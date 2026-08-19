import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  ResourceManager, StateStore, createProfile,
} from '../src/index.js'

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'harman-resource-'))
  const userHome = join(root, 'user')
  const projectRoot = join(root, 'project')
  await mkdir(join(userHome, '.agents', 'skills', 'user-skill'), { recursive: true })
  await writeFile(join(userHome, '.agents', 'skills', 'user-skill', 'SKILL.md'), '# user\n')
  await mkdir(join(projectRoot, '.agents', 'skills', 'project-skill'), { recursive: true })
  await writeFile(join(projectRoot, '.agents', 'skills', 'project-skill', 'SKILL.md'), '# project\n')
  await mkdir(join(projectRoot, '.agents', 'prompts'), { recursive: true })
  await writeFile(join(projectRoot, '.agents', 'prompts', 'review.md'), 'review\n')
  await writeFile(join(projectRoot, 'AGENTS.md'), 'owned by user\n')
  await writeFile(join(projectRoot, '.mcp.json'), '{"token":"must-not-enter-state"}\n')
  await symlink('/etc', join(projectRoot, '.agents', 'skills', 'escape'))
  const store = new StateStore(join(root, 'home'))
  await store.initialize()
  return { root, userHome, projectRoot, store, manager: new ResourceManager(store) }
}

test('scan discovers all target types, rejects symlinks, is idempotent, and never stores MCP secrets', async () => {
  const { manager, projectRoot, store, userHome } = await fixture()
  const first = await manager.scan({ userHome, projectRoot })
  assert.ok(first.some(item => item.id === 'skill/user-skill' && item.status === 'added'))
  assert.ok(first.some(item => item.id === 'skill/project-skill' && item.status === 'added'))
  assert.ok(first.some(item => item.id === 'agents/project-agents' && item.status === 'added'))
  assert.ok(first.some(item => item.id === 'prompt/review' && item.status === 'added'))
  assert.ok(first.some(item => item.id === 'mcp/.mcp' && item.status === 'added'))
  assert.ok(first.some(item => item.id === 'skill/escape' && item.status === 'rejected'))
  assert.ok((await manager.scan({ userHome, projectRoot })).filter(item => item.status === 'unchanged').length >= 5)
  assert.ok(!JSON.stringify(await store.read()).includes('must-not-enter-state'))
})

test('scan marks missing external entries unavailable without deleting their records', async () => {
  const { manager, projectRoot, userHome } = await fixture()
  await manager.scan({ userHome, projectRoot })
  await import('node:fs/promises').then(fs => fs.rm(join(projectRoot, '.agents', 'prompts', 'review.md')))
  await manager.scan({ userHome, projectRoot })
  assert.equal((await manager.show('prompt/review')).available, false)
})

test('register and explicit adopt preserve external bytes and publish a managed copy', async () => {
  const { root, manager } = await fixture()
  const external = join(root, 'custom.md')
  await writeFile(external, 'external bytes\n')
  await manager.register('prompt', external, { id: 'prompt/custom', scope: 'project' })
  const before = await readFile(external)
  const preview = await manager.adopt('prompt/custom', { dryRun: true })
  assert.equal(preview.plan.sourcePreserved, true)
  await assert.rejects(manager.adopt('prompt/custom'), /requires --yes/)
  const adopted = await manager.adopt('prompt/custom', { confirmed: true })
  assert.equal(adopted.resource.ownership, 'managed')
  assert.deepEqual(await readFile(external), before)
  assert.deepEqual(await readFile(adopted.resource.location), before)
})

test('failed adopt transaction removes its managed copy and retains the external record', async () => {
  const { root } = await fixture()
  const external = join(root, 'failure.md')
  await writeFile(external, 'still external\n')
  const base = new StateStore(join(root, 'failure-home'))
  await base.initialize()
  const baseManager = new ResourceManager(base)
  await baseManager.register('prompt', external, { id: 'prompt/failure' })
  const failing = new StateStore(join(root, 'failure-home'), { failpoint(stage) { if (stage === 'afterJournal') throw new Error('injected') } })
  const target = join(failing.managedResourceRoot, 'prompt', 'failure')
  await assert.rejects(new ResourceManager(failing).adopt('prompt/failure', { confirmed: true }), /injected/)
  await assert.rejects(readFile(target), error => error.code === 'ENOENT')
  const recovered = new StateStore(join(root, 'failure-home'))
  await recovered.initialize()
  assert.equal((await new ResourceManager(recovered).show('prompt/failure')).ownership, 'external')
  assert.equal((await readFile(external, 'utf8')), 'still external\n')
})

test('enable, disable, bind, and detach maintain Profile relations without touching external content', async () => {
  const { manager, projectRoot, store, userHome } = await fixture()
  await manager.scan({ userHome, projectRoot })
  await store.transaction({ action: 'test.profile' }, state => createProfile(state, { name: 'work', dshHome: join(store.root, 'profiles', 'work', 'dsh-home') }))
  const external = join(projectRoot, 'AGENTS.md')
  const before = await readFile(external)
  await manager.setEnabled('agents/project-agents', false)
  assert.equal((await manager.show('agents/project-agents')).enabled, false)
  await manager.setEnabled('agents/project-agents', true)
  await manager.bind('agents/project-agents', 'work')
  assert.deepEqual((await manager.show('agents/project-agents')).boundProfiles, ['work'])
  await manager.detach('agents/project-agents', 'work')
  assert.deepEqual((await manager.show('agents/project-agents')).boundProfiles, [])
  assert.deepEqual(await readFile(external), before)
})
