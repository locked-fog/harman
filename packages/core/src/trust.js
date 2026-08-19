import { createHash, createPublicKey, sign, verify } from 'node:crypto'
import { canonicalJson } from './canonical.js'
import { ConflictError, ValidationError } from './errors.js'

export function publicKeyId(publicKeyPem) {
  let key
  try { key = createPublicKey(publicKeyPem) } catch (error) { throw new ValidationError(`invalid public key: ${error.message}`) }
  if (key.asymmetricKeyType !== 'ed25519') throw new ValidationError('repository keys must be Ed25519')
  return createHash('sha256').update(key.export({ type: 'spki', format: 'der' })).digest('hex')
}

export function unsignedIndex(index) {
  const copy = structuredClone(index)
  delete copy.signatures
  return copy
}

export function signPayload(payload, privateKey, keyId) {
  return { keyId, algorithm: 'ed25519', signature: sign(null, Buffer.from(canonicalJson(payload)), privateKey).toString('base64') }
}

function verifySignatures(payload, signatures, repository, label) {
  if (!Array.isArray(signatures)) throw new ConflictError(`${label} has no signatures`)
  const trusted = repository.trustedKeys ?? {}
  const revoked = new Set(repository.revokedKeys ?? [])
  const valid = new Set()
  for (const record of signatures) {
    if (record?.algorithm !== 'ed25519' || typeof record.keyId !== 'string' || typeof record.signature !== 'string') continue
    if (revoked.has(record.keyId) || trusted[record.keyId] === undefined) continue
    let signature
    try { signature = Buffer.from(record.signature, 'base64') } catch { continue }
    if (verify(null, Buffer.from(canonicalJson(payload)), trusted[record.keyId], signature)) valid.add(record.keyId)
  }
  const threshold = repository.signatureThreshold ?? 1
  if (valid.size < threshold) throw new ConflictError(`${label} does not meet signature threshold`, { required: threshold, valid: [...valid], revoked: [...revoked] })
  return [...valid].sort()
}

export function verifyIndexTrust(index, repository) {
  if (repository.trustPolicy !== 'signed') return []
  return verifySignatures(unsignedIndex(index), index.signatures, repository, `repository ${repository.id} index`)
}

export function artifactSignaturePayload(name, version, sha256) {
  return { schemaVersion: 1, name, version, sha256 }
}

export function verifyArtifactTrust(pkg, repository) {
  if (repository.trustPolicy !== 'signed') return []
  return verifySignatures(artifactSignaturePayload(pkg.name, pkg.version, pkg.artifact.sha256), pkg.artifact.signatures, repository, `artifact ${pkg.name}@${pkg.version}`)
}
