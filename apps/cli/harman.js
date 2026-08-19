#!/usr/bin/env node

import { homedir } from 'node:os'
import { resolve } from 'node:path'
import {
  HarmanError, StateStore, ValidationError,
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
  for (let index = 0; index < args.length;) {
    if (args[index] === '--json') {
      json = true
      args.splice(index, 1)
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
  return { args, json, home: resolve(selected) }
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
  const [command, subject, id, ...rest] = parsed.args
  if (command === undefined || command === 'help' || command === '--help' || command === '-h') {
    return { stdout: usage(), code: 0 }
  }
  if (rest.length > 0) throw new ValidationError(`unexpected arguments: ${rest.join(' ')}`)
  const store = new StateStore(parsed.home)

  if (command === 'state' && subject === 'init' && id === undefined) {
    const state = await store.initialize()
    return { stdout: render(summary(state, parsed.home), parsed.json), code: 0 }
  }
  if (command === 'state' && subject === 'show' && id === undefined) {
    await store.initialize()
    return { stdout: render(summary(await store.read(), parsed.home), parsed.json), code: 0 }
  }
  if (command === 'explain' && id !== undefined) {
    await store.initialize()
    const state = await store.read()
    const value = subject === 'package' ? explainPackage(state, id)
      : subject === 'resource' ? explainResource(state, id)
        : subject === 'profile' ? explainProfile(state, id)
          : undefined
    if (value === undefined) throw new ValidationError(`unknown explain subject ${subject}`)
    return { stdout: render(value, parsed.json), code: 0 }
  }
  if (command === 'impact' && id !== undefined) {
    await store.initialize()
    const state = await store.read()
    const value = subject === 'package' ? packageImpact(state, id)
      : subject === 'profile' ? profileImpact(state, id)
        : undefined
    if (value === undefined) throw new ValidationError(`unknown impact subject ${subject}`)
    return { stdout: render(value, parsed.json), code: 0 }
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
