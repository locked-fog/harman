import { ConflictError, ValidationError } from './errors.js'
import { compareVersions, satisfies } from './semver.js'

function candidateOrder(left, right) {
  const version = compareVersions(right.entry.version, left.entry.version)
  if (version !== 0) return version
  const priority = right.repository.priority - left.repository.priority
  if (priority !== 0) return priority
  return left.repository.id.localeCompare(right.repository.id)
}

export function buildCatalog(sources) {
  const catalog = new Map()
  for (const { repository, index } of sources) {
    if (!repository.enabled) continue
    for (const [name, versions] of Object.entries(index.packages)) {
      const candidates = catalog.get(name) ?? []
      for (const entry of versions) candidates.push({ repository, entry: { ...entry, name } })
      catalog.set(name, candidates.sort(candidateOrder))
    }
  }
  return catalog
}

function cloneConstraints(constraints) {
  return new Map([...constraints].map(([name, ranges]) => [name, [...ranges]]))
}

function addConstraint(constraints, name, range, source) {
  if (typeof name !== 'string' || typeof range !== 'string') throw new ValidationError('dependency name/range must be strings')
  const ranges = constraints.get(name) ?? []
  ranges.push({ range, source })
  constraints.set(name, ranges)
}

function supportsEnvironment(candidate, options) {
  const entry = candidate.entry
  if (entry.dsh !== undefined && options.dshVersion !== undefined && !satisfies(options.dshVersion, entry.dsh)) return false
  if (entry.platform !== undefined && entry.platform !== 'any' && entry.platform !== options.platform) return false
  if (entry.arch !== undefined && entry.arch !== 'any' && entry.arch !== options.arch) return false
  return true
}

export function solvePackages(sources, requests, options = {}) {
  const catalog = buildCatalog(sources)
  const constraints = new Map()
  for (const request of requests) addConstraint(constraints, request.name, request.range ?? '*', 'explicit')
  for (const [name, version] of Object.entries(options.holds ?? {})) addConstraint(constraints, name, version, 'hold')
  const rejected = []

  function visit(selected, activeConstraints) {
    for (const [name, ranges] of activeConstraints) {
      const already = selected.get(name)
      if (already !== undefined && !ranges.every(item => satisfies(already.entry.version, item.range))) return null
    }
    const unresolved = [...activeConstraints.keys()].filter(name => !selected.has(name))
    if (unresolved.length === 0) return { selected, constraints: activeConstraints }
    unresolved.sort((a, b) => {
      const aCount = (catalog.get(a) ?? []).length
      const bCount = (catalog.get(b) ?? []).length
      return aCount - bCount || a.localeCompare(b)
    })
    const name = unresolved[0]
    const ranges = activeConstraints.get(name)
    const candidates = (catalog.get(name) ?? []).filter(candidate =>
      ranges.every(item => satisfies(candidate.entry.version, item.range)) && supportsEnvironment(candidate, options),
    )
    if (candidates.length === 0) {
      rejected.push({ name, constraints: ranges, available: (catalog.get(name) ?? []).map(candidate => ({
        repository: candidate.repository.id, version: candidate.entry.version, dsh: candidate.entry.dsh ?? '*',
      })) })
      return null
    }
    for (const candidate of candidates) {
      const nextSelected = new Map(selected)
      nextSelected.set(name, candidate)
      const nextConstraints = cloneConstraints(activeConstraints)
      for (const [dependency, range] of Object.entries(candidate.entry.dependencies ?? {})) {
        addConstraint(nextConstraints, dependency, range, `${name}@${candidate.entry.version}`)
      }
      const result = visit(nextSelected, nextConstraints)
      if (result !== null) return result
    }
    return null
  }

  const solved = visit(new Map(), constraints)
  if (solved === null) throw new ConflictError('package constraints are unsatisfiable', { rejected })
  const packages = [...solved.selected.values()].sort((a, b) => a.entry.name.localeCompare(b.entry.name)).map(candidate => ({
    name: candidate.entry.name,
    version: candidate.entry.version,
    repository: candidate.repository.id,
    artifact: candidate.entry.artifact,
    dependencies: candidate.entry.dependencies ?? {},
    resources: candidate.entry.resources ?? [],
    reason: requests.some(request => request.name === candidate.entry.name) ? 'explicit' : 'dependency',
    dsh: candidate.entry.dsh ?? '*',
  }))
  return {
    packages,
    explanation: packages.map(pkg => ({
      package: `${pkg.name}@${pkg.version}`,
      repository: pkg.repository,
      reason: pkg.reason,
      constraints: solved.constraints.get(pkg.name),
    })),
  }
}
