import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { build } from 'esbuild'

import { compactStylesheet } from './compact-stylesheet-plugin.mjs'
import { zodEnglishLocaleOnly } from './zod-locale-plugin.mjs'

const root = process.cwd()
const directory = path.join(root, 'output', 'activity-explorer')
const monoFont = await readFile(path.join(root, 'src/app-ui/assets/jetbrains-mono-latin.woff2'))
const fontDataUrl = (mime, bytes) => `data:${mime};base64,${bytes.toString('base64')}`
const result = await build({
  plugins: [compactStylesheet, zodEnglishLocaleOnly],
  entryPoints: [path.join(root, 'src/app-ui/preview.ts')],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['es2022'],
  write: false,
  minify: false,
  sourcemap: 'inline',
  legalComments: 'none',
  define: {
    __SQD_MONO_DATA_URL__: JSON.stringify(fontDataUrl('font/woff2', monoFont)),
  },
})
const bundle = result.outputFiles[0]?.text ?? ''
await mkdir(directory, { recursive: true })
await writeFile(
  path.join(directory, 'index.html'),
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>SQD Explorer Preview</title></head><body><div id="app"></div><script>${bundle}</script></body></html>`,
  'utf8',
)
console.log(`Built preview: ${path.relative(root, path.join(directory, 'index.html'))}`)
