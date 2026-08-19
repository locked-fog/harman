#!/usr/bin/env node

import { cp, lstat, mkdir, readFile, readlink, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const remove = args.includes('--uninstall')
const prefixIndex = args.indexOf('--prefix')
if (prefixIndex === -1 || args[prefixIndex + 1] === undefined) throw new Error('usage: install.mjs --prefix PATH [--uninstall]')
const prefix = resolve(args[prefixIndex + 1])
const destination = join(prefix, 'lib', 'harman')
const binaries = ['harman', 'harman-repo', 'harman-daemon']
const targets = {
  harman: '../lib/harman/apps/cli/harman.js',
  'harman-repo': '../lib/harman/apps/cli/harman-repo.js',
  'harman-daemon': '../lib/harman/apps/daemon/harman-daemon.js',
}
const servicePath = join(prefix, 'share', 'systemd', 'user', 'harman-daemon.service')
const serviceContent = `[Unit]\nDescription=Harman local control plane\n\n[Service]\nExecStart=${join(prefix, 'bin', 'harman-daemon')} --home %h/.harman\nRestart=on-failure\n\n[Install]\nWantedBy=default.target\n`

async function exists(path) { try { await lstat(path); return true } catch (error) { if (error?.code === 'ENOENT') return false; throw error } }

if (remove) {
  const marker = JSON.parse(await readFile(join(destination, 'install-manifest.json'), 'utf8'))
  if (marker.product !== 'harman' || marker.prefix !== prefix) throw new Error('refusing to uninstall a directory without a matching Harman ownership marker')
  for (const binary of binaries) {
    const path = join(prefix, 'bin', binary)
    if (!(await exists(path))) continue
    const info = await lstat(path)
    if (!info.isSymbolicLink() || await readlink(path) !== targets[binary]) throw new Error(`refusing to remove modified launcher ${path}`)
  }
  if (await exists(servicePath) && await readFile(servicePath, 'utf8') !== serviceContent) throw new Error(`refusing to remove modified service unit ${servicePath}`)
  for (const binary of binaries) await rm(join(prefix, 'bin', binary), { force: true })
  if (await exists(servicePath)) {
    await rm(servicePath)
  }
  await rm(destination, { recursive: true })
  process.stdout.write(`${JSON.stringify({ action: 'uninstall', prefix, preservedState: true })}\n`)
  process.exit(0)
}

const stage = `${destination}.stage-${randomUUID()}`
const backup = `${destination}.backup-${randomUUID()}`
for (const binary of binaries) {
  const path = join(prefix, 'bin', binary)
  if (await exists(path)) {
    const info = await lstat(path)
    if (!info.isSymbolicLink() || await readlink(path) !== targets[binary]) throw new Error(`refusing to overwrite modified launcher ${path}`)
  }
}
if (await exists(servicePath) && await readFile(servicePath, 'utf8') !== serviceContent) throw new Error(`refusing to overwrite modified service unit ${servicePath}`)
await mkdir(stage, { recursive: true, mode: 0o755 })
let published = false
try {
  for (const path of ['apps', 'packages', 'schemas', 'docs']) await cp(join(repositoryRoot, path), join(stage, path), { recursive: true, force: false, errorOnExist: true })
  await cp(join(repositoryRoot, 'package.json'), join(stage, 'package.json'), { force: false, errorOnExist: true })
  await writeFile(join(stage, 'install-manifest.json'), JSON.stringify({ schemaVersion: 1, product: 'harman', prefix, version: JSON.parse(await readFile(join(repositoryRoot, 'package.json'))).version }, null, 2) + '\n', { flag: 'wx', mode: 0o644 })
  await mkdir(join(prefix, 'lib'), { recursive: true, mode: 0o755 })
  if (await exists(destination)) await rename(destination, backup)
  await rename(stage, destination)
  published = true
  await mkdir(join(prefix, 'bin'), { recursive: true, mode: 0o755 })
  for (const binary of binaries) {
    const path = join(prefix, 'bin', binary); const temporary = `${path}.stage-${randomUUID()}`
    await symlink(targets[binary], temporary)
    await rename(temporary, path)
  }
  await mkdir(dirname(servicePath), { recursive: true, mode: 0o755 })
  await writeFile(servicePath, serviceContent, { mode: 0o644 })
  await rm(backup, { recursive: true, force: true })
  process.stdout.write(`${JSON.stringify({ action: 'install', prefix, destination, launchers: binaries })}\n`)
} catch (error) {
  await rm(stage, { recursive: true, force: true })
  if (published && await exists(backup)) { await rm(destination, { recursive: true, force: true }); await rename(backup, destination) }
  else if (!(await exists(destination)) && await exists(backup)) await rename(backup, destination)
  throw error
}
