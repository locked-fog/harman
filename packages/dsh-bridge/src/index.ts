import { request as httpRequest } from 'node:http'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { JsonValue } from './types.js'
import type {} from './compat/typert-protocol.js'

interface Envelope { ok?: boolean; result?: JsonValue; error?: { code?: string; message?: string } }

async function callDaemon(method: string, path: string, body?: JsonValue): Promise<JsonValue> {
  const home = resolve(process.env.HARMAN_HOME ?? join(homedir(), '.harman'))
  const token = (await readFile(join(home, 'daemon.token'), 'utf8')).trim()
  const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body))
  return new Promise((resolveCall, reject) => {
    const request = httpRequest({
      socketPath: join(home, 'daemon.sock'), method, path, timeout: 15_000,
      headers: { authorization: `Bearer ${token}`, ...(payload === undefined ? {} : { 'content-type': 'application/json', 'content-length': payload.length }) },
    }, response => {
      const chunks: Buffer[] = []
      response.on('data', chunk => chunks.push(chunk))
      response.on('end', () => {
        let envelope: Envelope
        try { envelope = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Envelope } catch { return reject(new Error('Harman daemon returned invalid JSON')) }
        if (envelope.ok !== true) return reject(new Error(`${envelope.error?.code ?? 'DAEMON_ERROR'}: ${envelope.error?.message ?? 'request failed'}`))
        resolveCall(envelope.result ?? null)
      })
    })
    request.on('timeout', () => request.destroy(new Error('Harman daemon timeout')))
    request.on('error', reject)
    if (payload !== undefined) request.write(payload)
    request.end()
  })
}

export class HarmanGateway extends TypertRemoteService {
  constructor(ctx: Context) { super(ctx, 'harman') }

  @Remote('snapshot')
  snapshot(): Promise<JsonValue> { return callDaemon('GET', '/v1/snapshot') }

  @Remote('query')
  query(subject: string, input: JsonValue): Promise<JsonValue> {
    return callDaemon('POST', '/v1/query', { subject, input })
  }

  @Remote('preview')
  preview(action: string, input: JsonValue): Promise<JsonValue> {
    return callDaemon('POST', '/v1/preview', { action, input })
  }

  @Remote('execute')
  execute(action: string, input: JsonValue, expectedRevision: number, confirmed: boolean): Promise<JsonValue> {
    return callDaemon('POST', '/v1/transactions', { action, input, expectedRevision, confirmed })
  }
}

export default HarmanGateway
