import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  ProfileManager, ResourceManager, RuntimeManager, StateStore,
} from '../src/index.js'

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'harman-profile-'))
  const home = join(root, 'home')
  const executable = process.execPath
  const fixtureScript = new URL('../../../tests/fixtures/fake-dsh.mjs', import.meta.url).pathname
  const hash = createHash('sha256').update(await readFile(fixtureScript)).digest('hex')
  const store = new StateStore(home)
  await store.initialize()
  const runtimes = new RuntimeManager(store)
  const runtime = await runtimes.register({ version: '0.1.0-rc.7', executable, launcherArgs: [fixtureScript], contentHash: hash, source: 'test-fixture', compatibility: 'compatible', official: true })
  await runtimes.setLatest(runtime.id)
  return { root, home, executable, store, runtimes, manager: new ProfileManager(store, { runtimes }) }
}

test('Runtime latest accepts only official compatible releases and exact pins resolve independently', async () => {
  const { executable, runtimes } = await fixture()
  const fixtureScript = new URL('../../../tests/fixtures/fake-dsh.mjs', import.meta.url).pathname
  const hash = createHash('sha256').update(await readFile(fixtureScript)).digest('hex')
  const breaking = await runtimes.register({ version: '0.2.0', executable, launcherArgs: [fixtureScript], contentHash: hash, source: 'fixture-breaking', compatibility: 'breaking', official: true })
  await assert.rejects(runtimes.setLatest(breaking.id), /cannot become latest/)
  assert.equal((await runtimes.resolve({ channel: 'latest' })).version, '0.1.0-rc.7')
  await assert.rejects(runtimes.resolve({ version: '0.2.0' }), /not compatible/)
})

test('Profile lifecycle keeps distinct DSH_HOME roots and materializes deterministic stock manifests', async () => {
  const { home, manager } = await fixture()
  const first = await manager.create({ name: 'one' })
  const second = await manager.clone('one', 'two')
  assert.notEqual(first.profile.dshHome, second.profile.dshHome)
  assert.equal(first.profile.runtime.channel, 'latest')
  const manifest = JSON.parse(await readFile(join(first.profile.dshHome, 'profiles', 'harman', 'package.json')))
  assert.deepEqual(manifest.dsh.profile.bundles.slice(0, 2), ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-headless'])
  assert.ok(!(await import('node:fs/promises').then(fs => fs.readdir(join(first.profile.dshHome, 'profiles', 'harman')))).includes('pnpm-lock.yaml'))
  assert.equal((await manager.doctor('one')).ok, true)
  assert.equal((await manager.diff('one', 'two')).runtime.equal, true)
  await manager.setRuntime('one', { version: '0.1.0-rc.7' })
  assert.equal((await manager.show('one')).runtime.version, '0.1.0-rc.7')
  await manager.setRuntime('one', { channel: 'latest' })
  assert.equal((await manager.show('one')).runtime.channel, 'latest')
  await manager.rename('two', 'renamed')
  assert.equal((await manager.show('renamed')).dshHome, join(home, 'profiles', 'renamed', 'dsh-home'))
  await assert.rejects(manager.show('two'), /does not exist/)
  assert.equal((await manager.remove('renamed', { dryRun: true })).impact.externalFilesModified, false)
  await assert.rejects(manager.remove('renamed'), /requires --yes/)
  assert.equal((await manager.remove('renamed', { confirmed: true })).deleted, 'renamed')
})

test('literal secrets are rejected while secret references remain declarative', async () => {
  const { manager } = await fixture()
  await assert.rejects(manager.create({ name: 'bad', models: { apiKey: 'literal' } }), /secretRef/)
  const created = await manager.create({ name: 'good', models: { apiKey: { secretRef: 'env:MODEL_KEY' } } })
  assert.equal(created.lock.config.models.apiKey.secretRef, 'env:MODEL_KEY')
})

test('two Profiles run concurrently with private state and read-only access outside their own DSH_HOME', async () => {
  const { manager, root } = await fixture()
  const a = await manager.create({ name: 'a' })
  const b = await manager.create({ name: 'b', runtime: { version: '0.1.0-rc.7' } })
  const forbidden = join(root, 'forbidden')
  await import('node:fs/promises').then(fs => fs.mkdir(forbidden))
  const [runA, runB] = await Promise.all([
    manager.run('a', ['--dump-config'], { env: { ...process.env, HARMAN_PROBE_FORBIDDEN: forbidden, HARMAN_OTHER_HOME: b.profile.dshHome } }),
    manager.run('b', ['--dump-config'], { env: { ...process.env, HARMAN_PROBE_FORBIDDEN: forbidden, HARMAN_OTHER_HOME: a.profile.dshHome } }),
  ])
  assert.equal(runA.code, 0, runA.stderr)
  assert.equal(runB.code, 0, runB.stderr)
  const outputA = JSON.parse(runA.stdout.trim())
  const outputB = JSON.parse(runB.stdout.trim())
  assert.equal(outputA.home, a.profile.dshHome)
  assert.equal(outputB.home, b.profile.dshHome)
  assert.notEqual(outputA.attempts.forbidden, 'writable')
  assert.notEqual(outputA.attempts.other, 'writable')
  assert.notEqual(outputB.attempts.other, 'writable')
  assert.match(await readFile(join(a.profile.dshHome, 'settings.yaml'), 'utf8'), new RegExp(a.profile.dshHome))
  assert.match(await readFile(join(b.profile.dshHome, 'settings.yaml'), 'utf8'), new RegExp(b.profile.dshHome))
  assert.equal((await manager.show('a')).active, false)
  assert.equal((await manager.show('b')).lastResolvedRuntime.version, '0.1.0-rc.7')
})

test('bound external instructions are composed without modifying their source', async () => {
  const { manager, root, store } = await fixture()
  const external = join(root, 'AGENTS.md')
  await writeFile(external, 'external instruction\n')
  await new ResourceManager(store).register('agents', external, { id: 'agents/project' })
  const before = await readFile(external)
  const created = await manager.create({ name: 'with-resource', resources: ['agents/project'] })
  assert.match(await readFile(join(created.profile.dshHome, 'AGENTS.md'), 'utf8'), /external instruction/)
  assert.deepEqual(await readFile(external), before)
})
