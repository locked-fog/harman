import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { StateStore, createProfile } from '../src/index.js'

const cli = new URL('../../../apps/cli/harman.js', import.meta.url).pathname

function run(home, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, '--home', home, '--json', ...args], { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', chunk => { stderr += chunk })
    child.on('error', reject)
    child.on('close', code => resolve({ code, stdout, stderr }))
  })
}

test('Resource CLI register/list/show/adopt/enable/disable/bind/detach is transaction-backed', async () => {
  const root = await mkdtemp(join(tmpdir(), 'harman-resource-cli-'))
  const home = join(root, 'home')
  const source = join(root, 'prompt.md')
  await writeFile(source, 'user owned\n')
  assert.equal((await run(home, ['state', 'init'])).code, 0)
  let result = await run(home, ['resource', 'register', 'prompt', source, '--id', 'prompt/custom', '--scope', 'project'])
  assert.equal(result.code, 0, result.stderr)
  assert.equal(JSON.parse(result.stdout).ownership, 'external')
  result = await run(home, ['resource', 'list'])
  assert.equal(JSON.parse(result.stdout)[0].id, 'prompt/custom')
  result = await run(home, ['resource', 'show', 'prompt/custom'])
  assert.equal(JSON.parse(result.stdout).location, source)
  assert.equal((await run(home, ['resource', 'disable', 'prompt/custom'])).code, 0)
  assert.equal(JSON.parse((await run(home, ['resource', 'show', 'prompt/custom'])).stdout).enabled, false)
  assert.equal((await run(home, ['resource', 'enable', 'prompt/custom'])).code, 0)

  const store = new StateStore(home)
  await store.transaction({ action: 'test.profile' }, state => createProfile(state, { name: 'work', dshHome: join(home, 'profiles', 'work', 'dsh-home') }))
  assert.equal((await run(home, ['resource', 'bind', 'prompt/custom', '--profile', 'work'])).code, 0)
  assert.deepEqual(JSON.parse((await run(home, ['resource', 'show', 'prompt/custom'])).stdout).boundProfiles, ['work'])
  assert.equal((await run(home, ['resource', 'detach', 'prompt/custom', '--profile', 'work'])).code, 0)

  result = await run(home, ['--dry-run', 'resource', 'adopt', 'prompt/custom'])
  assert.equal(result.code, 0)
  assert.equal(JSON.parse(result.stdout).plan.sourcePreserved, true)
  assert.equal((await run(home, ['resource', 'adopt', 'prompt/custom'])).code, 4)
  result = await run(home, ['--yes', 'resource', 'adopt', 'prompt/custom'])
  assert.equal(result.code, 0, result.stderr)
  assert.equal(JSON.parse(result.stdout).resource.ownership, 'managed')
  assert.equal(await readFile(source, 'utf8'), 'user owned\n')
})
