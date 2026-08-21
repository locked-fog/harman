import { spawnSync } from 'node:child_process'

const bwrap = process.env.HARMAN_BWRAP ?? '/usr/bin/bwrap'

function probe(extraArgs = []) {
  const result = spawnSync(bwrap, [
    '--die-with-parent', '--new-session', '--unshare-all', ...extraArgs,
    '--ro-bind', '/usr', '/usr',
    '--symlink', 'usr/bin', '/bin',
    '--symlink', 'usr/lib', '/lib',
    '--symlink', 'usr/lib', '/lib64',
    '--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp',
    '--clearenv', '--setenv', 'PATH', '/usr/bin:/bin',
    '--', '/usr/bin/true',
  ], { encoding: 'utf8', stdio: ['ignore', 'ignore', 'pipe'], timeout: 5000 })
  if (result.error) return { available: false, detail: `${result.error.code ?? 'spawn'}: ${result.error.message}` }
  if (result.status !== 0) {
    const stderr = (result.stderr ?? '').trim().replace(/\s+/g, ' ')
    return { available: false, detail: stderr || `exit ${result.status ?? 'unknown'}${result.signal ? ` (${result.signal})` : ''}` }
  }
  return { available: true, detail: 'ok' }
}

const isolated = probe()
const profile = probe(['--share-net'])

export const sandboxCapability = {
  bwrap,
  isolated: { ...isolated, skip: isolated.available ? false : `isolated bubblewrap unavailable: ${isolated.detail}` },
  profile: { ...profile, skip: profile.available ? false : `shared-network bubblewrap unavailable: ${profile.detail}` },
  all: { available: isolated.available && profile.available },
}

if (process.env.HARMAN_REQUIRE_SANDBOX === '1' && !sandboxCapability.all.available) {
  throw new Error(`HARMAN_REQUIRE_SANDBOX=1 requires isolated and shared-network bubblewrap; isolated=${isolated.detail}; shared-network=${profile.detail}`)
}
