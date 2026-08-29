#!/usr/bin/env tsx

import { mkdir, readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import path from 'node:path'

import AxeBuilder from '@axe-core/playwright'
import { type Browser, type Page, chromium } from 'playwright'

const preview = path.resolve('output/activity-explorer/index.html')
const screenshots = path.resolve('output/activity-explorer/screenshots')
const fixtures = ['hyperliquid', 'timeseries', 'candles', 'activity', 'error', 'empty']
const viewports = [
  { name: 'desktop-light', width: 1280, height: 900, colorScheme: 'light' as const },
  { name: 'desktop-dark', width: 1280, height: 900, colorScheme: 'dark' as const },
  { name: 'mobile-light', width: 390, height: 844, colorScheme: 'light' as const },
]
const renderTimings: number[] = []

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

async function validate(page: Page, fixture: string, viewport: (typeof viewports)[number]) {
  const errors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  page.on('pageerror', (error) => errors.push(error.message))
  const startedAt = performance.now()
  await page.goto(`${baseUrl}?fixture=${fixture}`, { waitUntil: 'load' })
  await page.waitForSelector('.sqd-shell')
  const renderMs = performance.now() - startedAt
  renderTimings.push(renderMs)
  assert(renderMs < 2_000, `${fixture} ${viewport.name} took ${renderMs.toFixed(0)}ms to render`)
  const nodeCount = await page.locator('*').count()
  assert(nodeCount < 2_000, `${fixture} ${viewport.name} rendered ${nodeCount} DOM nodes`)
  assert(errors.length === 0, `${fixture} ${viewport.name} console errors: ${errors.join(' | ')}`)
  assert((await page.locator('.sqd-mark').count()) === 1, `${fixture} should show one SQD mark`)
  assert((await page.locator('h1').count()) === 1, `${fixture} should expose one result heading`)
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  assert(overflow <= 2, `${fixture} ${viewport.name} overflows horizontally by ${overflow}px`)
  const emptyCards = await page
    .locator('.sqd-card')
    .evaluateAll((cards) => cards.filter((card) => card.getBoundingClientRect().height < 40).length)
  assert(emptyCards === 0, `${fixture} ${viewport.name} has collapsed evidence cards`)
  if (fixture === 'timeseries' || fixture === 'candles') {
    const svg = page.locator('svg.sqd-chart')
    assert((await svg.count()) === 1, `${fixture} should render one accessible chart`)
    const box = await svg.boundingBox()
    assert(box && box.width >= 300 && box.height >= 220, `${fixture} chart should stay readable`)
  }
  if (['timeseries', 'candles', 'activity'].includes(fixture)) {
    assert((await page.locator('table.sqd-table').count()) >= 1, `${fixture} should expose an evidence table`)
    const table = page.locator('table.sqd-table').first()
    const originalRows = await table.locator('tbody tr').count()
    const filter = page.locator('.sqd-input').first()
    await filter.fill('sqd-no-matching-row')
    assert((await table.locator('tbody tr').count()) === 0, `${fixture} table filtering should hide non-matches`)
    await filter.fill('')
    assert((await table.locator('tbody tr').count()) === originalRows, `${fixture} table filtering should restore rows`)
    await table.locator('.sqd-sort').first().click()
    await table.locator('.sqd-row-button').first().click()
    assert(await page.locator('.sqd-dialog').isVisible(), `${fixture} should open exact row evidence`)
    await page.locator('.sqd-dialog .sqd-button').click()
  }
  await page.keyboard.press('Tab')
  assert(
    await page.evaluate(
      () => document.activeElement instanceof HTMLElement && document.activeElement !== document.body,
    ),
    `${fixture} should have a keyboard focus target`,
  )
  const accessibility = await new AxeBuilder({ page }).analyze()
  const serious = accessibility.violations.filter((violation) =>
    ['serious', 'critical'].includes(violation.impact ?? ''),
  )
  assert(
    serious.length === 0,
    `${fixture} ${viewport.name} accessibility: ${serious.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(' | ')}`).join(', ')}`,
  )
  await page.screenshot({ path: path.join(screenshots, `${viewport.name}-${fixture}.png`), fullPage: true })
}

let baseUrl = ''

async function main() {
  const html = await readFile(preview)
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
    response.end(html)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert(address && typeof address === 'object', 'preview server should bind a local port')
  baseUrl = `http://127.0.0.1:${address.port}/`
  await mkdir(screenshots, { recursive: true })
  let browser: Browser | undefined
  try {
    browser = await chromium.launch({ headless: true })
    for (const fixture of fixtures) {
      for (const viewport of viewports) {
        const context = await browser.newContext({
          viewport: { width: viewport.width, height: viewport.height },
          colorScheme: viewport.colorScheme,
        })
        const page = await context.newPage()
        try {
          await validate(page, fixture, viewport)
        } finally {
          await context.close()
        }
        console.log(`PASS  ${viewport.name} ${fixture}`)
      }
    }
  } finally {
    await browser?.close()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
  const sorted = [...renderTimings].sort((a, b) => a - b)
  const percentile = (fraction: number) =>
    sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)] ?? 0
  console.log(
    `Render latency: median ${percentile(0.5).toFixed(0)}ms, p95 ${percentile(0.95).toFixed(0)}ms, max ${percentile(1).toFixed(0)}ms`,
  )
  console.log(`UI screenshots: ${path.relative(process.cwd(), screenshots)}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
