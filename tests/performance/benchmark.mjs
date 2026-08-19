import { performance } from 'node:perf_hooks'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { searchRepositoryIndexes, solvePackages, StateStore } from '../../packages/core/src/index.js'

const measurements = {}
async function measure(name, budgetMs, operation) {
  const started = performance.now()
  const result = await operation()
  const durationMs = Number((performance.now() - started).toFixed(2))
  measurements[name] = { durationMs, budgetMs, ok: durationMs <= budgetMs, result }
}

const versions = Array.from({ length: 20_000 }, (_, index) => ({
  version: `1.${Math.floor(index / 100)}.${index % 100}`,
  description: index % 97 === 0 ? 'needle package' : 'ordinary package',
  dependencies: {}, artifact: { url: `./p-${index}.tgz`, sha256: 'a'.repeat(64) },
}))
const source = { repository: { id: 'large', priority: 10, enabled: true }, index: { packages: { large: versions } } }
await measure('repository-search-20k-versions', 1_500, () => searchRepositoryIndexes([source], 'needle'))

const chainPackages = {}
for (let index = 0; index < 1_000; index += 1) chainPackages[`p${index}`] = [{
  version: '1.0.0', dependencies: index === 999 ? {} : { [`p${index + 1}`]: '1.0.0' },
  artifact: { url: `./p${index}.tgz`, sha256: 'b'.repeat(64) },
}]
await measure('solver-1k-dependency-chain', 2_000, () => ({ packages: solvePackages([{ repository: source.repository, index: { packages: chainPackages } }], [{ name: 'p0', range: '*' }]).packages.length }))

const root = await mkdtemp(join(tmpdir(), 'harman-performance-'))
const state = new StateStore(join(root, 'home')); await state.initialize()
await measure('state-commit-500-packages-resources-profiles', 3_000, async () => {
  await state.transaction({ action: 'benchmark.populate' }, draft => {
  for (let index = 0; index < 500; index += 1) {
    const packageId = `pkg${index}@1.0.0`; const resourceId = `prompt/r${index}`; const profileName = `profile-${index}`
    draft.packages[packageId] = { id: packageId, name: `pkg${index}`, version: '1.0.0', contentHash: index.toString(16).padStart(64, '0'), source: 'benchmark', recipeRevision: null, reason: 'explicit', dependencies: [], providesResources: [] }
    draft.resources[resourceId] = { id: resourceId, type: 'prompt', displayName: resourceId, location: join(root, `r${index}.md`), ownership: 'external', scope: 'benchmark', source: 'benchmark', fingerprint: null, available: false, enabled: false, priority: 0, packageId: null, manifestOwner: null, boundProfiles: [profileName] }
    draft.profiles[profileName] = { name: profileName, dshHome: join(root, profileName), app: 'headless', packages: [packageId], resources: [resourceId], runtime: { channel: 'latest' }, lastResolvedRuntime: null, pluginConfig: {}, promptOrder: [], mcp: {}, models: {}, cordisPatch: [], active: false, running: false, runOwnerPid: null, runStartedAt: null }
    }
  })
  return { packages: 500, resources: 500, profiles: 500 }
})
await measure('state-read-500-packages-resources-profiles', 1_000, async () => {
  const value = await state.read()
  return { packages: Object.keys(value.packages).length, resources: Object.keys(value.resources).length, profiles: Object.keys(value.profiles).length }
})

const failed = Object.entries(measurements).filter(([, value]) => !value.ok)
process.stdout.write(`${JSON.stringify({ schemaVersion: 1, measurements, ok: failed.length === 0 }, null, 2)}\n`)
if (failed.length > 0) process.exitCode = 1
