import { createHash } from 'node:crypto'
import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawn } from 'node:child_process'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sourceBridge = join(repoRoot, 'packages', 'dsh-bridge')
const sourceManifest = JSON.parse(await readFile(join(sourceBridge, 'package.json'), 'utf8'))
const args = process.argv.slice(2)

function option(name, fallback) {
  const index = args.indexOf(name)
  if (index === -1) return fallback
  const value = args[index + 1]
  if (value === undefined || value.startsWith('--')) throw new Error(`${name} requires a value`)
  return value
}

const releaseVersion = option('--package-version', process.env.HARMAN_BRIDGE_VERSION ?? sourceManifest.version)
const requestedDsh = option('--dsh-version', process.env.DSH_VERSION ?? 'latest')
const requestedGenerator = option('--generator-version', process.env.DSH_GENERATOR_VERSION ?? 'latest')
const outputDirectory = resolve(option('--output', join(repoRoot, 'evidence', 'releases', releaseVersion)))
const npmCache = resolve(process.env.HARMAN_NPM_CACHE ?? join(tmpdir(), 'harman-npm-cache'))
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const buildDirectory = await mkdtemp(join(tmpdir(), 'harman-dsh-bridge-'))
const nodeModules = join(buildDirectory, 'node_modules')
const tempBridge = join(buildDirectory, 'packages', 'dsh-bridge')

await mkdir(npmCache, { recursive: true })

function run(command, commandArgs, options = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, commandArgs, {
      cwd: options.cwd ?? repoRoot,
      env: { ...process.env, ...options.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const stdout = []
    const stderr = []
    child.stdout.on('data', chunk => stdout.push(chunk))
    child.stderr.on('data', chunk => stderr.push(chunk))
    child.on('error', rejectRun)
    child.on('close', code => {
      const result = { code, stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8') }
      if (code !== 0) {
        rejectRun(new Error(`${command} ${commandArgs.join(' ')} failed with exit ${code}\n${result.stderr || result.stdout}`))
      } else {
        resolveRun(result)
      }
    })
  })
}

const npmEnvironment = {
  npm_config_cache: npmCache,
  npm_config_audit: 'false',
  npm_config_fund: 'false',
  npm_config_update_notifier: 'false',
  npm_config_allow_scripts: '',
}

function parseJsonOutput(output) {
  const text = output.trim()
  const starts = [text.indexOf('{'), text.indexOf('[')].filter(index => index >= 0)
  if (starts.length === 0) throw new Error(`expected JSON output, received: ${text}`)
  return JSON.parse(text.slice(Math.min(...starts)))
}

async function npmJson(commandArgs, options = {}) {
  const result = await run(npmCommand, commandArgs, { ...options, env: { ...npmEnvironment, ...options.env } })
  return parseJsonOutput(result.stdout)
}

function oneRecord(value) {
  return Array.isArray(value) ? value.at(-1) : value
}

function onePackRecord(value) {
  if (Array.isArray(value)) return value.at(-1)
  if (value !== null && typeof value === 'object' && typeof value.filename === 'string') return value
  const records = value !== null && typeof value === 'object'
    ? Object.values(value).filter(candidate => candidate !== null && typeof candidate === 'object' && typeof candidate.filename === 'string')
    : []
  return records.at(-1)
}

async function npmView(name, requested) {
  const value = await npmJson(['view', `${name}@${requested}`, 'version', 'dist.tarball', 'dist.integrity', '--json'])
  const record = oneRecord(value)
  if (record === null || typeof record !== 'object' || typeof record.version !== 'string') {
    throw new Error(`npm metadata for ${name}@${requested} did not contain a version`)
  }
  return record
}

async function sha256(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex')
}

async function sha512Integrity(path) {
  return `sha512-${createHash('sha512').update(await readFile(path)).digest('base64')}`
}

async function npmPack(name, version, destination) {
  await mkdir(destination, { recursive: true })
  const value = await npmJson(['pack', `${name}@${version}`, '--ignore-scripts', '--json', '--pack-destination', destination])
  const record = onePackRecord(value)
  if (record === null || typeof record.filename !== 'string') throw new Error(`npm pack did not return a filename for ${name}@${version}`)
  return join(destination, record.filename)
}

async function extractPackage(name, version, archiveDirectory) {
  const archive = await npmPack(name, version, archiveDirectory)
  const packageDirectory = join(nodeModules, ...name.split('/'))
  await mkdir(packageDirectory, { recursive: true })
  await run('tar', ['-xzf', archive, '-C', packageDirectory, '--strip-components=1'])
  return archive
}

function exactPeerVersions(resolved) {
  return {
    '@deepseek-ai/cordis': `=${resolved['@deepseek-ai/cordis'].version}`,
    '@deepseek-ai/dsh-api-remotes': `=${resolved['@deepseek-ai/dsh-api-remotes'].version}`,
    '@deepseek-ai/dsh-client-locale': `=${resolved['@deepseek-ai/dsh-client-locale'].version}`,
    '@deepseek-ai/dsh-client-runtime': `=${resolved['@deepseek-ai/dsh-client-runtime'].version}`,
    '@deepseek-ai/dsh-client-ui-settings': `=${resolved['@deepseek-ai/dsh-client-ui-settings'].version}`,
    '@deepseek-ai/dsh-client-ui-slots': `=${resolved['@deepseek-ai/dsh-client-ui-slots'].version}`,
    '@deepseek-ai/dsh-session': `=${resolved['@deepseek-ai/dsh-session'].version}`,
    '@deepseek-ai/dsh-typert-protocol': `=${resolved['@deepseek-ai/dsh-typert-protocol'].version}`,
    react: '^18.2.0',
  }
}

function nextMinor(version) {
  const match = /^(\d+)\.(\d+)\./.exec(version)
  if (match === null) throw new Error(`cannot derive DSH compatibility range from ${version}`)
  return `${Number(match[1])}.${Number(match[2]) + 1}.0`
}

function packageManifest(resolved) {
  return {
    name: sourceManifest.name,
    version: releaseVersion,
    description: sourceManifest.description,
    type: sourceManifest.type,
    main: sourceManifest.main,
    types: sourceManifest.types,
    exports: sourceManifest.exports,
    dsh: sourceManifest.dsh,
    peerDependencies: exactPeerVersions(resolved),
    dependencies: sourceManifest.dependencies,
    files: sourceManifest.files,
  }
}

function compilerOptions(overrides = {}) {
  return {
    target: 'ES2022',
    module: 'NodeNext',
    moduleResolution: 'NodeNext',
    strict: true,
    skipLibCheck: true,
    forceConsistentCasingInFileNames: true,
    resolveJsonModule: true,
    ignoreDeprecations: '6.0',
    baseUrl: '../..',
    paths: {
      '@harman/dsh-bridge': ['packages/dsh-bridge/src/index.ts'],
      '@harman/dsh-bridge/*': ['packages/dsh-bridge/lib/*'],
    },
    ...overrides,
  }
}

async function prepareWorkspace(resolved) {
  await mkdir(join(buildDirectory, 'packages'), { recursive: true })
  await cp(join(sourceBridge, 'src'), join(tempBridge, 'src'), { recursive: true })
  await cp(join(sourceBridge, 'cordis.patch.yml'), join(tempBridge, 'cordis.patch.yml'))
  const sourceIndex = join(tempBridge, 'src', 'index.ts')
  const sourceText = await readFile(sourceIndex, 'utf8')
  await writeFile(sourceIndex, sourceText
    .replace(
      "import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'",
      "import { GatewayService, Remote } from '@deepseek-ai/dsh-type-meta'",
    )
    .replace('extends TypertRemoteService', 'extends GatewayService'))
  await writeFile(join(tempBridge, 'src', 'dsh-type-meta.d.ts'), [
    "declare module '@deepseek-ai/dsh-type-meta' {",
    "  import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'",
    '  export function Remote(name: string): (method: any, context: any) => void',
    '  export function RemoteScope(key: string, name?: string): (method: any, context: any) => void',
    '  export abstract class GatewayService extends TypertRemoteService {}',
    '}',
    '',
  ].join('\n'))
  await writeFile(join(tempBridge, 'package.json'), `${JSON.stringify(packageManifest(resolved), null, 2)}\n`)
  await writeFile(join(tempBridge, 'tsconfig.host.json'), `${JSON.stringify({
    compilerOptions: compilerOptions({
      rootDir: 'src',
      outDir: 'lib/types',
      declaration: true,
      emitDeclarationOnly: true,
      types: ['node'],
    }),
    files: ['src/index.ts', 'src/dsh-type-meta.d.ts'],
  }, null, 2)}\n`)
  await writeFile(join(tempBridge, 'tsconfig.client.json'), `${JSON.stringify({
    compilerOptions: compilerOptions({
      rootDir: 'src',
      outDir: 'lib/types',
      declaration: true,
      emitDeclarationOnly: true,
      jsx: 'react-jsx',
      types: ['node', 'react'],
    }),
    files: ['src/client/index.tsx', 'src/css-modules.d.ts'],
  }, null, 2)}\n`)
  await writeFile(join(buildDirectory, 'tsconfig.host.json'), `${JSON.stringify({
    files: [],
    references: [{ path: 'packages/dsh-bridge/tsconfig.host.json' }],
  }, null, 2)}\n`)
  await writeFile(join(buildDirectory, 'tsconfig.client.json'), `${JSON.stringify({
    files: [],
    references: [{ path: 'packages/dsh-bridge/tsconfig.client.json' }],
  }, null, 2)}\n`)
}

function cssModulesPlugin() {
  return {
    name: 'harman-css-modules',
    setup(build) {
      build.onLoad({ filter: /\.module\.css$/ }, async loaded => {
        const source = await readFile(loaded.path, 'utf8')
        const names = [...source.matchAll(/\.([A-Za-z_][A-Za-z0-9_-]*)/g)]
          .map(match => match[1])
          .filter(name => name !== 'sr-only')
          .sort()
          .filter((name, index, values) => index === 0 || name !== values[index - 1])
        const hash = `H${createHash('sha256').update(source).digest('base64url').slice(0, 6)}`
        const mapping = Object.fromEntries(names.map(name => [name, `${hash}_${name}`]))
        let css = source
        for (const name of names) css = css.replaceAll(`.${name}`, `.${mapping[name]}`)
        const tagId = `${sourceBridge}/src/client/HarmanSection.module.css`
        const contents = [
          `const css = ${JSON.stringify(css)}`,
          `const tagId = ${JSON.stringify(tagId)}`,
          'if (typeof document !== "undefined" && document.querySelector(`style[data-plugin-css=${JSON.stringify(tagId)}]`) === null) {',
          '  const tag = document.createElement("style")',
          '  tag.dataset.plugin = "@harman/dsh-bridge"',
          '  tag.dataset.pluginCss = tagId',
          '  tag.textContent = css',
          '  document.head.appendChild(tag)',
          '}',
          `export default ${JSON.stringify(mapping)}`,
          '',
        ].join('\n')
        return { contents, loader: 'js', resolveDir: dirname(loaded.path) }
      })
    },
  }
}

function remoteAliasPlugin(remotePath) {
  return {
    name: 'harman-remote-alias',
    setup(build) {
      build.onResolve({ filter: /^@harman\/dsh-bridge\/remote$/ }, () => ({ path: remotePath }))
    },
  }
}

function indent(text, prefix = '\t') {
  return text.split('\n').map(line => `${prefix}${line}`).join('\n')
}

function moduleLoaderBundle(code) {
  const withoutSourceMap = code.replace(/\n?\/\/# sourceMappingURL=.*$/u, '')
  return [
    'window.__ModuleLoader__.load({',
    `\tid: ${JSON.stringify(sourceManifest.name)},`,
    '\tfactory: (require) => {',
    '\t\tvar module = { exports: {} };',
    '\t\tvar exports = module.exports;',
    indent(withoutSourceMap, '\t\t'),
    '\t\treturn module.exports;',
    '\t}',
    '});',
    '',
  ].join('\n')
}

function normalizeRemoteDeclaration(remoteDeclaration) {
  return remoteDeclaration
    .replaceAll('@deepseek-ai/dsh-type-meta', '@deepseek-ai/dsh-typert-protocol')
    .replaceAll('TypeRTRemoteContribution', 'TypertRemoteContribution')
    .replaceAll('TypeRTRemoteNamespace$', 'TypertRemoteNamespace$')
    .replaceAll('TypeRTRemoteMap', 'TypertRemoteMap')
    .replaceAll('TypeRTRemoteNamespaceMap', 'TypertRemoteNamespaceMap')
}

async function importFromBuild(packageName, relativeMain) {
  const packagePath = join(nodeModules, ...packageName.split('/'), relativeMain)
  return import(pathToFileURL(packagePath).href)
}

const dshMetadata = await npmView('@deepseek-ai/dsh', requestedDsh)
const generatorMetadata = await npmView('@deepseek-ai/dsh-typert-generator', requestedGenerator)
const supportNames = [
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-invariants',
  '@deepseek-ai/dsh-api-remotes',
  '@deepseek-ai/dsh-client-locale',
  '@deepseek-ai/dsh-client-runtime',
  '@deepseek-ai/dsh-client-ui-settings',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-session',
  '@deepseek-ai/dsh-typert-protocol',
]
const supportMetadata = {}
for (const name of supportNames) supportMetadata[name] = await npmView(name, 'latest')

const fixedBuildDependencies = {
  typescript: '6.0.3',
  '@jridgewell/gen-mapping': '0.3.13',
  '@jridgewell/sourcemap-codec': '1.5.5',
  '@jridgewell/trace-mapping': '0.3.30',
  '@jridgewell/resolve-uri': '3.1.2',
  react: '18.3.1',
  'react-dom': '18.3.1',
  '@types/react': '18.3.1',
  '@types/react-dom': '18.3.1',
  '@types/node': '22.19.0',
  'undici-types': '6.20.0',
  csstype: '3.1.3',
  '@types/prop-types': '15.7.15',
  '@types/scheduler': '0.26.0',
  scheduler: '0.23.2',
  esbuild: '0.28.2',
  '@esbuild/linux-x64': '0.28.2',
  zod: '4.4.3',
}
const resolved = {
  '@deepseek-ai/dsh': dshMetadata,
  '@deepseek-ai/dsh-typert-generator': generatorMetadata,
  ...supportMetadata,
  ...Object.fromEntries(Object.entries(fixedBuildDependencies).map(([name, version]) => [name, { version }])),
}

const dshTarballDirectory = join(buildDirectory, 'official')
const dshTarball = await npmPack('@deepseek-ai/dsh', dshMetadata.version, dshTarballDirectory)
const dshSha256 = await sha256(dshTarball)
const dshIntegrity = await sha512Integrity(dshTarball)
if (dshMetadata['dist.integrity'] !== undefined && dshMetadata['dist.integrity'] !== dshIntegrity) {
  throw new Error(`DSH tarball integrity mismatch: registry=${dshMetadata['dist.integrity']} actual=${dshIntegrity}`)
}

const archiveDirectory = join(buildDirectory, 'archives')
await mkdir(nodeModules, { recursive: true })
await extractPackage('@deepseek-ai/dsh-typert-generator', generatorMetadata.version, archiveDirectory)
for (const name of supportNames) await extractPackage(name, supportMetadata[name].version, archiveDirectory)
for (const [name, version] of Object.entries(fixedBuildDependencies)) await extractPackage(name, version, archiveDirectory)
resolved.typescript = JSON.parse(await readFile(join(nodeModules, 'typescript', 'package.json'), 'utf8'))

await prepareWorkspace(resolved)
const { WorkspaceTypertGenerator } = await importFromBuild('@deepseek-ai/dsh-typert-generator', 'lib/types/workspace.js')
const generator = new WorkspaceTypertGenerator(buildDirectory)
const artifacts = generator.generate(['@harman/dsh-bridge'], ['host'])
if (artifacts.length !== 1 || artifacts[0].remote === undefined) throw new Error('expected one Host artifact with a Client Remote contribution')
const artifact = artifacts[0]
const generatedDirectory = join(tempBridge, 'lib')
await mkdir(generatedDirectory, { recursive: true })
await Promise.all([
  writeFile(join(generatedDirectory, 'typert.host.js'), artifact.js),
  writeFile(join(generatedDirectory, 'typert.host.d.ts'), artifact.dts),
  writeFile(join(generatedDirectory, 'typert.remote-client.js'), artifact.remote.js),
  writeFile(join(generatedDirectory, 'typert.remote-client.d.ts'), normalizeRemoteDeclaration(artifact.remote.dts)),
  writeFile(join(generatedDirectory, 'typert.remote-client.d.ts.map'), `${JSON.stringify({ version: 3, file: 'typert.remote-client.d.ts', sources: [], names: [], mappings: '' })}\n`),
])

const typescriptPath = join(nodeModules, 'typescript', 'bin', 'tsc')
await run(process.execPath, [typescriptPath, '-p', join(tempBridge, 'tsconfig.host.json')], { cwd: buildDirectory })
await run(process.execPath, [typescriptPath, '-p', join(tempBridge, 'tsconfig.client.json')], { cwd: buildDirectory })
const hostTypesPath = join(tempBridge, 'lib', 'types', 'index.d.ts')
const hostTypes = await readFile(hostTypesPath, 'utf8')
await writeFile(hostTypesPath, hostTypes
  .replaceAll("import { GatewayService } from '@deepseek-ai/dsh-type-meta'", "import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'")
  .replaceAll('extends GatewayService', 'extends TypertRemoteService'))

const { build } = await importFromBuild('esbuild', 'lib/main.js')
await build({
  entryPoints: [join(tempBridge, 'src', 'index.ts')],
  outfile: join(generatedDirectory, 'index.js'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'es2022',
  packages: 'external',
  alias: { '@deepseek-ai/dsh-type-meta': '@deepseek-ai/dsh-typert-protocol' },
  sourcemap: false,
  legalComments: 'none',
})
const hostBundlePath = join(generatedDirectory, 'index.js')
const hostBundle = await readFile(hostBundlePath, 'utf8')
await writeFile(hostBundlePath, hostBundle.replace(
  'import { GatewayService, Remote } from "@deepseek-ai/dsh-typert-protocol"',
  'import { TypertRemoteService as GatewayService, Remote } from "@deepseek-ai/dsh-typert-protocol"',
))
const clientResult = await build({
  entryPoints: [join(tempBridge, 'src', 'client', 'index.tsx')],
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  external: ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/*'],
  plugins: [cssModulesPlugin(), remoteAliasPlugin(join(generatedDirectory, 'typert.remote-client.js'))],
  write: false,
  sourcemap: false,
  legalComments: 'none',
})
if (clientResult.outputFiles?.length !== 1) throw new Error('esbuild did not return one client bundle')
await writeFile(join(generatedDirectory, 'client.js'), moduleLoaderBundle(clientResult.outputFiles[0].text))

await mkdir(outputDirectory, { recursive: true })
const packResult = await npmJson(['pack', '--ignore-scripts', '--json', '--pack-destination', outputDirectory], { cwd: tempBridge })
const packRecord = onePackRecord(packResult)
if (packRecord === null || typeof packRecord.filename !== 'string') throw new Error('Bridge npm pack did not return a filename')
const artifactPath = join(outputDirectory, packRecord.filename)
const git = await run('git', ['rev-parse', 'HEAD'])
const buildManifest = {
  schemaVersion: 1,
  package: sourceManifest.name,
  packageVersion: releaseVersion,
  sourceCommit: git.stdout.trim(),
  registry: 'https://registry.npmjs.org',
  requested: { dsh: requestedDsh, typertGenerator: requestedGenerator },
  resolved: Object.fromEntries(Object.entries(resolved).map(([name, value]) => [name, value.version])),
  dshSource: {
    package: '@deepseek-ai/dsh',
    version: dshMetadata.version,
    tarball: dshMetadata['dist.tarball'] ?? null,
    integrity: dshMetadata['dist.integrity'] ?? dshIntegrity,
    downloadedIntegrity: dshIntegrity,
    sha256: dshSha256,
    packedFile: basename(dshTarball),
  },
  build: {
    typertGenerator: generatorMetadata.version,
    esbuild: fixedBuildDependencies.esbuild,
    typescript: resolved.typescript?.version ?? 'unknown',
    officialDependencies: supportNames,
    compatibilityFacade: '@deepseek-ai/dsh-type-meta is generated only in the temporary analyzer workspace; runtime and published declarations target @deepseek-ai/dsh-typert-protocol',
  },
  artifact: {
    file: basename(artifactPath),
    sha256: await sha256(artifactPath),
    size: (await readFile(artifactPath)).byteLength,
    npmPack: packRecord,
  },
}
await writeFile(join(outputDirectory, 'build-manifest.json'), `${JSON.stringify(buildManifest, null, 2)}\n`)
await writeFile(join(outputDirectory, 'index.json'), `${JSON.stringify({
  schemaVersion: 1,
  sequence: 1,
  generatedAt: new Date().toISOString(),
  packages: {
    [sourceManifest.name]: [{
      version: releaseVersion,
      description: sourceManifest.description,
      dsh: `>=${dshMetadata.version} <${nextMinor(dshMetadata.version)}`,
      platform: process.platform,
      arch: process.arch,
      dependencies: {},
      artifact: { url: `./${basename(artifactPath)}`, sha256: buildManifest.artifact.sha256 },
    }],
  },
}, null, 2)}\n`)
process.stdout.write(`${JSON.stringify({ outputDirectory, artifact: artifactPath, manifest: join(outputDirectory, 'build-manifest.json'), dsh: dshMetadata.version, bridge: releaseVersion }, null, 2)}\n`)
