import { PackageManager } from './package-manager.js'
import { ProfileManager } from './profile-manager.js'
import { ResourceManager } from './resource-manager.js'
import { RuntimeManager } from './runtime-manager.js'
import { ProfileBundleManager } from './profile-bundle.js'
import { ConflictError, StaleRevisionError, ValidationError } from './errors.js'
import { packageImpact, profileImpact } from './graph.js'

const MUTATIONS = new Set([
  'package.install', 'package.remove', 'package.upgrade',
  'resource.enable', 'resource.disable', 'resource.bind', 'resource.detach',
  'profile.create', 'profile.clone', 'profile.rename', 'profile.delete', 'profile.activate', 'profile.deactivate', 'profile.runtime',
  'profile.export', 'profile.restore',
  'repository.enable', 'repository.disable', 'repository.priority', 'repository.policy',
  'runtime.sync',
])

function requireString(value, label) {
  if (typeof value !== 'string' || value.trim() === '') throw new ValidationError(`${label} is required`)
  return value
}

function publicState(state) {
  return {
    revision: state.revision,
    packages: Object.values(state.packages).sort((a, b) => a.id.localeCompare(b.id)),
    resources: Object.values(state.resources).sort((a, b) => a.id.localeCompare(b.id)),
    profiles: Object.values(state.profiles).sort((a, b) => a.name.localeCompare(b.name)),
    repositories: Object.values(state.repositories).sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id)),
    runtimes: Object.values(state.runtimes).sort((a, b) => a.id.localeCompare(b.id)),
    audit: state.audit.slice(-100).reverse(),
  }
}

export class ControlPlane {
  constructor(stateStore, options = {}) {
    this.stateStore = stateStore
    this.packages = options.packages ?? new PackageManager(stateStore)
    this.resources = options.resources ?? new ResourceManager(stateStore)
    this.runtimes = options.runtimes ?? new RuntimeManager(stateStore)
    this.profiles = options.profiles ?? new ProfileManager(stateStore, { runtimes: this.runtimes })
    this.bundles = options.bundles ?? new ProfileBundleManager(stateStore, { profiles: this.profiles })
  }

  async query(subject, input = {}) {
    await this.stateStore.initialize()
    if (subject === 'package.search') return this.packages.search(typeof input.query === 'string' ? input.query : '')
    if (subject === 'profile.diff') return this.profiles.diff(requireString(input.left, 'left profile'), requireString(input.right, 'right profile'))
    throw new ValidationError(`unsupported control-plane query ${subject}`)
  }

  async snapshot() {
    await this.stateStore.initialize()
    const state = await this.stateStore.read()
    const profiles = await Promise.all(Object.keys(state.profiles).sort().map(async name => {
      const profile = await this.profiles.show(name)
      return { ...profile, doctor: await this.profiles.doctor(name) }
    }))
    return { ...publicState(state), profiles, daemonTime: new Date().toISOString() }
  }

  async preview(action, input = {}) {
    if (!MUTATIONS.has(action)) throw new ValidationError(`unsupported control-plane action ${action}`)
    const state = await this.stateStore.read()
    const base = { action, expectedRevision: state.revision, destructive: false, impact: null }
    if (action === 'package.install') return { ...base, impact: await this.packages.install(input.specs ?? [], { dryRun: true }) }
    if (action === 'package.remove') return { ...base, destructive: true, impact: await this.packages.remove(input.specs ?? [], { dryRun: true }) }
    if (action === 'package.upgrade') return { ...base, impact: await this.packages.upgrade({ dryRun: true }) }
    if (action === 'profile.delete') return { ...base, destructive: true, impact: profileImpact(state, requireString(input.name, 'profile name')) }
    if (action === 'profile.rename') return { ...base, destructive: true, impact: { from: requireString(input.name, 'profile name'), to: requireString(input.nextName, 'new profile name') } }
    if (action === 'profile.export') return { ...base, impact: { profile: requireString(input.name, 'profile name'), destination: requireString(input.destination, 'export destination') } }
    if (action === 'profile.restore') return { ...base, impact: { bundle: requireString(input.bundle, 'bundle path'), profile: input.name ?? null, mode: input.mode ?? 'strict' } }
    if (action === 'resource.detach' || action === 'resource.disable') return { ...base, destructive: true, impact: { resource: requireString(input.id, 'resource id'), profile: input.profile ?? null } }
    if (action === 'repository.disable') return { ...base, destructive: true, impact: { repository: requireString(input.id, 'repository id') } }
    if (action === 'profile.runtime') {
      const policy = input.policy
      await this.runtimes.resolve(policy)
      return { ...base, impact: { profile: requireString(input.name, 'profile name'), from: state.profiles[input.name]?.runtime, to: policy } }
    }
    if (action === 'runtime.sync') {
      const candidate = this.runtimes.availableFromSources(await this.packages.sources())[0]
      return { ...base, impact: candidate === undefined ? { available: null } : { repository: candidate.repository.id, version: candidate.entry.version, artifactSha256: candidate.entry.artifact.sha256 } }
    }
    return { ...base, impact: input }
  }

  async execute(action, input = {}, options = {}) {
    if (!MUTATIONS.has(action)) throw new ValidationError(`unsupported control-plane action ${action}`)
    if (!Number.isInteger(options.expectedRevision)) throw new ValidationError('expectedRevision is required for every Web mutation')
    const current = await this.stateStore.read()
    if (current.revision !== options.expectedRevision) throw new StaleRevisionError(options.expectedRevision, current.revision)
    const preview = await this.preview(action, input)
    if (preview.destructive && options.confirmed !== true) throw new ConflictError('destructive action requires explicit confirmation', { preview })
    let result
    if (action === 'package.install') result = await this.packages.install(input.specs ?? [])
    else if (action === 'package.remove') result = await this.packages.remove(input.specs ?? [], { confirmed: true })
    else if (action === 'package.upgrade') result = await this.packages.upgrade()
    else if (action === 'resource.enable' || action === 'resource.disable') result = await this.resources.setEnabled(requireString(input.id, 'resource id'), action === 'resource.enable', input.profile)
    else if (action === 'resource.bind') result = await this.resources.bind(requireString(input.id, 'resource id'), requireString(input.profile, 'profile'))
    else if (action === 'resource.detach') result = await this.resources.detach(requireString(input.id, 'resource id'), requireString(input.profile, 'profile'))
    else if (action === 'profile.create') result = await this.profiles.create(input)
    else if (action === 'profile.clone') result = await this.profiles.clone(requireString(input.name, 'profile name'), requireString(input.nextName, 'new profile name'))
    else if (action === 'profile.rename') result = await this.profiles.rename(requireString(input.name, 'profile name'), requireString(input.nextName, 'new profile name'))
    else if (action === 'profile.delete') result = await this.profiles.remove(requireString(input.name, 'profile name'), { confirmed: true })
    else if (action === 'profile.activate' || action === 'profile.deactivate') result = await this.profiles.setActive(requireString(input.name, 'profile name'), action === 'profile.activate')
    else if (action === 'profile.runtime') result = await this.profiles.setRuntime(requireString(input.name, 'profile name'), input.policy)
    else if (action === 'profile.export') {
      result = await this.bundles.export(requireString(input.name, 'profile name'), requireString(input.destination, 'export destination'))
      await this.stateStore.transaction({ action: 'profile.export', actor: 'web', details: { name: input.name, destination: result.destination, manifestHash: result.manifestHash } }, () => result)
    }
    else if (action === 'profile.restore') result = await this.bundles.restore(requireString(input.bundle, 'bundle path'), { name: input.name, mode: input.mode ?? 'strict' })
    else if (action === 'repository.enable' || action === 'repository.disable') result = await this.packages.configureRepository(requireString(input.id, 'repository id'), { enabled: action === 'repository.enable' })
    else if (action === 'repository.priority') result = await this.packages.configureRepository(requireString(input.id, 'repository id'), { priority: input.priority })
    else if (action === 'repository.policy') result = await this.packages.configureRepository(requireString(input.id, 'repository id'), { trustPolicy: input.policy })
    else if (action === 'runtime.sync') result = await this.runtimes.syncLatest(await this.packages.sources())
    return { action, result, snapshot: await this.snapshot(), phases: ['validated', 'planned', 'committed', 'refreshed'] }
  }
}
