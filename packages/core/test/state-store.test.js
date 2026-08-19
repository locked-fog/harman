import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  StateBusyError, StateStore, StaleRevisionError, UnsupportedSchemaError,
  addPackage, addResource, createProfile,
} from '../src/index.js'

async function fixture(options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'harman-state-'))
  const store = new StateStore(root, options)
  await store.initialize()
  return { root, store }
}

async function waitForFile(path, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      await stat(path)
      return
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error(`timed out waiting for ${path}`)
}

async function waitForProcessGone(pid, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0)
    } catch (error) {
      if (error?.code === 'ESRCH') return
      throw error
    }
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error(`child ${pid} did not exit after SIGKILL`)
}

async function killAtStage(root, stage) {
  const marker = join(root, `${stage}.marker`)
  const child = spawn(process.execPath, [new URL('./crash-helper.mjs', import.meta.url).pathname, root, stage, marker], {
    stdio: 'ignore',
  })
  await waitForFile(marker)
  assert.equal(child.kill('SIGKILL'), true)
  await waitForProcessGone(child.pid)
  child.unref()
}

test('initializes strict state with private permissions and stable reread', async () => {
  const { root, store } = await fixture()
  const state = await store.read()
  assert.equal(state.schemaVersion, 2)
  assert.equal(state.revision, 0)
  assert.deepEqual(state.packages, {})
  assert.deepEqual(state.repositories, {})
  assert.equal((await stat(join(root, 'state.json'))).mode & 0o777, 0o600)
  assert.deepEqual(await store.initialize(), state)
})

test('transaction commits domain change, revision, and redacted audit atomically', async () => {
  const { store } = await fixture()
  const outcome = await store.transaction({
    action: 'package.add',
    actor: 'test',
    details: { name: 'demo', api_token: 'do-not-store', nested: { password: 'hidden' } },
    expectedRevision: 0,
  }, (draft) => addPackage(draft, {
    name: 'demo', version: '1.0.0', contentHash: 'a'.repeat(64), source: 'fixture',
  }))
  assert.equal(outcome.state.revision, 1)
  assert.equal(outcome.result.id, 'demo@1.0.0')
  assert.equal(outcome.state.audit[0].details.api_token, '<redacted>')
  assert.equal(outcome.state.audit[0].details.nested.password, '<redacted>')
  assert.equal((await store.read()).packages['demo@1.0.0'].source, 'fixture')
})

test('a mutator failure leaves state and audit unchanged', async () => {
  const { root, store } = await fixture()
  await assert.rejects(
    store.transaction({ action: 'explode' }, () => { throw new Error('boom') }),
    /boom/,
  )
  assert.equal((await store.read()).revision, 0)
  await assert.rejects(stat(join(root, 'transaction-intent.json')), { code: 'ENOENT' })
})

test('an interruption after journal preserves intent as aborted and keeps old state', async () => {
  let tripped = false
  const { root, store } = await fixture({
    failpoint(stage) {
      if (stage === 'afterJournal' && !tripped) {
        tripped = true
        throw new Error('simulated crash before temporary state')
      }
    },
  })
  await assert.rejects(store.transaction({ action: 'package.add' }, draft => addPackage(draft, {
    name: 'demo', version: '1', contentHash: 'b'.repeat(64),
  })), /simulated crash/)
  assert.equal((await store.read()).revision, 0)
  const recovered = new StateStore(root)
  await recovered.initialize()
  const entries = await import('node:fs/promises').then(fs => fs.readdir(join(root, 'recovery')))
  assert.equal(entries.length, 1)
  assert.equal((await recovered.read()).revision, 0)
})

test('an interruption after publish is recognized as committed during recovery', async () => {
  let tripped = false
  const { root, store } = await fixture({
    failpoint(stage) {
      if (stage === 'afterPublish' && !tripped) {
        tripped = true
        throw new Error('simulated crash after publish')
      }
    },
  })
  await assert.rejects(store.transaction({ action: 'package.add' }, draft => addPackage(draft, {
    name: 'demo', version: '1', contentHash: 'c'.repeat(64),
  })), /simulated crash/)
  assert.equal((await store.read()).revision, 1)
  const recovered = new StateStore(root)
  await recovered.initialize()
  assert.equal((await recovered.read()).packages['demo@1'].version, '1')
  await assert.rejects(stat(join(root, 'transaction-intent.json')), { code: 'ENOENT' })
})

test('revision precondition and writer lock fail closed', async () => {
  const { root, store } = await fixture()
  await assert.rejects(
    store.transaction({ action: 'noop', expectedRevision: 9 }, () => {}),
    error => error instanceof StaleRevisionError && error.code === 'STALE_REVISION',
  )
  await mkdir(join(root, 'state.lock'))
  await writeFile(join(root, 'state.lock', 'owner.json'), `{"pid":${process.pid},"acquiredAt":"test"}\n`)
  await assert.rejects(
    store.transaction({ action: 'noop' }, () => {}),
    error => error instanceof StateBusyError && error.details.pid === process.pid,
  )
})

test('actual SIGKILL before publish reclaims dead lock and preserves old state', async () => {
  const { root } = await fixture()
  await killAtStage(root, 'afterJournal')
  const recovered = new StateStore(root)
  await recovered.initialize()
  const state = await recovered.read()
  assert.equal(state.revision, 0)
  assert.deepEqual(state.packages, {})
  const recoveryEntries = await import('node:fs/promises').then(fs => fs.readdir(join(root, 'recovery')))
  assert.ok(recoveryEntries.some(name => name.includes('dead-lock')))
  assert.ok(recoveryEntries.some(name => name.endsWith('.json')))
})

test('actual SIGKILL after publish reclaims lock and recognizes committed state', async () => {
  const { root } = await fixture()
  await killAtStage(root, 'afterPublish')
  const recovered = new StateStore(root)
  await recovered.initialize()
  const state = await recovered.read()
  assert.equal(state.revision, 1)
  assert.equal(state.packages['crash-fixture@1'].version, '1')
  await assert.rejects(stat(join(root, 'transaction-intent.json')), { code: 'ENOENT' })
})

test('future schema is refused without mutating it', async () => {
  const { root, store } = await fixture()
  const state = await store.read()
  state.schemaVersion = 99
  await writeFile(join(root, 'state.json'), JSON.stringify(state) + '\n')
  await assert.rejects(store.read(), error => error instanceof UnsupportedSchemaError)
  assert.match(await readFile(join(root, 'state.json'), 'utf8'), /"schemaVersion":99/)
})

test('schema v1 requires and supports an explicit v1 to v2 migration', async () => {
  const { root, store } = await fixture()
  const state = await store.read()
  delete state.repositories
  state.schemaVersion = 1
  await writeFile(join(root, 'state.json'), JSON.stringify(state) + '\n')
  await assert.rejects(store.read(), error => error instanceof UnsupportedSchemaError)
  const migrated = await store.migrate()
  assert.equal(migrated.schemaVersion, 2)
  assert.deepEqual(migrated.repositories, {})
  assert.equal((await store.read()).revision, 0)
})

test('managed resource must remain within managed root', async () => {
  const { root, store } = await fixture()
  await assert.rejects(store.transaction({ action: 'resource.add' }, (draft) => {
    addResource(draft, {
      id: 'skill/escape', type: 'skill', ownership: 'managed',
      location: join(root, 'outside'), manifestOwner: 'harman',
    })
  }))
  await store.transaction({ action: 'resource.add' }, (draft) => addResource(draft, {
    id: 'skill/safe', type: 'skill', ownership: 'managed', location: join(root, 'unused'),
    managedRelativePath: 'skill/safe', manifestOwner: 'harman',
  }, { managedResourceRoot: store.managedResourceRoot }))
  assert.equal((await store.read()).resources['skill/safe'].ownership, 'managed')
})

test('profile runtime requires exactly latest channel or exact pin', async () => {
  const { root, store } = await fixture()
  await assert.rejects(store.transaction({ action: 'profile.add' }, draft => createProfile(draft, {
    name: 'bad', dshHome: join(root, 'bad'), runtime: { channel: 'latest', version: '0.1.0' },
  })))
  await store.transaction({ action: 'profile.add' }, draft => createProfile(draft, {
    name: 'latest', dshHome: join(root, 'latest'), runtime: { channel: 'latest' },
  }))
  await store.transaction({ action: 'profile.add' }, draft => createProfile(draft, {
    name: 'pinned', dshHome: join(root, 'pinned'), runtime: { version: '0.1.0-rc.7' },
  }))
  const state = await store.read()
  assert.deepEqual(state.profiles.latest.runtime, { channel: 'latest' })
  assert.deepEqual(state.profiles.pinned.runtime, { version: '0.1.0-rc.7' })
})
