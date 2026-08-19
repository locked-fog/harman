import assert from 'node:assert/strict'
import { request } from 'node:http'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createDaemon } from '../../../apps/daemon/server.js'
import { DaemonClient } from '../src/daemon-client.js'

async function raw(socketPath, token, method, path, body) {
  const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body))
  return new Promise((resolveRequest, reject) => {
    const call = request({ socketPath, path, method, headers: {
      ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
      ...(payload === undefined ? {} : { 'content-type': 'application/json', 'content-length': payload.length }),
    } }, response => {
      const chunks = []
      response.on('data', chunk => chunks.push(chunk))
      response.on('end', () => resolveRequest({ status: response.statusCode, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }))
    })
    call.on('error', reject)
    if (payload !== undefined) call.write(payload)
    call.end()
  })
}

test('daemon authenticates local IPC and fences stale Web transactions', async t => {
  const home = await mkdtemp(join(tmpdir(), 'harman-daemon-'))
  const daemon = await createDaemon({ home })
  t.after(() => daemon.close())
  assert.equal((await raw(daemon.socketPath, undefined, 'GET', '/v1/snapshot')).status, 401)
  assert.equal((await raw(daemon.socketPath, 'wrong', 'GET', '/v1/snapshot')).status, 401)
  const client = new DaemonClient({ socketPath: daemon.socketPath, tokenPath: daemon.tokenPath })
  const initial = await client.snapshot()
  assert.equal(initial.revision, 0)
  const preview = await client.preview('profile.create', { name: 'web', app: 'web' })
  assert.equal(preview.expectedRevision, 0)
  const committed = await client.execute('profile.create', { name: 'web', app: 'web' }, { expectedRevision: 0 })
  assert.equal(committed.snapshot.profiles[0].app, 'web')
  assert.deepEqual(await client.query('package.search', { query: 'missing' }), [])
  await assert.rejects(() => client.query('unsupported', {}), error => error.code === 'VALIDATION_ERROR')
  await assert.rejects(() => client.execute('profile.create', { name: 'stale' }, { expectedRevision: 0 }), error => error.code === 'STALE_REVISION')
  assert.equal((await readFile(daemon.tokenPath, 'utf8')).trim().length > 30, true)
})

test('client fails closed when daemon or credential is unavailable', async () => {
  const home = await mkdtemp(join(tmpdir(), 'harman-daemon-down-'))
  const client = new DaemonClient({ socketPath: join(home, 'missing.sock'), tokenPath: join(home, 'missing.token') })
  await assert.rejects(() => client.snapshot(), error => error.code === 'CONFLICT')
})
