import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'))
export const npmVersion: string = pkg.version

/* The exact commit the image was built from, passed in by the Docker build
   (SQD_GIT_SHA). A checkout that was not built that way reports unknown. */
const rawCommit = process.env.SQD_GIT_SHA?.trim() ?? ''
export const gitCommit: string = /^[0-9a-f]{7,40}$/i.test(rawCommit) ? rawCommit.toLowerCase() : 'unknown'
