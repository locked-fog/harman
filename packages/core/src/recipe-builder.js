import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { access, mkdir, readFile, rm } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ConflictError, ValidationError } from './errors.js'
import {
  PackageStore, downloadVerifiedArtifact, extractInspectedEntries, inspectTarGz,
} from './package-store.js'

export function validateRecipe(recipe) {
  if (recipe?.schemaVersion !== 1) throw new ValidationError('unsupported recipe schema')
  for (const key of ['name', 'version']) {
    if (typeof recipe[key] !== 'string' || recipe[key] === '') throw new ValidationError(`recipe ${key} is required`)
  }
  if (recipe.source?.type !== 'npm-tgz' || typeof recipe.source.url !== 'string' || !/^[a-f0-9]{64}$/.test(recipe.source.sha256 ?? '')) {
    throw new ValidationError('recipe source must be a hash-pinned npm-tgz')
  }
  if (!Array.isArray(recipe.build?.commands) || recipe.build.commands.length === 0) throw new ValidationError('recipe build.commands is required')
  for (const command of recipe.build.commands) {
    if (!Array.isArray(command) || command.length === 0 || command.some(part => typeof part !== 'string' || part === '')) {
      throw new ValidationError('each recipe command must be a non-empty argv array')
    }
  }
  if (typeof recipe.outputArtifact !== 'string' || recipe.outputArtifact === '') throw new ValidationError('recipe outputArtifact is required')
  if (recipe.build.network !== undefined && typeof recipe.build.network !== 'boolean') throw new ValidationError('recipe build.network must be boolean')
  return recipe
}

async function commandExists(path) {
  try {
    await access(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

function run(command, args, options) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { cwd: options.cwd, env: options.env, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', chunk => { stderr += chunk })
    child.on('error', reject)
    const timer = setTimeout(() => child.kill('SIGKILL'), options.timeoutMs)
    child.on('close', (code, signal) => {
      clearTimeout(timer)
      resolveRun({ code, signal, stdout, stderr })
    })
  })
}

export class RecipeBuilder {
  constructor(root, options = {}) {
    this.root = resolve(root)
    this.bwrap = options.bwrap ?? '/usr/bin/bwrap'
    this.timeoutMs = options.timeoutMs ?? 120_000
    this.store = options.store ?? new PackageStore(join(this.root, 'store'))
  }

  async build(inputRecipe, options = {}) {
    const recipe = validateRecipe(inputRecipe)
    if (!(await commandExists(this.bwrap))) {
      throw new ConflictError('isolated recipe build unavailable: bwrap is missing')
    }
    const buildRoot = join(this.root, 'builds', randomUUID())
    const sourceRoot = join(buildRoot, 'source')
    await mkdir(sourceRoot, { recursive: true, mode: 0o700 })
    const logs = []
    let succeeded = false
    try {
      const source = await downloadVerifiedArtifact(recipe.source.url, recipe.source.sha256)
      await extractInspectedEntries(inspectTarGz(source), sourceRoot)
      for (const command of recipe.build.commands) {
        const bwrapArgs = [
          '--die-with-parent', '--new-session', '--unshare-all',
          ...(recipe.build.network ? ['--share-net'] : []),
          '--ro-bind', '/usr', '/usr',
          '--symlink', 'usr/bin', '/bin',
          '--symlink', 'usr/lib', '/lib',
          '--symlink', 'usr/lib', '/lib64',
          '--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp',
          '--dir', '/home', '--dir', '/nonexistent',
          '--bind', sourceRoot, '/work', '--chdir', '/work',
          '--clearenv', '--setenv', 'PATH', '/usr/bin:/bin',
          '--setenv', 'HOME', '/nonexistent', '--setenv', 'SOURCE_DATE_EPOCH', String(recipe.sourceDateEpoch ?? 0),
          '--', ...command,
        ]
        const result = await run(this.bwrap, bwrapArgs, { cwd: buildRoot, env: {}, timeoutMs: recipe.build.timeoutMs ?? this.timeoutMs })
        logs.push({ command, ...result })
        if (result.code !== 0) throw new ConflictError('isolated recipe command failed', { command, code: result.code, signal: result.signal, stderr: result.stderr })
      }
      const artifactPath = resolve(sourceRoot, recipe.outputArtifact)
      if (artifactPath !== sourceRoot && !artifactPath.startsWith(sourceRoot + sep)) throw new ValidationError('recipe outputArtifact escapes build root')
      const artifactBytes = await readFile(artifactPath)
      const artifactSha256 = (await import('node:crypto')).createHash('sha256').update(artifactBytes).digest('hex')
      const imported = await this.store.importArtifact({
        name: recipe.name, version: recipe.version,
        url: pathToFileURL(artifactPath).href, sha256: artifactSha256,
      })
      succeeded = true
      return { recipe: { name: recipe.name, version: recipe.version }, artifactSha256, imported, logs, ...(options.captureArtifact ? { artifactBytes } : {}) }
    } finally {
      if (succeeded || options.preserveFailure !== true) await rm(buildRoot, { recursive: true, force: true })
    }
  }
}
