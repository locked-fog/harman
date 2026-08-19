import { createHash } from 'node:crypto'
import { mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { canonicalJson, contentHash } from './canonical.js'
import { ConflictError, ValidationError } from './errors.js'
import { compareVersions, parseVersion } from './semver.js'
import { verifyIndexTrust } from './trust.js'

export const REPOSITORY_INDEX_VERSION = 1

function object(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new ValidationError(`${label} must be an object`)
}

export function validateRepositoryIndex(index) {
  object(index, 'repository index')
  if (index.schemaVersion !== REPOSITORY_INDEX_VERSION) {
    throw new ValidationError(`unsupported repository index schema ${index.schemaVersion}`)
  }
  if (!Number.isInteger(index.sequence) || index.sequence < 0) throw new ValidationError('repository sequence must be non-negative')
  if (typeof index.generatedAt !== 'string' || Number.isNaN(Date.parse(index.generatedAt))) {
    throw new ValidationError('repository generatedAt must be RFC3339')
  }
  object(index.packages, 'repository packages')
  for (const [name, versions] of Object.entries(index.packages)) {
    if (!Array.isArray(versions) || versions.length === 0) throw new ValidationError(`package ${name} versions must be non-empty`)
    const seen = new Set()
    for (const entry of versions) {
      object(entry, `package ${name} entry`)
      parseVersion(entry.version)
      if (seen.has(entry.version)) throw new ValidationError(`package ${name} repeats version ${entry.version}`)
      seen.add(entry.version)
      if (typeof entry.artifact?.url !== 'string' || !/^[a-f0-9]{64}$/.test(entry.artifact?.sha256 ?? '')) {
        throw new ValidationError(`package ${name}@${entry.version} artifact is invalid`)
      }
      if (entry.artifact.signatures !== undefined && !Array.isArray(entry.artifact.signatures)) throw new ValidationError(`package ${name}@${entry.version} artifact signatures are invalid`)
      if (entry.dependencies !== undefined) object(entry.dependencies, `package ${name}@${entry.version} dependencies`)
      if (entry.resources !== undefined) {
        if (!Array.isArray(entry.resources)) throw new ValidationError(`package ${name}@${entry.version} resources must be an array`)
        const resourceIds = new Set()
        for (const resource of entry.resources) {
          object(resource, `package ${name}@${entry.version} Resource`)
          if (typeof resource.id !== 'string' || !/^[a-z][a-z0-9-]*\/[A-Za-z0-9._-]+$/.test(resource.id)) throw new ValidationError(`package ${name}@${entry.version} Resource id is invalid`)
          if (resourceIds.has(resource.id)) throw new ValidationError(`package ${name}@${entry.version} repeats Resource ${resource.id}`)
          resourceIds.add(resource.id)
          if (typeof resource.path !== 'string' || resource.path === '' || resource.path.startsWith('/') || resource.path.split('/').includes('..')) throw new ValidationError(`package ${name}@${entry.version} Resource path is unsafe`)
          if (typeof resource.type !== 'string' || resource.type !== resource.id.slice(0, resource.id.indexOf('/'))) throw new ValidationError(`package ${name}@${entry.version} Resource type is inconsistent`)
        }
      }
    }
  }
  if (index.runtimes !== undefined) {
    object(index.runtimes, 'repository runtimes')
    for (const [name, versions] of Object.entries(index.runtimes)) {
      if (name !== 'dsh' || !Array.isArray(versions)) throw new ValidationError(`runtime channel ${name} is invalid`)
      const seen = new Set()
      for (const entry of versions) {
        object(entry, 'DSH Runtime entry')
        parseVersion(entry.version)
        if (seen.has(entry.version)) throw new ValidationError(`DSH Runtime repeats version ${entry.version}`)
        seen.add(entry.version)
        if (entry.official !== true) throw new ValidationError(`DSH Runtime ${entry.version} must declare official provenance`)
        if (typeof entry.artifact?.url !== 'string' || !/^[a-f0-9]{64}$/.test(entry.artifact?.sha256 ?? '')) throw new ValidationError(`DSH Runtime ${entry.version} artifact is invalid`)
        if (typeof entry.executablePath !== 'string' || entry.executablePath === '' || entry.executablePath.startsWith('/') || entry.executablePath.split('/').includes('..')) throw new ValidationError(`DSH Runtime ${entry.version} executablePath is unsafe`)
      }
    }
  }
  return index
}

export function repositoryCachePath(root, id) {
  return join(resolve(root), 'cache', 'repositories', id, 'index.json')
}

async function loadUrl(url, etag) {
  if (url.startsWith('file:')) {
    const bytes = await readFile(fileURLToPath(url))
    return { status: 200, bytes, etag: `sha256:${createHash('sha256').update(bytes).digest('hex')}` }
  }
  const response = await fetch(url, { headers: etag === null || etag === undefined ? {} : { 'if-none-match': etag } })
  if (response.status === 304) return { status: 304, bytes: null, etag }
  if (!response.ok) throw new ConflictError(`repository fetch failed with HTTP ${response.status}`, { url, status: response.status })
  return { status: response.status, bytes: Buffer.from(await response.arrayBuffer()), etag: response.headers.get('etag') }
}

export async function syncRepository(root, repository, options = {}) {
  const cachePath = repositoryCachePath(root, repository.id)
  const response = await loadUrl(repository.url, repository.etag)
  if (response.status === 304) {
    const index = validateRepositoryIndex(JSON.parse(await readFile(cachePath, 'utf8')))
    const verifiedKeys = verifyIndexTrust(index, repository)
    return { changed: false, index, etag: repository.etag, indexHash: contentHash(index), verifiedKeys }
  }
  let index
  try {
    index = validateRepositoryIndex(JSON.parse(response.bytes.toString('utf8')))
  } catch (error) {
    throw new ValidationError(`repository ${repository.id} returned an invalid index: ${error.message}`)
  }
  if (!options.allowRollback && repository.sequence !== null && index.sequence < repository.sequence) {
    throw new ConflictError(`repository ${repository.id} sequence rolled back`, { previous: repository.sequence, received: index.sequence })
  }
  if (!options.allowRollback && repository.sequence !== null && index.sequence === repository.sequence && repository.indexHash !== null && contentHash(index) !== repository.indexHash) {
    throw new ConflictError(`repository ${repository.id} changed content without increasing sequence`, { sequence: index.sequence, previousHash: repository.indexHash, receivedHash: contentHash(index) })
  }
  const verifiedKeys = verifyIndexTrust(index, repository)
  await mkdir(dirname(cachePath), { recursive: true })
  const temporary = `${cachePath}.${process.pid}.tmp`
  try {
    await writeFile(temporary, canonicalJson(index), { flag: 'wx', mode: 0o600 })
    const file = await open(temporary, 'r')
    try { await file.sync() } finally { await file.close() }
    await rename(temporary, cachePath)
    const directory = await open(dirname(cachePath), 'r')
    try { await directory.sync() } finally { await directory.close() }
  } catch (error) {
    await rm(temporary, { force: true })
    throw error
  }
  return { changed: true, index, etag: response.etag, indexHash: contentHash(index), verifiedKeys }
}

export async function readRepositoryCache(root, id) {
  return validateRepositoryIndex(JSON.parse(await readFile(repositoryCachePath(root, id), 'utf8')))
}

export function searchRepositoryIndexes(sources, query) {
  const needle = query.toLocaleLowerCase()
  const results = []
  for (const { repository, index } of sources.sort((a, b) => b.repository.priority - a.repository.priority || a.repository.id.localeCompare(b.repository.id))) {
    for (const [name, versions] of Object.entries(index.packages)) {
      const matches = name.toLocaleLowerCase().includes(needle)
        || versions.some(entry => (entry.description ?? '').toLocaleLowerCase().includes(needle))
      if (!matches) continue
      const latest = [...versions].sort((a, b) => compareVersions(b.version, a.version))[0]
      results.push({ repository: repository.id, name, version: latest.version, description: latest.description ?? '' })
    }
  }
  return results
}

export function resolveArtifactUrl(repositoryUrl, artifactUrl) {
  return new URL(artifactUrl, repositoryUrl).href
}
