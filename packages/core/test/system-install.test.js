import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { access, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

const installer = new URL('../../../scripts/install.mjs', import.meta.url).pathname
function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [installer, ...args], { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''; let stderr = ''
    child.stdout.on('data', chunk => { stdout += chunk }); child.stderr.on('data', chunk => { stderr += chunk })
    child.on('error', reject); child.on('close', code => resolve({ code, stdout, stderr }))
  })
}

test('user-prefix install, atomic upgrade, and uninstall preserve Harman state', async () => {
  const root = await mkdtemp(join(tmpdir(), 'harman-install-')); const prefix = join(root, 'prefix'); const state = join(root, 'state')
  await mkdir(state); await writeFile(join(state, 'keep'), 'state survives\n')
  await mkdir(join(prefix, 'share', 'non-harman'), { recursive: true })
  await writeFile(join(prefix, 'share', 'non-harman', 'keep.txt'), 'unrelated prefix state\n')
  const first = await run(['--prefix', prefix]); assert.equal(first.code, 0, first.stderr)
  const init = await new Promise((resolve, reject) => {
    const child = spawn(join(prefix, 'bin', 'harman'), ['--home', state, '--json', 'state', 'init'], { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''; child.stdout.on('data', chunk => { stdout += chunk }); child.on('error', reject); child.on('close', code => resolve({ code, stdout }))
  })
  assert.equal(init.code, 0)
  const upgraded = await run(['--prefix', prefix]); assert.equal(upgraded.code, 0, upgraded.stderr)
  assert.equal(JSON.parse(await readFile(join(prefix, 'lib', 'harman', 'install-manifest.json'))).product, 'harman')
  const removed = await run(['--prefix', prefix, '--uninstall']); assert.equal(removed.code, 0, removed.stderr)
  await assert.rejects(access(join(prefix, 'bin', 'harman')))
  assert.equal(await readFile(join(state, 'keep'), 'utf8'), 'state survives\n')
  assert.equal(await readFile(join(prefix, 'share', 'non-harman', 'keep.txt'), 'utf8'), 'unrelated prefix state\n')
})
