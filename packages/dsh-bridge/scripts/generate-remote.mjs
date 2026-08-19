import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { WorkspaceTypertGenerator } from '../../../typert/generator/lib/types/workspace.js'

const workspace = resolve(process.cwd(), '../../..')
const output = resolve(process.cwd(), 'lib')
const artifacts = new WorkspaceTypertGenerator(workspace).generate(['@harman/dsh-bridge'], ['host'])
if (artifacts.length !== 1 || artifacts[0].remote === undefined) throw new Error('expected one Host artifact with a Client Remote contribution')
const artifact = artifacts[0]
await mkdir(output, { recursive: true })
await Promise.all([
  writeFile(join(output, 'typert.host.js'), artifact.js),
  writeFile(join(output, 'typert.host.d.ts'), artifact.dts),
  writeFile(join(output, 'typert.remote-client.js'), artifact.remote.js),
  writeFile(join(output, 'typert.remote-client.d.ts'), artifact.remote.dts),
  writeFile(join(output, 'typert.remote-client.d.ts.map'), artifact.remote.dtsMap),
])
process.stdout.write(`generated strict Harman Remote contract in ${output}\n`)
