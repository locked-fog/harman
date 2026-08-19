#!/usr/bin/env node

import { homedir } from 'node:os'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  HarmanError, PackageManager, StateStore, ValidationError,
  explainPackage, explainProfile, explainResource, packageImpact, profileImpact,
} from '../../packages/core/src/index.js'

const EXIT = {
  VALIDATION_ERROR: 3,
  CONFLICT: 4,
  NOT_FOUND: 5,
  STATE_BUSY: 6,
  STALE_REVISION: 7,
  UNSUPPORTED_SCHEMA: 8,
}

function parseGlobal(argv) {
  const args = [...argv]
  let home
  let json = false
  let dryRun = false
  let confirmed = false
  let dshVersion
  for (let index = 0; index < args.length;) {
    if (args[index] === '--json') {
      json = true
      args.splice(index, 1)
    } else if (args[index] === '--dry-run') {
      dryRun = true
      args.splice(index, 1)
    } else if (args[index] === '--yes' || args[index] === '--noconfirm') {
      confirmed = true
      args.splice(index, 1)
    } else if (args[index] === '--dsh-version') {
      const value = args[index + 1]
      if (value === undefined || value.trim() === '') throw new ValidationError('--dsh-version requires a version')
      dshVersion = value
      args.splice(index, 2)
    } else if (args[index] === '--home') {
      const value = args[index + 1]
      if (value === undefined || value.trim() === '') throw new ValidationError('--home requires a path')
      home = value
      args.splice(index, 2)
    } else {
      index += 1
    }
  }
  const environmentHome = process.env.HARMAN_HOME
  const selected = home ?? (environmentHome !== undefined && environmentHome.trim() !== '' ? environmentHome : `${homedir()}/.harman`)
  return { args, json, dryRun, confirmed, dshVersion, home: resolve(selected) }
}

function usage() {
  return `Usage: harman [--home PATH] [--json] <command>

Commands:
  state init                 initialize and validate Harman state
  state show                 show current state summary
  explain package ID         explain package origin and references
  explain resource ID        explain Resource origin, ownership, and bindings
  explain profile NAME       explain Profile composition and Runtime policy
  impact package ID          preview package removal impact
  impact profile NAME        preview Profile deletion impact
  repo add ID URL [PRIORITY] add a hash-verified repository
  repo list                  list configured repositories
  recipe build FILE          build a hash-pinned recipe in an isolated sandbox
  -Sy                        synchronize repository indexes
  -Ss QUERY                  search synchronized repositories
  -S PACKAGE...              solve, verify, and install packages
  -R PACKAGE...              remove packages (--yes required)
  -Syu                       synchronize and upgrade explicit packages
  -Qi PACKAGE                query an installed package
`
}

function summary(state, home) {
  return {
    home,
    schemaVersion: state.schemaVersion,
    revision: state.revision,
    packages: Object.keys(state.packages).length,
    resources: Object.keys(state.resources).length,
    profiles: Object.keys(state.profiles).length,
    repositories: Object.keys(state.repositories).length,
    runtimes: Object.keys(state.runtimes).length,
    auditEvents: state.audit.length,
  }
}

function render(value, json) {
  if (json) return JSON.stringify(value) + '\n'
  return Object.entries(value).map(([key, child]) => {
    const display = child !== null && typeof child === 'object' ? JSON.stringify(child) : String(child)
    return `${key}: ${display}`
  }).join('\n') + '\n'
}

async function execute(argv) {
  const parsed = parseGlobal(argv)
  const [command, ...operands] = parsed.args
  if (command === undefined || command === 'help' || command === '--help' || command === '-h') {
    return { stdout: usage(), code: 0 }
  }
  const store = new StateStore(parsed.home)
  const packages = new PackageManager(store)

  if (command === 'state' && operands[0] === 'init' && operands.length === 1) {
    const state = await store.initialize()
    return { stdout: render(summary(state, parsed.home), parsed.json), code: 0 }
  }
  if (command === 'state' && operands[0] === 'show' && operands.length === 1) {
    await store.initialize()
    return { stdout: render(summary(await store.read(), parsed.home), parsed.json), code: 0 }
  }
  if (command === 'state' && operands[0] === 'migrate' && operands.length === 1) {
    const state = await store.migrate()
    return { stdout: render(summary(state, parsed.home), parsed.json), code: 0 }
  }
  if (command === 'explain' && operands.length === 2) {
    const [subject, id] = operands
    await store.initialize()
    const state = await store.read()
    const value = subject === 'package' ? explainPackage(state, id)
      : subject === 'resource' ? explainResource(state, id)
        : subject === 'profile' ? explainProfile(state, id)
          : undefined
    if (value === undefined) throw new ValidationError(`unknown explain subject ${subject}`)
    return { stdout: render(value, parsed.json), code: 0 }
  }
  if (command === 'impact' && operands.length === 2) {
    const [subject, id] = operands
    await store.initialize()
    const state = await store.read()
    const value = subject === 'package' ? packageImpact(state, id)
      : subject === 'profile' ? profileImpact(state, id)
        : undefined
    if (value === undefined) throw new ValidationError(`unknown impact subject ${subject}`)
    return { stdout: render(value, parsed.json), code: 0 }
  }
  if (command === 'repo' && operands[0] === 'add' && (operands.length === 3 || operands.length === 4)) {
    const [, id, url, priorityText] = operands
    const priority = priorityText === undefined ? 0 : Number(priorityText)
    if (!Number.isInteger(priority)) throw new ValidationError('repository priority must be an integer')
    const result = await packages.addRepository({ id, url, priority, trustPolicy: 'hash-only' })
    return { stdout: render(result.result, parsed.json), code: 0 }
  }
  if (command === 'repo' && operands[0] === 'list' && operands.length === 1) {
    await store.initialize()
    return { stdout: render(Object.values((await store.read()).repositories), parsed.json), code: 0 }
  }
  if (command === 'recipe' && operands[0] === 'build' && operands.length === 2) {
    const recipe = JSON.parse(await readFile(resolve(operands[1]), 'utf8'))
    const result = await packages.buildRecipe(recipe, { preserveFailure: false })
    return { stdout: render(result, parsed.json), code: 0 }
  }
  if (command === '-Sy' && operands.length === 0) {
    return { stdout: render(await packages.sync(), parsed.json), code: 0 }
  }
  if (command === '-Ss' && operands.length === 1) {
    await store.initialize()
    return { stdout: render(await packages.search(operands[0]), parsed.json), code: 0 }
  }
  if (command === '-S' && operands.length > 0) {
    await store.initialize()
    const result = await packages.install(operands, { dryRun: parsed.dryRun, dshVersion: parsed.dshVersion, platform: process.platform, arch: process.arch })
    return { stdout: render(result, parsed.json), code: 0 }
  }
  if (command === '-R' && operands.length > 0) {
    await store.initialize()
    const result = await packages.remove(operands, { dryRun: parsed.dryRun, confirmed: parsed.confirmed })
    return { stdout: render(result, parsed.json), code: 0 }
  }
  if (command === '-Qi' && operands.length === 1) {
    await store.initialize()
    return { stdout: render(await packages.query(operands[0]), parsed.json), code: 0 }
  }
  if (command === '-Syu' && operands.length === 0) {
    await store.initialize()
    const sync = parsed.dryRun ? [] : await packages.sync()
    const upgrade = await packages.upgrade({ dryRun: parsed.dryRun, dshVersion: parsed.dshVersion, platform: process.platform, arch: process.arch })
    return { stdout: render({ sync, upgrade }, parsed.json), code: 0 }
  }
  throw new ValidationError(`invalid command: ${parsed.args.join(' ')}`, { usage: usage() })
}

try {
  const result = await execute(process.argv.slice(2))
  process.stdout.write(result.stdout)
  process.exitCode = result.code
} catch (error) {
  if (error instanceof HarmanError) {
    const payload = { error: { code: error.code, message: error.message, details: error.details } }
    const wantsJson = process.argv.includes('--json')
    process.stderr.write(wantsJson ? JSON.stringify(payload) + '\n' : `harman: ${error.code}: ${error.message}\n`)
    process.exitCode = EXIT[error.code] ?? 1
  } else {
    process.stderr.write(`harman: INTERNAL_ERROR: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
