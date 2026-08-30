import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'

async function filesUnder(root, directory = root) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...await filesUnder(root, path))
    else if (entry.isFile()) files.push({ path, name: relative(root, path) })
  }
  return files
}

export async function digestClientCandidate(params) {
  const manifestRoot = resolve(params.manifestRoot)
  const runtimeRoot = resolve(params.runtimeRoot)
  const manifestEntries = params.manifestFiles.map((name) => ({
    path: resolve(manifestRoot, name),
    name: `candidate/${name}`,
  }))
  const runtimeEntries = (await filesUnder(runtimeRoot))
    .filter((entry) => entry.name.endsWith('.js'))
    .map((entry) => ({ ...entry, name: `runtime/dist/${entry.name}` }))
  const metadataEntries = params.runtimeMetadataFiles.map((path) => ({
    path: resolve(path),
    name: `runtime/${relative(resolve(params.projectRoot), resolve(path))}`,
  }))
  const entries = [...manifestEntries, ...runtimeEntries, ...metadataEntries]
    .sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0)

  const digest = createHash('sha256')
  for (const entry of entries) {
    digest.update(entry.name)
    digest.update('\0')
    digest.update(await readFile(entry.path))
    digest.update('\0')
  }

  return {
    packageSha256: digest.digest('hex'),
    runtimeFileCount: runtimeEntries.length,
    hashedFileCount: entries.length,
    hashedFiles: entries.map((entry) => entry.name),
  }
}
