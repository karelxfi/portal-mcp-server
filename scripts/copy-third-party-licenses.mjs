import { copyFile, mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'

const root = process.cwd()
const dependencyPackagePath = path.join(root, 'node_modules/lightweight-charts/package.json')
const dependencyLicensePath = path.join(root, 'node_modules/lightweight-charts/LICENSE')
const outputDirectory = path.join(root, 'dist/licenses')
const outputLicensePath = path.join(outputDirectory, 'lightweight-charts-LICENSE.txt')

const dependencyPackage = JSON.parse(await readFile(dependencyPackagePath, 'utf8'))
if (dependencyPackage.name !== 'lightweight-charts' || dependencyPackage.version !== '5.2.1') {
  throw new Error(
    `Expected lightweight-charts 5.2.1 for the bundled App, got ${dependencyPackage.name ?? 'unknown'} ${dependencyPackage.version ?? 'unknown'}`,
  )
}
if (dependencyPackage.license !== 'Apache-2.0') {
  throw new Error(`Expected lightweight-charts to use Apache-2.0, got ${dependencyPackage.license ?? 'unknown'}`)
}

await mkdir(outputDirectory, { recursive: true })
await copyFile(dependencyLicensePath, outputLicensePath)
console.log(`Copied ${dependencyPackage.name} ${dependencyPackage.version} license to ${outputLicensePath}`)
