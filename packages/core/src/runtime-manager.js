import { access } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { constants } from 'node:fs'
import { join, resolve } from 'node:path'
import { ConflictError, NotFoundError, ValidationError } from './errors.js'
import { compareVersions, parseVersion } from './semver.js'
import { PackageStore } from './package-store.js'
import { resolveArtifactUrl } from './repository.js'
import { verifyArtifactTrust } from './trust.js'

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
      if (!runtime.official || runtime.compatibility !== 'compatible') {
        throw new ConflictError(`Runtime ${id} cannot become latest`, { official: runtime.official, compatibility: runtime.compatibility })
      }
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
    if (runtime.compatibility !== 'compatible') throw new ConflictError(`Runtime ${runtime.id} is not compatible`, { compatibility: runtime.compatibility })
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
    if (!contract.ok) return { available: preview, changed: false, compatibility, diagnostics: { stderr: contract.stderr.slice(-4000) } }
    await this.setLatest(id)
    return { available: preview, changed: true, compatibility, runtime: id }
  }
}
