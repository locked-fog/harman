#!/usr/bin/env node

import { homedir } from 'node:os'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  HarmanError, PackageManager, ProfileManager, ResourceManager, RuntimeManager, StateStore, ValidationError,
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
  resource scan [PROJECT]    discover external Skills, AGENTS.md, Prompts, and MCP
  resource list              list registered Resources
  resource show ID           show Resource identity and ownership
  resource register TYPE PATH [--id ID] [--scope SCOPE]
  resource adopt ID          copy an external Resource into managed storage (--yes)
  resource enable ID [--profile NAME]
  resource disable ID [--profile NAME]
  resource bind ID --profile NAME
  resource detach ID --profile NAME
  runtime register VERSION EXECUTABLE SHA256 SOURCE [--official]
  runtime latest ID         select a compatible official Runtime as latest
  runtime list              list registered DSH Runtimes
  profile create NAME [--config FILE] [--runtime VERSION]
  profile list|show NAME    list Profiles or show one Profile
  profile clone OLD NEW     clone declarations into an isolated DSH_HOME
  profile rename OLD NEW    rename an inactive Profile
  profile delete NAME       delete Harman-owned Profile state (--yes required)
  profile diff LEFT RIGHT   compare Profile declarations
  profile materialize NAME  rebuild the stock DSH Profile view
  profile activate|deactivate NAME
  profile run NAME [ARGS...] launch stock DSH in a read-only-root sandbox
  profile doctor NAME       validate Runtime, lock, manifest, and Store links
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
  const resources = new ResourceManager(store)
  const runtimes = new RuntimeManager(store)
  const profiles = new ProfileManager(store, { runtimes })

  function option(name) {
    const index = operands.indexOf(name)
    if (index === -1) return undefined
    const value = operands[index + 1]
    if (value === undefined || value.startsWith('--')) throw new ValidationError(`${name} requires a value`)
    operands.splice(index, 2)
    return value
  }

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
  if (command === 'resource') {
    const action = operands.shift()
    const profile = option('--profile')
    const idOption = option('--id')
    const scope = option('--scope')
    if (action === 'scan' && operands.length <= 1 && profile === undefined && idOption === undefined && scope === undefined) {
      const result = await resources.scan({ userHome: homedir(), projectRoot: resolve(operands[0] ?? process.cwd()) })
      return { stdout: render(result, parsed.json), code: 0 }
    }
    if (action === 'list' && operands.length === 0) {
      await store.initialize()
      return { stdout: render(await resources.list(), parsed.json), code: 0 }
    }
    if (action === 'show' && operands.length === 1) {
      await store.initialize()
      return { stdout: render(await resources.show(operands[0]), parsed.json), code: 0 }
    }
    if (action === 'register' && operands.length === 2) {
      await store.initialize()
      return { stdout: render(await resources.register(operands[0], operands[1], { id: idOption, scope }), parsed.json), code: 0 }
    }
    if (action === 'adopt' && operands.length === 1) {
      await store.initialize()
      return { stdout: render(await resources.adopt(operands[0], { dryRun: parsed.dryRun, confirmed: parsed.confirmed }), parsed.json), code: 0 }
    }
    if ((action === 'enable' || action === 'disable') && operands.length === 1) {
      await store.initialize()
      return { stdout: render(await resources.setEnabled(operands[0], action === 'enable', profile), parsed.json), code: 0 }
    }
    if ((action === 'bind' || action === 'detach') && operands.length === 1 && profile !== undefined) {
      await store.initialize()
      const result = action === 'bind' ? await resources.bind(operands[0], profile) : await resources.detach(operands[0], profile)
      return { stdout: render(result, parsed.json), code: 0 }
    }
  }
  if (command === 'runtime') {
    const action = operands.shift()
    const officialIndex = operands.indexOf('--official')
    const official = officialIndex !== -1
    if (official) operands.splice(officialIndex, 1)
    if (action === 'register' && operands.length === 4) {
      await store.initialize()
      return { stdout: render(await runtimes.register({ version: operands[0], executable: operands[1], contentHash: operands[2], source: operands[3], compatibility: 'compatible', official }), parsed.json), code: 0 }
    }
    if (action === 'latest' && operands.length === 1) {
      await store.initialize()
      return { stdout: render(await runtimes.setLatest(operands[0]), parsed.json), code: 0 }
    }
    if (action === 'list' && operands.length === 0) {
      await store.initialize()
      return { stdout: render(await runtimes.list(), parsed.json), code: 0 }
    }
  }
  if (command === 'profile') {
    const action = operands.shift()
    const configPath = option('--config')
    const runtimeVersion = option('--runtime')
    if (action === 'create' && operands.length === 1) {
      const config = configPath === undefined ? {} : JSON.parse(await readFile(resolve(configPath), 'utf8'))
      const runtime = runtimeVersion === undefined ? (config.runtime ?? { channel: 'latest' }) : { version: runtimeVersion }
      return { stdout: render(await profiles.create({ ...config, name: operands[0], runtime }), parsed.json), code: 0 }
    }
    if (action === 'list' && operands.length === 0) {
      await store.initialize()
      return { stdout: render(await profiles.list(), parsed.json), code: 0 }
    }
    if (action === 'show' && operands.length === 1) {
      await store.initialize()
      return { stdout: render(await profiles.show(operands[0]), parsed.json), code: 0 }
    }
    if (action === 'clone' && operands.length === 2) return { stdout: render(await profiles.clone(operands[0], operands[1]), parsed.json), code: 0 }
    if (action === 'rename' && operands.length === 2) return { stdout: render(await profiles.rename(operands[0], operands[1]), parsed.json), code: 0 }
    if (action === 'delete' && operands.length === 1) return { stdout: render(await profiles.remove(operands[0], { dryRun: parsed.dryRun, confirmed: parsed.confirmed }), parsed.json), code: 0 }
    if (action === 'diff' && operands.length === 2) return { stdout: render(await profiles.diff(operands[0], operands[1]), parsed.json), code: 0 }
    if (action === 'materialize' && operands.length === 1) return { stdout: render(await profiles.materialize(operands[0]), parsed.json), code: 0 }
    if ((action === 'activate' || action === 'deactivate') && operands.length === 1) return { stdout: render(await profiles.setActive(operands[0], action === 'activate'), parsed.json), code: 0 }
    if (action === 'run' && operands.length >= 1) return { stdout: render(await profiles.run(operands[0], operands.slice(1)), parsed.json), code: 0 }
    if (action === 'doctor' && operands.length === 1) return { stdout: render(await profiles.doctor(operands[0]), parsed.json), code: 0 }
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
