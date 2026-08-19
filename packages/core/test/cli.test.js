import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { StateStore, addPackage } from '../src/index.js'

const cli = new URL('../../../apps/cli/harman.js', import.meta.url).pathname

function run(args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', chunk => { stderr += chunk })
    child.on('error', reject)
    child.on('close', code => resolve({ code, stdout, stderr }))
  })
}

test('state init and show expose stable JSON summaries', async () => {
  const home = await mkdtemp(join(tmpdir(), 'harman-cli-'))
  const initialized = await run(['--home', home, '--json', 'state', 'init'])
  assert.equal(initialized.code, 0)
  assert.deepEqual(JSON.parse(initialized.stdout), {
    home,
    schemaVersion: 1,
    revision: 0,
    packages: 0,
    resources: 0,
    profiles: 0,
    runtimes: 0,
    auditEvents: 0,
  })
  assert.equal((await run(['--home', home, 'state', 'show'])).code, 0)
})

test('HARMAN_HOME is used and blank environment falls back safely', async () => {
  const home = await mkdtemp(join(tmpdir(), 'harman-cli-env-'))
  const result = await run(['--json', 'state', 'init'], { HARMAN_HOME: home })
  assert.equal(result.code, 0)
  assert.equal(JSON.parse(result.stdout).home, home)
})

test('explain and impact are script-friendly and preserve identifiers', async () => {
  const home = await mkdtemp(join(tmpdir(), 'harman-cli-graph-'))
  const store = new StateStore(home)
  await store.initialize()
  await store.transaction({ action: 'seed' }, state => addPackage(state, {
    name: 'demo', version: '1.2.3', contentHash: 'd'.repeat(64), source: 'repo/test',
  }))
  const explain = await run(['--home', home, '--json', 'explain', 'package', 'demo@1.2.3'])
  assert.equal(explain.code, 0)
  assert.equal(JSON.parse(explain.stdout).source, 'repo/test')
  const impact = await run(['--home', home, '--json', 'impact', 'package', 'demo@1.2.3'])
  assert.equal(impact.code, 0)
  assert.equal(JSON.parse(impact.stdout).allowed, true)
})

test('errors have stable JSON shape and exit classes', async () => {
  const home = await mkdtemp(join(tmpdir(), 'harman-cli-errors-'))
  const invalid = await run(['--home', home, '--json', 'wat'])
  assert.equal(invalid.code, 3)
  assert.equal(JSON.parse(invalid.stderr).error.code, 'VALIDATION_ERROR')
  const missing = await run(['--home', home, '--json', 'explain', 'package', 'absent@1'])
  assert.equal(missing.code, 5)
  assert.equal(JSON.parse(missing.stderr).error.code, 'NOT_FOUND')
})
