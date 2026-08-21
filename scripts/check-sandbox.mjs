import { appendFile } from 'node:fs/promises'
import { sandboxCapability } from './sandbox-capability.mjs'

const result = {
  bwrap: sandboxCapability.bwrap,
  isolated: sandboxCapability.isolated,
  profile: sandboxCapability.profile,
  all: sandboxCapability.all,
}
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)

if (process.env.GITHUB_OUTPUT) {
  await appendFile(process.env.GITHUB_OUTPUT, [
    `isolated=${sandboxCapability.isolated.available}`,
    `profile=${sandboxCapability.profile.available}`,
    `available=${sandboxCapability.all.available}`,
  ].join('\n') + '\n')
}
