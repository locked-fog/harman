#!/usr/bin/env node

import { createPrivateKey } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  CiBuilder, artifactSignaturePayload, publicKeyId, signPayload, unsignedIndex,
} from '../../packages/core/src/index.js'

function usage() {
  return `Usage:
  harman-repo build RECIPE OUTPUT_DIR [BUILD_HOME]
  harman-repo sign-index INPUT_INDEX PRIVATE_KEY OUTPUT_INDEX
  harman-repo sign-artifact NAME VERSION SHA256 PRIVATE_KEY OUTPUT_SIGNATURE
`
}

const [command, ...args] = process.argv.slice(2)
try {
  if (command === 'build' && (args.length === 2 || args.length === 3)) {
    const recipe = JSON.parse(await readFile(resolve(args[0]), 'utf8'))
    const buildHome = resolve(args[2] ?? `${args[1]}.build-home`)
    await mkdir(buildHome, { recursive: true, mode: 0o700 })
    const result = await new CiBuilder(buildHome).buildReproducibly(recipe, args[1])
    process.stdout.write(JSON.stringify(result) + '\n')
  } else if (command === 'sign-index' && args.length === 3) {
    const index = JSON.parse(await readFile(resolve(args[0]), 'utf8'))
    const privateKey = createPrivateKey(await readFile(resolve(args[1]), 'utf8'))
    const publicKey = privateKey.asymmetricKeyType === 'ed25519' ? privateKey : null
    if (publicKey === null) throw new Error('private key must be Ed25519')
    const keyId = publicKeyId((await import('node:crypto')).createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }).toString())
    const signature = signPayload(unsignedIndex(index), privateKey, keyId)
    index.signatures = [...(index.signatures ?? []).filter(item => item.keyId !== keyId), signature].sort((a, b) => a.keyId.localeCompare(b.keyId))
    await writeFile(resolve(args[2]), JSON.stringify(index, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
    process.stdout.write(JSON.stringify({ keyId, output: resolve(args[2]) }) + '\n')
  } else if (command === 'sign-artifact' && args.length === 5) {
    const [name, version, sha256, keyPath, output] = args
    const privateKey = createPrivateKey(await readFile(resolve(keyPath), 'utf8'))
    const publicPem = (await import('node:crypto')).createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }).toString()
    const keyId = publicKeyId(publicPem)
    const signature = signPayload(artifactSignaturePayload(name, version, sha256), privateKey, keyId)
    await writeFile(resolve(output), JSON.stringify(signature, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
    process.stdout.write(JSON.stringify({ keyId, output: resolve(output) }) + '\n')
  } else {
    process.stderr.write(usage())
    process.exitCode = 2
  }
} catch (error) {
  process.stderr.write(`harman-repo: ${error.message}${error.details === undefined ? '' : ` ${JSON.stringify(error.details)}`}\n`)
  process.exitCode = 1
}
