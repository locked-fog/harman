import { NotFoundError } from './errors.js'

function requireValue(record, id, kind) {
  const value = record[id]
  if (value === undefined) throw new NotFoundError(`${kind} ${id} does not exist`)
  return value
}

export function explainPackage(state, id) {
  const pkg = requireValue(state.packages, id, 'package')
  return {
    kind: 'package',
    id,
    version: pkg.version,
    source: pkg.source,
    reason: pkg.reason,
    dependencies: pkg.dependencies,
    dependedOnBy: Object.values(state.packages).filter(candidate => candidate.dependencies.includes(id)).map(candidate => candidate.id).sort(),
    profiles: Object.values(state.profiles).filter(profile => profile.packages.includes(id)).map(profile => profile.name).sort(),
    providesResources: [...pkg.providesResources].sort(),
  }
}

export function explainResource(state, id) {
  const resource = requireValue(state.resources, id, 'resource')
  return {
    kind: 'resource',
    id,
    type: resource.type,
    source: resource.source,
    ownership: resource.ownership,
    location: resource.location,
    fingerprint: resource.fingerprint,
    available: resource.available,
    enabled: resource.enabled,
    package: resource.packageId,
    profiles: [...resource.boundProfiles].sort(),
  }
}

export function explainProfile(state, name) {
  const profile = requireValue(state.profiles, name, 'profile')
  return {
    kind: 'profile',
    name,
    dshHome: profile.dshHome,
    runtimePolicy: profile.runtime,
    lastResolvedRuntime: profile.lastResolvedRuntime,
    packages: profile.packages.map(id => explainPackage(state, id)),
    resources: profile.resources.map(id => explainResource(state, id)),
    active: profile.active,
  }
}

export function packageImpact(state, id, operation = 'remove') {
  const explanation = explainPackage(state, id)
  return {
    operation,
    target: id,
    affectedProfiles: explanation.profiles,
    affectedResources: explanation.providesResources,
    blockingDependents: explanation.dependedOnBy,
    allowed: explanation.profiles.length === 0 && explanation.providesResources.length === 0 && explanation.dependedOnBy.length === 0,
  }
}

export function profileImpact(state, name, operation = 'delete') {
  const profile = requireValue(state.profiles, name, 'profile')
  return {
    operation,
    target: name,
    releasedPackages: [...profile.packages],
    detachedResources: profile.resources.map(id => ({ id, ownership: state.resources[id].ownership })),
    externalFilesModified: false,
    allowed: !profile.active,
  }
}
