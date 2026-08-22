#!/usr/bin/env node

import { homedir } from 'node:os'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  HarmanError, PackageManager, ProfileBundleManager, ProfileManager, ResourceManager, RuntimeManager, StateStore, ValidationError,
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
  let recipePath
  let timeoutMs
  let profileName
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
    } else if (args[index] === '--recipe') {
      const value = args[index + 1]
      if (value === undefined || value.trim() === '') throw new ValidationError('--recipe requires a path')
      recipePath = value
      args.splice(index, 2)
    } else if (args[index] === '--timeout-ms') {
      const value = Number(args[index + 1])
      if (!Number.isSafeInteger(value) || value <= 0) throw new ValidationError('--timeout-ms requires a positive integer')
      timeoutMs = value
      args.splice(index, 2)
    } else if (args[index] === '--profile') {
      const value = args[index + 1]
      if (value === undefined || value.trim() === '') throw new ValidationError('--profile requires a name')
      profileName = value
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
  return { args, json, dryRun, confirmed, dshVersion, recipePath, timeoutMs, profileName, home: resolve(selected) }
}

function usage() {
  return `Usage: harman [--home PATH] [--profile NAME] [--json] [--timeout-ms NUMBER] <command>

Commands:
  init                       initialize state, detect DSH, and create default Profile
  state init                 initialize and validate Harman state
  state show                 show current state summary
  explain package ID         explain package origin and references
  explain resource ID        explain Resource origin, ownership, and bindings
  explain profile NAME       explain Profile composition and Runtime policy
  impact package ID          preview package removal impact
  impact profile NAME        preview Profile deletion impact
  repo add ID URL [PRIORITY] add a hash-verified repository
  repo list                  list configured repositories
  repo remove ID             remove repository configuration
  repo priority ID NUMBER    set deterministic source priority
  repo enable|disable ID     explicitly trust or distrust source availability
  repo policy ID POLICY      set trusted-local, hash-only, or signed
  repo key-add ID FILE       add an Ed25519 public trust key
  repo key-revoke ID KEY_ID  revoke a repository signing key
  repo threshold ID NUMBER   require N distinct valid index/artifact signatures
  recipe build FILE          build a hash-pinned recipe in an isolated sandbox
  package orphans            list unreferenced dependency packages
  store gc                   remove unreferenced immutable objects (--yes)
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
  runtime detect             find and register the global @deepseek-ai/dsh
  runtime latest ID         select a Runtime as latest
 runtime list              list registered DSH Runtimes
  runtime sync              import and adopt the newest repository DSH Runtime
  profile create NAME [--config FILE] [--runtime VERSION] [--app headless|web]
  profile list|show NAME    list Profiles or show one Profile
  profile clone OLD NEW     clone declarations into an isolated DSH_HOME
  profile rename OLD NEW    rename an inactive Profile
  profile delete NAME       delete Harman-owned Profile state (--yes required)
  profile diff LEFT RIGHT   compare Profile declarations
  profile materialize NAME  rebuild the stock DSH Profile view
  profile activate|deactivate NAME
  profile use NAME           make one Profile the default command target
  profile runtime NAME latest|VERSION
  profile run NAME [ARGS...] launch stock DSH in a read-only-root sandbox
  profile doctor NAME       validate Runtime, lock, manifest, and Store links
  profile export NAME DIR   create a portable secret-free Profile bundle
  profile restore DIR [NAME] [--mode strict|follow-latest]
  profile import DIR [NAME] alias for restore
  -Sy                        synchronize repository indexes
  -Ss QUERY                  search synchronized repositories
  -S PACKAGE...              solve, verify, and install packages [--recipe FILE]
  -R PACKAGE...              remove packages (--yes required)
  -Syu                       synchronize and upgrade explicit packages
  -Qi PACKAGE                query an installed package
  run [ARGS...]              run the selected or default Profile
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
  const resources = new ResourceManager(store)
  const runtimes = new RuntimeManager(store)
  const profiles = new ProfileManager(store, { runtimes })
  const packages = new PackageManager(store, { profiles })
  const bundles = new ProfileBundleManager(store, { profiles })

  function option(name) {
    const index = operands.indexOf(name)
    if (index === -1) return undefined
    const value = operands[index + 1]
    if (value === undefined || value.startsWith('--')) throw new ValidationError(`${name} requires a value`)
    operands.splice(index, 2)
    return value
  }

  async function targetProfile({ create = false } = {}) {
    await store.initialize()
    if (parsed.profileName !== undefined) {
      const profile = await profiles.show(parsed.profileName)
      return profile.name
    }
    const current = await profiles.current()
    if (current !== null) return current.name
    if (!create) return undefined
    return (await profiles.ensureDefault()).name
  }

  async function detectRuntimeIfMissing() {
    const state = await store.read()
    if (Object.values(state.runtimes).some(runtime => runtime.latest === true)) return null
    return runtimes.detect()
  }

  async function installedPackageIds(specs) {
    const ids = []
    for (const spec of specs) ids.push((await packages.query(spec)).id)
    return ids
  }

  function explicitPackageIds(result) {
    const fromPlan = result.plan?.packages?.filter(pkg => pkg.reason === 'explicit').map(pkg => `${pkg.name}@${pkg.version}`) ?? []
    const fromRecipe = result.package?.id === undefined ? [] : [result.package.id]
    return [...new Set([...fromPlan, ...fromRecipe])]
  }

  if (command === 'init' && operands.length === 0) {
    await store.initialize()
    const runtime = await runtimes.detect()
    const profile = await profiles.ensureDefault()
    return { stdout: render({ ...summary(await store.read(), parsed.home), defaultProfile: profile.name, runtimeDetected: runtime.detected?.id ?? null }, parsed.json), code: 0 }
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
  if (command === 'repo' && operands[0] === 'remove' && operands.length === 2) return { stdout: render(await packages.removeRepository(operands[1]), parsed.json), code: 0 }
  if (command === 'repo' && operands[0] === 'priority' && operands.length === 3) {
    const priority = Number(operands[2]); if (!Number.isInteger(priority)) throw new ValidationError('repository priority must be an integer')
    return { stdout: render(await packages.configureRepository(operands[1], { priority }), parsed.json), code: 0 }
  }
  if (command === 'repo' && ['enable', 'disable'].includes(operands[0]) && operands.length === 2) return { stdout: render(await packages.configureRepository(operands[1], { enabled: operands[0] === 'enable' }), parsed.json), code: 0 }
  if (command === 'repo' && operands[0] === 'policy' && operands.length === 3) return { stdout: render(await packages.configureRepository(operands[1], { trustPolicy: operands[2] }), parsed.json), code: 0 }
  if (command === 'repo' && operands[0] === 'key-add' && operands.length === 3) return { stdout: render(await packages.addRepositoryKey(operands[1], await readFile(resolve(operands[2]), 'utf8')), parsed.json), code: 0 }
  if (command === 'repo' && operands[0] === 'key-revoke' && operands.length === 3) return { stdout: render(await packages.revokeRepositoryKey(operands[1], operands[2]), parsed.json), code: 0 }
  if (command === 'repo' && operands[0] === 'threshold' && operands.length === 3) {
    const threshold = Number(operands[2]); if (!Number.isInteger(threshold)) throw new ValidationError('signature threshold must be an integer')
    return { stdout: render(await packages.configureRepository(operands[1], { signatureThreshold: threshold }), parsed.json), code: 0 }
  }
  if (command === 'recipe' && operands[0] === 'build' && operands.length === 2) {
    const recipe = JSON.parse(await readFile(resolve(operands[1]), 'utf8'))
    const result = await packages.buildRecipe(recipe, { preserveFailure: false })
    return { stdout: render(result, parsed.json), code: 0 }
  }
  if (command === 'package' && operands[0] === 'orphans' && operands.length === 1) {
    await store.initialize()
    return { stdout: render(await packages.orphans(), parsed.json), code: 0 }
  }
  if (command === 'store' && operands[0] === 'gc' && operands.length === 1) {
    await store.initialize()
    return { stdout: render(await packages.collectStore({ dryRun: parsed.dryRun, confirmed: parsed.confirmed }), parsed.json), code: 0 }
  }
  if (command === 'resource') {
    const action = operands.shift()
    const profile = parsed.profileName ?? option('--profile')
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
    if (action === 'sync' && operands.length === 0) {
      await store.initialize()
      return { stdout: render(await runtimes.syncLatest(await packages.sources(), { dryRun: parsed.dryRun }), parsed.json), code: 0 }
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
      return { stdout: render(await runtimes.register({ version: operands[0], executable: operands[1], contentHash: operands[2], source: operands[3], compatibility: 'unvalidated', official }), parsed.json), code: 0 }
    }
    if (action === 'detect' && operands.length === 0) {
      await store.initialize()
      return { stdout: render(await runtimes.detect(), parsed.json), code: 0 }
    }
    if (action === 'sync' && operands.length === 0) {
      await store.initialize()
      return { stdout: render(await runtimes.syncLatest(await packages.sources(), { dryRun: parsed.dryRun }), parsed.json), code: 0 }
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
    const app = option('--app')
    const restoreMode = option('--mode')
    if (action === 'create' && operands.length === 1) {
      const config = configPath === undefined ? {} : JSON.parse(await readFile(resolve(configPath), 'utf8'))
      const runtime = runtimeVersion === undefined ? (config.runtime ?? { channel: 'latest' }) : { version: runtimeVersion }
      const selectedApp = app ?? config.app ?? 'headless'
      if (!['headless', 'web'].includes(selectedApp)) throw new ValidationError('--app must be headless or web')
      return { stdout: render(await profiles.create({ ...config, name: operands[0], runtime, app: selectedApp }), parsed.json), code: 0 }
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
    if (action === 'use' && operands.length === 1) return { stdout: render(await profiles.use(operands[0]), parsed.json), code: 0 }
    if (action === 'runtime' && operands.length === 2) return { stdout: render(await profiles.setRuntime(operands[0], operands[1] === 'latest' ? { channel: 'latest' } : { version: operands[1] }), parsed.json), code: 0 }
    if (action === 'run' && operands.length >= 1) {
      await detectRuntimeIfMissing()
      return { stdout: render(await profiles.run(operands[0], operands.slice(1), { timeoutMs: parsed.timeoutMs }), parsed.json), code: 0 }
    }
    if (action === 'doctor' && operands.length === 1) return { stdout: render(await profiles.doctor(operands[0]), parsed.json), code: 0 }
    if (action === 'export' && operands.length === 2) return { stdout: render(await bundles.export(operands[0], operands[1]), parsed.json), code: 0 }
    if ((action === 'restore' || action === 'import') && (operands.length === 1 || operands.length === 2)) return { stdout: render(await bundles.restore(operands[0], { name: operands[1], mode: restoreMode }), parsed.json), code: 0 }
  }
  if (command === 'run') {
    const name = await targetProfile({ create: true })
    await detectRuntimeIfMissing()
    return { stdout: render(await profiles.run(name, operands, { timeoutMs: parsed.timeoutMs }), parsed.json), code: 0 }
  }
  if (command === '-Sy' && operands.length === 0) {
    const repositories = await packages.sync()
    const runtime = runtimes.availableFromSources(await packages.sources())[0]
    return { stdout: render({ repositories, runtimeAvailable: runtime === undefined ? null : { repository: runtime.repository.id, version: runtime.entry.version, sha256: runtime.entry.artifact.sha256 } }, parsed.json), code: 0 }
  }
  if (command === '-Ss' && operands.length === 1) {
    await store.initialize()
    return { stdout: render(await packages.search(operands[0]), parsed.json), code: 0 }
  }
  if (command === '-S' && operands.length > 0) {
    await store.initialize()
    let result
    if (parsed.recipePath === undefined) {
      result = await packages.install(operands, { dryRun: parsed.dryRun, dshVersion: parsed.dshVersion, platform: process.platform, arch: process.arch })
    } else {
      if (operands.length !== 1) throw new ValidationError('--recipe installs exactly one requested package')
      const recipe = JSON.parse(await readFile(resolve(parsed.recipePath), 'utf8'))
      if (operands[0] !== recipe.name && operands[0] !== `${recipe.name}@${recipe.version}`) throw new ValidationError('recipe identity does not match requested package')
      result = await packages.installRecipe(recipe, { dryRun: parsed.dryRun })
    }
    if (!parsed.dryRun) {
      const name = await targetProfile()
      const ids = explicitPackageIds(result)
      if (name !== undefined && ids.length > 0) {
        const attached = await profiles.addPackages(name, ids)
        result = { ...result, profile: name, profilePackages: attached.packages }
      }
    }
    return { stdout: render(result, parsed.json), code: 0 }
  }
  if (command === '-R' && operands.length > 0) {
    await store.initialize()
    const name = await targetProfile()
    const ids = name === undefined ? [] : await installedPackageIds(operands)
    const selected = name === undefined ? null : await profiles.show(name)
    const attached = parsed.dryRun || !parsed.confirmed || selected === null ? [] : ids.filter(id => selected.packages.includes(id))
    if (attached.length > 0) await profiles.removePackages(name, attached)
    let result
    try {
      result = await packages.remove(operands, { dryRun: parsed.dryRun, confirmed: parsed.confirmed })
    } catch (error) {
      if (attached.length > 0) await profiles.addPackages(name, attached)
      throw error
    }
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
    const runtime = await runtimes.syncLatest(await packages.sources(), { dryRun: parsed.dryRun })
    return { stdout: render({ sync, upgrade, runtime }, parsed.json), code: 0 }
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
