import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import { canonicalJson, contentHash } from './canonical.js'
import { addPackage, addResource, removeResource } from './domain.js'
import { ConflictError, NotFoundError, ValidationError } from './errors.js'
import { makeReadOnly, PackageStore } from './package-store.js'
import { ProfileManager } from './profile-manager.js'
import { fingerprintPath } from './resource-manager.js'

async function exists(path) {
  try { await lstat(path); return true } catch (error) { if (error?.code === 'ENOENT') return false; throw error }
}

async function copyTree(source, destination) {
  const info = await lstat(source)
  if (info.isSymbolicLink()) throw new ValidationError(`bundle copy refuses symbolic link ${source}`)
  if (info.isDirectory()) {
    await mkdir(destination, { mode: 0o700 })
    for (const name of (await readdir(source)).sort()) await copyTree(join(source, name), join(destination, name))
  } else if (info.isFile()) {
    await writeFile(destination, await readFile(source), { flag: 'wx', mode: 0o600 })
  } else throw new ValidationError(`bundle copy refuses unsupported object ${source}`)
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

async function verifyObjectDirectory(path, expected) {
  const manifest = JSON.parse(await readFile(join(path, '.harman-object.json'), 'utf8'))
  if (manifest.artifactSha256 !== expected.contentHash || manifest.name !== expected.name || manifest.version !== expected.version) {
    throw new ConflictError(`bundle Store object identity mismatch for ${expected.id}`)
  }
  const expectedPaths = new Set(manifest.files.map(file => file.path))
  async function walk(current, relative = '') {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new ValidationError(`bundle Store object contains link ${entry.name}`)
      const childRelative = relative === '' ? entry.name : `${relative}/${entry.name}`
      if (entry.isDirectory()) await walk(join(current, entry.name), childRelative)
      else if (entry.isFile() && childRelative !== '.harman-object.json') {
        if (!expectedPaths.delete(childRelative)) throw new ConflictError(`bundle Store object has unexpected file ${childRelative}`)
        const record = manifest.files.find(file => file.path === childRelative)
        if (sha256(await readFile(join(current, entry.name))) !== record.sha256) throw new ConflictError(`bundle Store file hash mismatch: ${childRelative}`)
      } else if (!entry.isFile()) throw new ValidationError(`bundle Store object has unsupported entry ${childRelative}`)
    }
  }
  await walk(path)
  if (expectedPaths.size > 0) throw new ConflictError('bundle Store object is missing files', { files: [...expectedPaths] })
  return manifest
}

export class ProfileBundleManager {
  constructor(stateStore, options = {}) {
    this.stateStore = stateStore
    this.profiles = options.profiles ?? new ProfileManager(stateStore, options)
    this.store = new PackageStore(join(stateStore.root, 'store'))
  }

  async export(name, destination) {
    const target = resolve(destination)
    if (await exists(target)) throw new ConflictError(`export destination already exists: ${target}`)
    const state = await this.stateStore.read()
    const profile = state.profiles[name]
    if (profile === undefined) throw new NotFoundError(`profile ${name} does not exist`)
    const stage = `${target}.stage-${randomUUID()}`
    try {
      await mkdir(stage, { recursive: true, mode: 0o700 })
      const packages = []
      for (const id of profile.packages) {
        const pkg = state.packages[id]
        const source = this.store.objectPath(pkg.contentHash)
        await verifyObjectDirectory(source, pkg)
        await mkdir(join(stage, 'objects', 'sha256'), { recursive: true, mode: 0o700 })
        await copyTree(source, join(stage, 'objects', 'sha256', pkg.contentHash))
        packages.push(pkg)
      }
      const resources = []
      for (const id of profile.resources) {
        const resource = state.resources[id]
        const record = { ...resource }
        if (resource.ownership === 'managed') {
          const bundlePath = join('resources', ...id.split('/'))
          await mkdir(dirname(join(stage, bundlePath)), { recursive: true, mode: 0o700 })
          await copyTree(resource.location, join(stage, bundlePath))
          record.bundlePath = bundlePath
        } else if (resource.ownership === 'package') {
          const pkg = state.packages[resource.packageId]
          const objectRoot = this.store.objectPath(pkg.contentHash)
          const location = resolve(resource.location)
          if (location !== objectRoot && !location.startsWith(objectRoot + sep)) throw new ConflictError(`package Resource ${resource.id} escapes its Store object`)
          record.packageRelativePath = location === objectRoot ? '' : location.slice(objectRoot.length + 1)
        }
        resources.push(record)
      }
      const declaration = {
        packages: [...profile.packages], resources: [...profile.resources], app: profile.app, runtime: profile.runtime,
        lastResolvedRuntime: profile.lastResolvedRuntime, pluginConfig: profile.pluginConfig,
        promptOrder: profile.promptOrder, mcp: profile.mcp, models: profile.models, cordisPatch: profile.cordisPatch,
      }
      const sourceLock = JSON.parse(await readFile(join(profile.dshHome, 'harman.lock.json'), 'utf8'))
      const manifest = {
        schemaVersion: 1, exportedProfile: name, declaration, packages, resources,
        runtimePolicy: profile.runtime, resolvedRuntime: profile.lastResolvedRuntime,
        sourceLock, sourceLockHash: sourceLock.lockHash,
      }
      manifest.manifestHash = contentHash(manifest)
      await writeFile(join(stage, 'profile-export.json'), canonicalJson(manifest), { flag: 'wx', mode: 0o600 })
      await rename(stage, target)
      return { destination: target, manifestHash: manifest.manifestHash, packages: packages.length, resources: resources.length }
    } catch (error) {
      await rm(stage, { recursive: true, force: true })
      throw error
    }
  }

  async restore(bundlePath, options = {}) {
    const root = resolve(bundlePath)
    const manifest = JSON.parse(await readFile(join(root, 'profile-export.json'), 'utf8'))
    if (manifest.schemaVersion !== 1) throw new ValidationError('unsupported Profile export schema')
    const expectedHash = manifest.manifestHash
    const withoutHash = { ...manifest }
    delete withoutHash.manifestHash
    if (contentHash(withoutHash) !== expectedHash) throw new ConflictError('Profile export manifest hash mismatch')
    const name = options.name ?? manifest.exportedProfile
    const mode = options.mode ?? 'strict'
    if (!['strict', 'follow-latest'].includes(mode)) throw new ValidationError('restore mode must be strict or follow-latest')
    const state = await this.stateStore.read()
    if (state.profiles[name] !== undefined) throw new ConflictError(`profile ${name} already exists`)
    let runtime
    if (mode === 'strict') {
      if (manifest.resolvedRuntime === null) throw new ConflictError('strict restore requires an exported resolved Runtime')
      const candidate = state.runtimes[manifest.resolvedRuntime.id]
      if (candidate === undefined || candidate.contentHash !== manifest.resolvedRuntime.contentHash || candidate.compatibility !== 'compatible') {
        throw new ConflictError('strict restore Runtime is unavailable or mismatched', { required: manifest.resolvedRuntime })
      }
      runtime = { version: manifest.resolvedRuntime.version }
    } else runtime = manifest.runtimePolicy

    for (const pkg of manifest.packages) {
      const source = join(root, 'objects', 'sha256', pkg.contentHash)
      await verifyObjectDirectory(source, pkg)
      const destination = this.store.objectPath(pkg.contentHash)
      if (!(await exists(destination))) {
        const stage = `${destination}.stage-${randomUUID()}`
        await mkdir(dirname(destination), { recursive: true, mode: 0o700 })
        await copyTree(source, stage)
        await makeReadOnly(stage, { preserveRootWritable: true })
        await rename(stage, destination)
        await import('node:fs/promises').then(fs => fs.chmod(destination, 0o555))
      } else await verifyObjectDirectory(destination, pkg)
    }
    const managedCopies = []
    const addedPackages = []
    const addedResources = []
    try {
      for (const resource of manifest.resources) {
        if (resource.ownership === 'external') {
          const actual = await fingerprintPath(resource.location, { metadataOnly: resource.type === 'mcp' })
          if (actual !== resource.fingerprint) throw new ConflictError(`external Resource ${resource.id} is missing or changed`, { expected: resource.fingerprint, actual })
        } else if (resource.ownership === 'managed') {
          const target = resolve(this.stateStore.managedResourceRoot, ...resource.id.split('/'))
          if (!target.startsWith(this.stateStore.managedResourceRoot + sep)) throw new ValidationError('managed restore target escapes root')
          if (await exists(target)) throw new ConflictError(`managed restore target exists: ${target}`)
          await mkdir(dirname(target), { recursive: true, mode: 0o700 })
          await copyTree(join(root, resource.bundlePath), target)
          const actual = await fingerprintPath(target, { metadataOnly: resource.type === 'mcp' })
          if (actual !== resource.fingerprint) throw new ConflictError(`managed Resource ${resource.id} bundle content changed`, { expected: resource.fingerprint, actual })
          managedCopies.push(target)
        }
      }
      await this.stateStore.transaction({ action: 'profile.restore.inputs', details: { name, mode, manifestHash: expectedHash } }, draft => {
        for (const pkg of manifest.packages) if (draft.packages[pkg.id] === undefined) { addPackage(draft, pkg); addedPackages.push(pkg.id) }
        for (const resource of manifest.resources) if (draft.resources[resource.id] === undefined) {
          addResource(draft, {
            ...resource,
            location: resource.ownership === 'managed'
              ? resolve(this.stateStore.managedResourceRoot, ...resource.id.split('/'))
              : resource.ownership === 'package'
                ? join(this.store.objectPath(draft.packages[resource.packageId].contentHash), ...(resource.packageRelativePath ?? '').split('/').filter(Boolean))
                : resource.location,
            managedRelativePath: resource.id,
          }, { managedResourceRoot: this.stateStore.managedResourceRoot })
          addedResources.push(resource.id)
        }
      })
      const created = await this.profiles.create({ ...manifest.declaration, name, runtime })
      const restoredHash = created.lock.lockHash
      const identity = lock => ({
        packages: lock.packages.map(({ id, name: packageName, version, contentHash: hash }) => ({ id, name: packageName, version, contentHash: hash })),
        resources: lock.resources.map(({ id, type, ownership, fingerprint }) => ({ id, type, ownership, fingerprint })),
        config: lock.config,
        cordisPatchHash: lock.cordisPatchHash,
      })
      const equivalent = contentHash(identity(created.lock)) === contentHash(identity(manifest.sourceLock))
      return { profile: name, mode, manifestHash: expectedHash, sourceLockHash: manifest.sourceLockHash, restoredLockHash: restoredHash, equivalent, runtimeSelection: mode === 'strict' ? manifest.resolvedRuntime : manifest.runtimePolicy }
    } catch (error) {
      for (const path of managedCopies) await rm(path, { recursive: true, force: true })
      if (addedPackages.length > 0 || addedResources.length > 0) {
        await this.stateStore.transaction({ action: 'profile.restore.rollback', details: { name } }, draft => {
          for (const id of [...addedResources].reverse()) if (draft.resources[id] !== undefined) removeResource(draft, id)
          for (const id of addedPackages) delete draft.packages[id]
        })
      }
      throw error
    }
  }
}
