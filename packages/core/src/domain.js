import { resolve } from 'node:path'
import { ConflictError, NotFoundError, ValidationError } from './errors.js'

function requireRecord(record, id, kind) {
  const value = record[id]
  if (value === undefined) throw new NotFoundError(`${kind} ${id} does not exist`, { kind, id })
  return value
}

function assertNew(record, id, kind) {
  if (record[id] !== undefined) throw new ConflictError(`${kind} ${id} already exists`, { kind, id })
}

function sortedUnique(values) {
  return [...new Set(values)].sort()
}

export function packageId(name, version) {
  if (typeof name !== 'string' || name.trim() === '' || typeof version !== 'string' || version.trim() === '') {
    throw new ValidationError('package name and version are required')
  }
  return `${name}@${version}`
}

export function addPackage(state, input) {
  const id = input.id ?? packageId(input.name, input.version)
  assertNew(state.packages, id, 'package')
  state.packages[id] = {
    id,
    name: input.name,
    version: input.version,
    contentHash: input.contentHash,
    source: input.source ?? null,
    recipeRevision: input.recipeRevision ?? null,
    reason: input.reason ?? 'explicit',
    dependencies: sortedUnique(input.dependencies ?? []),
    providesResources: [],
  }
  return state.packages[id]
}

export function removePackage(state, id) {
  const pkg = requireRecord(state.packages, id, 'package')
  const profiles = Object.values(state.profiles).filter(profile => profile.packages.includes(id)).map(profile => profile.name)
  const dependents = Object.values(state.packages).filter(candidate => candidate.dependencies.includes(id)).map(candidate => candidate.id)
  if (profiles.length > 0 || dependents.length > 0 || pkg.providesResources.length > 0) {
    throw new ConflictError(`package ${id} is still referenced`, { profiles, dependents, resources: pkg.providesResources })
  }
  delete state.packages[id]
  return pkg
}

export function addResource(state, input, options = {}) {
  const id = input.id
  if (typeof id !== 'string' || !/^[a-z][a-z0-9-]*\/[A-Za-z0-9._-]+$/.test(id)) {
    throw new ValidationError(`invalid Resource URI ${JSON.stringify(id)}`)
  }
  assertNew(state.resources, id, 'resource')
  const ownership = input.ownership ?? 'external'
  const resource = {
    id,
    type: input.type ?? id.slice(0, id.indexOf('/')),
    displayName: input.displayName ?? id,
    location: resolve(input.location),
    ownership,
    scope: input.scope ?? 'user',
    source: input.source ?? null,
    fingerprint: input.fingerprint ?? null,
    available: input.available ?? true,
    enabled: input.enabled ?? true,
    priority: input.priority ?? 0,
    packageId: input.packageId ?? null,
    manifestOwner: input.manifestOwner ?? null,
    boundProfiles: [],
  }
  if (ownership === 'package') {
    const pkg = requireRecord(state.packages, resource.packageId, 'package')
    pkg.providesResources = sortedUnique([...pkg.providesResources, id])
  }
  if (ownership === 'managed' && options.managedResourceRoot !== undefined) {
    resource.location = resolve(options.managedResourceRoot, input.managedRelativePath ?? id)
    resource.manifestOwner = input.manifestOwner ?? 'harman'
  }
  state.resources[id] = resource
  return resource
}

export function removeResource(state, id) {
  const resource = requireRecord(state.resources, id, 'resource')
  if (resource.boundProfiles.length > 0) {
    throw new ConflictError(`resource ${id} is bound to Profiles`, { profiles: resource.boundProfiles })
  }
  if (resource.ownership === 'package') {
    const pkg = requireRecord(state.packages, resource.packageId, 'package')
    pkg.providesResources = pkg.providesResources.filter(resourceId => resourceId !== id)
  }
  delete state.resources[id]
  return { record: resource, filesystemAction: resource.ownership === 'external' ? 'none' : 'managed-delete-required' }
}

export function createProfile(state, input) {
  const name = input.name
  assertNew(state.profiles, name, 'profile')
  const runtime = input.runtime ?? { channel: 'latest' }
  state.profiles[name] = {
    name,
    dshHome: resolve(input.dshHome),
    packages: sortedUnique(input.packages ?? []),
    resources: sortedUnique(input.resources ?? []),
    runtime,
    lastResolvedRuntime: input.lastResolvedRuntime ?? null,
    pluginConfig: input.pluginConfig ?? {},
    promptOrder: input.promptOrder ?? [],
    mcp: input.mcp ?? {},
    models: input.models ?? {},
    cordisPatch: input.cordisPatch ?? [],
    active: false,
    running: false,
  }
  for (const resourceId of state.profiles[name].resources) {
    const resource = requireRecord(state.resources, resourceId, 'resource')
    resource.boundProfiles = sortedUnique([...resource.boundProfiles, name])
  }
  return state.profiles[name]
}

export function deleteProfile(state, name) {
  const profile = requireRecord(state.profiles, name, 'profile')
  if (profile.active) throw new ConflictError(`active profile ${name} cannot be deleted`)
  for (const resourceId of profile.resources) {
    state.resources[resourceId].boundProfiles = state.resources[resourceId].boundProfiles.filter(profileName => profileName !== name)
  }
  delete state.profiles[name]
  return {
    record: profile,
    releasedPackages: profile.packages,
    detachedResources: profile.resources,
    externalFilesystemAction: 'none',
  }
}

export function bindResource(state, profileName, resourceId) {
  const profile = requireRecord(state.profiles, profileName, 'profile')
  const resource = requireRecord(state.resources, resourceId, 'resource')
  profile.resources = sortedUnique([...profile.resources, resourceId])
  resource.boundProfiles = sortedUnique([...resource.boundProfiles, profileName])
  return { profile: profileName, resource: resourceId }
}

export function detachResource(state, profileName, resourceId) {
  const profile = requireRecord(state.profiles, profileName, 'profile')
  const resource = requireRecord(state.resources, resourceId, 'resource')
  if (!profile.resources.includes(resourceId)) throw new NotFoundError(`resource ${resourceId} is not bound to profile ${profileName}`)
  profile.resources = profile.resources.filter(id => id !== resourceId)
  resource.boundProfiles = resource.boundProfiles.filter(name => name !== profileName)
  return { profile: profileName, resource: resourceId, filesystemAction: 'none' }
}

export function setProfilePackages(state, profileName, packageIds) {
  const profile = requireRecord(state.profiles, profileName, 'profile')
  for (const id of packageIds) requireRecord(state.packages, id, 'package')
  profile.packages = sortedUnique(packageIds)
  return profile.packages
}

export function setResourceEnabled(state, resourceId, enabled) {
  const resource = requireRecord(state.resources, resourceId, 'resource')
  resource.enabled = Boolean(enabled)
  return resource
}

export function addRepository(state, input) {
  const id = input.id
  if (typeof id !== 'string' || !/^[A-Za-z0-9._-]+$/.test(id)) throw new ValidationError(`invalid repository id ${id}`)
  assertNew(state.repositories, id, 'repository')
  state.repositories[id] = {
    id,
    url: input.url,
    priority: input.priority ?? 0,
    enabled: input.enabled ?? true,
    trustPolicy: input.trustPolicy ?? 'hash-only',
    indexVersion: null,
    sequence: null,
    generatedAt: null,
    lastSync: null,
    etag: null,
    indexHash: null,
    trustedKeys: {},
    revokedKeys: [],
    signatureThreshold: 1,
  }
  return state.repositories[id]
}

export function removeRepository(state, id) {
  const repository = requireRecord(state.repositories, id, 'repository')
  delete state.repositories[id]
  return repository
}
