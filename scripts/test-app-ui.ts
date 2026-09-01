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
const viewports = [
  { name: 'desktop-light', width: 1280, height: 900, colorScheme: 'light' as const },
  { name: 'desktop-dark', width: 1280, height: 900, colorScheme: 'dark' as const },
  { name: 'mobile-light', width: 390, height: 844, colorScheme: 'light' as const },
]
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
    if (!request.url().startsWith(baseUrl)) externalRequests.push(request.url())
  })
  const startedAt = performance.now()
  await page.goto(`${baseUrl}?fixture=${fixture}`, { waitUntil: 'load' })
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
    const body = getComputedStyle(document.body)
    const title = getComputedStyle(document.querySelector('.sqd-title')!)
    const mono = getComputedStyle(document.querySelector('.sqd-footer')!)
    const root = getComputedStyle(document.documentElement)
    const card = document.querySelector('.sqd-card')
    const tableHeader = document.querySelector('.sqd-table th')
    const cardStyle = card ? getComputedStyle(card) : undefined
    const tableHeaderStyle = tableHeader ? getComputedStyle(tableHeader) : undefined
    return {
      background: body.backgroundColor,
      foreground: body.color,
      bodyFont: body.fontFamily,
      titleWeight: title.fontWeight,
      monoFont: mono.fontFamily,
      accent: root.getPropertyValue('--accent').trim(),
      successFill: root.getPropertyValue('--success-fill').trim(),
      warningFill: root.getPropertyValue('--warning-fill').trim(),
      dangerFill: root.getPropertyValue('--danger-fill').trim(),
      chartSeries: ['--chart-1', '--chart-2', '--chart-3', '--chart-4', '--chart-5'].map((token) =>
        root.getPropertyValue(token).trim(),
      ),
      colorScheme: root.colorScheme,
      cardBackground: cardStyle?.backgroundColor,
      cardRadius: cardStyle?.borderRadius,
      tableHeaderFont: tableHeaderStyle?.fontFamily,
      tableHeaderWeight: tableHeaderStyle?.fontWeight,
      tableHeaderTracking: tableHeaderStyle?.letterSpacing,
    }
  })
  assert(design.background === 'rgb(8, 9, 10)', `${fixture} should use SQD dark surface #08090a`)
  assert(design.foreground === 'rgb(247, 248, 248)', `${fixture} should use the SQD foreground token`)
  assert(design.bodyFont.startsWith('"Inter SQD"'), `${fixture} should render with embedded Inter`)
  assert(design.monoFont.startsWith('"JetBrains Mono SQD"'), `${fixture} evidence metadata should use JetBrains Mono`)
  assert(design.titleWeight === '510', `${fixture} headings should use SQD weight 510`)
  assert(design.accent === '#818cf8', `${fixture} should use SQD indigo #818cf8`)
  assert(design.successFill === '#16a34a', `${fixture} should use the SQD success fill token`)
  assert(design.warningFill === '#f59e0b', `${fixture} should use the SQD warning fill token`)
  assert(design.dangerFill === '#ef4444', `${fixture} should use the SQD danger fill token`)
  assert(
    JSON.stringify(design.chartSeries) === JSON.stringify(['#6366f1', '#0891b2', '#d97706', '#16a34a', '#8b5cf6']),
    `${fixture} co-equal series must follow tokens/chart-palette.json line_bar_area order (got ${design.chartSeries.join(', ')})`,
  )
  assert(design.colorScheme === 'dark', `${fixture} should remain an intentional dark product surface`)
  if (design.cardBackground) {
    assert(design.cardBackground === 'rgb(19, 19, 22)', `${fixture} cards should use SQD raised surface #131316`)
    assert(design.cardRadius === '12px', `${fixture} cards should use the SQD pane radius`)
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
  assert((await page.locator('h1').count()) === 1, `${fixture} should expose one result heading`)
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  assert(overflow <= 2, `${fixture} ${viewport.name} overflows horizontally by ${overflow}px`)
  const emptyCards = await page
    .locator('.sqd-card')
    .evaluateAll((cards) => cards.filter((card) => card.getBoundingClientRect().height < 40).length)
  assert(emptyCards === 0, `${fixture} ${viewport.name} has collapsed evidence cards`)
  await page.locator('.sqd-preview-picker').evaluate((node) => node.setAttribute('hidden', ''))
  await page.screenshot({ path: path.join(screenshots, `${viewport.name}-${fixture}.png`), fullPage: true })
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
    assert(
      (await finalPoint.getAttribute('aria-label'))?.includes('WETH per TOKEN'),
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
    assert(Number(final) === expected.at(-1)?.close, 'Hyperliquid final candle should match the pinned Portal row')
    const hit = page.locator('.sqd-chart-hit').last()
    const interactionStarted = performance.now()
    await hit.focus()
    interactionTimings.push(performance.now() - interactionStarted)
    assert(
      await page.locator('.sqd-chart-tooltip').isVisible(),
      'Hyperliquid keyboard focus should expose exact candle values',
    )
    const tooltipText = await page.locator('.sqd-chart-tooltip').innerText()
    assert(
      tooltipText.includes('Fills') && tooltipText.includes('VWAP'),
      'Hyperliquid point inspection should expose every promised field',
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
    assert((await receipt.innerText()).includes('SHA-256'), 'Evidence receipt should expose a short exact-data digest')
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
    assert(
      Number(await page.locator('.sqd-chart-line').getAttribute('data-point-count')) === expected.length,
      'Time-series line should contain every source point',
    )
    assert(
      Number(await page.locator('[data-final-value]').getAttribute('data-final-value')) === expected.at(-1)?.value,
      'Time-series final value should match structured content',
    )
    const ranges = page.locator('.sqd-range')
    assert((await ranges.count()) === 2, 'long charts should expose an exact start and end range')
    await ranges.nth(0).fill('6')
    await ranges.nth(1).fill('11')
    await page.getByRole('button', { name: 'Focus range' }).click()
    assert(
      (await page.locator('.sqd-chart-hit').count()) === 6,
      'range focus should redraw only the selected six points',
    )
    assert(
      (await page.locator('table.sqd-table tbody tr').count()) === Math.min(10, expected.length),
      'range focus must keep the current exact evidence page',
    )
    if (expected.length > 10) {
      assert(
        await page.locator('.sqd-table-pagination').isVisible(),
        'long chart evidence must remain reachable through table pages',
      )
    }
    await page.getByRole('button', { name: 'Reset range' }).click()
    assert((await page.locator('.sqd-chart-hit').count()) === expected.length, 'reset range should restore every point')
  }
  if (fixture === 'grouped') {
    const rows = APP_FIXTURES.grouped.time_series as Array<{ series_values: Record<string, number> }>
    const keys = ['transfers', 'swaps', 'contract_calls']
    assert(
      (await page.locator('.sqd-chart-legend-item').count()) === keys.length,
      'Grouped charts should expose every series',
    )
    const renderedTotals = await page
      .locator('[data-series-total]')
      .evaluateAll((nodes) => nodes.map((node) => Number(node.getAttribute('data-series-total'))))
    const expectedTotals = keys.map((key) => rows.reduce((sum, row) => sum + row.series_values[key], 0))
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
    assert(
      (await page.locator('table.sqd-table').innerText()).includes('0.000000009 USDC'),
      'Activity tables should keep exact tiny non-zero amounts',
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
      (await page.locator('table.sqd-table tbody tr').count()) === WALLET_FIXTURE_ROW_COUNT,
      'wallet table should preserve every exact activity row',
    )
    assert(
      (await page.locator('.sqd-ranked-row').count()) === 3,
      'wallet workspace should rank the exact counterparties',
    )
  }
  if (fixture === 'contract') {
    assert(
      (await page.locator('.sqd-metric').count()) === 4,
      'contract workspace should expose interactions, callers, events, and event types',
    )
    assert((await page.locator('.sqd-card').count()) === 2, 'contract workspace should compare callers and event types')
    assert(
      (await page.locator('.sqd-ranked-row').count()) === 7,
      'contract workspace should retain four callers and three event types',
    )
  }
  if (fixture === 'large_table') {
    const rows = APP_FIXTURES.large_table.items as Array<Record<string, unknown>>
    assert((await page.locator('table.sqd-table tbody tr').count()) === 10, 'Large tables should use short local pages')
    assert(
      (await page.locator('.sqd-display-limit').innerText()).includes('10 of 125'),
      'Large tables should disclose the local page size',
    )
    assert(
      (await page.locator('.sqd-table-pagination').innerText()).includes('Page 1 of 13'),
      'Large tables should expose page state',
    )
    await page.getByRole('button', { name: 'Next rows' }).click()
    assert(
      (await page.locator('.sqd-table-pagination').innerText()).includes('Page 2 of 13'),
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
    assert(observedPages === 13, `Large table should paginate into 13 short pages, walked ${observedPages}`)
    assert(walkedKeys.length === rows.length, `Pagination should expose all ${rows.length} exact rows, saw ${walkedKeys.length}`)
    assert(
      new Set(walkedKeys).size === rows.length && !walkedKeys.includes(''),
      'Pagination must expose every exact row key exactly once, with no gaps or duplicates',
    )
  }
  if (fixture === 'partial') {
    assert(
      (await page.locator('.sqd-display-limit').innerText()).includes('8 of 40 declared'),
      'Partial results must disclose declared against present rows',
    )
    assert(
      (await page.locator('.sqd-context').innerText()).includes('partial'),
      'Partial results must be labeled partial next to the headline',
    )
    const continueButton = page.getByRole('button', { name: 'Load the next rows' })
    assert(
      (await continueButton.count()) === 1 && (await continueButton.isEnabled()),
      'Partial results should offer an enabled continuation action',
    )
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

let baseUrl = ''

async function main() {
  const wallet = APP_FIXTURES.wallet as Record<string, any>
  const walletRows = wallet.activity.items as Array<Record<string, any>>
  assert(
    wallet.fund_flow.summary.total_in_usd ===
      walletRows.filter((row) => row.direction === 'in').reduce((sum, row) => sum + row.value_usd, 0),
    'Wallet inbound total must reconcile with exact rows',
  )
  assert(
    wallet.fund_flow.summary.total_out_usd ===
      walletRows.filter((row) => row.direction === 'out').reduce((sum, row) => sum + row.value_usd, 0),
    'Wallet outbound total must reconcile with exact rows',
  )
  const contract = APP_FIXTURES.contract as Record<string, any>
  assert(
    contract.interactions.total_transactions ===
      contract.interactions.top_callers.reduce((sum: number, row: any) => sum + row.interaction_count, 0),
    'Contract interaction total must reconcile with callers',
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
    hyperliquid.summary.total_volume ===
      Number(hyperliquid.ohlc.reduce((sum: number, row: any) => sum + row.volume, 0).toFixed(2)),
    'Hyperliquid fixture volume must reconcile with its pinned rows',
  )
  const timeseries = APP_FIXTURES.timeseries as Record<string, any>
  assert(
    timeseries.summary.total === timeseries.time_series.reduce((sum: number, row: any) => sum + row.value, 0),
    'Time-series fixture total must reconcile with its rows',
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
    await warmupPage.goto(`${baseUrl}?fixture=empty`, { waitUntil: 'load' })
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
