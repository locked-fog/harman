import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import {
  ConflictError, PackageManager, StateStore, artifactSignaturePayload,
  publicKeyId, signPayload, unsignedIndex,
} from '../src/index.js'

function keypair() {
  const pair = generateKeyPairSync('ed25519')
  const publicKey = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString()
  return { ...pair, publicKeyPem: publicKey, keyId: publicKeyId(publicKey) }
}

function index(sequence, artifact, privateKeys) {
  const value = {
    schemaVersion: 1, sequence, generatedAt: `2026-08-19T12:00:${String(sequence).padStart(2, '0')}Z`,
    packages: { demo: [{ version: '1.0.0', dependencies: {}, artifact }] },
  }
  value.signatures = privateKeys.map(key => signPayload(unsignedIndex(value), key.privateKey, key.keyId))
  return value
}

test('signed repository enforces index and artifact signatures, rotation, revocation, replay, and explicit distrust', async () => {
  const root = await mkdtemp(join(tmpdir(), 'harman-trust-')); const indexPath = join(root, 'index.json')
  const store = new StateStore(join(root, 'home')); await store.initialize(); const manager = new PackageManager(store)
  await manager.addRepository({ id: 'signed', url: pathToFileURL(indexPath).href, priority: 10, trustPolicy: 'hash-only' })
  await assert.rejects(manager.configureRepository('signed', { trustPolicy: 'signed' }), /requires an active key/)
  const first = keypair(); const second = keypair()
  await manager.addRepositoryKey('signed', first.publicKeyPem)
  await manager.configureRepository('signed', { trustPolicy: 'signed' })
  const sha = 'a'.repeat(64)
  const artifact = { url: './demo.tgz', sha256: sha, signatures: [signPayload(artifactSignaturePayload('demo', '1.0.0', sha), first.privateKey, first.keyId)] }
  await writeFile(indexPath, JSON.stringify(index(1, artifact, [first])))
  assert.equal((await manager.sync())[0].sequence, 1)
  assert.deepEqual((await manager.planInstall(['demo'])).packages[0].trustedSignatures, [first.keyId])

  const changed = index(1, { ...artifact, url: './mirror.tgz' }, [first])
  await writeFile(indexPath, JSON.stringify(changed))
  await assert.rejects(manager.sync(), /without increasing sequence/)

  await manager.addRepositoryKey('signed', second.publicKeyPem)
  const rotatedArtifact = { ...artifact, signatures: [artifact.signatures[0], signPayload(artifactSignaturePayload('demo', '1.0.0', sha), second.privateKey, second.keyId)] }
  await writeFile(indexPath, JSON.stringify(index(2, rotatedArtifact, [first, second])))
  assert.equal((await manager.sync())[0].sequence, 2)
  await manager.revokeRepositoryKey('signed', first.keyId)
  assert.deepEqual((await manager.planInstall(['demo'])).packages[0].trustedSignatures, [second.keyId])
  await manager.revokeRepositoryKey('signed', second.keyId)
  await assert.rejects(manager.search('demo'), /signature threshold/)
  await manager.configureRepository('signed', { enabled: false })
  await assert.rejects(manager.planInstall(['demo']), /no synchronized repositories/)
  assert.ok(!JSON.stringify(await store.read()).includes('PRIVATE KEY'))
})

test('multi-source conflict selection is priority then stable repository ID', async () => {
  const root = await mkdtemp(join(tmpdir(), 'harman-multisource-')); const store = new StateStore(join(root, 'home')); await store.initialize(); const manager = new PackageManager(store)
  for (const [id, priority, hash] of [['low', 1, '1'.repeat(64)], ['high', 20, '2'.repeat(64)], ['alpha', 20, '3'.repeat(64)]]) {
    const path = join(root, `${id}.json`)
    await writeFile(path, JSON.stringify({ schemaVersion: 1, sequence: 1, generatedAt: '2026-08-19T12:01:00Z', packages: { demo: [{ version: '1.0.0', dependencies: {}, artifact: { url: './demo.tgz', sha256: hash } }] } }))
    await manager.addRepository({ id, url: pathToFileURL(path).href, priority, trustPolicy: 'hash-only' })
  }
  await manager.sync()
  const plan = await manager.planInstall(['demo'])
  assert.equal(plan.packages[0].repository, 'alpha')
  assert.equal(plan.packages[0].artifact.sha256, '3'.repeat(64))
})
