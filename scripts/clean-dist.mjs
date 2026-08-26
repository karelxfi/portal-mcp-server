import { rm } from 'node:fs/promises'
import { basename, resolve } from 'node:path'

const outputDirectory = resolve(process.cwd(), 'dist')

if (basename(outputDirectory) !== 'dist') {
  throw new Error(`Refusing to clean unexpected output directory: ${outputDirectory}`)
}

await rm(outputDirectory, { recursive: true, force: true })
