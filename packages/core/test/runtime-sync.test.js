import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { PackageManager, RuntimeManager, StateStore } from '../src/index.js'

function octal(value, length) { return value.toString(8).padStart(length - 1, '0') + '\0' }
function runtimeTar(version, compatible) {
  const files = [
    ['package/package.json', JSON.stringify({ name: '@deepseek-ai/dsh-runtime', version })],
    ['package/bin/dsh.mjs', `if (process.argv.includes('--help')) process.exit(${compatible ? 0 : 2})\nconsole.log('runtime ${version}')\n`],
  ]
  const chunks = []
  for (const [path, text] of files) {
    const body = Buffer.from(text); const header = Buffer.alloc(512); header.write(path)
    header.write(octal(0o644, 8), 100, 8, 'ascii'); header.write(octal(body.length, 12), 124, 12, 'ascii')
    header.fill(32, 148, 156); header[156] = 48; header.write('ustar\0', 257, 6, 'ascii'); header.write('00', 263, 2, 'ascii')
    header.write(octal(header.reduce((sum, byte) => sum + byte, 0), 8), 148, 8, 'ascii')
    chunks.push(header, body, Buffer.alloc((512 - body.length % 512) % 512))
  }
  return gzipSync(Buffer.concat([...chunks, Buffer.alloc(1024)]))
}

test('repository Runtime channel promotes compatible latest and refuses a breaking release', async () => {
  const root = await mkdtemp(join(tmpdir(), 'harman-runtime-sync-'))
  const repositoryRoot = join(root, 'repository')
  await import('node:fs/promises').then(fs => fs.mkdir(repositoryRoot, { recursive: true }))
  async function publish(sequence, version, compatible) {
    const bytes = runtimeTar(version, compatible)
    const artifact = `dsh-${version}.tgz`
    await writeFile(join(repositoryRoot, artifact), bytes)
    await writeFile(join(repositoryRoot, 'index.json'), JSON.stringify({
      schemaVersion: 1, sequence, generatedAt: `2026-08-19T00:00:0${sequence}Z`, packages: {},
      runtimes: { dsh: [{ version, official: true, source: `official-fixture:${version}`, executablePath: 'bin/dsh.mjs', artifact: { url: `./${artifact}`, sha256: createHash('sha256').update(bytes).digest('hex') } }] },
    }))
  }
  const state = new StateStore(join(root, 'home')); await state.initialize()
  const packages = new PackageManager(state); const runtimes = new RuntimeManager(state)
  await packages.addRepository({ id: 'official', url: pathToFileURL(join(repositoryRoot, 'index.json')).href, priority: 100, trustPolicy: 'hash-only' })
  await publish(1, '0.1.0', true); await packages.sync()
  const preview = await runtimes.syncLatest(await packages.sources(), { dryRun: true })
  assert.equal(preview.available.version, '0.1.0')
  const promoted = await runtimes.syncLatest(await packages.sources())
  assert.equal(promoted.changed, true)
  assert.equal((await runtimes.resolve({ channel: 'latest' })).version, '0.1.0')
  await publish(2, '0.2.0', false); await packages.sync()
  const rejected = await runtimes.syncLatest(await packages.sources())
  assert.equal(rejected.compatibility, 'breaking')
  assert.equal((await runtimes.resolve({ channel: 'latest' })).version, '0.1.0')
  assert.equal((await runtimes.list()).find(runtime => runtime.version === '0.2.0').compatibility, 'breaking')
  const gc = await packages.collectStore({ dryRun: true })
  assert.equal(gc.plan.remove.length, 0)
})
