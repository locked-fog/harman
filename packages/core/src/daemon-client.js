import { request as httpRequest } from 'node:http'
import { readFile } from 'node:fs/promises'
import { ConflictError, HarmanError } from './errors.js'

export class DaemonClient {
  constructor(options) {
    this.socketPath = options.socketPath
    this.tokenPath = options.tokenPath
    this.timeoutMs = options.timeoutMs ?? 10_000
  }

  async request(method, path, body) {
    let token
    try { token = (await readFile(this.tokenPath, 'utf8')).trim() } catch (error) {
      throw new ConflictError('Harman daemon credential is unavailable', { cause: error?.code })
    }
    const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body))
    return new Promise((resolveRequest, reject) => {
      const request = httpRequest({
        socketPath: this.socketPath, path, method,
        headers: {
          authorization: `Bearer ${token}`,
          accept: 'application/json',
          ...(payload === undefined ? {} : { 'content-type': 'application/json', 'content-length': payload.length }),
        },
        timeout: this.timeoutMs,
      }, response => {
        const chunks = []
        response.on('data', chunk => chunks.push(chunk))
        response.on('end', () => {
          let envelope
          try { envelope = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { return reject(new ConflictError('Harman daemon returned invalid JSON')) }
          if (!envelope.ok) return reject(new HarmanError(envelope.error?.code ?? 'DAEMON_ERROR', envelope.error?.message ?? 'daemon request failed', envelope.error?.details))
          resolveRequest(envelope.result)
        })
      })
      request.on('timeout', () => request.destroy(new Error('daemon request timed out')))
      request.on('error', error => reject(new ConflictError('Harman daemon is unavailable', { cause: error?.code ?? error?.message })))
      if (payload !== undefined) request.write(payload)
      request.end()
    })
  }

  snapshot() { return this.request('GET', '/v1/snapshot') }
  query(subject, input) { return this.request('POST', '/v1/query', { subject, input }) }
  preview(action, input) { return this.request('POST', '/v1/preview', { action, input }) }
  execute(action, input, options) {
    return this.request('POST', '/v1/transactions', { action, input, expectedRevision: options.expectedRevision, confirmed: options.confirmed === true })
  }
}
