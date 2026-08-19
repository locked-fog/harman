import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { mkdtemp, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import {
  PackageStore, ProfileBundleManager, ProfileManager, ResourceManager,
  RuntimeManager, StateStore, addPackage,
} from '../src/index.js'

function octal(value, length) { return value.toString(8).padStart(length - 1, '0') + '\0' }
function packageTar(name, version) {
  const files = [['package/package.json', JSON.stringify({ name, version })], ['package/index.js', 'export default true\n']]
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

async function runtime(store) {
  const manager = new RuntimeManager(store)
  const script = new URL('../../../tests/fixtures/fake-dsh.mjs', import.meta.url).pathname
  const hash = createHash('sha256').update(await readFile(script)).digest('hex')
  const record = await manager.register({ version: '0.1.0-rc.7', executable: process.execPath, launcherArgs: [script], contentHash: hash, source: 'fixture', compatibility: 'compatible', official: true })
  await manager.setLatest(record.id)
  return manager
}

async function sourceFixture() {
  const root = await mkdtemp(join(tmpdir(), 'harman-export-'))
  const store = new StateStore(join(root, 'source-home')); await store.initialize()
  const runtimes = await runtime(store)
  const archive = packageTar('portable', '1.0.0'); const archivePath = join(root, 'portable.tgz'); await writeFile(archivePath, archive)
  const hash = createHash('sha256').update(archive).digest('hex')
  await new PackageStore(join(store.root, 'store')).importArtifact({ name: 'portable', version: '1.0.0', url: pathToFileURL(archivePath).href, sha256: hash })
  await store.transaction({ action: 'fixture.package' }, state => addPackage(state, { name: 'portable', version: '1.0.0', contentHash: hash, source: 'fixture' }))
  const external = join(root, 'external.md'); await writeFile(external, 'external stays external\n')
  const resources = new ResourceManager(store); await resources.register('prompt', external, { id: 'prompt/external' })
  const managedSource = join(root, 'managed.md'); await writeFile(managedSource, 'managed content\n')
  await resources.register('prompt', managedSource, { id: 'prompt/managed' }); await resources.adopt('prompt/managed', { confirmed: true })
  const profiles = new ProfileManager(store, { runtimes })
  await profiles.create({ name: 'portable', app: 'web', packages: ['portable@1.0.0'], resources: ['prompt/external', 'prompt/managed'], models: { apiKey: { secretRef: 'env:MODEL_KEY' } } })
  assert.equal((await profiles.run('portable', ['--dump-config'])).code, 0)
  const bundle = join(root, 'bundle'); await new ProfileBundleManager(store, { profiles }).export('portable', bundle)
  return { root, store, bundle, external }
}

test('strict offline restore reconstructs Package, managed Resource, lock identity, and exact Runtime', async () => {
  const { root, bundle, external } = await sourceFixture()
  const target = new StateStore(join(root, 'target-home')); await target.initialize(); const runtimes = await runtime(target)
  const profiles = new ProfileManager(target, { runtimes }); const result = await new ProfileBundleManager(target, { profiles }).restore(bundle, { name: 'restored', mode: 'strict' })
  assert.equal(result.equivalent, true)
  assert.equal((await profiles.show('restored')).runtime.version, '0.1.0-rc.7')
  assert.equal((await profiles.show('restored')).app, 'web')
  const state = await target.read(); assert.ok(state.packages['portable@1.0.0']); assert.equal(state.resources['prompt/external'].ownership, 'external')
  assert.equal(await readFile(external, 'utf8'), 'external stays external\n')
  assert.equal(await readFile(state.resources['prompt/managed'].location, 'utf8'), 'managed content\n')
  assert.ok(!JSON.stringify(JSON.parse(await readFile(join(bundle, 'profile-export.json')))).includes('literal-secret'))
})

test('follow-latest preserves channel policy and records the restore choice', async () => {
  const { root, bundle } = await sourceFixture()
  const target = new StateStore(join(root, 'follow-home')); await target.initialize(); const runtimes = await runtime(target)
  const profiles = new ProfileManager(target, { runtimes }); const result = await new ProfileBundleManager(target, { profiles }).restore(bundle, { name: 'follow', mode: 'follow-latest' })
  assert.equal(result.runtimeSelection.channel, 'latest'); assert.equal((await profiles.show('follow')).runtime.channel, 'latest'); assert.equal(result.equivalent, true)
})

test('missing external Resource and tampered manifest fail without a visible Profile', async () => {
  const { root, bundle, external } = await sourceFixture(); await rename(external, `${external}.offline`)
  const target = new StateStore(join(root, 'failure-home')); await target.initialize(); const runtimes = await runtime(target)
  const profiles = new ProfileManager(target, { runtimes }); const bundles = new ProfileBundleManager(target, { profiles })
  await assert.rejects(bundles.restore(bundle, { name: 'missing', mode: 'strict' }))
  assert.equal(Object.keys((await target.read()).profiles).length, 0)
  const manifestPath = join(bundle, 'profile-export.json'); const manifest = JSON.parse(await readFile(manifestPath)); manifest.exportedProfile = 'tampered'; await writeFile(manifestPath, JSON.stringify(manifest))
  await assert.rejects(bundles.restore(bundle, { name: 'tampered', mode: 'strict' }), /manifest hash mismatch/)
})
