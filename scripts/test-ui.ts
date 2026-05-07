#!/usr/bin/env tsx

import { mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { chromium, type Browser, type Page } from 'playwright'

import { UI_FIXTURES, type UiFixture } from '../src/ui/fixtures.js'

type ViewportCase = {
  name: string
  width: number
  height: number
  colorScheme: 'light' | 'dark'
  fixtures?: Set<string>
}

type CanvasStats = {
  width: number
  height: number
  sampled: number
  colored: number
  uniqueBuckets: number
  variance: number
}

type ChartStats = {
  kind: string
  width: number
  height: number
  canvasCount: number
  yAxisLabels: string[]
  yAxisOverflow: number
  currentValueMarkers: number
  colored: number
  uniqueBuckets: number
  maxVariance: number
  canvases: CanvasStats[]
}

type LayoutIssue = {
  kind: string
  label: string
  detail: string
}

const PREVIEW_HTML = path.join(process.cwd(), '.preview/index.html')
const ARTIFACT_DIR = path.join(process.cwd(), 'output/playwright/ui')

const VIEWPORTS: ViewportCase[] = [
  { name: 'desktop-light', width: 1366, height: 900, colorScheme: 'light' },
  { name: 'desktop-dark', width: 1366, height: 900, colorScheme: 'dark' },
  {
    name: 'mobile-light',
    width: 390,
    height: 844,
    colorScheme: 'light',
    fixtures: new Set(['full', 'candlestick', 'table', 'kpi', 'stress']),
  },
]

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function fixtureUrl(fixture: UiFixture) {
  const url = pathToFileURL(PREVIEW_HTML)
  return `${url.href}?fixture=${encodeURIComponent(fixture.id)}`
}

async function collectChartStats(page: Page): Promise<ChartStats[]> {
  return page.locator('.pt-wick-chart').evaluateAll((charts) =>
    charts.map((chart) => {
      const rect = chart.getBoundingClientRect()
      const canvases = Array.from(chart.querySelectorAll('canvas'))
      const yAxisLabels = Array.from(chart.querySelectorAll('span'))
        .map((label) => ({
          text: label.textContent?.trim() || '',
          rect: label.getBoundingClientRect(),
          position: getComputedStyle(label).position,
        }))
        .filter((label) =>
          label.text.length > 0 &&
          label.position === 'absolute' &&
          label.rect.left >= rect.right - 110 &&
          label.rect.right <= rect.right + 1 &&
          label.rect.top >= rect.top - 1 &&
          label.rect.top < rect.bottom - 40
        )
      const yAxisOverflow = yAxisLabels.filter((label) => label.rect.left < rect.left || label.rect.right > rect.right + 1).length
      const currentValueMarkers = Array.from(chart.querySelectorAll('div')).filter((marker) => {
        const markerRect = marker.getBoundingClientRect()
        const style = getComputedStyle(marker)
        return (
          markerRect.width >= 28 &&
          markerRect.height >= 16 &&
          markerRect.left >= rect.right - 120 &&
          markerRect.right <= rect.right + 1 &&
          markerRect.top >= rect.top &&
          markerRect.bottom <= rect.bottom &&
          style.position === 'absolute' &&
          style.zIndex === '3' &&
          style.backgroundColor !== 'rgba(0, 0, 0, 0)'
        )
      }).length

      const canvasStats = canvases.map((canvas) => {
        const ctx = canvas.getContext('2d', { willReadFrequently: true })
        const width = canvas.width
        const height = canvas.height
        if (!ctx || width <= 0 || height <= 0) {
          return {
            width,
            height,
            sampled: 0,
            colored: 0,
            uniqueBuckets: 0,
            variance: 0,
          }
        }

        const pixels = ctx.getImageData(0, 0, width, height).data
        const step = Math.max(1, Math.floor((width * height) / 18_000))
        const buckets = new Set<string>()
        let sampled = 0
        let colored = 0
        let sum = 0
        let sumSq = 0

        for (let p = 0; p < width * height; p += step) {
          const index = p * 4
          const r = pixels[index] ?? 0
          const g = pixels[index + 1] ?? 0
          const b = pixels[index + 2] ?? 0
          const a = pixels[index + 3] ?? 0
          const luma = (r + g + b) / 3
          sampled += 1
          sum += luma
          sumSq += luma * luma
          if (a > 8 && (r > 8 || g > 8 || b > 8)) colored += 1
          buckets.add(`${r >> 4}:${g >> 4}:${b >> 4}:${a >> 6}`)
        }

        const mean = sampled ? sum / sampled : 0
        const variance = sampled ? sumSq / sampled - mean * mean : 0
        return {
          width,
          height,
          sampled,
          colored,
          uniqueBuckets: buckets.size,
          variance,
        }
      })

      return {
        kind: chart.getAttribute('data-chart-kind') || '',
        width: rect.width,
        height: rect.height,
        canvasCount: canvases.length,
        yAxisLabels: yAxisLabels.map((label) => label.text),
        yAxisOverflow,
        currentValueMarkers,
        colored: canvasStats.reduce((total, item) => total + item.colored, 0),
        uniqueBuckets: canvasStats.reduce((total, item) => total + item.uniqueBuckets, 0),
        maxVariance: Math.max(0, ...canvasStats.map((item) => item.variance)),
        canvases: canvasStats,
      }
    }),
  )
}

async function collectAllCanvasStats(page: Page): Promise<CanvasStats[]> {
  return page.locator('canvas').evaluateAll((nodes) =>
    nodes.map((node) => {
      const canvas = node as HTMLCanvasElement
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      const width = canvas.width
      const height = canvas.height
      if (!ctx || width <= 0 || height <= 0) {
        return { width, height, sampled: 0, colored: 0, uniqueBuckets: 0, variance: 0 }
      }

      const pixels = ctx.getImageData(0, 0, width, height).data
      const step = Math.max(1, Math.floor((width * height) / 6_000))
      const buckets = new Set<string>()
      let sampled = 0
      let colored = 0
      let sum = 0
      let sumSq = 0
      for (let p = 0; p < width * height; p += step) {
        const index = p * 4
        const r = pixels[index] ?? 0
        const g = pixels[index + 1] ?? 0
        const b = pixels[index + 2] ?? 0
        const a = pixels[index + 3] ?? 0
        const luma = (r + g + b) / 3
        sampled += 1
        sum += luma
        sumSq += luma * luma
        if (a > 8 && (r > 8 || g > 8 || b > 8)) colored += 1
        buckets.add(`${r >> 4}:${g >> 4}:${b >> 4}:${a >> 6}`)
      }
      const mean = sampled ? sum / sampled : 0
      const variance = sampled ? sumSq / sampled - mean * mean : 0
      return { width, height, sampled, colored, uniqueBuckets: buckets.size, variance }
    }),
  )
}

async function assertChartInteraction(page: Page, fixture: UiFixture) {
  const chart = page.locator('.pt-wick-chart').first()
  const box = await chart.boundingBox()
  assert(box, `${fixture.id}: chart has no bounding box`)

  const before = await chart.screenshot()
  await page.mouse.move(box.x + box.width * 0.52, box.y + box.height * 0.45)
  await page.waitForTimeout(120)
  const after = await chart.screenshot()

  assert(
    !before.equals(after),
    `${fixture.id}: chart did not visually react to hover/crosshair movement`,
  )
}

async function assertLayoutIntegrity(page: Page, fixture: UiFixture, viewport: ViewportCase) {
  const issues = (await page.evaluate(`
    (() => {
      const found = []
      const viewportWidth = document.documentElement.clientWidth
      const scrollWidth = document.documentElement.scrollWidth

      if (scrollWidth > viewportWidth + 2) {
        found.push({
          kind: 'horizontal-overflow',
          label: 'document',
          detail: scrollWidth + 'px scroll width on ' + viewportWidth + 'px viewport',
        })
      }

      const labelFor = (element) => {
        const text = (element.textContent || '').trim().replace(/\\s+/g, ' ') || element.className.toString()
        return text.length > 60 ? text.slice(0, 57) + '...' : text
      }

      const checkTextFit = (selector) => {
        for (const element of Array.from(document.querySelectorAll(selector))) {
          if (element.offsetParent === null) continue
          const horizontalClip = element.scrollWidth - element.clientWidth > 2
          const verticalClip = element.scrollHeight - element.clientHeight > 2
          if (horizontalClip || verticalClip) {
            found.push({
              kind: 'text-clipped',
              label: labelFor(element),
              detail:
                selector +
                ' scroll ' +
                element.scrollWidth +
                'x' +
                element.scrollHeight +
                ', client ' +
                element.clientWidth +
                'x' +
                element.clientHeight,
            })
          }
        }
      }

      checkTextFit('.pt-btn')
      checkTextFit('.pt-badge')
      checkTextFit('.pt-preview-picker button')
      checkTextFit('.pt-input')

      for (const element of Array.from(document.querySelectorAll('.pt-card, .pt-header, .pt-state'))) {
        const rect = element.getBoundingClientRect()
        if (rect.width <= 0 || rect.height <= 0) {
          found.push({
            kind: 'collapsed-element',
            label: labelFor(element),
            detail: rect.width.toFixed(1) + 'x' + rect.height.toFixed(1),
          })
        }
        if (rect.left < -1 || rect.right > viewportWidth + 1) {
          found.push({
            kind: 'viewport-overflow',
            label: labelFor(element),
            detail:
              'left ' +
              rect.left.toFixed(1) +
              ', right ' +
              rect.right.toFixed(1) +
              ', viewport ' +
              viewportWidth,
          })
        }
      }

      const cards = Array.from(document.querySelectorAll('.pt-panels > .pt-card'))
        .map((element) => ({ element, rect: element.getBoundingClientRect() }))
        .filter(({ rect }) => rect.width > 0 && rect.height > 0)

      for (let i = 0; i < cards.length; i += 1) {
        for (let j = i + 1; j < cards.length; j += 1) {
          const first = cards[i]
          const second = cards[j]
          const overlapX = Math.max(
            0,
            Math.min(first.rect.right, second.rect.right) - Math.max(first.rect.left, second.rect.left),
          )
          const overlapY = Math.max(
            0,
            Math.min(first.rect.bottom, second.rect.bottom) - Math.max(first.rect.top, second.rect.top),
          )
          if (overlapX * overlapY > 4) {
            found.push({
              kind: 'panel-overlap',
              label: labelFor(first.element) + ' / ' + labelFor(second.element),
              detail: overlapX.toFixed(1) + 'x' + overlapY.toFixed(1) + ' overlap',
            })
          }
        }
      }

      return found
    })()
  `)) as LayoutIssue[]

  assert(
    issues.length === 0,
    `${fixture.id} ${viewport.name}: layout integrity failed: ${issues
      .map((issue) => `${issue.kind} (${issue.label}: ${issue.detail})`)
      .join(' | ')}`,
  )
}

async function assertPreviewSwitcher(browser: Browser) {
  const viewport = VIEWPORTS[0]!
  const page = await browser.newPage({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 1,
    colorScheme: viewport.colorScheme,
  })
  const consoleErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('pageerror', (error) => consoleErrors.push(error.message))

  try {
    await page.goto(fixtureUrl(UI_FIXTURES[0]!), { waitUntil: 'load' })
    await page.waitForSelector('.pt-app', { timeout: 10_000 })

    for (const fixture of UI_FIXTURES) {
      await page.getByRole('button', { name: fixture.label }).click()
      await page.waitForTimeout(120)
      assert(consoleErrors.length === 0, `preview switcher ${fixture.id}: console errors: ${consoleErrors.join(' | ')}`)
      const cards = await page.locator('.pt-card').count()
      assert(cards > 0, `preview switcher ${fixture.id}: expected rendered cards`)
      await assertLayoutIntegrity(page, fixture, viewport)
    }

    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'desktop-light-switcher-final.png'), fullPage: true })
  } finally {
    await page.close()
  }
}

async function runFixture(browser: Browser, fixture: UiFixture, viewport: ViewportCase) {
  const page = await browser.newPage({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 1,
    colorScheme: viewport.colorScheme,
  })
  const consoleErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('pageerror', (error) => consoleErrors.push(error.message))

  try {
    await page.goto(fixtureUrl(fixture), { waitUntil: 'load' })
    await page.waitForSelector('.pt-app', { timeout: 10_000 })
    await page.waitForTimeout(250)

    assert(consoleErrors.length === 0, `${fixture.id}: console errors: ${consoleErrors.join(' | ')}`)

    const cards = await page.locator('.pt-card').count()
    assert(cards > 0, `${fixture.id}: expected at least one rendered card`)
    await assertLayoutIntegrity(page, fixture, viewport)

    const screenshotPath = path.join(ARTIFACT_DIR, `${viewport.name}-${fixture.id}.png`)
    await page.screenshot({ path: screenshotPath, fullPage: true })

    if (fixture.expected.tables) {
      const tables = await page.locator('table.pt-table').count()
      assert(tables >= fixture.expected.tables, `${fixture.id}: expected ${fixture.expected.tables} table(s), got ${tables}`)
    }

    if (fixture.expected.charts > 0) {
      await page.waitForFunction(
        (expected) => {
          const charts = Array.from(document.querySelectorAll('.pt-wick-chart'))
          return charts.length >= expected && charts.every((chart) => {
            const rect = chart.getBoundingClientRect()
            return rect.width >= 240 && rect.height >= 220 && chart.querySelectorAll('canvas').length > 0
          })
        },
        fixture.expected.charts,
        { timeout: 10_000 },
      )

      const stats = await collectChartStats(page)
      assert(stats.length >= fixture.expected.charts, `${fixture.id}: expected ${fixture.expected.charts} chart(s), got ${stats.length}`)

      stats.forEach((stat, index) => {
        assert(stat.width >= 240, `${fixture.id}: chart ${index + 1} is too narrow (${stat.width}px)`)
        assert(stat.height >= 220, `${fixture.id}: chart ${index + 1} is too short (${stat.height}px)`)
        assert(stat.canvasCount > 0, `${fixture.id}: chart ${index + 1} has no canvas`)
        assert(stat.yAxisLabels.length >= 2, `${fixture.id}: chart ${index + 1} is missing readable y-axis labels`)
        assert(stat.yAxisOverflow === 0, `${fixture.id}: chart ${index + 1} has overflowing y-axis labels`)
        if (stat.kind !== 'bar') {
          assert(stat.currentValueMarkers >= 1, `${fixture.id}: chart ${index + 1} is missing a current-value marker`)
        }
        assert(
          stat.yAxisLabels.every((label) => !/\d,\d{3},\d{3}/.test(label)),
          `${fixture.id}: chart ${index + 1} y-axis labels are too verbose (${stat.yAxisLabels.join(', ')})`,
        )
        assert(stat.colored > 80, `${fixture.id}: chart ${index + 1} looks blank (${stat.colored} colored samples)`)
        assert(stat.uniqueBuckets >= 4, `${fixture.id}: chart ${index + 1} has too little pixel variety (${stat.uniqueBuckets} buckets)`)
        assert(stat.maxVariance > 4, `${fixture.id}: chart ${index + 1} has too little visual variance (${stat.maxVariance.toFixed(2)})`)
      })

      if (viewport.name === 'desktop-light') {
        await assertChartInteraction(page, fixture)
      }
    }

    if (fixture.expected.canvases) {
      const canvases = await collectAllCanvasStats(page)
      const visible = canvases.filter((canvas) => canvas.width > 0 && canvas.height > 0 && canvas.colored > 15)
      assert(
        visible.length >= fixture.expected.canvases,
        `${fixture.id}: expected ${fixture.expected.canvases} visible canvas chart(s), got ${visible.length}`,
      )
    }
  } finally {
    await page.close()
  }
}

async function main() {
  await rm(ARTIFACT_DIR, { recursive: true, force: true })
  await mkdir(ARTIFACT_DIR, { recursive: true })

  const browser = await chromium.launch()
  const failures: string[] = []

  try {
    for (const fixture of UI_FIXTURES) {
      for (const viewport of VIEWPORTS) {
        if (viewport.fixtures && !viewport.fixtures.has(fixture.id)) continue
        try {
          await runFixture(browser, fixture, viewport)
          console.log(`PASS  ${viewport.name} ${fixture.id}`)
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          failures.push(`${viewport.name} ${fixture.id}: ${message}`)
          console.log(`FAIL  ${viewport.name} ${fixture.id}`)
          console.log(`      ${message}`)
        }
      }
    }

    try {
      await assertPreviewSwitcher(browser)
      console.log('PASS  desktop-light fixture-switcher')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      failures.push(`desktop-light fixture-switcher: ${message}`)
      console.log('FAIL  desktop-light fixture-switcher')
      console.log(`      ${message}`)
    }
  } finally {
    await browser.close()
  }

  console.log('\nUI screenshots:', path.relative(process.cwd(), ARTIFACT_DIR))

  if (failures.length) {
    console.log('\nFailures:')
    failures.forEach((failure) => console.log(`  - ${failure}`))
    process.exit(1)
  }

  console.log('\nUI visual smoke tests passed.')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
