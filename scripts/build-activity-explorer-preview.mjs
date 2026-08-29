import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { build } from 'esbuild'

const root = process.cwd()
const directory = path.join(root, 'output', 'activity-explorer')
const result = await build({
  entryPoints: [path.join(root, 'src/app-ui/preview.ts')],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['es2022'],
  write: false,
  minify: false,
  sourcemap: 'inline',
  legalComments: 'none',
})
const bundle = result.outputFiles[0]?.text ?? ''
await mkdir(directory, { recursive: true })
await writeFile(
  path.join(directory, 'index.html'),
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SQD Activity Explorer Preview</title></head><body><div id="app"></div><script>${bundle}</script></body></html>`,
  'utf8',
)
console.log(`Built preview: ${path.relative(root, path.join(directory, 'index.html'))}`)
