import {
  mkdir, open, readFile, rename, rm, stat, writeFile,
} from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { canonicalJson, contentHash, deepClone, newTransactionId, redactSecrets } from './canonical.js'
import { StateBusyError, StaleRevisionError, ValidationError } from './errors.js'
import { emptyState, validateState } from './state-schema.js'

const STATE_FILENAME = 'state.json'
const JOURNAL_FILENAME = 'transaction-intent.json'
const LOCK_DIRECTORY = 'state.lock'

async function fsyncFile(path) {
  const handle = await open(path, 'r')
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}

async function fsyncDirectory(path) {
  const handle = await open(path, 'r')
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}

async function exists(path) {
  try {
    await stat(path)
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

export class StateStore {
  constructor(root, options = {}) {
    this.root = resolve(root)
    this.statePath = join(this.root, STATE_FILENAME)
    this.journalPath = join(this.root, JOURNAL_FILENAME)
    this.lockPath = join(this.root, LOCK_DIRECTORY)
    this.recoveryRoot = join(this.root, 'recovery')
    this.managedResourceRoot = resolve(options.managedResourceRoot ?? join(this.root, 'resources', 'managed'))
    this.clock = options.clock ?? (() => new Date())
    this.failpoint = options.failpoint ?? (() => {})
  }

  validationOptions() {
    return { managedResourceRoot: this.managedResourceRoot }
  }

  async initialize() {
    await mkdir(this.root, { recursive: true })
    await mkdir(this.managedResourceRoot, { recursive: true })
    const release = await this.acquireLock()
    try {
      if (!(await exists(this.statePath))) {
        const initial = canonicalJson(emptyState())
        const temporary = join(this.root, `.state.init-${process.pid}-${newTransactionId()}`)
        await writeFile(temporary, initial, { flag: 'wx', mode: 0o600 })
        await fsyncFile(temporary)
        await rename(temporary, this.statePath)
        await fsyncDirectory(this.root)
      }
      await this.recoverInterruptedTransaction()
      return this.read()
    } finally {
      await release()
    }
  }

  async read() {
    const raw = await readFile(this.statePath, 'utf8')
    let state
    try {
      state = JSON.parse(raw)
    } catch (error) {
      throw new ValidationError(`state file is not valid JSON: ${error.message}`)
    }
    return validateState(state, this.validationOptions())
  }

  async recoverInterruptedTransaction() {
    if (!(await exists(this.journalPath))) return { recovered: false }
    let journal
    try {
      journal = JSON.parse(await readFile(this.journalPath, 'utf8'))
    } catch (error) {
      throw new ValidationError(`transaction journal is not valid JSON: ${error.message}`)
    }
    const state = await this.read()
    const currentHash = contentHash(state)
    if (journal.proposedHash === currentHash && journal.proposedRevision === state.revision) {
      if (journal.transactionId !== undefined) {
        await rm(join(this.root, `.state.${journal.transactionId}.tmp`), { force: true })
      }
      await rm(this.journalPath)
      await fsyncDirectory(this.root)
      return { recovered: true, outcome: 'committed', transactionId: journal.transactionId }
    }
    await mkdir(this.recoveryRoot, { recursive: true })
    const safeTime = this.clock().toISOString().replaceAll(':', '-').replaceAll('.', '-')
    const preserved = join(this.recoveryRoot, `${safeTime}-${journal.transactionId ?? 'unknown'}.json`)
    if (journal.transactionId !== undefined) {
      await rm(join(this.root, `.state.${journal.transactionId}.tmp`), { force: true })
    }
    await rename(this.journalPath, preserved)
    await fsyncDirectory(this.root)
    return { recovered: true, outcome: 'aborted', transactionId: journal.transactionId, preserved }
  }

  async acquireLock() {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await mkdir(this.lockPath)
      } catch (error) {
        if (error?.code !== 'EEXIST') throw error
        let owner
        try {
          owner = JSON.parse(await readFile(join(this.lockPath, 'owner.json'), 'utf8'))
        } catch {
          owner = undefined
        }
        if (attempt === 0 && Number.isInteger(owner?.pid) && !this.isProcessAlive(owner.pid)) {
          await mkdir(this.recoveryRoot, { recursive: true })
          const safeTime = this.clock().toISOString().replaceAll(':', '-').replaceAll('.', '-')
          const preserved = join(this.recoveryRoot, `${safeTime}-dead-lock-${owner.pid}`)
          try {
            await rename(this.lockPath, preserved)
            await fsyncDirectory(this.root)
            continue
          } catch (renameError) {
            if (renameError?.code === 'ENOENT') continue
            throw renameError
          }
        }
        throw new StateBusyError('another Harman state transaction holds the writer lock', owner)
      }
      const owner = { pid: process.pid, acquiredAt: this.clock().toISOString() }
      await writeFile(join(this.lockPath, 'owner.json'), canonicalJson(owner), { mode: 0o600 })
      await fsyncDirectory(this.lockPath)
      return async () => {
        await rm(this.lockPath, { recursive: true, force: true })
        await fsyncDirectory(this.root)
      }
    }
    throw new StateBusyError('failed to acquire Harman state writer lock after dead-owner recovery')
  }

  isProcessAlive(pid) {
    try {
      process.kill(pid, 0)
      return true
    } catch (error) {
      if (error?.code === 'ESRCH') return false
      return true
    }
  }

  async transaction({ action, actor = 'cli', details = {}, expectedRevision }, mutate) {
    if (typeof action !== 'string' || action.trim() === '') throw new ValidationError('transaction action is required')
    if (typeof mutate !== 'function') throw new ValidationError('transaction mutator must be a function')
    const release = await this.acquireLock()
    let temporary
    try {
      await this.recoverInterruptedTransaction()
      const current = await this.read()
      if (expectedRevision !== undefined && expectedRevision !== current.revision) {
        throw new StaleRevisionError(expectedRevision, current.revision)
      }
      const draft = deepClone(current)
      const result = await mutate(draft)
      draft.revision = current.revision + 1
      const transactionId = newTransactionId()
      draft.audit.push({
        id: transactionId,
        revision: draft.revision,
        time: this.clock().toISOString(),
        actor,
        action,
        details: redactSecrets(details),
      })
      validateState(draft, this.validationOptions())

      const journal = {
        schemaVersion: 1,
        transactionId,
        baseRevision: current.revision,
        proposedRevision: draft.revision,
        baseHash: contentHash(current),
        proposedHash: contentHash(draft),
        action,
        createdAt: this.clock().toISOString(),
      }
      await writeFile(this.journalPath, canonicalJson(journal), { flag: 'wx', mode: 0o600 })
      await fsyncFile(this.journalPath)
      await fsyncDirectory(this.root)
      await this.failpoint('afterJournal', { current, draft, journal })

      temporary = join(this.root, `.state.${transactionId}.tmp`)
      await writeFile(temporary, canonicalJson(draft), { flag: 'wx', mode: 0o600 })
      await fsyncFile(temporary)
      await this.failpoint('afterTemporary', { current, draft, journal, temporary })
      await rename(temporary, this.statePath)
      temporary = undefined
      await fsyncDirectory(dirname(this.statePath))
      await this.failpoint('afterPublish', { current, draft, journal })
      await rm(this.journalPath)
      await fsyncDirectory(this.root)
      return { state: draft, result, transactionId }
    } finally {
      if (temporary !== undefined) await rm(temporary, { force: true })
      await release()
    }
  }
}
