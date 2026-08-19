import { timingSafeEqual, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { ControlPlane, HarmanError, StateStore, ValidationError } from '../../packages/core/src/index.js'

const MAX_BODY = 1024 * 1024

function json(response, status, value) {
  const body = JSON.stringify(value) + '\n'
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  response.end(body)
}

async function bodyOf(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > MAX_BODY) throw new ValidationError('request body exceeds 1 MiB')
    chunks.push(chunk)
  }
  if (chunks.length === 0) return {}
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { throw new ValidationError('request body must be valid JSON') }
}

function tokenMatches(header, expected) {
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return false
  const actual = Buffer.from(header.slice(7))
  const wanted = Buffer.from(expected)
  return actual.length === wanted.length && timingSafeEqual(actual, wanted)
}

export async function ensureDaemonToken(home, supplied) {
  const path = join(home, 'daemon.token')
  await mkdir(home, { recursive: true, mode: 0o700 })
  if (supplied !== undefined) return { path, token: supplied }
  try { return { path, token: (await readFile(path, 'utf8')).trim() } } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  const token = randomBytes(32).toString('base64url')
  await writeFile(path, token + '\n', { flag: 'wx', mode: 0o600 })
  return { path, token }
}

export async function createDaemon(options) {
  const home = resolve(options.home)
  const socketPath = resolve(options.socketPath ?? join(home, 'daemon.sock'))
  const stateStore = options.stateStore ?? new StateStore(home)
  const control = options.control ?? new ControlPlane(stateStore)
  await stateStore.initialize()
  const credential = await ensureDaemonToken(home, options.token)
  await mkdir(dirname(socketPath), { recursive: true, mode: 0o700 })
  await rm(socketPath, { force: true })

  const server = createServer(async (request, response) => {
    try {
      if (!tokenMatches(request.headers.authorization, credential.token)) return json(response, 401, { ok: false, error: { code: 'UNAUTHORIZED', message: 'valid bearer token required' } })
      const url = new URL(request.url ?? '/', 'http://localhost')
      if (request.method === 'GET' && url.pathname === '/v1/health') return json(response, 200, { ok: true, status: 'ready' })
      if (request.method === 'GET' && url.pathname === '/v1/snapshot') return json(response, 200, { ok: true, result: await control.snapshot() })
      if (request.method === 'POST' && url.pathname === '/v1/query') {
        const body = await bodyOf(request)
        return json(response, 200, { ok: true, result: await control.query(body.subject, body.input) })
      }
      if (request.method === 'POST' && url.pathname === '/v1/preview') {
        const body = await bodyOf(request)
        return json(response, 200, { ok: true, result: await control.preview(body.action, body.input) })
      }
      if (request.method === 'POST' && url.pathname === '/v1/transactions') {
        const body = await bodyOf(request)
        const result = await control.execute(body.action, body.input, { expectedRevision: body.expectedRevision, confirmed: body.confirmed })
        return json(response, 200, { ok: true, result })
      }
      return json(response, 404, { ok: false, error: { code: 'NOT_FOUND', message: 'API route not found' } })
    } catch (error) {
      const status = error?.code === 'STALE_REVISION' ? 409 : error instanceof HarmanError ? 400 : 500
      return json(response, status, { ok: false, error: { code: error?.code ?? 'INTERNAL', message: error?.message ?? String(error), details: error?.details } })
    }
  })

  await new Promise((resolveListen, reject) => {
    server.once('error', reject)
    server.listen(socketPath, () => { server.off('error', reject); resolveListen() })
  })
  await chmod(socketPath, 0o600)
  return {
    home, socketPath, tokenPath: credential.path, server,
    async close() {
      await new Promise((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose()))
      await rm(socketPath, { force: true })
    },
  }
}
