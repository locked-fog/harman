import { access } from 'node:fs/promises'
import { constants } from 'node:fs'
import { resolve } from 'node:path'
import { ConflictError, NotFoundError, ValidationError } from './errors.js'
import { parseVersion } from './semver.js'

export function runtimeId(version) {
  parseVersion(version)
  return `dsh@${version}`
}

export class RuntimeManager {
  constructor(stateStore) {
    this.stateStore = stateStore
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
}
