import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { spawn } from 'node:child_process'
import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'

const cli = new URL('../../../apps/cli/harman.js', import.meta.url).pathname

function octal(value, length) {
  return value.toString(8).padStart(length - 1, '0') + '\0'
}

function packageTar(name, version) {
  const files = [
    ['package/package.json', JSON.stringify({ name, version, type: 'module', dsh: { bundle: { patch: './cordis.patch.yml' } } })],
    ['package/cordis.patch.yml', '[]\n'],
    ['package/lib/index.js', `export const version = ${JSON.stringify(version)}\n`],
    ['package/skills/demo/SKILL.md', `# demo ${version}\n`],
  ]
  const chunks = []
  for (const [path, text] of files) {
    const body = Buffer.from(text)
    const header = Buffer.alloc(512)
    header.write(path)
    header.write(octal(0o644, 8), 100, 8, 'ascii')
    header.write(octal(0, 8), 108, 8, 'ascii')
    header.write(octal(0, 8), 116, 8, 'ascii')
    header.write(octal(body.length, 12), 124, 12, 'ascii')
    header.write(octal(0, 12), 136, 12, 'ascii')
    header.fill(32, 148, 156)
    header[156] = 48
    header.write('ustar\0', 257, 6, 'ascii')
    header.write('00', 263, 2, 'ascii')
    header.write(octal(header.reduce((sum, byte) => sum + byte, 0), 8), 148, 8, 'ascii')
    chunks.push(header, body, Buffer.alloc((512 - body.length % 512) % 512))
  }
  return gzipSync(Buffer.concat([...chunks, Buffer.alloc(1024)]))
}

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

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'harman-package-cli-'))
  const home = join(root, 'home')
  const repositoryRoot = join(root, 'repository')
  await import('node:fs/promises').then(fs => fs.mkdir(repositoryRoot, { recursive: true }))
  async function publish(sequence, versions) {
    const entries = []
    for (const version of versions) {
      const bytes = packageTar('demo', version)
      const filename = `demo-${version}.tgz`
      await writeFile(join(repositoryRoot, filename), bytes)
      entries.push({
        version,
        description: `demo ${version}`,
        dependencies: {},
        resources: [{ id: 'skill/demo', type: 'skill', path: 'skills/demo', displayName: 'Demo skill' }],
        artifact: { url: `./${filename}`, sha256: createHash('sha256').update(bytes).digest('hex') },
      })
    }
    await writeFile(join(repositoryRoot, 'index.json'), JSON.stringify({
      schemaVersion: 1, sequence, generatedAt: `2026-08-19T00:00:0${sequence}Z`, packages: { demo: entries },
    }))
  }
  await publish(1, ['1.0.0'])
  return { root, home, repositoryRoot, publish }
}

async function allNames(root) {
  const names = []
  async function walk(path) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      names.push(entry.name)
      if (entry.isDirectory()) await walk(join(path, entry.name))
    }
  }
  await walk(root)
  return names
}

test('pacman-style sync/search/dry-run/install/query/remove uses verified Store without pnpm state', async () => {
  const { home, repositoryRoot } = await fixture()
  const added = await run(home, ['repo', 'add', 'main', pathToFileURL(join(repositoryRoot, 'index.json')).href, '10'])
  assert.equal(added.code, 0, added.stderr)
  assert.equal((await run(home, ['-Sy'])).code, 0)
  const search = await run(home, ['-Ss', 'demo'])
  assert.equal(search.code, 0)
  assert.equal(JSON.parse(search.stdout)[0].version, '1.0.0')

  const dry = await run(home, ['--dry-run', '-S', 'demo'])
  assert.equal(dry.code, 0)
  assert.equal(JSON.parse(dry.stdout).dryRun, true)
  let query = await run(home, ['-Qi', 'demo'])
  assert.equal(query.code, 5)

  const installed = await run(home, ['-S', 'demo'])
  assert.equal(installed.code, 0, installed.stderr)
  assert.deepEqual(JSON.parse(installed.stdout).installed, ['demo@1.0.0'])
  query = await run(home, ['-Qi', 'demo'])
  assert.equal(query.code, 0)
  assert.equal(JSON.parse(query.stdout).contentHash.length, 64)
  assert.ok(!(await allNames(home)).includes('pnpm-lock.yaml'))
  const resources = await run(home, ['resource', 'show', 'skill/demo'])
  assert.equal(resources.code, 0, resources.stderr)
  assert.equal(JSON.parse(resources.stdout).ownership, 'package')

  const refused = await run(home, ['-R', 'demo'])
  assert.equal(refused.code, 4)
  const preview = await run(home, ['--dry-run', '-R', 'demo'])
  assert.equal(preview.code, 0)
  assert.equal(JSON.parse(preview.stdout).impacts[0].allowed, true)
  const removed = await run(home, ['--yes', '-R', 'demo'])
  assert.equal(removed.code, 0, removed.stderr)
  assert.deepEqual(JSON.parse(removed.stdout).removed, ['demo@1.0.0'])
  assert.equal((await run(home, ['resource', 'show', 'skill/demo'])).code, 5)
})

test('-Syu previews without mutation and upgrades explicit package after sync', async () => {
  const { home, repositoryRoot, publish } = await fixture()
  assert.equal((await run(home, ['repo', 'add', 'main', pathToFileURL(join(repositoryRoot, 'index.json')).href])).code, 0)
  assert.equal((await run(home, ['-Sy'])).code, 0)
  assert.equal((await run(home, ['-S', 'demo'])).code, 0)
  assert.equal((await run(home, ['profile', 'create', 'upgrade-target', '--config', new URL('../../../tests/fixtures/profile-demo.json', import.meta.url).pathname])).code, 0)
  await publish(2, ['1.0.0', '1.1.0'])

  const beforeSyncPreview = await run(home, ['--dry-run', '-Syu'])
  assert.equal(beforeSyncPreview.code, 0)
  assert.deepEqual(JSON.parse(beforeSyncPreview.stdout).upgrade.changes, [])

  const upgraded = await run(home, ['-Syu'])
  assert.equal(upgraded.code, 0, upgraded.stderr)
  assert.deepEqual(JSON.parse(upgraded.stdout).upgrade.changes, [{ from: 'demo@1.0.0', to: 'demo@1.1.0' }])
  const query = await run(home, ['-Qi', 'demo'])
  assert.equal(JSON.parse(query.stdout).version, '1.1.0')
  const profile = await run(home, ['profile', 'show', 'upgrade-target'])
  assert.deepEqual(JSON.parse(profile.stdout).packages, ['demo@1.1.0'])
  const profileHome = JSON.parse(profile.stdout).dshHome
  assert.match(await readFile(join(profileHome, 'profiles', 'harman', 'node_modules', 'demo', 'lib', 'index.js'), 'utf8'), /1\.1\.0/)
  assert.match(await readFile(join(profileHome, 'profiles', 'harman', 'package.json'), 'utf8'), /"demo": "1\.1\.0"/)
  assert.equal((await run(home, ['-Qi', 'demo@1.0.0'])).code, 5)
})

test('-Syu artifact verification failure preserves the installed package', async () => {
  const { home, repositoryRoot } = await fixture()
  assert.equal((await run(home, ['repo', 'add', 'main', pathToFileURL(join(repositoryRoot, 'index.json')).href])).code, 0)
  assert.equal((await run(home, ['-Sy'])).code, 0)
  assert.equal((await run(home, ['-S', 'demo'])).code, 0)
  const bytes = packageTar('demo', '1.1.0')
  await writeFile(join(repositoryRoot, 'demo-1.1.0.tgz'), bytes)
  await writeFile(join(repositoryRoot, 'index.json'), JSON.stringify({
    schemaVersion: 1, sequence: 2, generatedAt: '2026-08-19T00:00:02Z', packages: { demo: [{
      version: '1.1.0', dependencies: {},
      artifact: { url: './demo-1.1.0.tgz', sha256: '0'.repeat(64) },
    }] },
  }))
  const failed = await run(home, ['-Syu'])
  assert.equal(failed.code, 4)
  assert.match(failed.stderr, /artifact hash mismatch/)
  const query = await run(home, ['-Qi', 'demo'])
  assert.equal(query.code, 0)
  assert.equal(JSON.parse(query.stdout).version, '1.0.0')
})
