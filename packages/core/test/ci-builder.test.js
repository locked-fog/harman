import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { CiBuilder, ConflictError } from '../src/index.js'
import { sandboxCapability } from '../../../scripts/sandbox-capability.mjs'

function octal(value, length) { return value.toString(8).padStart(length - 1, '0') + '\0' }
function tar(files) {
  const chunks = []
  for (const [path, value] of files) {
    const body = Buffer.from(value); const header = Buffer.alloc(512); header.write(path)
    header.write(octal(0o644, 8), 100, 8, 'ascii'); header.write(octal(body.length, 12), 124, 12, 'ascii')
    header.fill(32, 148, 156); header[156] = 48; header.write('ustar\0', 257, 6, 'ascii'); header.write('00', 263, 2, 'ascii')
    header.write(octal(header.reduce((sum, byte) => sum + byte, 0), 8), 148, 8, 'ascii')
    chunks.push(header, body, Buffer.alloc((512 - body.length % 512) % 512))
  }
  return gzipSync(Buffer.concat([...chunks, Buffer.alloc(1024)]))
}

async function recipe(root, randomize = false) {
  const product = tar([['package/package.json', JSON.stringify({ name: 'ci-demo', version: '1.0.0' })], ['package/index.js', 'ok\n']])
  const script = `import { randomBytes } from 'node:crypto'; import { writeFile } from 'node:fs/promises'; const b=Buffer.from('${product.toString('base64')}','base64'); ${randomize ? "randomBytes(4).copy(b,4)" : ''}; await writeFile('result.tgz',b)`
  const source = tar([['package/package.json', JSON.stringify({ name: 'source', version: '1.0.0' })], ['package/build.mjs', script]])
  const path = join(root, randomize ? 'random-source.tgz' : 'source.tgz'); await writeFile(path, source)
  return { schemaVersion: 1, name: 'ci-demo', version: '1.0.0', sourceDateEpoch: 0, source: { type: 'npm-tgz', url: pathToFileURL(path).href, sha256: createHash('sha256').update(source).digest('hex') }, build: { commands: [['node', 'build.mjs']] }, outputArtifact: 'result.tgz' }
}

test('CI builder requires two byte-identical sandbox builds and emits provenance plus SPDX SBOM', { skip: sandboxCapability.isolated.skip }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'harman-ci-')); const output = join(root, 'out')
  const result = await new CiBuilder(join(root, 'build')).buildReproducibly(await recipe(root), output)
  assert.equal((await readFile(result.artifactPath)).length > 0, true)
  assert.equal(JSON.parse(await readFile(join(output, 'provenance.json'))).reproducibility.byteIdentical, true)
  assert.equal(JSON.parse(await readFile(join(output, 'sbom.spdx.json'))).spdxVersion, 'SPDX-2.3')
})

test('CI builder refuses a valid but byte-nondeterministic package artifact', { skip: sandboxCapability.isolated.skip }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'harman-ci-random-'))
  await assert.rejects(new CiBuilder(join(root, 'build')).buildReproducibly(await recipe(root, true), join(root, 'out')), error => error instanceof ConflictError)
})
