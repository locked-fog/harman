import { createHash } from 'node:crypto'
import { access, readFile, realpath } from 'node:fs/promises'
import { execFile, spawn } from 'node:child_process'
import { constants } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import { ConflictError, NotFoundError, ValidationError } from './errors.js'
import { compareVersions, parseVersion } from './semver.js'
import { PackageStore } from './package-store.js'
import { resolveArtifactUrl } from './repository.js'
import { verifyArtifactTrust } from './trust.js'

const execFileAsync = promisify(execFile)

async function readJson(path) {
  try { return JSON.parse(await readFile(path, 'utf8')) } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR' || error instanceof SyntaxError) return null
    throw error
  }
}

function packageBins(manifest) {
  if (typeof manifest?.bin === 'string') return { dsh: manifest.bin }
  if (manifest?.bin !== null && typeof manifest?.bin === 'object') return manifest.bin
  return {}
}

async function commandStdout(command, args) {
  try {
    const result = await execFileAsync(command, args, { encoding: 'utf8', timeout: 5_000, maxBuffer: 2 * 1024 * 1024 })
    return result.stdout
  } catch {
    return null
  }
}

function listedPackageRoot(value) {
  const direct = value?.dependencies?.['@deepseek-ai/dsh']
  return typeof direct?.path === 'string' ? direct.path : null
}

async function findManifestRoot(path) {
  let current = resolve(path)
  for (let depth = 0; depth < 8; depth += 1) {
    const manifestPath = join(current, 'package.json')
    const manifest = await readJson(manifestPath)
    if (manifest?.name === '@deepseek-ai/dsh') return { root: current, manifest }
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  return null
}

async function sha256File(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex')
}

export function runtimeId(version) {
  parseVersion(version)
  return `dsh@${version}`
}

export class RuntimeManager {
  constructor(stateStore) {
    this.stateStore = stateStore
    this.store = new PackageStore(join(stateStore.root, 'store'))
  }

  async register(input) {
    const id = runtimeId(input.version)
    const executable = resolve(input.executable)
    try { await access(executable, constants.X_OK) } catch { throw new ValidationError(`DSH executable is not executable: ${executable}`) }
    if (!/^[a-f0-9]{64}$/.test(input.contentHash ?? '')) throw new ValidationError('Runtime contentHash must be SHA-256')
    if (!['compatible', 'breaking', 'unvalidated'].includes(input.compatibility)) throw new ValidationError('Runtime compatibility status is invalid')
    return (await this.stateStore.transaction({ action: 'runtime.register', details: { id, source: input.source } }, state => {
      if (state.runtimes[id] !== undefined) throw new ConflictError(`Runtime ${id} already exists`)
      state.runtimes[id] = {
        id, version: input.version, executable, source: input.source,
        contentHash: input.contentHash, compatibility: input.compatibility,
        launcherArgs: input.launcherArgs ?? [],
        official: input.official === true, latest: false,
        validatedAt: input.validatedAt ?? null,
        contract: input.contract ?? null,
      }
      return state.runtimes[id]
    })).result
  }

  async setLatest(id) {
    return (await this.stateStore.transaction({ action: 'runtime.latest', details: { id } }, state => {
      const runtime = state.runtimes[id]
      if (runtime === undefined) throw new NotFoundError(`Runtime ${id} does not exist`)
      for (const candidate of Object.values(state.runtimes)) candidate.latest = candidate.id === id
      return runtime
    })).result
  }

  async list() {
    return Object.values((await this.stateStore.read()).runtimes).sort((a, b) => a.id.localeCompare(b.id))
  }

  resolveFromState(state, policy) {
    let runtime
    if (policy.channel === 'latest') runtime = Object.values(state.runtimes).find(candidate => candidate.latest)
    else runtime = state.runtimes[runtimeId(policy.version)]
    if (runtime === undefined) throw new NotFoundError(`no Runtime resolves policy ${JSON.stringify(policy)}`)
    return runtime
  }

  async resolve(policy) {
    return this.resolveFromState(await this.stateStore.read(), policy)
  }

  availableFromSources(sources) {
    const candidates = []
    for (const { repository, index } of sources) for (const entry of index.runtimes?.dsh ?? []) candidates.push({ repository, entry })
    return candidates.sort((a, b) => compareVersions(b.entry.version, a.entry.version) || b.repository.priority - a.repository.priority || a.repository.id.localeCompare(b.repository.id))
  }

  async globalPackageRoots(options = {}) {
    if (Array.isArray(options.packageRoots)) return options.packageRoots.map(path => resolve(path))

    const roots = new Set()
    const configured = process.env.HARMAN_DSH_PACKAGE_ROOT
    if (configured !== undefined && configured.trim() !== '') roots.add(resolve(configured))

    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
    const listed = await commandStdout(npm, ['list', '--global', '--depth=0', '--json', '@deepseek-ai/dsh'])
    if (listed !== null) {
      try {
        const root = listedPackageRoot(JSON.parse(listed))
        if (root !== null) roots.add(resolve(root))
      } catch {}
    }

    const npmRoot = await commandStdout(npm, ['root', '--global'])
    if (npmRoot !== null && npmRoot.trim() !== '') roots.add(resolve(npmRoot.trim(), '@deepseek-ai', 'dsh'))

    const npmPrefix = await commandStdout(npm, ['prefix', '--global'])
    if (npmPrefix !== null && npmPrefix.trim() !== '') roots.add(resolve(npmPrefix.trim(), 'lib', 'node_modules', '@deepseek-ai', 'dsh'))

    const locator = process.platform === 'win32' ? 'where.exe' : 'which'
    const located = await commandStdout(locator, ['dsh'])
    if (located !== null && located.trim() !== '') {
      const resolved = await realpath(located.trim().split(/\r?\n/)[0]).catch(() => resolve(located.trim().split(/\r?\n/)[0]))
      const manifest = await findManifestRoot(resolved)
      if (manifest !== null) roots.add(manifest.root)
    }
    return [...roots]
  }

  async inspectPackageRoot(root) {
    const packageRoot = resolve(root)
    const manifest = await readJson(join(packageRoot, 'package.json'))
    if (manifest?.name !== '@deepseek-ai/dsh' || typeof manifest.version !== 'string') return null
    parseVersion(manifest.version)

    const bins = packageBins(manifest)
    const binPath = bins.dsh ?? bins[Object.keys(bins)[0]] ?? 'bin/dsh.mjs'
    if (typeof binPath !== 'string' || binPath.trim() === '') return null
    const target = resolve(packageRoot, binPath)
    if (target !== packageRoot && !target.startsWith(`${packageRoot}${sep}`)) return null
    try { await access(target, constants.F_OK) } catch { return null }
    const targetHash = await sha256File(target)
    let executable = target
    let launcherArgs = []
    try { await access(target, constants.X_OK) } catch {
      executable = process.execPath
      launcherArgs = [target]
    }
    return {
      id: runtimeId(manifest.version), version: manifest.version, executable, launcherArgs,
      contentHash: targetHash, source: `npm:@deepseek-ai/dsh@${manifest.version}`,
      compatibility: 'unvalidated', official: false, latest: true, validatedAt: null, contract: null,
    }
  }

  async detect(options = {}) {
    await this.stateStore.initialize()
    const roots = await this.globalPackageRoots(options)
    const candidates = []
    for (const root of roots) {
      const candidate = await this.inspectPackageRoot(root)
      if (candidate !== null) candidates.push(candidate)
    }
    candidates.sort((left, right) => compareVersions(right.version, left.version) || left.source.localeCompare(right.source))
    if (candidates.length === 0) return { detected: null, changed: false, candidates: [] }

    const candidate = candidates[0]
    const before = await this.stateStore.read()
    const previous = before.runtimes[candidate.id]
    const transaction = await this.stateStore.transaction({ action: 'runtime.detect', details: { id: candidate.id, source: candidate.source } }, state => {
      for (const runtime of Object.values(state.runtimes)) runtime.latest = false
      state.runtimes[candidate.id] = { ...previous, ...candidate, latest: true }
      return state.runtimes[candidate.id]
    })
    const changed = previous === undefined
      || previous.executable !== candidate.executable
      || previous.contentHash !== candidate.contentHash
      || previous.latest !== true
      || previous.compatibility !== candidate.compatibility
    return { detected: transaction.result, changed, candidates: candidates.map(runtime => ({ id: runtime.id, version: runtime.version, executable: runtime.executable, source: runtime.source })) }
  }

  runContract(executable, launcherArgs, timeoutMs = 30_000) {
    return new Promise(resolveRun => {
      const child = spawn(executable, [...launcherArgs, '--help'], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, DSH_HOME: join(this.stateStore.root, 'runtime-contract-home') } })
      let stdout = ''; let stderr = ''; let settled = false
      const finish = result => { if (settled) return; settled = true; clearTimeout(timer); resolveRun(result) }
      child.stdout.on('data', chunk => { stdout += chunk })
      child.stderr.on('data', chunk => { stderr += chunk })
      child.on('error', error => finish({ ok: false, code: null, signal: null, stdout, stderr: `${stderr}${error.message}` }))
      child.on('close', (code, signal) => finish({ ok: code === 0, code, signal, stdout, stderr }))
      const timer = setTimeout(() => { child.kill('SIGKILL'); finish({ ok: false, code: null, signal: 'SIGKILL', stdout, stderr: `${stderr}compatibility contract timed out` }) }, timeoutMs)
    })
  }

  async syncLatest(sources, options = {}) {
    const candidates = this.availableFromSources(sources)
    if (candidates.length === 0) return { available: null, changed: false, reason: 'no-official-runtime-in-repositories' }
    const { repository, entry } = candidates[0]
    const current = Object.values((await this.stateStore.read()).runtimes).find(runtime => runtime.latest)
    const preview = { repository: repository.id, version: entry.version, artifactSha256: entry.artifact.sha256, current: current?.version ?? null }
    if (current?.version === entry.version && current.contentHash === entry.artifact.sha256) return { available: preview, changed: false, reason: 'already-latest' }
    if (options.dryRun) return { available: preview, changed: false, dryRun: true }
    verifyArtifactTrust({ name: '@deepseek-ai/dsh-runtime', version: entry.version, artifact: entry.artifact }, repository)
    const imported = await this.store.importArtifact({ name: '@deepseek-ai/dsh-runtime', version: entry.version, url: resolveArtifactUrl(repository.url, entry.artifact.url), sha256: entry.artifact.sha256 })
    if (!imported.manifest.files.some(file => file.path === entry.executablePath)) throw new ConflictError(`DSH Runtime executable ${entry.executablePath} is absent from its verified artifact`)
    const executable = process.execPath
    const launcherArgs = [join(imported.path, entry.executablePath), ...(entry.launcherArgs ?? [])]
    const contract = await this.runContract(executable, launcherArgs, options.timeoutMs)
    const compatibility = contract.ok ? 'compatible' : 'breaking'
    const id = runtimeId(entry.version)
    await this.stateStore.transaction({ action: 'runtime.validate', details: { id, repository: repository.id, compatibility } }, state => {
      const existing = state.runtimes[id]
      if (existing !== undefined && existing.contentHash !== entry.artifact.sha256) throw new ConflictError(`Runtime ${id} already exists with different content`)
      state.runtimes[id] = {
        id, version: entry.version, executable, launcherArgs,
        source: entry.source ?? `repository:${repository.id}`, contentHash: entry.artifact.sha256,
        compatibility, official: true, latest: existing?.latest ?? false,
        validatedAt: new Date().toISOString(), contract: { command: '--help', code: contract.code, signal: contract.signal },
      }
    })
    await this.setLatest(id)
    return {
      available: preview, changed: true, compatibility, runtime: id,
      ...(contract.ok ? {} : { diagnostics: { stderr: contract.stderr.slice(-4000), message: 'latest was adopted; use an exact version pin if it cannot launch' } }),
    }
  }
}
