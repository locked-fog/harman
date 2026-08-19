import { createHash, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import {
  access, lstat, mkdir, readFile, readlink, rename, rm, symlink, writeFile,
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
    if (key !== 'secretRef' && /(token|password|secret|api[-_]?key)/i.test(key) && typeof child === 'string') {
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
  const bundles = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-headless']
  const dependencies = {}
  const inventory = []
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
    await symlink(object, link)
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
  }
  const instructions = []
  for (const resource of enabledResources.filter(item => ['agents', 'prompt'].includes(item.type))) {
    const info = await lstat(resource.location)
    if (!info.isFile() || info.isSymbolicLink()) throw new ConflictError(`instruction Resource ${resource.id} is not a regular file`)
    instructions.push(`<!-- Harman Resource: ${resource.id} -->\n${await readFile(resource.location, 'utf8')}`)
  }
  if (instructions.length > 0) await writeFile(join(destination, 'AGENTS.md'), instructions.join('\n\n') + '\n', { flag: 'wx', mode: 0o600 })
  ensureConfigSecrets(profile.pluginConfig)
  ensureConfigSecrets(profile.mcp)
  ensureConfigSecrets(profile.models)
  const manifest = {
    name: `harman-profile-${profile.name}`,
    private: true,
    dependencies,
    dsh: { profile: { bundles } },
  }
  await writeFile(join(internal, 'package.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
  await writeFile(join(internal, 'cordis.patch.yml'), JSON.stringify(profile.cordisPatch, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
  const lock = {
    schemaVersion: 1, profile: profile.name, runtimePolicy: profile.runtime,
    packages: inventory, resources: resourceInventory,
    config: { plugin: profile.pluginConfig, promptOrder: profile.promptOrder, mcp: profile.mcp, models: profile.models },
    cordisPatchHash: contentHash(profile.cordisPatch),
  }
  lock.lockHash = contentHash(lock)
  await writeFile(join(destination, 'harman.lock.json'), canonicalJson(lock), { flag: 'wx', mode: 0o600 })
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

  async create(input) {
    await this.stateStore.initialize()
    const root = profileRoot(this.stateStore, input.name)
    const dshHome = join(root, 'dsh-home')
    if (await exists(root)) throw new ConflictError(`Profile directory already exists: ${root}`)
    const state = await this.stateStore.read()
    const draftProfile = {
      name: input.name, dshHome, packages: [...(input.packages ?? [])], resources: [...(input.resources ?? [])],
      runtime: input.runtime ?? { channel: 'latest' }, lastResolvedRuntime: null,
      pluginConfig: input.pluginConfig ?? {}, promptOrder: input.promptOrder ?? [], mcp: input.mcp ?? {},
      models: input.models ?? {}, cordisPatch: input.cordisPatch ?? [], active: false, running: false,
    }
    const stage = `${root}.stage-${randomUUID()}`
    try {
      await materializeTree(this.stateStore, draftProfile, state, join(stage, 'dsh-home'))
      await mkdir(dirname(root), { recursive: true, mode: 0o700 })
      await rename(stage, root)
      const transaction = await this.stateStore.transaction({ action: 'profile.create', details: { name: input.name } }, draft => createProfile(draft, draftProfile))
      return { profile: transaction.result, lock: JSON.parse(await readFile(join(dshHome, 'harman.lock.json'), 'utf8')) }
    } catch (error) {
      await rm(stage, { recursive: true, force: true })
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
    const state = await this.stateStore.read()
    const profile = state.profiles[name]
    if (profile === undefined) throw new NotFoundError(`profile ${name} does not exist`)
    if (profile.running) throw new ConflictError(`running profile ${name} cannot be materialized`)
    const root = profileRoot(this.stateStore, name)
    const current = profile.dshHome
    const stage = join(root, `.dsh-home.stage-${randomUUID()}`)
    const backup = join(root, `.dsh-home.backup-${randomUUID()}`)
    const lock = await materializeTree(this.stateStore, profile, state, stage)
    try {
      if (await exists(current)) await rename(current, backup)
      await rename(stage, current)
      await rm(backup, { recursive: true, force: true })
      return lock
    } catch (error) {
      await rm(stage, { recursive: true, force: true })
      if (await exists(backup)) { await rm(current, { recursive: true, force: true }); await rename(backup, current) }
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

  async run(name, args = [], options = {}) {
    try { await access(this.bwrap, constants.X_OK) } catch { throw new ConflictError('isolated DSH launch unavailable: bwrap is missing') }
    await this.materialize(name)
    const profile = await this.show(name)
    const runtime = await this.runtimes.resolve(profile.runtime)
    await this.transactionRetry({ action: 'profile.run.start', details: { name, runtime: runtime.id } }, state => {
      if (state.profiles[name].running) throw new ConflictError(`profile ${name} is already running`)
      state.profiles[name].running = true
      state.profiles[name].lastResolvedRuntime = { id: runtime.id, version: runtime.version, source: runtime.source, contentHash: runtime.contentHash, resolvedAt: new Date().toISOString() }
    })
    const bwrapArgs = [
      '--die-with-parent', '--new-session', '--unshare-all', '--share-net',
      '--ro-bind', '/', '/', '--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp',
      '--bind', profile.dshHome, profile.dshHome,
      '--chdir', resolve(options.cwd ?? process.cwd()),
      '--setenv', 'DSH_HOME', profile.dshHome,
      '--', runtime.executable, ...(runtime.launcherArgs ?? []), '--profile', 'harman', ...args,
    ]
    let result
    try {
      result = await runProcess(this.bwrap, bwrapArgs, { cwd: options.cwd ?? process.cwd(), env: options.env ?? process.env, timeoutMs: options.timeoutMs ?? this.timeoutMs })
      return { runtime, profile: name, command: args, ...result }
    } finally {
      await this.transactionRetry({ action: 'profile.run.stop', details: { name, code: result?.code ?? null, signal: result?.signal ?? null } }, state => { state.profiles[name].running = false })
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
        try { ok = (await readlink(path)) === pkg.storePath } catch {}
        links.push({ id: pkg.id, ok, path })
      }
    }
    checks.push({ id: 'store-links', ok: links.every(link => link.ok), detail: links })
    return { profile: name, ok: checks.every(check => check.ok), policy: profile.runtime, resolved: profile.lastResolvedRuntime, latest: profile.latest, checks }
  }
}
