#!/usr/bin/env tsx

import { mkdir, readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import path from 'node:path'

import AxeBuilder from '@axe-core/playwright'
import { type Browser, type Page, chromium } from 'playwright'

import { APP_FIXTURES } from '../src/app-ui/fixtures.ts'

const preview = path.resolve('output/activity-explorer/index.html')
const screenshots = path.resolve('output/activity-explorer/screenshots')
const fixtures = [
  'hyperliquid',
  'ratio',
  'timeseries',
  'grouped',
  'sparse',
  'mixed',
  'activity',
  'wallet',
  'contract',
  'large_table',
  'partial',
  'error',
  'empty',
]
const WALLET_FIXTURE_ROW_COUNT = ((APP_FIXTURES.wallet.activity as Record<string, unknown>).items as unknown[]).length
/* Recorded Portal pages are honest about being pages: any fixture whose
   evidence receipt says partial may show amber, every other one must not. */
const PARTIAL_FIXTURES = new Set(
  Object.entries(APP_FIXTURES)
    .filter(([, payload]) => {
      const evidence = payload._evidence as Record<string, any> | undefined
      return Boolean(payload.error) || evidence?.result?.completeness === 'partial'
    })
    .map(([name]) => name),
)
const CONTINUE_LABEL = String(
  ((APP_FIXTURES.partial._ui as Record<string, any>).follow_up_actions as Array<Record<string, unknown>>).find(
    (action) => action.intent === 'continue',
  )?.label,
)
/* Fullscreen cells exercise the whole workspace (tables, receipt, history);
   inline cells check the summary card the host renders in the conversation;
   the claude cell applies Claude's published style variables to prove the
   structure is themed by the host. */
type Cell = {
  name: string
  width: number
  height: number
  colorScheme: 'light' | 'dark'
  mode: 'inline' | 'fullscreen'
  host?: 'claude'
}
const viewports: Cell[] = [
  { name: 'desktop-light', width: 1280, height: 900, colorScheme: 'light', mode: 'fullscreen' },
  { name: 'desktop-dark', width: 1280, height: 900, colorScheme: 'dark', mode: 'fullscreen' },
  { name: 'mobile-light', width: 390, height: 844, colorScheme: 'light', mode: 'fullscreen' },
  { name: 'inline-dark', width: 760, height: 900, colorScheme: 'dark', mode: 'inline' },
  { name: 'inline-mobile-dark', width: 390, height: 844, colorScheme: 'dark', mode: 'inline' },
  { name: 'inline-claude-light', width: 760, height: 900, colorScheme: 'light', mode: 'inline', host: 'claude' },
]
const SQD = {
  dark: { surface: 'rgb(8, 9, 10)', fg: 'rgb(247, 248, 248)', accent: 'rgb(129, 140, 248)', card: 'rgb(19, 19, 22)', series: ['rgb(99, 102, 241)', 'rgb(8, 145, 178)', 'rgb(217, 119, 6)', 'rgb(22, 163, 74)', 'rgb(139, 92, 246)'] },
  light: { surface: 'rgb(255, 255, 255)', fg: 'rgb(17, 17, 21)', accent: 'rgb(37, 99, 235)', card: 'rgb(255, 255, 255)', series: ['rgb(37, 99, 235)', 'rgb(180, 83, 9)', 'rgb(0, 108, 165)', 'rgb(177, 5, 196)', 'rgb(0, 119, 50)'] },
}
const CLAUDE = { light: { surface: 'rgb(255, 255, 255)', fg: 'rgb(20, 20, 19)' }, dark: { surface: 'rgb(48, 48, 46)', fg: 'rgb(250, 249, 245)' } }

function cellUrl(fixture: string, viewport: Cell): string {
  const query = new URLSearchParams({ fixture, mode: viewport.mode, picker: '0' })
  if (viewport.host) query.set('host', viewport.host)
  return `${baseUrl}?${query.toString()}`
}
const renderTimings: number[] = []
const interactionTimings: number[] = []

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

async function validate(page: Page, fixture: string, viewport: (typeof viewports)[number]) {
  const errors: string[] = []
  const externalRequests: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('request', (request) => {
    /* Chain logos from SQD's CDN are the one sanctioned external load. */
    const url = request.url()
    const chainLogo = url.startsWith('https://cdn.subsquid.io/img/networks/') || url.startsWith('https://sqd.dev/images/')
    if (!url.startsWith(baseUrl) && !chainLogo) externalRequests.push(url)
  })
  const startedAt = performance.now()
  await page.goto(cellUrl(fixture, viewport), { waitUntil: 'load' })
  await page.waitForSelector('.sqd-shell')
  await page.evaluate(() => document.fonts.ready)
  const renderMs = performance.now() - startedAt
  renderTimings.push(renderMs)
  assert(renderMs < 1_000, `${fixture} ${viewport.name} took ${renderMs.toFixed(0)}ms to render`)
  const nodeCount = await page.locator('*').count()
  assert(nodeCount < 2_000, `${fixture} ${viewport.name} rendered ${nodeCount} DOM nodes`)
  assert(errors.length === 0, `${fixture} ${viewport.name} console errors: ${errors.join(' | ')}`)
  assert(
    externalRequests.length === 0,
    `${fixture} ${viewport.name} made unexpected external requests: ${externalRequests.join(' | ')}`,
  )
  const design = await page.evaluate(() => {
    /* Resolve tokens through a probe element: light-dark() and host
       fallbacks only become colours once they are used. (Kept as one map so
       the tsx transform adds no browser-side name helper.) */
    const tokens = ['--accent', '--success-fill', '--warning-fill', '--danger-fill', '--chart-1', '--chart-2', '--chart-3', '--chart-4', '--chart-5']
    const resolved = tokens.map((token) => {
      const probe = document.createElement('span')
      probe.style.color = `var(${token})`
      document.body.append(probe)
      const value = getComputedStyle(probe).color
      probe.remove()
      return value
    })
    const body = getComputedStyle(document.body)
    const title = document.querySelector('.sqd-title, .sqd-empty h2')
    const mono = getComputedStyle(document.querySelector('.sqd-eyebrow, .sqd-receipt-line, .sqd-footer, .sqd-query')!)
    const card = document.querySelector('.sqd-card')
    const tableHeader = document.querySelector('.sqd-table th')
    const cardStyle = card ? getComputedStyle(card) : undefined
    const tableHeaderStyle = tableHeader ? getComputedStyle(tableHeader) : undefined
    return {
      background: body.backgroundColor,
      foreground: body.color,
      bodyFont: body.fontFamily,
      titleWeight: title ? getComputedStyle(title).fontWeight : '510',
      monoFont: mono.fontFamily,
      accent: resolved[0],
      successFill: resolved[1],
      warningFill: resolved[2],
      dangerFill: resolved[3],
      chartSeries: resolved.slice(4),
      prefersDark: matchMedia('(prefers-color-scheme: dark)').matches,
      mode: document.querySelector<HTMLElement>('.sqd-app[data-mode]')?.dataset.mode,
      cardBackground: cardStyle?.backgroundColor,
      cardRadius: cardStyle?.borderRadius,
      tableHeaderFont: tableHeaderStyle?.fontFamily,
      tableHeaderWeight: tableHeaderStyle?.fontWeight,
      tableHeaderTracking: tableHeaderStyle?.letterSpacing,
    }
  })
  const expected = SQD[viewport.colorScheme]
  const host = viewport.host ? CLAUDE[viewport.colorScheme] : undefined
  assert(design.prefersDark === (viewport.colorScheme === 'dark'), `${fixture} cell must run in ${viewport.colorScheme}`)
  assert(design.mode === viewport.mode, `${fixture} should render in ${viewport.mode} mode`)
  assert(
    design.background === (host?.surface ?? expected.surface),
    `${fixture} ${viewport.name} surface should come from ${host ? 'the host variables' : 'the SQD token'} (got ${design.background})`,
  )
  assert(
    design.foreground === (host?.fg ?? expected.fg),
    `${fixture} ${viewport.name} foreground should come from ${host ? 'the host variables' : 'the SQD token'} (got ${design.foreground})`,
  )
  assert(design.bodyFont.startsWith('"Inter SQD"'), `${fixture} should render with embedded Inter`)
  assert(design.monoFont.startsWith('"JetBrains Mono SQD"'), `${fixture} evidence metadata should use JetBrains Mono`)
  assert(design.titleWeight === '510', `${fixture} headings should use SQD weight 510`)
  assert(design.accent === expected.accent, `${fixture} should keep the SQD accent in ${viewport.colorScheme} (got ${design.accent})`)
  assert(design.successFill === 'rgb(22, 163, 74)', `${fixture} should use the SQD success fill token`)
  assert(
    design.warningFill === (viewport.colorScheme === 'dark' ? 'rgb(245, 158, 11)' : 'rgb(217, 119, 6)'),
    `${fixture} should use the SQD warning fill token`,
  )
  assert(
    design.dangerFill === (viewport.colorScheme === 'dark' ? 'rgb(239, 68, 68)' : 'rgb(220, 38, 38)'),
    `${fixture} should use the SQD danger fill token`,
  )
  assert(
    JSON.stringify(design.chartSeries) === JSON.stringify(expected.series),
    `${fixture} co-equal series must follow tokens/chart-palette.json for ${viewport.colorScheme} (got ${design.chartSeries.join(', ')})`,
  )
  if (design.cardBackground && viewport.mode === 'fullscreen' && !host) {
    assert(design.cardBackground === expected.card, `${fixture} panels should use the SQD raised surface (got ${design.cardBackground})`)
    assert(design.cardRadius === '12px', `${fixture} panels should use the SQD pane radius`)
  }
  if (design.tableHeaderFont) {
    assert(design.tableHeaderFont.startsWith('"Inter SQD"'), `${fixture} table headers should use Inter`)
    assert(design.tableHeaderWeight === '510', `${fixture} table headers should use weight 510`)
    assert(
      design.tableHeaderTracking === 'normal',
      `${fixture} table headers should use untracked sentence case per the Chart Standards table spec`,
    )
  }
  if (viewport.width <= 520 && (await page.locator('.sqd-input').count()) > 0) {
    const inputSize = await page
      .locator('.sqd-input')
      .first()
      .evaluate((node) => getComputedStyle(node).fontSize)
    assert(inputSize === '16px', `${fixture} mobile inputs should keep the SQD 16px floor`)
    const rowCount = page.locator('.sqd-table-tools .sqd-brand-subtitle').first()
    if ((await rowCount.count()) > 0) {
      const clippedBy = await rowCount.evaluate((node) => node.scrollWidth - node.clientWidth)
      assert(clippedBy <= 1, `${fixture} mobile exact-row count is clipped by ${clippedBy}px`)
    }
  }
  assert((await page.locator('.sqd-mark').count()) === 1, `${fixture} should show one SQD mark`)
  assert((await page.locator('h1').count()) <= 1, `${fixture} should expose at most one result heading`)
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  assert(overflow <= 2, `${fixture} ${viewport.name} overflows horizontally by ${overflow}px`)
  const emptyCards = await page
    .locator('.sqd-card')
    .evaluateAll((cards) => cards.filter((card) => card.getBoundingClientRect().height < 40).length)
  assert(emptyCards === 0, `${fixture} ${viewport.name} has collapsed evidence cards`)
  await page.screenshot({ path: path.join(screenshots, `${viewport.name}-${fixture}.png`), fullPage: true })
  if (viewport.mode === 'inline') {
    await validateInline(page, fixture, viewport)
    return
  }
  if (['timeseries', 'grouped', 'sparse', 'mixed'].includes(fixture)) {
    const svg = page.locator('svg.sqd-chart')
    assert((await svg.count()) >= 1, `${fixture} should render an accessible chart workspace`)
    const box = await svg.boundingBox()
    const minimumChartHeight = viewport.width <= 520 ? 110 : 280
    assert(box && box.width >= 300 && box.height >= minimumChartHeight, `${fixture} chart should stay readable`)
    const rightScaleX = await svg.locator('.sqd-chart-label').first().getAttribute('x')
    const chartViewBoxWidth = Number((await svg.getAttribute('viewBox'))?.split(' ')[2])
    assert(Number(rightScaleX) > chartViewBoxWidth * 0.85, `${fixture} should use the SQD right-side value scale`)
    assert(
      (await svg.getAttribute('role')) === 'group',
      `${fixture} interactive charts should expose their point descendants`,
    )
  }
  if (['hyperliquid', 'ratio'].includes(fixture)) {
    const terminal = page.locator('.sqd-candle-chart')
    assert((await terminal.count()) >= 1, `${fixture} should render the market terminal surface`)
    const box = await terminal.first().boundingBox()
    const minimumChartHeight = viewport.width <= 520 ? 110 : 280
    assert(
      box && box.width >= 300 && box.height >= minimumChartHeight,
      `${fixture} terminal chart should stay readable`,
    )
    assert(
      (await page.locator('.sqd-candle-chart canvas').count()) >= 2,
      `${fixture} should paint the canvas chart surface`,
    )
    const pillBox = await page.locator('.sqd-candle-pill').first().boundingBox()
    assert(
      pillBox && box && pillBox.x - box.x > box.width * 0.8,
      `${fixture} should pin the last value on the SQD right-side value scale`,
    )
    assert(
      (await terminal.first().getAttribute('role')) === 'group',
      `${fixture} terminal should expose grouped chart semantics`,
    )
    const attribution = page.locator('a[href*="tradingview.com"]').first()
    assert((await attribution.count()) === 1, `${fixture} should show the required TradingView product attribution`)
    assert(
      (await page.locator('.sqd-candle-readout').innerText()).length > 0,
      `${fixture} should show the crosshair-linked OHLC readout`,
    )
  }
  if (fixture === 'ratio') {
    const readoutText = await page.locator('.sqd-candle-readout').innerText()
    assert(!readoutText.includes('$'), 'Token-ratio candles must not be relabeled as USD')
    const finalPoint = page.locator('.sqd-chart-hit').last()
    await finalPoint.focus()
    const ratioUnit = String((APP_FIXTURES.ratio.chart as Record<string, unknown>).price_unit)
    assert(
      (await finalPoint.getAttribute('aria-label'))?.includes(ratioUnit),
      'Token-ratio point inspection should retain its declared unit',
    )
  }
  if (fixture === 'hyperliquid') {
    const expected = APP_FIXTURES.hyperliquid.ohlc as Array<Record<string, number>>
    assert(
      (await page.locator('[data-candle-index]').count()) === expected.length,
      'Hyperliquid should keep every candle individually inspectable',
    )
    assert(
      (await page.locator('[data-volume]').count()) === expected.length,
      'Hyperliquid should carry exact volume on every candle',
    )
    assert(
      (await page.locator('.sqd-candle-readout').innerText()).includes('Open candle, still forming'),
      'The forming candle must stay visibly non-final in the readout',
    )
    const final = await page.locator('[data-candle-index][data-close]').last().getAttribute('data-close')
    assert(Number(final) === Number(expected.at(-1)?.close), 'Hyperliquid final candle should match the recorded Portal row')
    const hit = page.locator('.sqd-chart-hit').last()
    const interactionStarted = performance.now()
    await hit.focus()
    interactionTimings.push(performance.now() - interactionStarted)
    assert(
      (await page.locator('.sqd-candle-chart .sqd-chart-tooltip').count()) === 0,
      'The candle chart must not float a tooltip over the candles; the readout is the hover surface',
    )
    const readoutLines = page.locator('.sqd-candle-readout-line')
    /* Readout keys render uppercase, so compare case-insensitively. */
    const focusedText = (await page.locator('.sqd-candle-readout').innerText()).toLowerCase()
    assert(
      focusedText.includes('fills') && focusedText.includes('vwap'),
      'Hyperliquid point inspection should expose every promised field in the readout',
    )
    const focusedHeight = await page.locator('.sqd-candle-readout').evaluate((node) => node.getBoundingClientRect().height)
    const lineCount = await readoutLines.count()
    await page.locator('.sqd-chart-hit').nth(2).focus()
    const otherHeight = await page.locator('.sqd-candle-readout').evaluate((node) => node.getBoundingClientRect().height)
    assert(
      lineCount === 2 && focusedHeight === otherHeight,
      `The readout must keep its height across candles (${focusedHeight} vs ${otherHeight}) so the chart never resizes`,
    )
    assert(
      !(await page.locator('.sqd-candle-readout').innerText()).includes('candle, still forming'),
      'A complete candle must not carry the forming flag',
    )
    const showRaw = page.getByRole('button', { name: 'Show raw candle rows' })
    assert((await showRaw.count()) === 1, 'Hyperliquid should expose its raw candle action')
    await showRaw.click()
    assert(
      (await page.locator('.sqd-raw').getAttribute('open')) !== null,
      'Raw candle action should open exact JSON evidence',
    )
    const rawRows = JSON.parse(await page.locator('.sqd-raw pre').innerText())
    assert(
      Array.isArray(rawRows) && rawRows.length === expected.length,
      'Raw candle action should target the exact candle rows',
    )
    await hit.click()
    assert(
      (await page.locator('table.sqd-table tbody tr[data-selected="true"]').count()) === 1,
      'Selecting a chart point should link to one exact table row',
    )
    assert(
      (await page.locator('.sqd-table-pagination').innerText()).includes('Page 3 of 3'),
      'Selecting a late candle should page the evidence table to its exact row',
    )
    assert((await hit.getAttribute('aria-pressed')) === 'true', 'Selected chart points should expose their state')
    await page.getByRole('button', { name: 'Previous rows' }).click()
    const receipt = page.locator('.sqd-receipt')
    assert((await receipt.count()) === 1, 'Successful results should show one factual evidence receipt')
    await page.getByRole('button', { name: 'Full receipt' }).click()
    assert(
      (await page.locator('.sqd-dialog[open]').innerText()).includes('exact_data_sha256'),
      'Full receipt should expose the exact-data digest',
    )
    await page.locator('.sqd-dialog[open]').evaluate((node) => (node as HTMLDialogElement).close())
    await page.getByRole('button', { name: 'Download JSON' }).click()
    assert(
      (await page.locator('body').getAttribute('data-export-format')) === 'json',
      'JSON export action should be wired',
    )
    await page.getByRole('button', { name: 'Download CSV' }).click()
    assert(
      (await page.locator('body').getAttribute('data-export-format')) === 'csv',
      'CSV export action should be wired',
    )
    await page.getByRole('button', { name: 'Open previous result in this session' }).click()
    assert(
      (await page.locator('body').getAttribute('data-history-action')) === 'back',
      'session history should support back navigation',
    )
    await page.getByRole('button', { name: 'Open next result in this session' }).click()
    assert(
      (await page.locator('body').getAttribute('data-history-action')) === 'forward',
      'session history should support forward navigation',
    )
  }
  if (fixture === 'timeseries') {
    const expected = APP_FIXTURES.timeseries.time_series as Array<Record<string, number>>
    assert(
      (await page.locator('.sqd-chart-hit').count()) === expected.length,
      'Time series should render every source point',
    )
    const renderedValues = await page
      .locator('.sqd-chart-bar')
      .evaluateAll((nodes) => nodes.map((node) => Number(node.getAttribute('data-value'))))
    assert(
      JSON.stringify(renderedValues) === JSON.stringify(expected.map((row) => row.value)),
      'Time-series bars should carry every exact Portal value in order',
    )
    assert(
      Number(await page.locator('[data-final-value]').getAttribute('data-final-value')) === expected.at(-1)?.value,
      'Time-series final value should match structured content',
    )
  }
  if (fixture === 'grouped') {
    const rows = APP_FIXTURES.grouped.time_series as Array<{ contract_address: string; value: number }>
    const keys = [...new Set(rows.map((row) => row.contract_address))]
    assert(
      (await page.locator('.sqd-chart-legend-item').count()) === keys.length,
      'Grouped charts should expose every series',
    )
    const renderedTotals = await page
      .locator('[data-series-total]')
      .evaluateAll((nodes) => nodes.map((node) => Number(node.getAttribute('data-series-total'))))
    const expectedTotals = keys.map((key) => rows.filter((row) => row.contract_address === key).reduce((sum, row) => sum + row.value, 0))
    assert(
      JSON.stringify(renderedTotals) === JSON.stringify(expectedTotals),
      'Grouped chart totals should reconcile with every structured row',
    )
    const firstLegend = page.locator('.sqd-chart-legend-item').first()
    await firstLegend.click()
    assert(
      (await firstLegend.getAttribute('aria-pressed')) === 'false',
      'Grouped series controls should expose their state',
    )
    const firstPoint = page.locator('.sqd-chart-hit').first()
    await firstPoint.focus()
    assert(
      !(await firstPoint.getAttribute('aria-label'))?.includes('Transfers'),
      'Hidden series should leave point accessibility text',
    )
    assert(
      !(await page.locator('.sqd-chart-tooltip').innerText()).includes('Transfers'),
      'Hidden series should leave point tooltips',
    )
    assert(
      await page
        .locator('.sqd-chart-series-area[data-series-index="0"]')
        .evaluate((node) => getComputedStyle(node).display === 'none'),
      'Hiding the first series should hide its stacked band',
    )
  }
  if (fixture === 'sparse') {
    const orderedX = await page
      .locator('.sqd-chart-hit')
      .evaluateAll((nodes) => nodes.map((node) => Number(node.getAttribute('data-x-value'))))
    assert(
      JSON.stringify(orderedX) === JSON.stringify([0, 1, 3, 4]),
      'Sparse series should render in chronological order',
    )
    const segments = await page
      .locator('.sqd-chart-line')
      .evaluateAll((nodes) => nodes.map((node) => Number(node.getAttribute('data-point-count'))))
    assert(
      JSON.stringify(segments) === JSON.stringify([2, 2]),
      'Sparse series should leave a visual gap for the missing bucket',
    )
  }
  if (fixture === 'mixed') {
    const values = await page
      .locator('.sqd-chart-bar')
      .evaluateAll((nodes) => nodes.map((node) => Number(node.getAttribute('data-value'))))
    assert(
      JSON.stringify(values) === JSON.stringify([-30, -10, 15, 0, 50]),
      'Signed bars should preserve chronological values',
    )
    assert(
      (await page.locator('.sqd-chart-hit').count()) === 6,
      'Missing signed values should remain inspectable without becoming a bar',
    )
    assert(
      (await page.locator('.sqd-chart-hit').last().getAttribute('aria-label'))?.includes('not available'),
      'Null chart values must not become factual zeroes',
    )
    const validGeometry = await page.locator('.sqd-chart-bar').evaluateAll((nodes) =>
      nodes.every((node) => {
        const height = Number(node.getAttribute('height'))
        const y = Number(node.getAttribute('y'))
        return Number.isFinite(height) && height >= 1 && Number.isFinite(y)
      }),
    )
    assert(validGeometry, 'Signed bars should have valid geometry on both sides of zero')
  }
  if (['hyperliquid', 'timeseries', 'activity', 'large_table'].includes(fixture)) {
    assert((await page.locator('table.sqd-table').count()) >= 1, `${fixture} should expose an evidence table`)
    const table = page.locator('table.sqd-table').first()
    const originalRows = await table.locator('tbody tr').count()
    const filter = page.locator('.sqd-input').first()
    const filterStarted = performance.now()
    await filter.fill('sqd-no-matching-row')
    interactionTimings.push(performance.now() - filterStarted)
    assert((await table.locator('tbody tr').count()) === 0, `${fixture} table filtering should hide non-matches`)
    await filter.fill('')
    assert((await table.locator('tbody tr').count()) === originalRows, `${fixture} table filtering should restore rows`)
    const sortStarted = performance.now()
    await table.locator('.sqd-sort').first().click()
    interactionTimings.push(performance.now() - sortStarted)
    assert(
      (await table.locator('th').first().getAttribute('aria-sort')) !== 'none',
      `${fixture} sorting should expose direction`,
    )
    await table.locator('.sqd-row-button').first().click()
    assert(await page.locator('.sqd-dialog').isVisible(), `${fixture} should open exact row evidence`)
    assert(
      (await page.locator('.sqd-dialog').getAttribute('aria-labelledby')) === 'sqd-evidence-dialog-title',
      `${fixture} evidence dialog should have an accessible name`,
    )
    const dialogAccessibility = await new AxeBuilder({ page }).include('.sqd-dialog').analyze()
    const dialogSerious = dialogAccessibility.violations.filter((violation) =>
      ['serious', 'critical'].includes(violation.impact ?? ''),
    )
    assert(
      dialogSerious.length === 0,
      `${fixture} evidence dialog accessibility: ${dialogSerious.map((violation) => violation.id).join(', ')}`,
    )
    await page.locator('.sqd-dialog[open]').evaluate((node) => (node as HTMLDialogElement).close())
  }
  if (fixture === 'activity') {
    const expectedHash = String((APP_FIXTURES.activity.items as Array<Record<string, unknown>>)[0].tx_hash)
    assert(
      (await page.locator('table.sqd-table').innerText()).includes(expectedHash),
      'Activity tables should keep exact transaction hashes',
    )
    const firstBlock = Number((APP_FIXTURES.activity.items as Array<Record<string, unknown>>)[0].block_number)
    assert(
      (await page.locator('table.sqd-table').innerText()).includes(firstBlock.toLocaleString('en-US')),
      'Activity tables should keep exact block numbers',
    )
  }
  if (fixture === 'wallet') {
    assert(
      (await page.locator('.sqd-card').count()) >= 3,
      'wallet workspace should combine timeline, exact rows, and counterparties',
    )
    assert(
      (await page.locator('.sqd-event').count()) === WALLET_FIXTURE_ROW_COUNT,
      'wallet timeline should preserve every exact activity row',
    )
    assert(
      (await page.locator('table.sqd-table').first().locator('tbody tr').count()) === WALLET_FIXTURE_ROW_COUNT,
      'wallet table should preserve every exact activity row',
    )
    assert((await page.locator('.sqd-eyebrow').innerText()).toLowerCase().includes('base'), 'the eyebrow names the chain by its display name')
    assert((await page.locator('.sqd-query .sqd-chain-logo').count()) === 1, 'the query chip carries the chain logo')
    const links = page.locator('a.sqd-link')
    assert((await links.count()) > 0, 'wallet identifiers must link to the public explorer')
    const hrefs = await links.evaluateAll((nodes) => nodes.map((node) => (node as HTMLAnchorElement).href))
    assert(hrefs.every((href) => href.startsWith('https://basescan.org/')), 'wallet links must point at Basescan')
    await page.locator('.sqd-timeline a.sqd-link').first().click()
    assert(
      (await page.evaluate(() => document.body.dataset.openedLink))?.startsWith('https://basescan.org/'),
      'clicking an identifier must hand the explorer link to the host',
    )
    const counterparties = ((APP_FIXTURES.wallet.fund_flow as Record<string, unknown>).movement_counterparties as unknown[]).length
    assert(
      (await page.locator('.sqd-ranked-row').count()) === counterparties,
      'wallet workspace should rank every exact movement counterparty',
    )
  }
  if (fixture === 'contract') {
    assert(
      (await page.locator('.sqd-metric').count()) === 4,
      'contract workspace should expose interactions, callers, events, and event types',
    )
    assert((await page.locator('.sqd-card').count()) === 2, 'contract workspace should compare callers and event types')
    const contractPayload = APP_FIXTURES.contract as Record<string, any>
    const expectedRanked =
      contractPayload.interactions.top_callers.length + Object.keys(contractPayload.events.events_by_type).length
    assert(
      (await page.locator('.sqd-ranked-row').count()) === expectedRanked,
      'contract workspace should retain every caller and event type',
    )
  }
  if (!PARTIAL_FIXTURES.has(fixture)) {
    assert(
      (await page.locator('.sqd-notice--caution, .sqd-notice--danger, .sqd-display-limit--caution, .sqd-context--warning').count()) === 0,
      `${fixture} is complete, so nothing on it may read as a warning`,
    )
  }
  if (fixture === 'large_table') {
    const rows = APP_FIXTURES.large_table.top_contracts as Array<Record<string, unknown>>
    const pages = Math.ceil(rows.length / 10)
    assert((await page.locator('table.sqd-table tbody tr').count()) === 10, 'Large tables should use short local pages')
    assert(
      (await page.locator('.sqd-card:has(table.sqd-table) .sqd-display-limit').first().innerText()).includes(`10 of ${rows.length}`),
      'Large tables should disclose the local page size',
    )
    assert((await page.locator('.sqd-display-limit--caution').count()) === 0, 'a complete local page is a caption, not a warning')
    assert((await page.locator('.sqd-hero-figure').count()) === 0, 'The headline number lives in the metric row, not beside the title')
    assert(
      (await page.locator('.sqd-metric').first().innerText()).toLowerCase().includes('transactions'),
      'The primary metric leads the metric row',
    )
    const ranked = page.locator('.sqd-ranked-row')
    assert((await ranked.count()) === 10, 'Ranked panels show ten rows by default')
    const more = page.locator('.sqd-more-button')
    assert((await more.innerText()) === `Show all ${rows.length}`, 'The ranked panel offers every row in one control')
    await more.click()
    assert((await ranked.count()) === rows.length, 'Show all reveals every ranked row already in the result')
    assert((await more.innerText()) === 'Show 10', 'The control folds the panel back')
    await more.click()
    assert((await ranked.count()) === 10, 'Folding back returns to the default page')
    assert(
      (await page.locator('.sqd-table-pagination').innerText()).includes(`Page 1 of ${pages}`),
      'Large tables should expose page state',
    )
    await page.getByRole('button', { name: 'Next rows' }).click()
    assert(
      (await page.locator('.sqd-table-pagination').innerText()).includes(`Page 2 of ${pages}`),
      'Large table paging should advance',
    )
    assert(
      (await page.locator('table.sqd-table').innerText()).includes(String(rows[10]?.address)),
      'The second page should start at the exact next row',
    )
    const lastAddress = String(rows.at(-1)?.address)
    await page.locator('.sqd-input').fill(lastAddress)
    assert(
      (await page.locator('table.sqd-table tbody tr').count()) === 1,
      'Table search should include rows beyond the first rendered page',
    )
    assert(
      (await page.locator('table.sqd-table').innerText()).includes(lastAddress),
      'A hidden matching row should render exactly',
    )
    /* Prove the short local pages expose every exact row once: clearing the
       filter and walking Next from the first page must collect all 125 row
       keys with no missing and no duplicate identities. */
    await page.locator('.sqd-input').fill('')
    for (let guard = 0; guard < 60; guard += 1) {
      const previous = page.getByRole('button', { name: 'Previous rows' })
      if (await previous.isDisabled()) break
      await previous.click()
    }
    const walkedKeys: string[] = []
    let observedPages = 0
    for (let guard = 0; guard < 60; guard += 1) {
      observedPages += 1
      walkedKeys.push(
        ...(await page
          .locator('table.sqd-table tbody tr[data-evidence-key]')
          .evaluateAll((trs) => trs.map((tr) => (tr as HTMLElement).dataset.evidenceKey ?? ''))),
      )
      const next = page.getByRole('button', { name: 'Next rows' })
      if (await next.isDisabled()) break
      await next.click()
    }
    assert(observedPages === pages, `Large table should paginate into ${pages} short pages, walked ${observedPages}`)
    assert(walkedKeys.length === rows.length, `Pagination should expose all ${rows.length} exact rows, saw ${walkedKeys.length}`)
    assert(
      new Set(walkedKeys).size === rows.length && !walkedKeys.includes(''),
      'Pagination must expose every exact row key exactly once, with no gaps or duplicates',
    )
  }
  if (fixture === 'partial') {
    assert(
      (await page.locator('.sqd-eyebrow .sqd-dot').count()) === 1,
      'Partial results must carry a state dot next to the headline',
    )
    const continueButton = page.getByRole('button', { name: CONTINUE_LABEL })
    assert(
      (await continueButton.count()) === 1 && (await continueButton.isEnabled()),
      'Partial results should offer an enabled continuation action',
    )
  }
  if (fixture === 'hyperliquid' && viewport.name === 'desktop-dark') {
    await page.goto(`${cellUrl(fixture, viewport)}&busy=1`, { waitUntil: 'load' })
    await page.waitForSelector('.sqd-shell')
    assert((await page.locator('.sqd-shell[aria-busy="true"] .sqd-progress').count()) === 1, 'a pending follow-up shows progress over the last result')
    assert((await page.locator('.sqd-candle-chart canvas').count()) >= 2, 'a pending follow-up keeps the last result on screen')
    assert(
      (await page.locator('.sqd-followups button').evaluateAll((nodes) => nodes.every((node) => (node as HTMLButtonElement).disabled))) === true,
      'a pending follow-up holds every follow-up control',
    )
    await page.goto(`${cellUrl(fixture, viewport)}&error=1`, { waitUntil: 'load' })
    await page.waitForSelector('.sqd-shell')
    assert((await page.locator('.sqd-notice--danger').count()) === 1, 'a failed follow-up reports above the last result')
    assert((await page.locator('.sqd-candle-chart canvas').count()) >= 2, 'a failed follow-up keeps the last result on screen')
    assert((await page.getByRole('button', { name: 'Retry' }).count()) === 1, 'a failed follow-up offers a retry')
    await page.goto(cellUrl(fixture, viewport), { waitUntil: 'load' })
    await page.waitForSelector('.sqd-shell')
  }
  const keyboardTarget = page.locator('button:visible, [tabindex="0"]:visible').first()
  if (!['error', 'empty'].includes(fixture)) {
    assert((await keyboardTarget.count()) === 1, `${fixture} should expose a keyboard focus target`)
    await keyboardTarget.focus()
    assert(
      await page.evaluate(
        () => document.activeElement !== document.body && document.activeElement !== document.documentElement,
      ),
      `${fixture} should have a keyboard focus target`,
    )
  }
  const accessibility = await new AxeBuilder({ page }).analyze()
  const serious = accessibility.violations.filter((violation) =>
    ['serious', 'critical'].includes(violation.impact ?? ''),
  )
  assert(
    serious.length === 0,
    `${fixture} ${viewport.name} accessibility: ${serious.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(' | ')}`).join(', ')}`,
  )
}

/* The inline card: the host's rules (auto-fit height, at most two actions,
   no menus, no nested scrolling) plus SQD's (the primary instrument first). */
async function validateInline(page: Page, fixture: string, viewport: Cell) {
  const buttons = page.locator('.sqd-followups button')
  assert((await buttons.count()) <= 2, `${fixture} inline card must offer at most two actions`)
  assert((await page.locator('.sqd-receipt, .sqd-raw, .sqd-footer, .sqd-table-pagination, .sqd-input').count()) === 0, `${fixture} inline card must leave the ledger apparatus to fullscreen`)
  assert((await page.locator('.sqd-card').count()) <= 1, `${fixture} inline card shows one primary panel`)
  assert((await page.locator('table.sqd-table tbody tr').count()) <= 5, `${fixture} inline tables preview at most five rows`)
  const innerScroll = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('.sqd-shell *')).filter((node) => {
      const style = getComputedStyle(node)
      return /auto|scroll/.test(style.overflowY) && node.scrollHeight > node.clientHeight + 2
    }).length,
  )
  assert(innerScroll === 0, `${fixture} inline card must not scroll vertically inside itself`)
  const primary = page.locator('.sqd-card--primary, .sqd-empty, .sqd-notice--danger').first()
  if ((await primary.count()) > 0) {
    const box = await primary.boundingBox()
    /* The instrument is the point of the card: on a 760px host column it
       starts inside the first 360px; a phone stacks the readouts two by two. */
    const budget = viewport.width <= 520 ? 480 : 360
    assert(box && box.y < budget, `${fixture} ${viewport.name} primary panel should start within the first ${budget}px (got ${box?.y.toFixed(0)})`)
  }
  if (['hyperliquid', 'ratio'].includes(fixture)) {
    assert((await page.locator('.sqd-candle-chart canvas').count()) >= 2, `${fixture} inline card should paint the terminal`)
  }
  if (fixture === 'partial') {
    assert((await page.getByRole('button', { name: CONTINUE_LABEL }).count()) === 1, 'partial inline card keeps its continuation action')
  }
  if (fixture === 'error') {
    assert((await page.getByRole('button', { name: 'Retry' }).count()) === 1, 'error inline card offers a retry')
  }
  if (fixture === 'empty') {
    assert((await page.getByRole('button', { name: 'Widen the window' }).count()) === 1, 'empty inline card offers to widen the window')
  }
  if (viewport.width <= 520) {
    const smallTargets = await page.locator('.sqd-followups button').evaluateAll((nodes) =>
      nodes.filter((node) => node.getBoundingClientRect().height < 44).length,
    )
    assert(smallTargets === 0, `${fixture} inline actions on phones must be at least 44px tall`)
  }
  const fullscreen = page.getByRole('button', { name: 'Open full screen' })
  if ((await fullscreen.count()) > 0) {
    await fullscreen.first().click()
    assert((await page.locator('body').getAttribute('data-fullscreen-requested')) === 'true', `${fixture} fullscreen action should be wired`)
  }
  const accessibility = await new AxeBuilder({ page }).analyze()
  const serious = accessibility.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact ?? ''))
  assert(serious.length === 0, `${fixture} ${viewport.name} accessibility: ${serious.map((violation) => violation.id).join(', ')}`)
}

let baseUrl = ''

async function main() {
  const wallet = APP_FIXTURES.wallet as Record<string, any>
  const walletRows = wallet.activity.items as Array<Record<string, any>>
  assert(wallet.activity.count === walletRows.length, 'Wallet activity count must reconcile with exact rows')
  assert(
    walletRows.every((row) => typeof row.tx_hash === 'string' && row.tx_hash.length === 66),
    'Wallet rows must carry exact transaction hashes',
  )
  const contract = APP_FIXTURES.contract as Record<string, any>
  assert(
    contract.interactions.total_transactions >=
      contract.interactions.top_callers.reduce((sum: number, row: any) => sum + row.interaction_count, 0) &&
      contract.interactions.unique_callers >= contract.interactions.top_callers.length,
    'Contract interaction total must cover its ranked callers',
  )
  assert(
    contract.events.total_events ===
      Object.values(contract.events.events_by_type).reduce((sum: number, value) => sum + Number(value), 0),
    'Contract event total must reconcile with event types',
  )
  const hyperliquid = APP_FIXTURES.hyperliquid as Record<string, any>
  assert(
    hyperliquid.summary.total_fills === hyperliquid.ohlc.reduce((sum: number, row: any) => sum + row.fill_count, 0),
    'Hyperliquid fixture fill total must reconcile with its pinned rows',
  )
  assert(
    Math.abs(
      Number(hyperliquid.summary.total_volume) -
        hyperliquid.ohlc.reduce((sum: number, row: any) => sum + Number(row.volume), 0),
    ) < 0.01,
    'Hyperliquid fixture volume must reconcile with its recorded rows',
  )
  const timeseries = APP_FIXTURES.timeseries as Record<string, any>
  assert(
    timeseries.summary.statistics.max === Math.max(...timeseries.time_series.map((row: any) => row.value)) &&
      timeseries.summary.total_buckets === timeseries.time_series.length,
    'Time-series fixture statistics must reconcile with its rows',
  )
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
    /* Warm the browser first so Chromium start-up is not charged to whichever
       fixture happens to run first. Every fixture then meets the same budget. */
    const warmup = await browser.newContext({ viewport: { width: 1280, height: 900 } })
    const warmupPage = await warmup.newPage()
    await warmupPage.goto(`${baseUrl}?fixture=empty&picker=0`, { waitUntil: 'load' })
    await warmupPage.evaluate(() => document.fonts.ready)
    await warmup.close()
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
  const percentile = (values: number[], fraction: number) =>
    values[Math.min(values.length - 1, Math.ceil(values.length * fraction) - 1)] ?? 0
  const sortedInteractions = [...interactionTimings].sort((a, b) => a - b)
  assert(
    percentile(sortedInteractions, 0.95) < 250,
    `UI interaction p95 exceeded 250ms: ${percentile(sortedInteractions, 0.95).toFixed(0)}ms`,
  )
  console.log(
    `Render latency: median ${percentile(sorted, 0.5).toFixed(0)}ms, p95 ${percentile(sorted, 0.95).toFixed(0)}ms, max ${percentile(sorted, 1).toFixed(0)}ms`,
  )
  console.log(`Interaction latency: p95 ${percentile(sortedInteractions, 0.95).toFixed(0)}ms`)
  console.log(`UI screenshots: ${path.relative(process.cwd(), screenshots)}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
