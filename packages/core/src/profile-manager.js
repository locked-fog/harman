import { createHash, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import {
  access, chmod, copyFile, lstat, mkdir, readFile, readdir, readlink, rename, rm, symlink, writeFile,
} from 'node:fs/promises'
import { constants } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { canonicalJson, contentHash } from './canonical.js'
import { createProfile, deleteProfile } from './domain.js'
import { ConflictError, NotFoundError, ValidationError } from './errors.js'
import { profileImpact } from './graph.js'
import { PackageStore } from './package-store.js'
import { RuntimeManager } from './runtime-manager.js'

function profileRoot(stateStore, name) {
  return join(stateStore.root, 'profiles', name)
}

async function exists(path) {
  try { await lstat(path); return true } catch (error) { if (error?.code === 'ENOENT') return false; throw error }
}

async function materializePackageView(source, destination) {
  await mkdir(destination, { recursive: true, mode: 0o755 })
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const from = join(source, entry.name)
    const to = join(destination, entry.name)
    if (entry.isSymbolicLink()) throw new ConflictError(`Store object contains forbidden symlink: ${from}`)
    if (entry.isDirectory()) {
      await materializePackageView(from, to)
      await chmod(to, 0o555)
    } else if (entry.isFile()) {
      await copyFile(from, to, constants.COPYFILE_FICLONE)
      await chmod(to, 0o444)
    } else {
      throw new ConflictError(`Store object contains unsupported entry: ${from}`)
    }
  }
}

function pathInside(path, roots) {
  return roots.some(root => path === root || path.startsWith(`${root}/`))
}

function pathAncestor(path, roots) {
  return roots.some(root => root.startsWith(`${path}/`))
}

async function copyPreservedTree(source, destination, oldManaged, newManaged, relative = '') {
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const childRelative = relative === '' ? entry.name : `${relative}/${entry.name}`
    if (pathInside(childRelative, oldManaged)) continue
    const from = join(source, entry.name)
    const to = join(destination, entry.name)
    if (pathInside(childRelative, newManaged)) throw new ConflictError(`Harman managed path conflicts with existing Profile state: ${childRelative}`)
    const info = await lstat(from)
    if (info.isDirectory()) {
      if (!(await exists(to))) await mkdir(to, { mode: info.mode & 0o777 })
      else if (!(await lstat(to)).isDirectory()) throw new ConflictError(`Profile state conflicts with generated directory: ${childRelative}`)
      await copyPreservedTree(from, to, oldManaged, newManaged, childRelative)
      if (!pathAncestor(childRelative, newManaged)) await chmod(to, info.mode & 0o777)
    } else if (await exists(to)) {
      throw new ConflictError(`Profile state conflicts with generated path: ${childRelative}`)
    } else if (info.isSymbolicLink()) {
      await symlink(await readlink(from), to)
    } else if (info.isFile()) {
      await copyFile(from, to, constants.COPYFILE_FICLONE)
      await chmod(to, info.mode & 0o777)
    } else throw new ConflictError(`Profile state contains unsupported entry: ${childRelative}`)
  }
}

async function managedPaths(home) {
  try {
    const marker = JSON.parse(await readFile(join(home, '.harman-managed.json'), 'utf8'))
    if (!Array.isArray(marker.paths) || !marker.paths.every(path => typeof path === 'string')) throw new Error('invalid paths')
    return marker.paths
  } catch (error) {
    if (error?.code !== 'ENOENT') throw new ConflictError(`Profile managed-path marker is invalid: ${error.message}`)
  }
  const paths = ['profiles/harman', 'harman.lock.json', '.harman-managed.json']
  if (await exists(join(home, 'AGENTS.md'))) paths.push('AGENTS.md')
  try {
    const lock = JSON.parse(await readFile(join(home, 'harman.lock.json'), 'utf8'))
    for (const resource of lock.resources ?? []) if (resource.type === 'skill') paths.push(`skills/${resource.id.slice(resource.id.indexOf('/') + 1)}`)
  } catch {}
  return paths.sort()
}

async function makeProfileTreeRemovable(root) {
  let info
  try { info = await lstat(root) } catch (error) { if (error?.code === 'ENOENT') return; throw error }
  if (info.isSymbolicLink() || info.isFile()) { if (!info.isSymbolicLink()) await chmod(root, 0o600); return }
  if (!info.isDirectory()) return
  await chmod(root, 0o700)
  for (const entry of await readdir(root)) await makeProfileTreeRemovable(join(root, entry))
}

async function removeStaleMaterializations(root) {
  let entries
  try { entries = await readdir(root, { withFileTypes: true }) } catch (error) {
    if (error?.code === 'ENOENT') return
    throw error
  }
  for (const entry of entries) {
    if (!entry.name.startsWith('.dsh-home.stage-') && !entry.name.startsWith('.dsh-home.backup-')) continue
    const path = join(root, entry.name)
    await makeProfileTreeRemovable(path)
    await rm(path, { recursive: true, force: true })
  }
}

function runProcess(command, args, options) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { cwd: options.cwd, env: options.env, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', chunk => { stderr += chunk })
    child.on('error', reject)
    const timer = setTimeout(() => child.kill('SIGKILL'), options.timeoutMs)
    child.on('close', (code, signal) => {
      clearTimeout(timer)
      resolveRun({ code, signal, stdout, stderr })
    })
  })
}

function ensureConfigSecrets(value, path = 'config') {
  if (Array.isArray(value)) return value.forEach((item, index) => ensureConfigSecrets(item, `${path}[${index}]`))
  if (value === null || typeof value !== 'object') return
  for (const [key, child] of Object.entries(value)) {
    const referenceField = key === 'secretRef' || /(env|ref)$/i.test(key)
    if (!referenceField && /(token|password|secret|api[-_]?key)/i.test(key) && typeof child === 'string') {
      throw new ValidationError(`${path}.${key} must use {"secretRef":"..."} instead of a literal secret`)
    }
    ensureConfigSecrets(child, `${path}.${key}`)
  }
}

async function materializeTree(stateStore, profile, state, destination) {
  const internal = join(destination, 'profiles', 'harman')
  const modules = join(internal, 'node_modules')
  await mkdir(modules, { recursive: true, mode: 0o700 })
  const store = new PackageStore(join(stateStore.root, 'store'))
  const bundles = ['@deepseek-ai/dsh-base', profile.app === 'web'
    ? '@deepseek-ai/dsh-web-app'
    : '@deepseek-ai/dsh-headless']
  const dependencies = {}
  const inventory = []
  const ownedPaths = ['profiles/harman', 'harman.lock.json', '.harman-managed.json']
  for (const id of profile.packages) {
    const pkg = state.packages[id]
    if (pkg === undefined) throw new NotFoundError(`Profile package ${id} is missing`)
    const object = store.objectPath(pkg.contentHash)
    const manifest = JSON.parse(await readFile(join(object, '.harman-object.json'), 'utf8'))
    if (manifest.name !== pkg.name || manifest.version !== pkg.version || manifest.artifactSha256 !== pkg.contentHash) {
      throw new ConflictError(`Store object for ${id} failed identity verification`)
    }
    const link = join(modules, ...pkg.name.split('/'))
    await mkdir(dirname(link), { recursive: true, mode: 0o700 })
    await materializePackageView(object, link)
    await writeFile(join(link, '.harman-view.json'), canonicalJson({ storePath: object, contentHash: pkg.contentHash }), { flag: 'wx', mode: 0o444 })
    await chmod(link, 0o555)
    dependencies[pkg.name] = pkg.version
    bundles.push(pkg.name)
    inventory.push({ id, name: pkg.name, version: pkg.version, contentHash: pkg.contentHash, storePath: object })
  }
  const enabledResources = profile.resources.map(id => state.resources[id]).filter(resource => resource?.enabled)
  const resourceInventory = enabledResources.map(resource => ({
    id: resource.id, type: resource.type, ownership: resource.ownership,
    location: resource.location, fingerprint: resource.fingerprint,
  }))
  for (const resource of enabledResources.filter(item => item.type === 'skill')) {
    const link = join(destination, 'skills', resource.id.slice(resource.id.indexOf('/') + 1))
    await mkdir(dirname(link), { recursive: true, mode: 0o700 })
    await symlink(resource.location, link)
    ownedPaths.push(`skills/${resource.id.slice(resource.id.indexOf('/') + 1)}`)
  }
  const instructionResources = enabledResources.filter(item => ['agents', 'prompt'].includes(item.type))
  const instructionIds = new Set(instructionResources.map(resource => resource.id))
  for (const id of profile.promptOrder) if (!instructionIds.has(id)) throw new ConflictError(`promptOrder refers to a missing or disabled instruction Resource: ${id}`)
  const order = new Map(profile.promptOrder.map((id, index) => [id, index]))
  instructionResources.sort((a, b) => (order.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.id) ?? Number.MAX_SAFE_INTEGER) || a.id.localeCompare(b.id))
  const instructions = []
  for (const resource of instructionResources) {
    const info = await lstat(resource.location)
    if (!info.isFile() || info.isSymbolicLink()) throw new ConflictError(`instruction Resource ${resource.id} is not a regular file`)
    instructions.push(`<!-- Harman Resource: ${resource.id} -->\n${await readFile(resource.location, 'utf8')}`)
  }
  if (instructions.length > 0) {
    await writeFile(join(destination, 'AGENTS.md'), instructions.join('\n\n') + '\n', { flag: 'wx', mode: 0o600 })
    ownedPaths.push('AGENTS.md')
  }
  ensureConfigSecrets(profile.pluginConfig)
  ensureConfigSecrets(profile.mcp)
  ensureConfigSecrets(profile.models)
  const patches = structuredClone(profile.cordisPatch)
  const configuredIds = new Set()
  for (const patch of patches) {
    if (patch?.insert !== undefined) {
      if (!Array.isArray(patch.insert)) throw new ValidationError('Cordis insert patch must be an array')
      for (const entry of patch.insert) {
        if (typeof entry?.id !== 'string' || entry.id === '') throw new ValidationError('inserted Cordis rows require stable ids')
        if (configuredIds.has(entry.id)) throw new ConflictError(`Cordis row ${entry.id} is configured more than once`)
        configuredIds.add(entry.id)
      }
    } else {
      if (typeof patch?.id !== 'string' || patch.id === '') throw new ValidationError('Cordis patches require an id')
      if (configuredIds.has(patch.id)) throw new ConflictError(`Cordis row ${patch.id} is configured more than once`)
      configuredIds.add(patch.id)
    }
  }
  for (const [id, config] of Object.entries(profile.pluginConfig)) {
    if (configuredIds.has(id)) throw new ConflictError(`pluginConfig conflicts with Cordis row ${id}`)
    configuredIds.add(id)
    patches.push({ id, config })
  }
  const mcpRows = []
  for (const [serverName, config] of Object.entries(profile.mcp)) {
    if (!/^[A-Za-z0-9_-]{1,32}$/.test(serverName)) throw new ValidationError(`invalid MCP server name ${serverName}`)
    if (config === null || typeof config !== 'object' || Array.isArray(config)) throw new ValidationError(`MCP ${serverName} config must be an object`)
    if (config.serverName !== undefined && config.serverName !== serverName) throw new ConflictError(`MCP ${serverName} serverName conflicts with its key`)
    const id = `harman-mcp-${serverName}`
    if (configuredIds.has(id)) throw new ConflictError(`MCP ${serverName} conflicts with Cordis row ${id}`)
    configuredIds.add(id)
    mcpRows.push({ id, name: '@deepseek-ai/dsh-mcp-client', config: { ...config, serverName } })
  }
  if (mcpRows.length > 0) patches.push({ insert: mcpRows })
  if (Object.keys(profile.models).length > 0) {
    if (configuredIds.has('settings')) throw new ConflictError('model settings conflict with an explicit settings Cordis patch')
    patches.push({ id: 'settings', config: { path: join(profile.dshHome, 'settings.json') } })
  }
  const manifest = {
    name: `harman-profile-${profile.name}`,
    private: true,
    dependencies,
    dsh: { profile: { bundles } },
  }
  await writeFile(join(internal, 'package.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
  await writeFile(join(internal, 'cordis.patch.yml'), JSON.stringify(patches, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
  const lock = {
    schemaVersion: 1, profile: profile.name, runtimePolicy: profile.runtime,
    packages: inventory, resources: resourceInventory,
    config: { plugin: profile.pluginConfig, promptOrder: profile.promptOrder, mcp: profile.mcp, models: profile.models },
    cordisPatchHash: contentHash(profile.cordisPatch),
  }
  lock.lockHash = contentHash(lock)
  await writeFile(join(destination, 'harman.lock.json'), canonicalJson(lock), { flag: 'wx', mode: 0o600 })
  await writeFile(join(destination, '.harman-managed.json'), canonicalJson({ schemaVersion: 1, paths: [...new Set(ownedPaths)].sort() }), { flag: 'wx', mode: 0o600 })
  return lock
}

export class ProfileManager {
  constructor(stateStore, options = {}) {
    this.stateStore = stateStore
    this.runtimes = options.runtimes ?? new RuntimeManager(stateStore)
    this.bwrap = options.bwrap ?? '/usr/bin/bwrap'
    this.timeoutMs = options.timeoutMs ?? 120_000
  }

  async transactionRetry(metadata, mutator) {
    for (let attempt = 0; ; attempt += 1) {
      try { return await this.stateStore.transaction(metadata, mutator) } catch (error) {
        if (error?.code !== 'STATE_BUSY' || attempt >= 100) throw error
        await new Promise(resolveWait => setTimeout(resolveWait, 10))
      }
    }
  }

  processAlive(pid) {
    if (!Number.isInteger(pid) || pid <= 0) return false
    try { process.kill(pid, 0); return true } catch (error) { return error?.code !== 'ESRCH' }
  }

  async recoverStaleRun(name) {
    const state = await this.stateStore.read()
    const profile = state.profiles[name]
    if (profile === undefined || !profile.running || this.processAlive(profile.runOwnerPid)) return false
    await this.transactionRetry({ action: 'profile.run.recover', details: { name, staleOwnerPid: profile.runOwnerPid ?? null } }, draft => {
      const current = draft.profiles[name]
      if (current?.running && !this.processAlive(current.runOwnerPid)) {
        current.running = false
        current.runOwnerPid = null
        current.runStartedAt = null
      }
    })
    return true
  }

  async create(input) {
    await this.stateStore.initialize()
    const root = profileRoot(this.stateStore, input.name)
    const dshHome = join(root, 'dsh-home')
    if (await exists(root)) throw new ConflictError(`Profile directory already exists: ${root}`)
    const state = await this.stateStore.read()
    const draftProfile = {
      name: input.name, dshHome, packages: [...(input.packages ?? [])], resources: [...(input.resources ?? [])],
      app: input.app ?? 'headless',
      runtime: input.runtime ?? { channel: 'latest' }, lastResolvedRuntime: null,
      pluginConfig: input.pluginConfig ?? {}, promptOrder: input.promptOrder ?? [], mcp: input.mcp ?? {},
      models: input.models ?? {}, cordisPatch: input.cordisPatch ?? [], active: false, running: false,
    }
    const stage = `${root}.stage-${randomUUID()}`
    try {
      await materializeTree(this.stateStore, draftProfile, state, join(stage, 'dsh-home'))
      if (Object.keys(draftProfile.models).length > 0) await writeFile(join(stage, 'dsh-home', 'settings.json'), canonicalJson(draftProfile.models), { flag: 'wx', mode: 0o600 })
      await mkdir(dirname(root), { recursive: true, mode: 0o700 })
      await rename(stage, root)
      const transaction = await this.stateStore.transaction({ action: 'profile.create', details: { name: input.name } }, draft => createProfile(draft, draftProfile))
      return { profile: transaction.result, lock: JSON.parse(await readFile(join(dshHome, 'harman.lock.json'), 'utf8')) }
    } catch (error) {
      await makeProfileTreeRemovable(stage)
      await rm(stage, { recursive: true, force: true })
      await makeProfileTreeRemovable(root)
      await rm(root, { recursive: true, force: true })
      throw error
    }
  }

  async list() {
    return Object.values((await this.stateStore.read()).profiles).sort((a, b) => a.name.localeCompare(b.name))
  }

  async show(name) {
    const state = await this.stateStore.read()
    const profile = state.profiles[name]
    if (profile === undefined) throw new NotFoundError(`profile ${name} does not exist`)
    let runtime = null
    try { runtime = this.runtimes.resolveFromState(state, profile.runtime) } catch {}
    return { ...profile, runtimeStatus: runtime === null ? 'unresolved' : runtime.compatibility, latest: Object.values(state.runtimes).find(item => item.latest)?.version ?? null }
  }

  async materialize(name) {
    await this.recoverStaleRun(name)
    const state = await this.stateStore.read()
    const profile = state.profiles[name]
    if (profile === undefined) throw new NotFoundError(`profile ${name} does not exist`)
    if (profile.running) throw new ConflictError(`running profile ${name} cannot be materialized`)
    const root = profileRoot(this.stateStore, name)
    await removeStaleMaterializations(root)
    const current = profile.dshHome
    const stage = join(root, `.dsh-home.stage-${randomUUID()}`)
    const backup = join(root, `.dsh-home.backup-${randomUUID()}`)
    const lock = await materializeTree(this.stateStore, profile, state, stage)
    try {
      if (await exists(current)) await copyPreservedTree(current, stage, await managedPaths(current), await managedPaths(stage))
      if (await exists(current)) await rename(current, backup)
      await rename(stage, current)
      await makeProfileTreeRemovable(backup)
      await rm(backup, { recursive: true, force: true })
      return lock
    } catch (error) {
      await makeProfileTreeRemovable(stage)
      await rm(stage, { recursive: true, force: true })
      if (await exists(backup)) { await makeProfileTreeRemovable(current); await rm(current, { recursive: true, force: true }); await rename(backup, current) }
      throw error
    }
  }

  async clone(sourceName, targetName) {
    const source = await this.show(sourceName)
    return this.create({ ...source, name: targetName, dshHome: undefined, active: false, lastResolvedRuntime: null })
  }

  async rename(name, nextName) {
    const state = await this.stateStore.read()
    const profile = state.profiles[name]
    if (profile === undefined) throw new NotFoundError(`profile ${name} does not exist`)
    if (state.profiles[nextName] !== undefined) throw new ConflictError(`profile ${nextName} already exists`)
    if (profile.active) throw new ConflictError(`active profile ${name} cannot be renamed`)
    const oldRoot = profileRoot(this.stateStore, name)
    const nextRoot = profileRoot(this.stateStore, nextName)
    await rename(oldRoot, nextRoot)
    try {
      const result = await this.stateStore.transaction({ action: 'profile.rename', details: { name, nextName } }, draft => {
        const current = draft.profiles[name]
        delete draft.profiles[name]
        current.name = nextName
        current.dshHome = join(nextRoot, 'dsh-home')
        draft.profiles[nextName] = current
        for (const resource of Object.values(draft.resources)) resource.boundProfiles = resource.boundProfiles.map(item => item === name ? nextName : item).sort()
        return current
      })
      await this.materialize(nextName)
      return result.result
    } catch (error) {
      if (await exists(nextRoot)) await rename(nextRoot, oldRoot)
      throw error
    }
  }

  async remove(name, options = {}) {
    const state = await this.stateStore.read()
    const impact = profileImpact(state, name)
    if (options.dryRun) return { dryRun: true, impact }
    if (!options.confirmed) throw new ConflictError('Profile deletion requires --yes after reviewing impact', { impact })
    const result = await this.stateStore.transaction({ action: 'profile.delete', details: { name } }, draft => deleteProfile(draft, name))
    await makeProfileTreeRemovable(profileRoot(this.stateStore, name))
    await rm(profileRoot(this.stateStore, name), { recursive: true, force: true })
    return { dryRun: false, impact, deleted: result.result.record.name }
  }

  async diff(left, right) {
    const a = await this.show(left)
    const b = await this.show(right)
    const compare = key => ({ left: a[key], right: b[key], equal: contentHash(a[key]) === contentHash(b[key]) })
    return { profiles: [left, right], packages: compare('packages'), resources: compare('resources'), runtime: compare('runtime'), pluginConfig: compare('pluginConfig'), mcp: compare('mcp'), models: compare('models'), cordisPatch: compare('cordisPatch') }
  }

  async setActive(name, active) {
    return (await this.stateStore.transaction({ action: active ? 'profile.activate' : 'profile.deactivate', details: { name } }, state => {
      const profile = state.profiles[name]
      if (profile === undefined) throw new NotFoundError(`profile ${name} does not exist`)
      profile.active = active
      return profile
    })).result
  }

  async setRuntime(name, policy) {
    const previous = (await this.show(name)).runtime
    await this.runtimes.resolve(policy)
    await this.stateStore.transaction({ action: 'profile.runtime', details: { name, policy } }, state => { state.profiles[name].runtime = policy })
    try {
      const lock = await this.materialize(name)
      return { profile: name, previous, runtime: policy, lockHash: lock.lockHash }
    } catch (error) {
      await this.stateStore.transaction({ action: 'profile.runtime.rollback', details: { name, previous } }, state => { state.profiles[name].runtime = previous })
      throw error
    }
  }

  async run(name, args = [], options = {}) {
    try { await access(this.bwrap, constants.X_OK) } catch { throw new ConflictError('isolated DSH launch unavailable: bwrap is missing') }
    await this.materialize(name)
    const profile = await this.show(name)
    const runtime = await this.runtimes.resolve(profile.runtime)
    await this.transactionRetry({ action: 'profile.run.start', details: { name, runtime: runtime.id } }, state => {
      if (state.profiles[name].running) throw new ConflictError(`profile ${name} is already running`)
      state.profiles[name].running = true
      state.profiles[name].runOwnerPid = process.pid
      state.profiles[name].runStartedAt = new Date().toISOString()
      state.profiles[name].lastResolvedRuntime = { id: runtime.id, version: runtime.version, source: runtime.source, contentHash: runtime.contentHash, resolvedAt: new Date().toISOString() }
    })
    const bwrapArgs = [
      '--die-with-parent', '--new-session', '--unshare-all', '--share-net',
      '--ro-bind', '/', '/', '--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp',
      '--bind', profile.dshHome, profile.dshHome,
      '--ro-bind', join(profile.dshHome, 'profiles', 'harman', 'node_modules'), join(profile.dshHome, 'profiles', 'harman', 'node_modules'),
      '--chdir', resolve(options.cwd ?? process.cwd()),
      '--setenv', 'DSH_HOME', profile.dshHome,
      '--setenv', 'HARMAN_HOME', this.stateStore.root,
      '--', runtime.executable, ...(runtime.launcherArgs ?? []), '--profile', 'harman', ...args,
    ]
    let result
    try {
      result = await runProcess(this.bwrap, bwrapArgs, { cwd: options.cwd ?? process.cwd(), env: options.env ?? process.env, timeoutMs: options.timeoutMs ?? this.timeoutMs })
      return { runtime, profile: name, command: args, ...result }
    } finally {
      await this.transactionRetry({ action: 'profile.run.stop', details: { name, code: result?.code ?? null, signal: result?.signal ?? null } }, state => {
        state.profiles[name].running = false
        state.profiles[name].runOwnerPid = null
        state.profiles[name].runStartedAt = null
      })
    }
  }

  async doctor(name) {
    const profile = await this.show(name)
    const checks = []
    checks.push({ id: 'dsh-home', ok: await exists(profile.dshHome), detail: profile.dshHome })
    checks.push({ id: 'manifest', ok: await exists(join(profile.dshHome, 'profiles', 'harman', 'package.json')) })
    checks.push({ id: 'lock', ok: await exists(join(profile.dshHome, 'harman.lock.json')) })
    checks.push({ id: 'runtime', ok: profile.runtimeStatus === 'compatible', detail: profile.runtimeStatus })
    checks.push({ id: 'running', ok: profile.running !== true, detail: profile.running ? 'profile reports running' : 'not running' })
    const links = []
    const lockPath = join(profile.dshHome, 'harman.lock.json')
    if (await exists(lockPath)) {
      const lock = JSON.parse(await readFile(lockPath, 'utf8'))
      for (const pkg of lock.packages) {
        const path = join(profile.dshHome, 'profiles', 'harman', 'node_modules', ...pkg.name.split('/'))
        let ok = false
        try {
          const marker = JSON.parse(await readFile(join(path, '.harman-view.json'), 'utf8'))
          ok = marker.storePath === pkg.storePath && marker.contentHash === pkg.contentHash
        } catch {}
        links.push({ id: pkg.id, ok, path })
      }
    }
    checks.push({ id: 'store-links', ok: links.every(link => link.ok), detail: links })
    return { profile: name, ok: checks.every(check => check.ok), policy: profile.runtime, resolved: profile.lastResolvedRuntime, latest: profile.latest, checks }
  }
}
