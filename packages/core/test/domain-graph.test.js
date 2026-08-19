import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  ConflictError, StateStore, addPackage, addResource, bindResource,
  createProfile, deleteProfile, detachResource, explainPackage, explainProfile,
  explainResource, packageImpact, profileImpact, removePackage, removeResource,
  setProfilePackages,
} from '../src/index.js'

async function populated() {
  const root = await mkdtemp(join(tmpdir(), 'harman-domain-'))
  const external = join(root, 'project', 'AGENTS.md')
  await import('node:fs/promises').then(fs => fs.mkdir(join(root, 'project'), { recursive: true }))
  await writeFile(external, 'owned by the user\n')
  const store = new StateStore(join(root, 'state'))
  await store.initialize()
  await store.transaction({ action: 'seed' }, (state) => {
    addPackage(state, { name: 'base', version: '1', contentHash: '1'.repeat(64) })
    addPackage(state, {
      name: 'plugin', version: '2', contentHash: '2'.repeat(64),
      dependencies: ['base@1'], reason: 'explicit', source: 'repo/main',
    })
    addResource(state, {
      id: 'skill/from-plugin', type: 'skill', ownership: 'package',
      packageId: 'plugin@2', location: join(root, 'store', 'plugin', 'skill'),
    })
    addResource(state, {
      id: 'agents/project', type: 'agents', ownership: 'external', location: external,
      source: 'scan', fingerprint: 'f'.repeat(64), scope: 'project',
    })
    createProfile(state, {
      name: 'coding', dshHome: join(root, 'profiles', 'coding', 'dsh-home'),
      packages: ['plugin@2'], resources: ['agents/project', 'skill/from-plugin'],
    })
  })
  return { root, external, store }
}

test('reference graph explains origin, reason, dependencies, ownership, and Profile use', async () => {
  const { store } = await populated()
  const state = await store.read()
  assert.deepEqual(explainPackage(state, 'base@1').dependedOnBy, ['plugin@2'])
  assert.deepEqual(explainPackage(state, 'plugin@2').profiles, ['coding'])
  assert.equal(explainResource(state, 'agents/project').ownership, 'external')
  assert.equal(explainProfile(state, 'coding').runtimePolicy.channel, 'latest')
  assert.equal(explainProfile(state, 'coding').resources.length, 2)
})

test('impact plans block referenced removal and promise no external file mutation', async () => {
  const { store } = await populated()
  const state = await store.read()
  assert.equal(packageImpact(state, 'plugin@2').allowed, false)
  assert.deepEqual(packageImpact(state, 'base@1').blockingDependents, ['plugin@2'])
  const impact = profileImpact(state, 'coding')
  assert.equal(impact.externalFilesModified, false)
  assert.equal(impact.allowed, true)
  assert.deepEqual(impact.detachedResources.map(item => item.ownership).sort(), ['external', 'package'])
})

test('package removal refuses Profile, dependency, and provided-Resource references', async () => {
  const { store } = await populated()
  await assert.rejects(
    store.transaction({ action: 'package.remove' }, state => removePackage(state, 'plugin@2')),
    error => error instanceof ConflictError && error.details.profiles.includes('coding'),
  )
  await assert.rejects(
    store.transaction({ action: 'package.remove' }, state => removePackage(state, 'base@1')),
    error => error instanceof ConflictError && error.details.dependents.includes('plugin@2'),
  )
})

test('detach and Profile deletion never modify external content', async () => {
  const { external, store } = await populated()
  const before = await readFile(external)
  await store.transaction({ action: 'resource.detach' }, state => detachResource(state, 'coding', 'agents/project'))
  assert.deepEqual(await readFile(external), before)
  await store.transaction({ action: 'profile.delete' }, state => deleteProfile(state, 'coding'))
  assert.deepEqual(await readFile(external), before)
  const state = await store.read()
  assert.ok(state.resources['agents/project'])
  assert.deepEqual(state.resources['agents/project'].boundProfiles, [])
})

test('external record removal returns no filesystem action and leaves bytes untouched', async () => {
  const { external, store } = await populated()
  const bytes = await readFile(external)
  await store.transaction({ action: 'resource.detach' }, state => detachResource(state, 'coding', 'agents/project'))
  const result = await store.transaction({ action: 'resource.remove' }, state => removeResource(state, 'agents/project'))
  assert.equal(result.result.filesystemAction, 'none')
  assert.deepEqual(await readFile(external), bytes)
})

test('bindings remain bidirectionally consistent', async () => {
  const { root, store } = await populated()
  await store.transaction({ action: 'resource.add-and-bind' }, (state) => {
    addResource(state, {
      id: 'prompt/review', type: 'prompt', ownership: 'external', location: join(root, 'review.md'),
    })
    bindResource(state, 'coding', 'prompt/review')
  })
  let state = await store.read()
  assert.ok(state.profiles.coding.resources.includes('prompt/review'))
  assert.deepEqual(state.resources['prompt/review'].boundProfiles, ['coding'])
  await store.transaction({ action: 'resource.detach' }, draft => detachResource(draft, 'coding', 'prompt/review'))
  state = await store.read()
  assert.ok(!state.profiles.coding.resources.includes('prompt/review'))
  assert.deepEqual(state.resources['prompt/review'].boundProfiles, [])
})

test('package set refuses missing identities before publication', async () => {
  const { store } = await populated()
  const before = await store.read()
  await assert.rejects(store.transaction({ action: 'profile.packages' }, state => {
    setProfilePackages(state, 'coding', ['missing@9'])
  }))
  assert.deepEqual(await store.read(), before)
})
