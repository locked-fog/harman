import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { createServer } from 'node:http'
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import {
  ConflictError, PackageStore, RecipeBuilder, ValidationError, compareVersions, inspectTarGz,
  readRepositoryCache, searchRepositoryIndexes, solvePackages, syncRepository,
  validateRepositoryIndex, satisfies,
} from '../src/index.js'

function octal(value, length) {
  return value.toString(8).padStart(length - 1, '0') + '\0'
}

function tar(entries) {
  const chunks = []
  for (const entry of entries) {
    const body = Buffer.from(entry.body ?? '')
    const header = Buffer.alloc(512)
    header.write(entry.name, 0, 100, 'utf8')
    header.write(octal(entry.mode ?? 0o644, 8), 100, 8, 'ascii')
    header.write(octal(0, 8), 108, 8, 'ascii')
    header.write(octal(0, 8), 116, 8, 'ascii')
    header.write(octal(body.length, 12), 124, 12, 'ascii')
    header.write(octal(0, 12), 136, 12, 'ascii')
    header.fill(32, 148, 156)
    header[156] = (entry.type ?? '0').charCodeAt(0)
    header.write('ustar\0', 257, 6, 'ascii')
    header.write('00', 263, 2, 'ascii')
    const checksum = header.reduce((sum, byte) => sum + byte, 0)
    header.write(octal(checksum, 8), 148, 8, 'ascii')
    chunks.push(header, body, Buffer.alloc((512 - body.length % 512) % 512))
  }
  chunks.push(Buffer.alloc(1024))
  return gzipSync(Buffer.concat(chunks))
}

function index(sequence = 1) {
  return {
    schemaVersion: 1,
    sequence,
    generatedAt: '2026-08-19T00:00:00Z',
    packages: {
      demo: [
        { version: '1.0.0', description: 'demo stable', artifact: { url: './demo.tgz', sha256: 'a'.repeat(64) }, dependencies: {} },
        { version: '2.0.0-rc.1', description: 'demo preview', artifact: { url: './demo-rc.tgz', sha256: 'b'.repeat(64) }, dependencies: { dep: '^1.0.0' } },
      ],
      dep: [{ version: '1.2.0', artifact: { url: './dep.tgz', sha256: 'c'.repeat(64) }, dependencies: {} }],
    },
  }
}

test('semantic versions preserve prerelease order and supported constraints', () => {
  assert.ok(compareVersions('1.0.0-rc.7', '1.0.0-rc.6') > 0)
  assert.ok(compareVersions('1.0.0', '1.0.0-rc.7') > 0)
  assert.equal(satisfies('1.4.2', '^1.2.0'), true)
  assert.equal(satisfies('2.0.0', '^1.2.0'), false)
  assert.equal(satisfies('0.1.9', '^0.1.2'), true)
  assert.equal(satisfies('0.2.0', '^0.1.2'), false)
  assert.equal(satisfies('1.3.0', '>=1.2.0 <2.0.0'), true)
})

test('repository validation, atomic file sync, search, and rollback refusal', async () => {
  const root = await mkdtemp(join(tmpdir(), 'harman-repo-'))
  const source = join(root, 'source-index.json')
  await writeFile(source, JSON.stringify(index(3)))
  const repository = { id: 'main', url: pathToFileURL(source).href, priority: 10, enabled: true, etag: null, sequence: null }
  const synced = await syncRepository(root, repository)
  assert.equal(synced.changed, true)
  assert.equal((await readRepositoryCache(root, 'main')).sequence, 3)
  assert.deepEqual(searchRepositoryIndexes([{ repository, index: synced.index }], 'stable')[0], {
    repository: 'main', name: 'demo', version: '2.0.0-rc.1', description: 'demo preview',
  })
  await writeFile(source, JSON.stringify(index(2)))
  await assert.rejects(syncRepository(root, { ...repository, sequence: 3 }), error => error instanceof ConflictError)
  assert.equal((await readRepositoryCache(root, 'main')).sequence, 3)
})

test('HTTP repository conditional request keeps validated cache on 304', async () => {
  const root = await mkdtemp(join(tmpdir(), 'harman-http-repo-'))
  const body = JSON.stringify(index(4))
  let requests = 0
  const server = createServer((request, response) => {
    requests += 1
    if (request.headers['if-none-match'] === '"v4"') {
      response.writeHead(304)
      response.end()
    } else {
      response.writeHead(200, { 'content-type': 'application/json', etag: '"v4"' })
      response.end(body)
    }
  })
  await new Promise(resolveServer => server.listen(0, '127.0.0.1', resolveServer))
  try {
    const address = server.address()
    const repository = { id: 'http', url: `http://127.0.0.1:${address.port}/index.json`, priority: 0, enabled: true, etag: null, sequence: null }
    const first = await syncRepository(root, repository)
    const second = await syncRepository(root, { ...repository, etag: first.etag, sequence: 4 })
    assert.equal(second.changed, false)
    assert.equal(second.index.sequence, 4)
    assert.equal(requests, 2)
  } finally {
    await new Promise(resolveServer => server.close(resolveServer))
  }
})

test('repository network interruption preserves the last validated cache', async () => {
  const root = await mkdtemp(join(tmpdir(), 'harman-http-interrupted-'))
  const good = JSON.stringify(index(7))
  let interrupted = false
  const server = createServer((_request, response) => {
    if (!interrupted) { response.end(good); return }
    response.writeHead(200, { 'content-type': 'application/json', 'content-length': good.length * 2 })
    response.write(good.slice(0, 20))
    response.destroy()
  })
  await new Promise(resolveServer => server.listen(0, '127.0.0.1', resolveServer))
  try {
    const address = server.address()
    const repository = { id: 'flaky', url: `http://127.0.0.1:${address.port}/index.json`, priority: 0, enabled: true, etag: null, sequence: null }
    const first = await syncRepository(root, repository)
    interrupted = true
    await assert.rejects(syncRepository(root, { ...repository, sequence: 7, indexHash: first.indexHash }))
    assert.equal((await readRepositoryCache(root, 'flaky')).sequence, 7)
  } finally {
    await new Promise(resolveServer => server.close(resolveServer))
  }
})

test('deterministic solver resolves dependencies, DSH compatibility, holds, and conflicts', () => {
  const repository = { id: 'main', priority: 10, enabled: true }
  const catalogIndex = index()
  catalogIndex.packages.demo[1].dsh = '>=0.1.0-rc.7 <0.2.0'
  const solved = solvePackages([{ repository, index: catalogIndex }], [{ name: 'demo', range: '*' }], {
    dshVersion: '0.1.0-rc.7', platform: 'linux', arch: 'x64',
  })
  assert.deepEqual(solved.packages.map(pkg => `${pkg.name}@${pkg.version}`), ['demo@2.0.0-rc.1', 'dep@1.2.0'])
  assert.equal(solved.packages.find(pkg => pkg.name === 'dep').reason, 'dependency')
  const held = solvePackages([{ repository, index: catalogIndex }], [{ name: 'demo' }], {
    holds: { demo: '1.0.0' }, dshVersion: '0.1.0-rc.7',
  })
  assert.equal(held.packages[0].version, '1.0.0')
  assert.throws(() => solvePackages([{ repository, index: catalogIndex }], [{ name: 'demo', range: '^3.0.0' }]), ConflictError)
})

test('tar inspection rejects traversal, links, duplicate paths, and checksum damage', async () => {
  assert.throws(() => inspectTarGz(tar([{ name: 'package/../../escape', body: 'x' }])), ValidationError)
  assert.throws(() => inspectTarGz(tar([{ name: 'package/link', type: '2' }])), ValidationError)
  assert.throws(() => inspectTarGz(tar([{ name: 'package/a', body: '1' }, { name: 'package/a', body: '2' }])), ValidationError)
  const damaged = tar([{ name: 'package/a', body: '1' }])
  const uncompressed = await import('node:zlib').then(zlib => zlib.gunzipSync(damaged))
  uncompressed[10] ^= 1
  assert.throws(() => inspectTarGz(gzipSync(uncompressed)), /checksum/)
})

test('Store verifies artifact and identity, imports immutably, and reuses by hash', async () => {
  const root = await mkdtemp(join(tmpdir(), 'harman-store-'))
  const archive = tar([
    { name: 'package/package.json', body: JSON.stringify({ name: 'demo', version: '1.0.0', dsh: { bundle: { patch: './cordis.patch.yml' } } }) },
    { name: 'package/cordis.patch.yml', body: '[]\n' },
    { name: 'package/lib/index.js', body: 'export const value = 1\n' },
  ])
  const archivePath = join(root, 'demo.tgz')
  await writeFile(archivePath, archive)
  const hash = createHash('sha256').update(archive).digest('hex')
  const store = new PackageStore(join(root, 'store'))
  const imported = await store.importArtifact({ name: 'demo', version: '1.0.0', url: pathToFileURL(archivePath).href, sha256: hash })
  assert.equal(imported.reused, false)
  assert.equal(JSON.parse(await readFile(join(imported.path, 'package.json'))).name, 'demo')
  assert.equal((await stat(imported.path)).mode & 0o222, 0)
  assert.equal((await stat(join(imported.path, 'lib', 'index.js'))).mode & 0o222, 0)
  const reused = await store.importArtifact({ name: 'demo', version: '1.0.0', url: pathToFileURL(archivePath).href, sha256: hash })
  assert.equal(reused.reused, true)
  await assert.rejects(store.importArtifact({ name: 'other', version: '1.0.0', url: pathToFileURL(archivePath).href, sha256: hash }), ConflictError)
  await assert.rejects(store.importArtifact({ name: 'demo', version: '1.0.0', url: pathToFileURL(archivePath).href, sha256: '0'.repeat(64) }), ConflictError)
})

test('Store garbage collection is previewed, confirmed, and retains every referenced object', async () => {
  const root = await mkdtemp(join(tmpdir(), 'harman-store-gc-'))
  const store = new PackageStore(join(root, 'store'))
  async function importOne(name) {
    const archive = tar([{ name: 'package/package.json', body: JSON.stringify({ name, version: '1.0.0' }) }])
    const path = join(root, `${name}.tgz`)
    await writeFile(path, archive)
    const hash = createHash('sha256').update(archive).digest('hex')
    const imported = await store.importArtifact({ name, version: '1.0.0', url: pathToFileURL(path).href, sha256: hash })
    return { hash, path: imported.path }
  }
  const retained = await importOne('retained')
  const orphan = await importOne('orphan')
  const preview = await store.garbageCollect([retained.hash], { dryRun: true })
  assert.deepEqual(preview.plan.remove, [orphan.hash])
  await assert.rejects(store.garbageCollect([retained.hash]), ConflictError)
  await store.garbageCollect([retained.hash], { confirmed: true })
  assert.equal((await stat(retained.path)).isDirectory(), true)
  await assert.rejects(stat(orphan.path), error => error.code === 'ENOENT')
})

test('invalid repository index fails before cache publication', () => {
  const bad = index()
  bad.packages.demo[0].artifact.sha256 = '../bad'
  assert.throws(() => validateRepositoryIndex(bad), ValidationError)
})

test('recipe build is hash-pinned, environment-clean, filesystem-confined, and network-isolated', async () => {
  const root = await mkdtemp(join(tmpdir(), 'harman-recipe-'))
  const product = tar([
    { name: 'package/package.json', body: JSON.stringify({ name: 'built-demo', version: '1.0.0' }) },
    { name: 'package/index.js', body: 'export const built = true\n' },
  ])
  const buildScript = `
import { writeFile } from 'node:fs/promises'
if (process.env.HARMAN_RECIPE_SECRET !== undefined) throw new Error('secret leaked')
if (process.env.HOME !== '/nonexistent' || process.env.SOURCE_DATE_EPOCH !== '123') throw new Error('environment is not deterministic')
try { await writeFile('/etc/harman-recipe-escape', 'bad') ; throw new Error('system filesystem writable') } catch (error) { if (error.message === 'system filesystem writable') throw error }
try { await fetch('http://127.0.0.1:9/') ; throw new Error('network unexpectedly reachable') } catch (error) { if (error.message === 'network unexpectedly reachable') throw error }
await writeFile('result.tgz', Buffer.from('${product.toString('base64')}', 'base64'))
`
  const source = tar([
    { name: 'package/package.json', body: JSON.stringify({ name: 'source', version: '1.0.0' }) },
    { name: 'package/build.mjs', body: buildScript },
  ])
  const sourcePath = join(root, 'source.tgz')
  await writeFile(sourcePath, source)
  const recipe = {
    schemaVersion: 1,
    name: 'built-demo',
    version: '1.0.0',
    sourceDateEpoch: 123,
    source: { type: 'npm-tgz', url: pathToFileURL(sourcePath).href, sha256: createHash('sha256').update(source).digest('hex') },
    build: { network: false, commands: [['node', 'build.mjs']] },
    outputArtifact: 'result.tgz',
  }
  const previous = process.env.HARMAN_RECIPE_SECRET
  process.env.HARMAN_RECIPE_SECRET = 'must-not-leak'
  try {
    const result = await new RecipeBuilder(join(root, 'home')).build(recipe)
    assert.equal(result.recipe.name, 'built-demo')
    assert.equal(result.imported.manifest.name, 'built-demo')
    assert.equal(result.logs[0].code, 0)
    await assert.rejects(new RecipeBuilder(join(root, 'missing'), { bwrap: join(root, 'not-bwrap') }).build(recipe), /bwrap is missing/)
  } finally {
    if (previous === undefined) delete process.env.HARMAN_RECIPE_SECRET
    else process.env.HARMAN_RECIPE_SECRET = previous
  }
})

test('recipe output cannot escape its build root', async () => {
  const root = await mkdtemp(join(tmpdir(), 'harman-recipe-path-'))
  const source = tar([{ name: 'package/package.json', body: JSON.stringify({ name: 'source', version: '1.0.0' }) }])
  const sourcePath = join(root, 'source.tgz')
  await writeFile(sourcePath, source)
  await assert.rejects(new RecipeBuilder(join(root, 'home')).build({
    schemaVersion: 1, name: 'built-demo', version: '1.0.0',
    source: { type: 'npm-tgz', url: pathToFileURL(sourcePath).href, sha256: createHash('sha256').update(source).digest('hex') },
    build: { commands: [['true']] }, outputArtifact: '../escape.tgz',
  }), ValidationError)
})
