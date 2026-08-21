import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { chmod, mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { sandboxCapability } from '../../../scripts/sandbox-capability.mjs'
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

test('materialization removes attributable stale stages and read-only backups', async () => {
  const { home, manager } = await fixture()
  await manager.create({ name: 'cleanup' })
  const root = join(home, 'profiles', 'cleanup')
  for (const name of ['.dsh-home.stage-interrupted', '.dsh-home.backup-interrupted']) {
    const directory = join(root, name, 'nested')
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'readonly'), 'stale')
    await chmod(join(directory, 'readonly'), 0o444)
    await chmod(directory, 0o555)
    await chmod(join(root, name), 0o555)
  }
  await manager.materialize('cleanup')
  assert.deepEqual((await readdir(root)).filter(name => name.startsWith('.dsh-home.')), [])
})

test('materialization replaces only Harman-owned views and preserves private DSH state', async () => {
  const { manager } = await fixture()
  const created = await manager.create({ name: 'durable' })
  await writeFile(join(created.profile.dshHome, 'settings.yaml'), 'theme: dark\n')
  await mkdir(join(created.profile.dshHome, 'sessions'), { recursive: true })
  await writeFile(join(created.profile.dshHome, 'sessions', 'one.jsonl'), '{"event":"kept"}\n')
  await manager.materialize('durable')
  assert.equal(await readFile(join(created.profile.dshHome, 'settings.yaml'), 'utf8'), 'theme: dark\n')
  assert.equal(await readFile(join(created.profile.dshHome, 'sessions', 'one.jsonl'), 'utf8'), '{"event":"kept"}\n')
  assert.deepEqual(JSON.parse(await readFile(join(created.profile.dshHome, '.harman-managed.json'))).paths, ['.harman-managed.json', 'harman.lock.json', 'profiles/harman'])
})

test('materialization recovers a run marker whose owner process no longer exists', async () => {
  const { manager, store } = await fixture()
  await manager.create({ name: 'crashed' })
  await store.transaction({ action: 'fixture.crashed-run' }, state => {
    state.profiles.crashed.running = true
    state.profiles.crashed.runOwnerPid = 2_147_483_647
    state.profiles.crashed.runStartedAt = '2026-08-19T00:00:00Z'
  })
  await manager.materialize('crashed')
  const recovered = await manager.show('crashed')
  assert.equal(recovered.running, false)
  assert.equal(recovered.runOwnerPid, null)
})

test('two Profiles run concurrently with private state and read-only access outside their own DSH_HOME', { skip: sandboxCapability.profile.skip }, async () => {
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

test('Profile composition orders instructions and materializes plugin, MCP, and model configuration without literals', async () => {
  const { manager, root, store } = await fixture()
  const first = join(root, 'first.md'); const second = join(root, 'second.md')
  await writeFile(first, 'first\n'); await writeFile(second, 'second\n')
  const resources = new ResourceManager(store)
  await resources.register('prompt', first, { id: 'prompt/first' })
  await resources.register('agents', second, { id: 'agents/second' })
  const created = await manager.create({
    name: 'composed', resources: ['prompt/first', 'agents/second'], promptOrder: ['agents/second', 'prompt/first'],
    pluginConfig: { 'agent-default-model': { provider: 'test', model: 'test-model' } },
    mcp: { local: { transport: 'stdio', command: 'true', args: [] } },
    models: { 'llm-deepseek': { apiKeyEnv: 'MODEL_KEY' } },
  })
  const instructions = await readFile(join(created.profile.dshHome, 'AGENTS.md'), 'utf8')
  assert.ok(instructions.indexOf('second') < instructions.indexOf('first'))
  const patch = JSON.parse(await readFile(join(created.profile.dshHome, 'profiles', 'harman', 'cordis.patch.yml')))
  assert.deepEqual(patch.find(item => item.id === 'agent-default-model').config, { provider: 'test', model: 'test-model' })
  assert.equal(patch.flatMap(item => item.insert ?? []).find(item => item.id === 'harman-mcp-local').config.serverName, 'local')
  assert.equal(patch.find(item => item.id === 'settings').config.path, join(created.profile.dshHome, 'settings.json'))
  assert.deepEqual(JSON.parse(await readFile(join(created.profile.dshHome, 'settings.json'))), { 'llm-deepseek': { apiKeyEnv: 'MODEL_KEY' } })
  await assert.rejects(manager.create({ name: 'conflict', cordisPatch: [{ id: 'settings', config: {} }], models: { x: {} } }), /conflict/)
})
