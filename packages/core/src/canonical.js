import { createHash, randomUUID } from 'node:crypto'

const SECRET_KEY = /(?:^|[-_])(secret|password|token|api[-_]?key|private[-_]?key|credential)(?:$|[-_])/i

export function deepClone(value) {
  return structuredClone(value)
}

export function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue)
  if (value === null || typeof value !== 'object') return value
  const result = {}
  for (const key of Object.keys(value).sort()) result[key] = sortValue(value[key])
  return result
}

export function canonicalJson(value) {
  return JSON.stringify(sortValue(value)) + '\n'
}

export function contentHash(value) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex')
}

export function newTransactionId() {
  return randomUUID()
}

export function redactSecrets(value) {
  if (Array.isArray(value)) return value.map(redactSecrets)
  if (value === null || typeof value !== 'object') return value
  const result = {}
  for (const [key, child] of Object.entries(value)) {
    result[key] = SECRET_KEY.test(key) ? '<redacted>' : redactSecrets(child)
  }
  return result
}
