import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
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

test('repository Runtime channel follows latest and keeps compatibility diagnostics for downgrade decisions', async () => {
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
  const promotedBreaking = await runtimes.syncLatest(await packages.sources())
  assert.equal(promotedBreaking.compatibility, 'breaking')
  assert.equal(promotedBreaking.changed, true)
  assert.equal((await runtimes.resolve({ channel: 'latest' })).version, '0.2.0')
  assert.equal((await runtimes.resolve({ version: '0.1.0' })).version, '0.1.0')
  assert.equal((await runtimes.list()).find(runtime => runtime.version === '0.2.0').compatibility, 'breaking')
  const gc = await packages.collectStore({ dryRun: true })
  assert.equal(gc.plan.remove.length, 0)
})

test('Runtime detection imports the global DSH package without a manual hash or version entry', async () => {
  const root = await mkdtemp(join(tmpdir(), 'harman-runtime-detect-'))
  const packageRoot = join(root, 'node_modules', '@deepseek-ai', 'dsh')
  const script = join(packageRoot, 'bin', 'dsh.mjs')
  await mkdir(join(packageRoot, 'bin'), { recursive: true })
  await writeFile(join(packageRoot, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version: '11.7.0', bin: { dsh: 'bin/dsh.mjs' } }))
  await writeFile(script, '#!/usr/bin/env node\nconsole.log("detected")\n')

  const store = new StateStore(join(root, 'home'))
  await store.initialize()
  const runtimes = new RuntimeManager(store)
  const detected = await runtimes.detect({ packageRoots: [packageRoot] })

  assert.equal(detected.changed, true)
  assert.equal(detected.detected.id, 'dsh@11.7.0')
  assert.equal(detected.detected.compatibility, 'unvalidated')
  assert.equal(detected.detected.latest, true)
  assert.equal(detected.detected.launcherArgs.length, 1)
  assert.equal((await runtimes.resolve({ channel: 'latest' })).version, '11.7.0')
  assert.equal((await runtimes.resolve({ version: '11.7.0' })).contentHash.length, 64)
})
