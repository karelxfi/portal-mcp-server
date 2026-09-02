import { readFile, readdir, stat } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'

const sourceRoot = resolve('src')

async function collectTypeScriptFiles(directory) {
  const files = []
  for (const name of await readdir(directory)) {
    const path = resolve(directory, name)
    const details = await stat(path)
    if (details.isDirectory()) {
      files.push(...(await collectTypeScriptFiles(path)))
    } else if (name.endsWith('.ts') && !name.endsWith('.test.ts')) {
      /* Unit tests sit next to the code and are not runtime modules. */
      files.push(path)
    }
  }
  return files
}

function resolveLocalImport(importer, specifier, knownFiles) {
  if (!specifier.startsWith('.')) return undefined
  const candidate = resolve(dirname(importer), specifier.replace(/\.js$/, '.ts'))
  return knownFiles.has(candidate) ? candidate : undefined
}

const files = await collectTypeScriptFiles(sourceRoot)
const knownFiles = new Set(files)
const sources = new Map(await Promise.all(files.map(async (file) => [file, await readFile(file, 'utf8')])))
const dependencies = new Map()

for (const [file, source] of sources) {
  const localDependencies = new Set()
  const importPattern = /(?:from\s*|import\s*\()['"](\.[^'"]+)['"]/g
  for (const match of source.matchAll(importPattern)) {
    const dependency = resolveLocalImport(file, match[1], knownFiles)
    if (dependency) localDependencies.add(dependency)
  }
  dependencies.set(file, localDependencies)
}

function collectReachable(entryPoints) {
  const reachable = new Set()
  const pending = [...entryPoints]
  while (pending.length > 0) {
    const file = pending.pop()
    if (!file || reachable.has(file)) continue
    reachable.add(file)
    pending.push(...(dependencies.get(file) ?? []))
  }
  return reachable
}

const runtimeReachable = collectReachable([resolve('src/index.ts'), resolve('src/http.ts')])
const appBuildReachable = collectReachable([resolve('src/app-ui/index.ts'), resolve('src/app-ui/preview.ts')])
const reachable = new Set([...runtimeReachable, ...appBuildReachable])

const unreachable = files.filter((file) => !reachable.has(file))
if (unreachable.length > 0) {
  throw new Error(`Unreachable runtime modules:\n${unreachable.map((file) => `- ${relative('.', file)}`).join('\n')}`)
}

const unusedRegistrations = []
for (const [file, source] of sources) {
  for (const match of source.matchAll(/export\s+(?:async\s+)?function\s+(register[A-Za-z0-9_]+)/g)) {
    const name = match[1]
    const references = [...sources.values()].filter((candidate) => candidate.includes(name)).length
    if (references < 2 && name !== 'registerAllTools') {
      unusedRegistrations.push(`${name} in ${relative('.', file)}`)
    }
  }
}

if (unusedRegistrations.length > 0) {
  throw new Error(`Unregistered tool implementations:\n${unusedRegistrations.map((item) => `- ${item}`).join('\n')}`)
}

const bannedRuntimePatterns = [
  ['monolithic MCP SDK import', /@modelcontextprotocol\/sdk/],
  ['legacy server.tool registration', /\.tool\s*\(/],
  ['legacy server.resource registration', /\.resource\s*\(/],
  ['private SDK tool registry access', /_registeredTools/],
  ['bespoke MCP session state', /\bsessionId\b/],
]
for (const [label, pattern] of bannedRuntimePatterns) {
  const matches = [...sources.entries()]
    .filter(
      ([file, source]) =>
        runtimeReachable.has(file) && !file.startsWith(resolve('src/generated')) && pattern.test(source),
    )
    .map(([file]) => relative('.', file))
  if (matches.length > 0) {
    throw new Error(`Lean MCP surface still contains ${label}:\n${matches.map((file) => `- ${file}`).join('\n')}`)
  }
}

const toolSources = [...sources.entries()].filter(([file]) => file.startsWith(resolve('src/tools')))
const portalRegistrationCount = toolSources.reduce(
  (total, [, source]) => total + [...source.matchAll(/registerPortalTool\s*\(/g)].length,
  0,
)
if (portalRegistrationCount !== 28) {
  throw new Error(`Expected all 28 tools on registerPortalTool(), found ${portalRegistrationCount}`)
}
const directToolRegistrations = toolSources
  .filter(([, source]) => /server\.registerTool\s*\(/.test(source))
  .map(([file]) => relative('.', file))
if (directToolRegistrations.length > 0) {
  throw new Error(
    `Tool modules bypass the instrumented registration surface:\n${directToolRegistrations
      .map((file) => `- ${file}`)
      .join('\n')}`,
  )
}

const sourceLines = [...sources.entries()]
  .filter(([file]) => runtimeReachable.has(file) || appBuildReachable.has(file))
  .reduce((total, [, source]) => total + source.split('\n').length, 0)
console.log(
  `Lean surface OK: ${runtimeReachable.size} runtime modules, ${appBuildReachable.size} app build modules, ${sourceLines} source lines, 28/28 instrumented registrations, 0 legacy surfaces`,
)
