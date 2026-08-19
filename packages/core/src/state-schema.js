import { isAbsolute, resolve, sep } from 'node:path'
import { UnsupportedSchemaError, ValidationError } from './errors.js'

export const CURRENT_SCHEMA_VERSION = 2

export function emptyState() {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    revision: 0,
    packages: {},
    resources: {},
    profiles: {},
    repositories: {},
    runtimes: {},
    audit: [],
  }
}

function objectRecord(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ValidationError(`${label} must be an object`)
  }
}

function nonEmpty(value, label) {
  if (typeof value !== 'string' || value.trim() === '') throw new ValidationError(`${label} must be a non-empty string`)
}

function uniqueStrings(values, label) {
  if (!Array.isArray(values) || values.some(value => typeof value !== 'string')) {
    throw new ValidationError(`${label} must be a string array`)
  }
  if (new Set(values).size !== values.length) throw new ValidationError(`${label} contains duplicates`)
}

function assertInside(path, root, label) {
  const actual = resolve(path)
  const boundary = resolve(root)
  if (actual !== boundary && !actual.startsWith(boundary + sep)) {
    throw new ValidationError(`${label} escapes the managed root`, { actual, boundary })
  }
}

export function validateState(state, options = {}) {
  objectRecord(state, 'state')
  if (!Number.isInteger(state.schemaVersion)) throw new ValidationError('schemaVersion must be an integer')
  if (state.schemaVersion > CURRENT_SCHEMA_VERSION) {
    throw new UnsupportedSchemaError(`state schema ${state.schemaVersion} is newer than supported ${CURRENT_SCHEMA_VERSION}`)
  }
  if (state.schemaVersion !== CURRENT_SCHEMA_VERSION) {
    throw new UnsupportedSchemaError(`state schema ${state.schemaVersion} requires an explicit migration`)
  }
  if (!Number.isInteger(state.revision) || state.revision < 0) throw new ValidationError('revision must be a non-negative integer')
  for (const key of ['packages', 'resources', 'profiles', 'repositories', 'runtimes']) objectRecord(state[key], key)
  if (!Array.isArray(state.audit)) throw new ValidationError('audit must be an array')

  for (const [id, repository] of Object.entries(state.repositories)) {
    objectRecord(repository, `repository ${id}`)
    if (repository.id !== id) throw new ValidationError(`repository map key ${id} does not match its id`)
    nonEmpty(repository.url, `repository ${id} url`)
    if (!Number.isInteger(repository.priority)) throw new ValidationError(`repository ${id} priority must be an integer`)
    if (typeof repository.enabled !== 'boolean') throw new ValidationError(`repository ${id} enabled must be boolean`)
    if (!['trusted-local', 'hash-only', 'signed'].includes(repository.trustPolicy)) {
      throw new ValidationError(`repository ${id} trustPolicy is invalid`)
    }
  }

  for (const [id, pkg] of Object.entries(state.packages)) {
    objectRecord(pkg, `package ${id}`)
    if (pkg.id !== id) throw new ValidationError(`package map key ${id} does not match its id`)
    nonEmpty(pkg.name, `package ${id} name`)
    nonEmpty(pkg.version, `package ${id} version`)
    nonEmpty(pkg.contentHash, `package ${id} contentHash`)
    if (!['explicit', 'dependency', 'profile', 'build'].includes(pkg.reason)) {
      throw new ValidationError(`package ${id} has invalid reason`)
    }
    uniqueStrings(pkg.dependencies, `package ${id} dependencies`)
    uniqueStrings(pkg.providesResources, `package ${id} providesResources`)
  }

  for (const [id, resource] of Object.entries(state.resources)) {
    objectRecord(resource, `resource ${id}`)
    if (resource.id !== id) throw new ValidationError(`resource map key ${id} does not match its id`)
    nonEmpty(resource.type, `resource ${id} type`)
    nonEmpty(resource.location, `resource ${id} location`)
    if (!['external', 'managed', 'package'].includes(resource.ownership)) {
      throw new ValidationError(`resource ${id} has invalid ownership`)
    }
    if (!isAbsolute(resource.location)) throw new ValidationError(`resource ${id} location must be absolute`)
    uniqueStrings(resource.boundProfiles, `resource ${id} boundProfiles`)
    if (resource.ownership === 'managed') {
      nonEmpty(resource.manifestOwner, `managed resource ${id} manifestOwner`)
      if (options.managedResourceRoot === undefined) {
        throw new ValidationError('managedResourceRoot is required to validate managed resources')
      }
      assertInside(resource.location, options.managedResourceRoot, `managed resource ${id}`)
    }
    if (resource.ownership === 'package') {
      nonEmpty(resource.packageId, `package resource ${id} packageId`)
      if (state.packages[resource.packageId] === undefined) {
        throw new ValidationError(`resource ${id} refers to missing package ${resource.packageId}`)
      }
    } else if (resource.packageId !== null && resource.packageId !== undefined) {
      throw new ValidationError(`non-package resource ${id} cannot declare packageId`)
    }
  }

  for (const [name, profile] of Object.entries(state.profiles)) {
    objectRecord(profile, `profile ${name}`)
    if (profile.name !== name) throw new ValidationError(`profile map key ${name} does not match its name`)
    if (!/^[-A-Za-z0-9_.]+$/.test(name) || name === '.' || name === '..') {
      throw new ValidationError(`invalid profile name ${name}`)
    }
    nonEmpty(profile.dshHome, `profile ${name} dshHome`)
    if (!isAbsolute(profile.dshHome)) throw new ValidationError(`profile ${name} dshHome must be absolute`)
    uniqueStrings(profile.packages, `profile ${name} packages`)
    uniqueStrings(profile.resources, `profile ${name} resources`)
    objectRecord(profile.runtime, `profile ${name} runtime`)
    const hasLatest = profile.runtime.channel === 'latest' && profile.runtime.version === undefined
    const hasPin = typeof profile.runtime.version === 'string' && profile.runtime.version !== '' && profile.runtime.channel === undefined
    if (!hasLatest && !hasPin) throw new ValidationError(`profile ${name} runtime must be latest channel or an exact version`)
    for (const packageId of profile.packages) {
      if (state.packages[packageId] === undefined) throw new ValidationError(`profile ${name} refers to missing package ${packageId}`)
    }
    for (const resourceId of profile.resources) {
      if (state.resources[resourceId] === undefined) throw new ValidationError(`profile ${name} refers to missing resource ${resourceId}`)
    }
  }

  for (const [id, pkg] of Object.entries(state.packages)) {
    for (const dependency of pkg.dependencies) {
      if (state.packages[dependency] === undefined) throw new ValidationError(`package ${id} refers to missing dependency ${dependency}`)
    }
    for (const resourceId of pkg.providesResources) {
      const resource = state.resources[resourceId]
      if (resource === undefined || resource.ownership !== 'package' || resource.packageId !== id) {
        throw new ValidationError(`package ${id} has inconsistent provided resource ${resourceId}`)
      }
    }
  }

  for (const [id, resource] of Object.entries(state.resources)) {
    const expected = Object.values(state.profiles).filter(profile => profile.resources.includes(id)).map(profile => profile.name).sort()
    if (JSON.stringify([...resource.boundProfiles].sort()) !== JSON.stringify(expected)) {
      throw new ValidationError(`resource ${id} boundProfiles does not match Profile references`)
    }
  }

  return state
}
