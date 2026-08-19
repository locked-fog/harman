import { join } from 'node:path'
import {
  addPackage, addRepository, packageId, removePackage, removeRepository,
} from './domain.js'
import { ConflictError, NotFoundError, ValidationError } from './errors.js'
import { packageImpact } from './graph.js'
import { PackageStore } from './package-store.js'
import {
  readRepositoryCache, resolveArtifactUrl, searchRepositoryIndexes, syncRepository,
} from './repository.js'
import { solvePackages } from './solver.js'
import { RecipeBuilder } from './recipe-builder.js'
import { publicKeyId, verifyArtifactTrust, verifyIndexTrust } from './trust.js'

function parseRequest(spec) {
  if (typeof spec !== 'string' || spec === '') throw new ValidationError('package request is empty')
  const separator = spec.lastIndexOf('@')
  if (separator > 0) return { name: spec.slice(0, separator), range: spec.slice(separator + 1) || '*' }
  return { name: spec, range: '*' }
}

export class PackageManager {
  constructor(stateStore) {
    this.stateStore = stateStore
    this.store = new PackageStore(join(stateStore.root, 'store'))
    this.recipes = new RecipeBuilder(stateStore.root, { store: this.store })
  }

  async addRepository(input) {
    await this.stateStore.initialize()
    return this.stateStore.transaction({ action: 'repository.add', details: input }, state => addRepository(state, input))
  }

  async sources() {
    const state = await this.stateStore.read()
    const sources = []
    for (const repository of Object.values(state.repositories)) {
      if (!repository.enabled || repository.indexHash === null) continue
      const index = await readRepositoryCache(this.stateStore.root, repository.id)
      verifyIndexTrust(index, repository)
      sources.push({ repository, index })
    }
    return sources
  }

  async removeRepository(id) {
    return (await this.stateStore.transaction({ action: 'repository.remove', details: { id } }, state => removeRepository(state, id))).result
  }

  async configureRepository(id, changes) {
    return (await this.stateStore.transaction({ action: 'repository.configure', details: { id, changes } }, state => {
      const repository = state.repositories[id]
      if (repository === undefined) throw new NotFoundError(`repository ${id} does not exist`)
      if (changes.priority !== undefined) repository.priority = changes.priority
      if (changes.enabled !== undefined) repository.enabled = changes.enabled
      if (changes.signatureThreshold !== undefined) {
        if (!Number.isInteger(changes.signatureThreshold) || changes.signatureThreshold < 1) throw new ValidationError('signature threshold must be a positive integer')
        const active = Object.keys(repository.trustedKeys ?? {}).filter(key => !(repository.revokedKeys ?? []).includes(key)).length
        if (changes.signatureThreshold > active) throw new ConflictError('signature threshold exceeds active key count', { active })
        repository.signatureThreshold = changes.signatureThreshold
      }
      if (changes.trustPolicy !== undefined) {
        if (!['trusted-local', 'hash-only', 'signed'].includes(changes.trustPolicy)) throw new ValidationError('invalid repository trust policy')
        if (changes.trustPolicy === 'signed' && Object.keys(repository.trustedKeys ?? {}).filter(key => !(repository.revokedKeys ?? []).includes(key)).length === 0) throw new ConflictError('signed trust policy requires an active key')
        repository.trustPolicy = changes.trustPolicy
      }
      return repository
    })).result
  }

  async addRepositoryKey(id, publicKeyPem) {
    const keyId = publicKeyId(publicKeyPem)
    return (await this.stateStore.transaction({ action: 'repository.key.add', details: { id, keyId } }, state => {
      const repository = state.repositories[id]
      if (repository === undefined) throw new NotFoundError(`repository ${id} does not exist`)
      repository.trustedKeys ??= {}
      repository.revokedKeys ??= []
      if (repository.trustedKeys[keyId] !== undefined) throw new ConflictError(`repository key ${keyId} already exists`)
      repository.trustedKeys[keyId] = publicKeyPem
      return { repository: id, keyId }
    })).result
  }

  async revokeRepositoryKey(id, keyId) {
    return (await this.stateStore.transaction({ action: 'repository.key.revoke', details: { id, keyId } }, state => {
      const repository = state.repositories[id]
      if (repository === undefined) throw new NotFoundError(`repository ${id} does not exist`)
      if (repository.trustedKeys?.[keyId] === undefined) throw new NotFoundError(`repository key ${keyId} does not exist`)
      repository.revokedKeys = [...new Set([...(repository.revokedKeys ?? []), keyId])].sort()
      return { repository: id, keyId, revoked: true }
    })).result
  }

  async sync() {
    await this.stateStore.initialize()
    const state = await this.stateStore.read()
    const enabled = Object.values(state.repositories).filter(repository => repository.enabled)
    if (enabled.length === 0) throw new NotFoundError('no enabled repositories are configured')
    const results = []
    for (const repository of enabled.sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id))) {
      const result = await syncRepository(this.stateStore.root, repository)
      await this.stateStore.transaction({ action: 'repository.sync', details: { repository: repository.id, changed: result.changed } }, draft => {
        const current = draft.repositories[repository.id]
        if (current === undefined) throw new NotFoundError(`repository ${repository.id} was removed during sync`)
        current.indexVersion = result.index.schemaVersion
        current.sequence = result.index.sequence
        current.generatedAt = result.index.generatedAt
        current.lastSync = new Date().toISOString()
        current.etag = result.etag
        current.indexHash = result.indexHash
      })
      results.push({ repository: repository.id, changed: result.changed, sequence: result.index.sequence, packages: Object.keys(result.index.packages).length })
    }
    return results
  }

  async search(query) {
    return searchRepositoryIndexes(await this.sources(), query)
  }

  async buildRecipe(recipe, options = {}) {
    await this.stateStore.initialize()
    return this.recipes.build(recipe, options)
  }

  async planInstall(specs, options = {}) {
    const requests = specs.map(parseRequest)
    const sources = await this.sources()
    if (sources.length === 0) throw new NotFoundError('no synchronized repositories are available')
    const solved = solvePackages(sources, requests, options)
    const sourceById = new Map(sources.map(source => [source.repository.id, source]))
    return {
      ...solved,
      packages: solved.packages.map(pkg => {
        const repository = sourceById.get(pkg.repository).repository
        const trustedSignatures = verifyArtifactTrust(pkg, repository)
        return { ...pkg, trustedSignatures, artifact: { ...pkg.artifact, url: resolveArtifactUrl(repository.url, pkg.artifact.url) } }
      }),
    }
  }

  async install(specs, options = {}) {
    const plan = await this.planInstall(specs, options)
    if (options.dryRun) return { dryRun: true, plan }
    const imported = new Map()
    for (const pkg of plan.packages) {
      imported.set(packageId(pkg.name, pkg.version), await this.store.importArtifact({
        name: pkg.name, version: pkg.version, url: pkg.artifact.url, sha256: pkg.artifact.sha256,
      }))
    }
    const idByName = new Map(plan.packages.map(pkg => [pkg.name, packageId(pkg.name, pkg.version)]))
    const result = await this.stateStore.transaction({ action: 'package.install', details: { requests: specs, packages: plan.packages.map(pkg => `${pkg.name}@${pkg.version}`) } }, state => {
      const installed = []
      for (const pkg of plan.packages) {
        const id = packageId(pkg.name, pkg.version)
        const existing = state.packages[id]
        if (existing !== undefined) {
          if (existing.contentHash !== pkg.artifact.sha256) throw new ConflictError(`installed package ${id} has different content hash`)
          continue
        }
        addPackage(state, {
          name: pkg.name,
          version: pkg.version,
          contentHash: pkg.artifact.sha256,
          source: pkg.repository,
          reason: pkg.reason,
          dependencies: Object.keys(pkg.dependencies).map(name => idByName.get(name)),
        })
        installed.push(id)
      }
      return installed
    })
    return { dryRun: false, plan, installed: result.result, store: Object.fromEntries(imported) }
  }

  async query(spec) {
    const state = await this.stateStore.read()
    if (state.packages[spec] !== undefined) return state.packages[spec]
    const candidates = Object.values(state.packages).filter(pkg => pkg.name === spec)
    if (candidates.length === 0) throw new NotFoundError(`package ${spec} is not installed`)
    if (candidates.length > 1) throw new ConflictError(`package name ${spec} has multiple installed versions`, { versions: candidates.map(pkg => pkg.id) })
    return candidates[0]
  }

  async remove(specs, options = {}) {
    const state = await this.stateStore.read()
    const ids = []
    for (const spec of specs) {
      if (state.packages[spec] !== undefined) ids.push(spec)
      else {
        const matches = Object.values(state.packages).filter(pkg => pkg.name === spec)
        if (matches.length === 0) throw new NotFoundError(`package ${spec} is not installed`)
        if (matches.length > 1) throw new ConflictError(`package ${spec} has multiple installed versions`, { versions: matches.map(pkg => pkg.id) })
        ids.push(matches[0].id)
      }
    }
    const impacts = ids.map(id => packageImpact(state, id))
    if (options.dryRun) return { dryRun: true, impacts }
    if (!options.confirmed) throw new ConflictError('package removal requires --yes after reviewing impact', { impacts })
    const result = await this.stateStore.transaction({ action: 'package.remove', details: { packages: ids } }, draft => ids.map(id => removePackage(draft, id).id))
    return { dryRun: false, removed: result.result, impacts }
  }

  async upgrade(options = {}) {
    const before = await this.stateStore.read()
    const explicit = Object.values(before.packages).filter(pkg => pkg.reason === 'explicit')
    if (explicit.length === 0) return { dryRun: Boolean(options.dryRun), changes: [], installed: [], retained: [] }
    const plan = await this.planInstall(explicit.map(pkg => pkg.name), options)
    const selectedByName = new Map(plan.packages.map(pkg => [pkg.name, packageId(pkg.name, pkg.version)]))
    const changes = explicit.map(pkg => ({ from: pkg.id, to: selectedByName.get(pkg.name) })).filter(change => change.from !== change.to)
    if (options.dryRun) return { dryRun: true, changes, plan }
    const imported = new Map()
    for (const pkg of plan.packages) {
      imported.set(packageId(pkg.name, pkg.version), await this.store.importArtifact({
        name: pkg.name, version: pkg.version, url: pkg.artifact.url, sha256: pkg.artifact.sha256,
      }))
    }
    const idByName = new Map(plan.packages.map(pkg => [pkg.name, packageId(pkg.name, pkg.version)]))
    const transaction = await this.stateStore.transaction({ action: 'package.upgrade', details: { changes } }, state => {
      const installed = []
      const retained = []
      for (const pkg of plan.packages) {
        const id = packageId(pkg.name, pkg.version)
        if (state.packages[id] === undefined) {
          addPackage(state, {
            name: pkg.name, version: pkg.version, contentHash: pkg.artifact.sha256,
            source: pkg.repository, reason: pkg.reason,
            dependencies: Object.keys(pkg.dependencies).map(name => idByName.get(name)),
          })
          installed.push(id)
        }
      }
      for (const change of changes) {
        try {
          removePackage(state, change.from)
        } catch (error) {
          if (!(error instanceof ConflictError)) throw error
          retained.push({ id: change.from, reason: error.details })
        }
      }
      return { installed, retained }
    })
    return { dryRun: false, changes, ...transaction.result, store: Object.fromEntries(imported) }
  }
}
