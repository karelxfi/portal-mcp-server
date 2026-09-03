#!/usr/bin/env tsx
/*
 * A contact sheet for design review: every recorded fixture at a desktop,
 * tablet, and phone width, in both themes, in one picture per fixture. The
 * layout baseline in `test:app-ui` is what fails a build; this is what a person
 * looks at, and the pull request template asks for it on any change under
 * `src/app-ui/`.
 *
 * Everything on the sheet is a recorded SQD Portal response. Nothing here
 * invents data.
 */

import { mkdir, readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import path from 'node:path'

import { chromium } from 'playwright'

import { APP_FIXTURES } from '../src/app-ui/fixtures.ts'

const preview = path.resolve('output/activity-explorer/index.html')
const sheets = path.resolve('output/activity-explorer/contact-sheet')
/* The three widths the app is built for: a fullscreen host column, a tablet,
   and the narrowest phone the styles target. */
const WIDTHS = [
  { label: 'Desktop 1280', width: 1280, height: 1100 },
  { label: 'Tablet 834', width: 834, height: 1100 },
  { label: 'Phone 390', width: 390, height: 1100 },
]
const THEMES = ['light', 'dark'] as const

async function main() {
  const html = await readFile(preview, 'utf8').catch(() => {
    throw new Error('Run `npm run build:app-preview` first: the preview bundle is missing.')
  })
  await mkdir(sheets, { recursive: true })
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end(html)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as { port: number }).port
  const browser = await chromium.launch({ headless: true })
  const written: string[] = []
  try {
    for (const fixture of Object.keys(APP_FIXTURES).sort()) {
      for (const theme of THEMES) {
        const page = await browser.newPage({
          viewport: { width: WIDTHS.reduce((sum, cell) => sum + cell.width + 24, 24), height: 1200 },
          colorScheme: theme,
        })
        const frames = WIDTHS.map(
          (cell) =>
            `<figure style="margin:0"><figcaption>${cell.label}</figcaption>` +
            `<iframe src="http://127.0.0.1:${port}/?fixture=${encodeURIComponent(fixture)}&picker=0&theme=${theme}" ` +
            `width="${cell.width}" height="${cell.height}" loading="eager"></iframe></figure>`,
        ).join('')
        await page.setContent(
          `<style>body{margin:0;padding:12px;display:flex;gap:12px;align-items:flex-start;` +
            `background:${theme === 'dark' ? '#141413' : '#faf9f5'};` +
            `font:600 11px/2 ui-monospace,monospace;color:${theme === 'dark' ? '#9c9a92' : '#73726c'}}` +
            `iframe{border:1px solid ${theme === 'dark' ? '#3d3d3a' : '#dedcd1'};display:block;background:transparent}` +
            `figcaption{text-transform:uppercase;letter-spacing:0.08em}</style>${frames}`,
          { waitUntil: 'networkidle' },
        )
        await page.waitForTimeout(600)
        const file = path.join(sheets, `${fixture}-${theme}.png`)
        await page.screenshot({ path: file, fullPage: true })
        written.push(path.relative(process.cwd(), file))
        await page.close()
      }
    }
  } finally {
    await browser.close()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
  console.log(`Contact sheets: ${written.length} in ${path.relative(process.cwd(), sheets)}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
