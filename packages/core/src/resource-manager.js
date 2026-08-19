import { createHash, randomUUID } from 'node:crypto'
import {
  lstat, mkdir, readFile, readdir, rename, rm, stat, writeFile,
} from 'node:fs/promises'
import { basename, join, resolve, sep } from 'node:path'
import {
  addResource, bindResource, detachResource, setResourceEnabled,
} from './domain.js'
import { ConflictError, NotFoundError, ValidationError } from './errors.js'

const TYPES = new Set(['skill', 'agents', 'prompt', 'mcp', 'context'])

function slug(value) {
  const normalized = value.normalize('NFKC').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
  return normalized || 'resource'
}

async function pathKind(path) {
  try {
    const info = await lstat(path)
    if (info.isSymbolicLink()) return 'symlink'
    if (info.isDirectory()) return 'directory'
    if (info.isFile()) return 'file'
    return 'unsupported'
  } catch (error) {
    if (error?.code === 'ENOENT') return 'missing'
    throw error
  }
}

export async function fingerprintPath(path, options = {}) {
  const hash = createHash('sha256')
  async function visit(current, relative) {
    const info = await lstat(current)
    if (info.isSymbolicLink()) throw new ValidationError(`resource contains a symbolic link: ${current}`)
    if (info.isDirectory()) {
      hash.update(`d\0${relative}\0`)
      for (const entry of (await readdir(current)).sort()) await visit(join(current, entry), relative === '' ? entry : `${relative}/${entry}`)
    } else if (info.isFile()) {
      hash.update(`f\0${relative}\0${info.mode & 0o777}\0`)
      if (options.metadataOnly) hash.update(`${info.size}\0${Math.trunc(info.mtimeMs)}\0`)
      else hash.update(await readFile(current))
    } else {
      throw new ValidationError(`resource contains an unsupported filesystem object: ${current}`)
    }
  }
  await visit(path, '')
  return hash.digest('hex')
}

async function copyNoLinks(source, destination) {
  const info = await lstat(source)
  if (info.isSymbolicLink()) throw new ValidationError(`refusing to adopt symbolic link ${source}`)
  if (info.isDirectory()) {
    await mkdir(destination, { mode: 0o700 })
    for (const entry of (await readdir(source)).sort()) await copyNoLinks(join(source, entry), join(destination, entry))
  } else if (info.isFile()) {
    await writeFile(destination, await readFile(source), { flag: 'wx', mode: 0o600 })
  } else {
    throw new ValidationError(`refusing to adopt unsupported filesystem object ${source}`)
  }
}

function discovery(type, path, scope, source, options = {}) {
  const name = options.name ?? (type === 'agents' ? `${scope}-agents` : basename(path).replace(/\.[^.]+$/, ''))
  return { id: `${type}/${slug(name)}`, type, displayName: name, location: resolve(path), scope, source }
}

export class ResourceManager {
  constructor(stateStore, options = {}) {
    this.stateStore = stateStore
    this.managedRoot = resolve(options.managedRoot ?? stateStore.managedResourceRoot)
  }

  async discover(options = {}) {
    const candidates = []
    const userHome = resolve(options.userHome)
    const projectRoot = resolve(options.projectRoot)
    async function directoryChildren(root, type, scope, source) {
      if (await pathKind(root) !== 'directory') return
      for (const name of (await readdir(root)).sort()) {
        const identity = type === 'prompt' ? name.replace(/\.[^.]+$/, '') : name
        candidates.push(discovery(type, join(root, name), scope, source, { name: identity }))
      }
    }
    await directoryChildren(join(userHome, '.agents', 'skills'), 'skill', 'user', 'scan:user-skills')
    await directoryChildren(join(projectRoot, '.agents', 'skills'), 'skill', 'project', 'scan:project-skills')
    await directoryChildren(join(userHome, '.agents', 'prompts'), 'prompt', 'user', 'scan:user-prompts')
    await directoryChildren(join(projectRoot, '.agents', 'prompts'), 'prompt', 'project', 'scan:project-prompts')
    if (await pathKind(join(projectRoot, 'AGENTS.md')) === 'file') candidates.push(discovery('agents', join(projectRoot, 'AGENTS.md'), 'project', 'scan:agents'))
    for (const path of [join(userHome, '.codex', 'config.toml'), join(projectRoot, '.mcp.json')]) {
      if (await pathKind(path) === 'file') candidates.push(discovery('mcp', path, path.startsWith(projectRoot + sep) ? 'project' : 'user', 'scan:mcp'))
    }
    return candidates
  }

  async scan(options) {
    await this.stateStore.initialize()
    const found = []
    for (const candidate of await this.discover(options)) {
      const kind = await pathKind(candidate.location)
      if (kind === 'symlink' || kind === 'unsupported') {
        found.push({ ...candidate, status: 'rejected', reason: kind })
        continue
      }
      const fingerprint = await fingerprintPath(candidate.location, { metadataOnly: candidate.type === 'mcp' })
      found.push({ ...candidate, ownership: 'external', available: true, fingerprint, status: 'discovered' })
    }
    const transaction = await this.stateStore.transaction({ action: 'resource.scan', details: { count: found.length } }, state => {
      const results = []
      const seen = new Set()
      for (const item of found) {
        if (item.status === 'rejected') { results.push(item); continue }
        seen.add(item.id)
        const existing = state.resources[item.id]
        if (existing === undefined) {
          addResource(state, item)
          results.push({ id: item.id, status: 'added', fingerprint: item.fingerprint })
        } else if (existing.location !== item.location || existing.type !== item.type) {
          results.push({ id: item.id, status: 'conflict', existingLocation: existing.location, discoveredLocation: item.location })
        } else {
          const changed = existing.fingerprint !== item.fingerprint
          existing.fingerprint = item.fingerprint
          existing.available = true
          results.push({ id: item.id, status: changed ? 'changed' : 'unchanged', fingerprint: item.fingerprint })
        }
      }
      for (const resource of Object.values(state.resources)) {
        if (resource.ownership === 'external' && String(resource.source).startsWith('scan:') && !seen.has(resource.id)) resource.available = false
      }
      return results
    })
    return transaction.result
  }

  async list() {
    return Object.values((await this.stateStore.read()).resources).sort((a, b) => a.id.localeCompare(b.id))
  }

  async show(id) {
    const resource = (await this.stateStore.read()).resources[id]
    if (resource === undefined) throw new NotFoundError(`resource ${id} does not exist`)
    return resource
  }

  async register(type, location, options = {}) {
    if (!TYPES.has(type)) throw new ValidationError(`unsupported resource type ${type}`)
    const actual = resolve(location)
    const kind = await pathKind(actual)
    if (!['file', 'directory'].includes(kind)) throw new ValidationError(`resource location is not a regular file or directory: ${actual}`)
    const id = options.id ?? `${type}/${slug(options.name ?? basename(actual).replace(/\.[^.]+$/, ''))}`
    const fingerprint = await fingerprintPath(actual, { metadataOnly: type === 'mcp' })
    const transaction = await this.stateStore.transaction({ action: 'resource.register', details: { id, location: actual } }, state => addResource(state, {
      id, type, location: actual, ownership: 'external', scope: options.scope ?? 'other',
      source: 'register', fingerprint, displayName: options.name ?? id,
    }))
    return transaction.result
  }

  async adopt(id, options = {}) {
    const resource = await this.show(id)
    if (resource.ownership !== 'external') throw new ConflictError(`only external resources can be adopted`, { id, ownership: resource.ownership })
    const target = resolve(this.managedRoot, ...id.split('/'))
    if (target !== this.managedRoot && !target.startsWith(this.managedRoot + sep)) throw new ValidationError('managed resource target escapes root')
    const plan = { id, source: resource.location, target, sourcePreserved: true, rollback: 'remove managed copy and retain external record' }
    if (options.dryRun) return { dryRun: true, plan }
    if (!options.confirmed) throw new ConflictError('resource adoption requires --yes after reviewing impact', { plan })
    if (await pathKind(target) !== 'missing') throw new ConflictError(`managed target already exists`, { target })
    const stage = `${target}.stage-${randomUUID()}`
    await mkdir(resolve(this.managedRoot, id.split('/')[0]), { recursive: true, mode: 0o700 })
    try {
      await copyNoLinks(resource.location, stage)
      await rename(stage, target)
      const fingerprint = await fingerprintPath(target, { metadataOnly: resource.type === 'mcp' })
      await this.stateStore.transaction({ action: 'resource.adopt', details: { id, target } }, state => {
        const current = state.resources[id]
        if (current === undefined) throw new NotFoundError(`resource ${id} disappeared during adoption`)
        if (current.ownership !== 'external' || current.location !== resource.location || current.fingerprint !== resource.fingerprint) {
          throw new ConflictError(`resource ${id} changed during adoption`)
        }
        current.ownership = 'managed'
        current.location = target
        current.manifestOwner = 'harman'
        current.source = `adopt:${resource.location}`
        current.fingerprint = fingerprint
        return current
      })
      return { dryRun: false, plan, resource: await this.show(id) }
    } catch (error) {
      await rm(stage, { recursive: true, force: true })
      await rm(target, { recursive: true, force: true })
      throw error
    }
  }

  async setEnabled(id, enabled, profile) {
    const transaction = await this.stateStore.transaction({ action: enabled ? 'resource.enable' : 'resource.disable', details: { id, profile: profile ?? null } }, state => {
      if (profile !== undefined) return enabled ? bindResource(state, profile, id) : detachResource(state, profile, id)
      return setResourceEnabled(state, id, enabled)
    })
    return transaction.result
  }

  async bind(id, profile) {
    return (await this.stateStore.transaction({ action: 'resource.bind', details: { id, profile } }, state => bindResource(state, profile, id))).result
  }

  async detach(id, profile) {
    return (await this.stateStore.transaction({ action: 'resource.detach', details: { id, profile } }, state => detachResource(state, profile, id))).result
  }
}
