import { writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'

import { build } from 'esbuild'

const projectRoot = process.cwd()
const entryPoint = path.join(projectRoot, 'src/ui/preview.tsx')
const outDir = path.join(projectRoot, '.preview')
const outFile = path.join(outDir, 'index.html')

const result = await build({
  entryPoints: [entryPoint],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['es2020'],
  write: false,
  charset: 'utf8',
  sourcemap: false,
  minify: false,
  jsx: 'automatic',
  define: {
    'process.env.NODE_ENV': '"production"',
  },
})

const bundle = result.outputFiles[0]?.text ?? ''
const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Portal Explorer Preview</title>
  </head>
  <body>
    <div id="app"></div>
    <script>${bundle}</script>
  </body>
</html>`

await mkdir(outDir, { recursive: true })
await writeFile(outFile, html, 'utf8')
console.log(`Preview written to ${path.relative(projectRoot, outFile)} (${(bundle.length / 1024).toFixed(1)} KB)`)
