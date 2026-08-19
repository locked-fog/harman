import { createHash, randomUUID } from 'node:crypto'
import { gunzipSync } from 'node:zlib'
import {
  chmod, mkdir, readFile, rename, rm, stat, writeFile,
} from 'node:fs/promises'
import { dirname, join, posix, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ConflictError, ValidationError } from './errors.js'

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function parseOctal(buffer, start, length, label) {
  const text = buffer.subarray(start, start + length).toString('ascii').replaceAll('\0', '').trim()
  if (text === '') return 0
  if (!/^[0-7]+$/.test(text)) throw new ValidationError(`tar ${label} is not octal`)
  return Number.parseInt(text, 8)
}

function tarString(buffer, start, length) {
  const end = buffer.indexOf(0, start)
  return buffer.subarray(start, end === -1 || end > start + length ? start + length : end).toString('utf8')
}

function safeRelativePath(raw) {
  if (raw.includes('\0') || raw.includes('\\') || raw.startsWith('/')) throw new ValidationError(`unsafe tar path ${raw}`)
  const normalized = posix.normalize(raw)
  const parts = normalized.split('/').filter(Boolean)
  if (parts[0] !== 'package') throw new ValidationError(`tar entry must live below package/: ${raw}`)
  const stripped = parts.slice(1)
  if (stripped.length === 0) return ''
  if (stripped.some(part => part === '..' || part === '.')) throw new ValidationError(`unsafe tar path ${raw}`)
  return stripped.join('/')
}

export function inspectTarGz(bytes, options = {}) {
  if (bytes.length > (options.maxCompressedBytes ?? 100 * 1024 * 1024)) throw new ValidationError('compressed artifact exceeds size limit')
  let tar
  try {
    tar = gunzipSync(bytes, { maxOutputLength: options.maxUncompressedBytes ?? 512 * 1024 * 1024 })
  } catch (error) {
    throw new ValidationError(`artifact is not a bounded gzip tar: ${error.message}`)
  }
  const entries = []
  const names = new Set()
  let offset = 0
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512)
    if (header.every(byte => byte === 0)) break
    const storedChecksum = parseOctal(header, 148, 8, 'checksum')
    const checksumHeader = Buffer.from(header)
    checksumHeader.fill(32, 148, 156)
    const actualChecksum = checksumHeader.reduce((sum, byte) => sum + byte, 0)
    if (storedChecksum !== actualChecksum) throw new ValidationError('tar header checksum mismatch')
    const name = tarString(header, 0, 100)
    const prefix = tarString(header, 345, 155)
    const rawPath = prefix === '' ? name : `${prefix}/${name}`
    const relative = safeRelativePath(rawPath)
    const size = parseOctal(header, 124, 12, 'size')
    const type = String.fromCharCode(header[156] || 48)
    if (!['0', '5'].includes(type)) throw new ValidationError(`tar entry ${rawPath} has forbidden type ${type}`)
    if (names.has(relative)) throw new ValidationError(`tar entry path is duplicated: ${rawPath}`)
    names.add(relative)
    const dataStart = offset + 512
    const dataEnd = dataStart + size
    if (dataEnd > tar.length) throw new ValidationError(`tar entry ${rawPath} exceeds archive bounds`)
    if (relative !== '') entries.push({ relative, type, mode: parseOctal(header, 100, 8, 'mode'), bytes: tar.subarray(dataStart, dataEnd) })
    offset = dataStart + Math.ceil(size / 512) * 512
  }
  if (entries.length === 0) throw new ValidationError('artifact contains no package entries')
  return entries
}

export async function extractInspectedEntries(entries, destination) {
  const boundary = resolve(destination)
  await mkdir(boundary, { recursive: true, mode: 0o700 })
  for (const entry of entries) {
    const target = join(boundary, ...entry.relative.split('/'))
    const actual = resolve(target)
    if (actual !== boundary && !actual.startsWith(boundary + sep)) throw new ValidationError(`entry escapes extraction root: ${entry.relative}`)
    if (entry.type === '5') {
      await mkdir(actual, { recursive: true, mode: 0o700 })
    } else {
      await mkdir(dirname(actual), { recursive: true, mode: 0o700 })
      await writeFile(actual, entry.bytes, { flag: 'wx', mode: 0o600 })
    }
  }
}

async function artifactBytes(url, maxBytes) {
  if (url.startsWith('file:')) {
    const bytes = await readFile(fileURLToPath(url))
    if (bytes.length > maxBytes) throw new ValidationError('artifact exceeds size limit')
    return bytes
  }
  const response = await fetch(url)
  if (!response.ok) throw new ConflictError(`artifact download failed with HTTP ${response.status}`, { url, status: response.status })
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) throw new ValidationError('artifact content-length exceeds size limit')
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.length > maxBytes) throw new ValidationError('artifact exceeds size limit')
  return bytes
}

export async function downloadVerifiedArtifact(url, expectedSha256, maxBytes = 100 * 1024 * 1024) {
  const bytes = await artifactBytes(url, maxBytes)
  const actual = sha256(bytes)
  if (actual !== expectedSha256) throw new ConflictError('artifact hash mismatch', { expected: expectedSha256, actual })
  return bytes
}

export async function makeReadOnly(root, options = {}) {
  const { readdir } = await import('node:fs/promises')
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) {
      await makeReadOnly(path)
      await chmod(path, 0o555)
    } else {
      await chmod(path, 0o444)
    }
  }
  if (!options.preserveRootWritable) await chmod(root, 0o555)
}

async function makeRemovable(root) {
  const { readdir } = await import('node:fs/promises')
  try {
    await chmod(root, 0o700)
  } catch (error) {
    if (error?.code === 'ENOENT') return
    throw error
  }
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) await makeRemovable(path)
    else await chmod(path, 0o600)
  }
}

export class PackageStore {
  constructor(root, options = {}) {
    this.root = resolve(root)
    this.objects = join(this.root, 'objects', 'sha256')
    this.staging = join(this.root, 'staging')
    this.maxArtifactBytes = options.maxArtifactBytes ?? 100 * 1024 * 1024
  }

  objectPath(hash) {
    if (!/^[a-f0-9]{64}$/.test(hash)) throw new ValidationError('invalid Store content hash')
    return join(this.objects, hash.slice(0, 2), hash)
  }

  async importArtifact(input) {
    const bytes = await downloadVerifiedArtifact(input.url, input.sha256, this.maxArtifactBytes)
    const actualHash = sha256(bytes)
    const destination = this.objectPath(actualHash)
    try {
      const existing = JSON.parse(await readFile(join(destination, '.harman-object.json'), 'utf8'))
      if (existing.artifactSha256 !== actualHash) throw new ConflictError('existing Store object manifest mismatches its path')
      if (existing.name !== input.name || existing.version !== input.version) {
        throw new ConflictError('existing Store object identity mismatches repository metadata')
      }
      await makeReadOnly(destination)
      return { path: destination, artifactSha256: actualHash, manifest: existing, reused: true }
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
    const stage = join(this.staging, randomUUID())
    await mkdir(stage, { recursive: true, mode: 0o700 })
    try {
      const entries = inspectTarGz(bytes)
      await extractInspectedEntries(entries, stage)
      const packageJsonPath = join(stage, 'package.json')
      const packageManifest = JSON.parse(await readFile(packageJsonPath, 'utf8'))
      if (packageManifest.name !== input.name || packageManifest.version !== input.version) {
        throw new ConflictError('artifact package identity does not match repository metadata', {
          expected: { name: input.name, version: input.version },
          actual: { name: packageManifest.name, version: packageManifest.version },
        })
      }
      const objectManifest = {
        schemaVersion: 1,
        name: input.name,
        version: input.version,
        artifactSha256: actualHash,
        files: entries.filter(entry => entry.type === '0').map(entry => ({ path: entry.relative, sha256: sha256(entry.bytes) })).sort((a, b) => a.path.localeCompare(b.path)),
      }
      await writeFile(join(stage, '.harman-object.json'), JSON.stringify(objectManifest, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
      await makeReadOnly(stage, { preserveRootWritable: true })
      await mkdir(dirname(destination), { recursive: true })
      try {
        await rename(stage, destination)
        await chmod(destination, 0o555)
      } catch (error) {
        if (error?.code !== 'EEXIST' && error?.code !== 'ENOTEMPTY') throw error
        await makeRemovable(stage)
        await rm(stage, { recursive: true, force: true })
      }
      return { path: destination, artifactSha256: actualHash, manifest: objectManifest, reused: false }
    } catch (error) {
      try {
        await makeRemovable(stage)
        await rm(stage, { recursive: true, force: true })
      } catch (cleanupError) {
        error.cleanupError = cleanupError
      }
      throw error
    }
  }
}
