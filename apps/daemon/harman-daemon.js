#!/usr/bin/env node

import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { createDaemon } from './server.js'

function value(argv, name) {
  const index = argv.indexOf(name)
  if (index === -1) return undefined
  if (argv[index + 1] === undefined) throw new Error(`${name} requires a value`)
  return argv[index + 1]
}

const argv = process.argv.slice(2)
const home = resolve(value(argv, '--home') ?? process.env.HARMAN_HOME ?? `${homedir()}/.harman`)
const socketPath = value(argv, '--socket')
const daemon = await createDaemon({ home, socketPath })
process.stdout.write(JSON.stringify({ status: 'ready', socketPath: daemon.socketPath, tokenPath: daemon.tokenPath }) + '\n')

let stopping = false
async function stop() {
  if (stopping) return
  stopping = true
  await daemon.close()
  process.exitCode = 0
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
