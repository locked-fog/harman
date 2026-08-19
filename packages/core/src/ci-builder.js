import { mkdir, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { contentHash } from './canonical.js'
import { ConflictError } from './errors.js'
import { RecipeBuilder } from './recipe-builder.js'

export class CiBuilder {
  constructor(root, options = {}) {
    this.builder = options.builder ?? new RecipeBuilder(root, options)
  }

  async buildReproducibly(recipe, outputDirectory) {
    const first = await this.builder.build(recipe, { captureArtifact: true })
    const second = await this.builder.build(recipe, { captureArtifact: true })
    if (first.artifactSha256 !== second.artifactSha256 || !first.artifactBytes.equals(second.artifactBytes)) {
      throw new ConflictError('recipe build is not reproducible', { first: first.artifactSha256, second: second.artifactSha256 })
    }
    const destination = resolve(outputDirectory)
    await mkdir(destination, { recursive: true, mode: 0o700 })
    const artifactName = `${recipe.name.replaceAll('/', '-')}-${recipe.version}.tgz`
    const artifactPath = join(destination, artifactName)
    const sbom = {
      spdxVersion: 'SPDX-2.3', dataLicense: 'CC0-1.0', SPDXID: 'SPDXRef-DOCUMENT',
      name: `${recipe.name}-${recipe.version}`, documentNamespace: `https://harman.local/spdx/${first.artifactSha256}`,
      creationInfo: { created: new Date((recipe.sourceDateEpoch ?? 0) * 1000).toISOString(), creators: ['Tool: harman-repo'] },
      packages: [{ SPDXID: 'SPDXRef-Package', name: recipe.name, versionInfo: recipe.version, downloadLocation: recipe.source.url, checksums: [{ algorithm: 'SHA256', checksumValue: first.artifactSha256 }], filesAnalyzed: true }],
      files: first.imported.manifest.files.map((file, index) => ({ SPDXID: `SPDXRef-File-${index}`, fileName: file.path, checksums: [{ algorithm: 'SHA256', checksumValue: file.sha256 }] })),
    }
    const provenance = {
      schemaVersion: 1, builder: 'harman-repo', recipeHash: contentHash(recipe),
      source: recipe.source, artifact: { path: basename(artifactPath), sha256: first.artifactSha256 },
      reproducibility: { builds: 2, byteIdentical: true }, sandbox: { implementation: 'bubblewrap', network: recipe.build.network === true },
    }
    await writeFile(artifactPath, first.artifactBytes, { flag: 'wx', mode: 0o600 })
    await writeFile(join(destination, 'provenance.json'), JSON.stringify(provenance, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
    await writeFile(join(destination, 'sbom.spdx.json'), JSON.stringify(sbom, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
    return { artifactPath, artifactSha256: first.artifactSha256, provenance, sbomPath: join(destination, 'sbom.spdx.json') }
  }
}
