#!/usr/bin/env node
// squid-perf / parse.mjs
// Stream a raw squid logs file and emit structured JSON per service.
//
// Usage:
//   node parse.mjs --input <raw-log-path> --output <json-path> --label <str>
//
// Schema of the output (stable across this skill's versions):
// {
//   meta: { label, sourceFile, parsedAt, captureStartedAt, captureTimeSource,
//           totalLines, parsedLines, skippedLines, earliestTs, latestTs,
//           earliestTsMs, latestTsMs, live, parserVersion },
//   services: {
//     "<service-name>": {
//       name, loggerFamily,
//       firstBlock, lastBlock, firstTsMs, lastTsMs,
//       firstProgressTsMs, lastProgressTsMs, progressCount,
//       progressSchema: ["tsMs","current","target","rate","mappingRate","itemsPerSec","etaSec","sequence"],
//       progressRows: [[tsMs, current, target, rate, mappingRate, itemsPerSec, etaSec, sequence], ...],
//       multicall: [{ tsMs, sequence, operation, block, chunks, groups, calls, latencyMs }, ...],
//       restarts: [{ rowIndex, tsMs, fromBlock, resumedAtBlock }, ...],
//       errorCount, levelCounts: { warning, error },
//       errors: [{ tsMs, level, logger, message }, ...]  // capped at 1000
//       tier3: { "<logger>": { count,
//         samples: [{ tsMs, sequence, fields: {unit: value, ...} }, ...],
//         syncSamples?: [{ tsMs, sequence, fields: {unit: value, ...} }, ...],
//         postRestartSamples?: [{ tsMs, sequence, fields: {unit: value, ...} }, ...] } }
//     }
//   }
// }

import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'

const PARSER_VERSION = 10

// Line shape:  <service> <ISO-TS>Z <LEVEL> <logger> <message...>
const LINE_RX =
  /^(\S+)\s+(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)\s+(TRACE|DEBUG|INFO|NOTICE|WARN|WARNING|ERROR|CRITICAL|FATAL)\s+(\S+)\s+(.*)$/

// `sqd logs` emits ANSI color escape codes (\x1b[NNm). Strip them before matching.
const ANSI_RX = /\x1b\[[0-9;]*m/g

// Progress message: "107000000 / 454805370, rate: 4 blocks/sec, mapping: 18 blocks/sec, 11 items/sec, eta: 0s"
// Tolerant: rate/mapping/items/eta may each be absent in older CLIs.
const PROGRESS_RX =
  /^(\d+)\s*\/\s*(\d+)(?:,\s*rate:\s*(\d+(?:\.\d+)?)\s*blocks\/sec)?(?:,\s*mapping:\s*(\d+(?:\.\d+)?)\s*blocks\/sec)?(?:,\s*(\d+(?:\.\d+)?)\s*items\/sec)?(?:,\s*eta:\s*(\S+))?/

const PROGRESS_LOGGERS = new Set(['sqd:processor', 'sqd:batch-processor', 'sqd:source-processor'])

const ERROR_LEVELS = new Set(['WARN', 'WARNING', 'ERROR', 'CRITICAL', 'FATAL'])

// Multicall: "processed loadOnchainMarketsInfo 454805261 at block 454805261: 131 chunks, 130 groups, 10010 total calls, 4536ms"
const MULTICALL_RX =
  /^processed\s+(\S+)\s+(\d+)\s+at\s+block\s+(\d+):\s+(\d+)\s+chunks?,\s+(\d+)\s+groups?,\s+(\d+)\s+total\s+calls?,\s+(\d+)\s*ms/

// Tier-3: extract "<number><unit>" and "<number> <unit>" pairs for any known unit.
const TIER3_NUMERIC_RX =
  /(\d+(?:\.\d+)?)\s*(ms|sec|seconds|blocks?|items?|calls?|chunks?|groups?|bytes?|kb|mb|gb|rows?|entities|prices|orders|trades|stats|fees|infos|actions)(?!\w)/gi

// Keep per-service errors & tier-3 samples bounded.
const MAX_ERRORS_PER_SERVICE = 1000
const MAX_TIER3_SAMPLES = 1000
const TIER3_MIN_COUNT = 10 // below this the logger is probably too noisy / too rare to surface
const CATCHUP_GAP_BLOCKS = 10

function parseTier3Fields(message) {
  const fields = {}
  for (const nm of message.matchAll(TIER3_NUMERIC_RX)) {
    const val = parseFloat(nm[1])
    const unit = nm[2].toLowerCase()
    if (!(unit in fields)) fields[unit] = val
  }
  return fields
}

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      out[a.slice(2)] = argv[i + 1]
      i++
    }
  }
  return out
}

function parseEta(str) {
  if (!str) return null
  let total = 0
  for (const m of str.matchAll(/(\d+)\s*(d|h|m|s)/g)) {
    total += parseInt(m[1], 10) * ({ d: 86400, h: 3600, m: 60, s: 1 }[m[2]] ?? 0)
  }
  return Number.isFinite(total) ? total : null
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const input = args.input
  const output = args.output
  if (!input || !output) {
    process.stderr.write('usage: parse.mjs --input <path> --output <path> [--label <str>]\n')
    process.exit(2)
  }
  const label = args.label || path.basename(input, path.extname(input))
  const parserStartedAtMs = Date.now()
  const captureStartPath = args['capture-start'] || `${input}.capture-start`
  let captureStartedAtMs = parserStartedAtMs
  let captureTimeSource = 'parser-start-fallback'
  if (fs.existsSync(captureStartPath)) {
    const captureStartedAt = fs.readFileSync(captureStartPath, 'utf8').trim()
    const parsedCaptureStartedAtMs = Date.parse(captureStartedAt)
    if (Number.isNaN(parsedCaptureStartedAtMs)) {
      throw new Error(`invalid capture-start timestamp in ${captureStartPath}`)
    }
    captureStartedAtMs = parsedCaptureStartedAtMs
    captureTimeSource = 'fetch-start'
  }

  fs.mkdirSync(path.dirname(output), { recursive: true })

  const services = new Map()
  let totalLines = 0,
    parsedLines = 0,
    skipped = 0
  let earliestTs = null,
    latestTs = null
  let previousInputTsMs = null
  let inputTimestampDirection = 0

  const stream = fs.createReadStream(input, { encoding: 'utf8' })
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity })

  for await (const rawLine of rl) {
    totalLines++
    const stripped =
      rawLine.length > 0 && rawLine.charCodeAt(rawLine.length - 1) === 13 ? rawLine.slice(0, -1) : rawLine
    const line = stripped.indexOf('\x1b') === -1 ? stripped : stripped.replace(ANSI_RX, '')
    if (!line) {
      skipped++
      continue
    }

    const m = line.match(LINE_RX)
    if (!m) {
      skipped++
      continue
    }

    const service = m[1]
    const tsStr = m[2]
    const level = m[3]
    const logger = m[4]
    const message = m[5]

    const tsMs = Date.parse(tsStr)
    if (Number.isNaN(tsMs)) {
      skipped++
      continue
    }

    parsedLines++
    if (inputTimestampDirection === 0 && previousInputTsMs != null && tsMs !== previousInputTsMs) {
      inputTimestampDirection = Math.sign(tsMs - previousInputTsMs)
    }
    previousInputTsMs = tsMs
    if (earliestTs === null || tsMs < earliestTs) earliestTs = tsMs
    if (latestTs === null || tsMs > latestTs) latestTs = tsMs

    let svc = services.get(service)
    if (!svc) {
      svc = {
        name: service,
        loggerFamily: null,
        progressRows: [],
        multicall: [],
        restarts: [],
        errorCount: 0,
        levelCounts: { warning: 0, error: 0 },
        errors: [],
        tier3: new Map(),
        firstTsMs: null,
        lastTsMs: null,
      }
      services.set(service, svc)
    }

    if (svc.firstTsMs === null || tsMs < svc.firstTsMs) svc.firstTsMs = tsMs
    if (svc.lastTsMs === null || tsMs > svc.lastTsMs) svc.lastTsMs = tsMs

    const isErrorLevel = ERROR_LEVELS.has(level)
    if (isErrorLevel) {
      svc.errorCount++
      if (level === 'WARN' || level === 'WARNING') svc.levelCounts.warning++
      else svc.levelCounts.error++
      if (svc.errors.length < MAX_ERRORS_PER_SERVICE) {
        svc.errors.push({
          tsMs,
          level,
          logger,
          message: message.length > 500 ? message.slice(0, 500) + '…' : message,
        })
      }
    }

    if (PROGRESS_LOGGERS.has(logger)) {
      if (!svc.loggerFamily) svc.loggerFamily = logger
      const pm = message.match(PROGRESS_RX)
      if (pm) {
        const current = parseInt(pm[1], 10)
        const target = parseInt(pm[2], 10)
        const rate = pm[3] != null ? parseFloat(pm[3]) : null
        const mappingRate = pm[4] != null ? parseFloat(pm[4]) : null
        const itemsPerSec = pm[5] != null ? parseFloat(pm[5]) : null
        const etaSec = pm[6] != null ? parseEta(pm[6]) : null

        // Restart detection happens AFTER sorting by tsMs (see below), since
        // `sqd logs` may emit lines in reverse chronological order.
        // Keep the input ordinal internally. `sqd logs` is normally newest-first,
        // including rows that share a timestamp, so a timestamp-only stable sort
        // can preserve those equal-timestamp rows in the wrong order.
        svc.progressRows.push([tsMs, current, target, rate, mappingRate, itemsPerSec, etaSec, totalLines])
      }
    } else if (logger === 'sqd:multicall') {
      const mm = message.match(MULTICALL_RX)
      if (mm) {
        svc.multicall.push({
          tsMs,
          sourceOrdinal: totalLines,
          operation: mm[1],
          block: parseInt(mm[3], 10),
          chunks: parseInt(mm[4], 10),
          groups: parseInt(mm[5], 10),
          calls: parseInt(mm[6], 10),
          latencyMs: parseInt(mm[7], 10),
        })
      }
    } else if (!isErrorLevel) {
      // Tier-3: any non-progress, non-multicall, non-error INFO line.
      let t3 = svc.tier3.get(logger)
      if (!t3) {
        t3 = { count: 0, samples: [] }
        svc.tier3.set(logger, t3)
      }
      t3.count++
      if (t3.samples.length < MAX_TIER3_SAMPLES) {
        const fields = parseTier3Fields(message)
        if (Object.keys(fields).length > 0) {
          t3.samples.push({ tsMs, sourceOrdinal: totalLines, fields })
        }
      }
    }
  }

  const live = latestTs != null && latestTs >= captureStartedAtMs - 60_000

  if (parsedLines === 0) {
    throw new Error(`no recognizable SQD log lines in ${input}`)
  }

  const out = {
    meta: {
      label,
      sourceFile: path.resolve(input),
      parsedAt: new Date().toISOString(),
      captureStartedAt: new Date(captureStartedAtMs).toISOString(),
      captureStartedAtMs,
      captureTimeSource,
      parserVersion: PARSER_VERSION,
      totalLines,
      parsedLines,
      skippedLines: skipped,
      earliestTs: earliestTs != null ? new Date(earliestTs).toISOString() : null,
      latestTs: latestTs != null ? new Date(latestTs).toISOString() : null,
      earliestTsMs: earliestTs,
      latestTsMs: latestTs,
      live,
    },
    services: {},
  }

  const serviceDirections = new Map()
  for (const [name, svc] of services) {
    // `sqd logs` can emit entries in reverse chronological order, so sort all
    // time-series arrays ascending by tsMs before emitting.
    let serviceInputDirection = 0
    for (let i = 1; i < svc.progressRows.length; i++) {
      const tsDelta = svc.progressRows[i][0] - svc.progressRows[i - 1][0]
      if (tsDelta !== 0) {
        serviceInputDirection = Math.sign(tsDelta)
        break
      }
    }
    // With no unequal timestamps there is no evidence that input is reversed.
    // Preserve source order rather than inventing rollbacks.
    const direction = serviceInputDirection || inputTimestampDirection || 1
    serviceDirections.set(name, direction)
    svc.progressRows.sort((a, b) => a[0] - b[0] || (direction < 0 ? b[7] - a[7] : a[7] - b[7]))
    svc.progressRows = svc.progressRows.map((row) => [...row.slice(0, 7), direction < 0 ? -row[7] : row[7]])
    for (const sample of svc.multicall) {
      sample.sequence = direction < 0 ? -sample.sourceOrdinal : sample.sourceOrdinal
      delete sample.sourceOrdinal
    }
    svc.multicall.sort((a, b) => a.tsMs - b.tsMs || a.sequence - b.sequence)
    svc.errors.sort((a, b) => a.tsMs - b.tsMs)
    for (const t3 of svc.tier3.values()) {
      for (const sample of t3.samples) {
        sample.sequence = direction < 0 ? -sample.sourceOrdinal : sample.sourceOrdinal
        delete sample.sourceOrdinal
      }
      t3.samples.sort((a, b) => a.tsMs - b.tsMs || a.sequence - b.sequence)
    }

    // Restart detection in chronological order: any strict backward block jump.
    // Equal block numbers are normal while caught up and are not restarts.
    for (let i = 1; i < svc.progressRows.length; i++) {
      const prev = svc.progressRows[i - 1]
      const curr = svc.progressRows[i]
      if (curr[1] < prev[1]) {
        svc.restarts.push({
          rowIndex: i,
          tsMs: curr[0],
          sequence: curr[7],
          fromBlock: prev[1],
          resumedAtBlock: curr[1],
        })
      }
    }

    const progressCount = svc.progressRows.length
    out.services[name] = {
      name,
      loggerFamily: svc.loggerFamily,
      firstBlock: progressCount ? svc.progressRows[0][1] : null,
      lastBlock: progressCount ? svc.progressRows[progressCount - 1][1] : null,
      firstTsMs: svc.firstTsMs,
      lastTsMs: svc.lastTsMs,
      firstProgressTsMs: progressCount ? svc.progressRows[0][0] : null,
      lastProgressTsMs: progressCount ? svc.progressRows[progressCount - 1][0] : null,
      progressCount,
      progressSchema: ['tsMs', 'current', 'target', 'rate', 'mappingRate', 'itemsPerSec', 'etaSec', 'sequence'],
      progressRows: svc.progressRows,
      multicall: svc.multicall,
      restarts: svc.restarts,
      errorCount: svc.errorCount,
      levelCounts: svc.levelCounts,
      errors: svc.errors,
      tier3: Object.fromEntries(
        [...svc.tier3.entries()].filter(([, v]) => v.count >= TIER3_MIN_COUNT).map(([k, v]) => [k, v]),
      ),
    }
  }

  // Retain a second bounded Tier-3 sample drawn specifically from the measured
  // sync window. The raw sample above preserves the historical whole-log
  // behavior for explicit range overrides, but a newest-first capture can fill
  // that cap with idle-tail lines before older sync lines are encountered.
  const syncWindows = new Map()
  for (const [name, service] of Object.entries(out.services)) {
    if (service.progressCount === 0 || Object.keys(service.tier3).length === 0) continue
    const latestRestart = service.restarts.length > 0 ? service.restarts[service.restarts.length - 1] : null
    const rows = latestRestart ? service.progressRows.slice(latestRestart.rowIndex) : service.progressRows
    if (rows.length === 0) continue
    let catchupRow = null
    for (const row of rows) {
      const current = row[1]
      const target = row[2]
      if (target != null && target > 0 && target - current <= CATCHUP_GAP_BLOCKS) {
        catchupRow = row
        break
      }
    }
    const start = rows[0]
    // A catch-up row at index zero means the capture contains steady-state
    // activity only, so retain the full post-start window as the report does.
    const end = catchupRow === start ? null : catchupRow
    syncWindows.set(name, {
      direction: serviceDirections.get(name) || 1,
      hasRestart: latestRestart != null,
      startTsMs: start[0],
      startSequence: start[7],
      endTsMs: end?.[0] ?? null,
      endSequence: end?.[7] ?? null,
    })
    for (const t3 of Object.values(service.tier3)) {
      t3.syncSamples = []
      if (latestRestart != null) t3.postRestartSamples = []
    }
  }

  if (syncWindows.size > 0) {
    const sampleStream = fs.createReadStream(input, { encoding: 'utf8' })
    const sampleLines = readline.createInterface({ input: sampleStream, crlfDelay: Infinity })
    let sourceOrdinal = 0
    for await (const rawLine of sampleLines) {
      sourceOrdinal++
      const line = rawLine.replace(ANSI_RX, '')
      const match = line.match(LINE_RX)
      if (!match) continue
      const serviceName = match[1]
      const window = syncWindows.get(serviceName)
      if (!window) continue
      const level = match[3]
      const logger = match[4]
      if (ERROR_LEVELS.has(level) || PROGRESS_LOGGERS.has(logger) || logger === 'sqd:multicall') continue
      const t3 = out.services[serviceName].tier3[logger]
      if (!t3) continue
      const needsSyncSample = t3.syncSamples.length < MAX_TIER3_SAMPLES
      const needsPostRestartSample = window.hasRestart && t3.postRestartSamples.length < MAX_TIER3_SAMPLES
      if (!needsSyncSample && !needsPostRestartSample) continue
      const tsMs = Date.parse(match[2])
      if (Number.isNaN(tsMs)) continue
      const sequence = window.direction < 0 ? -sourceOrdinal : sourceOrdinal
      const atOrAfterStart = tsMs > window.startTsMs || (tsMs === window.startTsMs && sequence >= window.startSequence)
      const atOrBeforeEnd =
        window.endTsMs == null || tsMs < window.endTsMs || (tsMs === window.endTsMs && sequence <= window.endSequence)
      if (!atOrAfterStart) continue
      const fields = parseTier3Fields(match[5])
      if (Object.keys(fields).length === 0) continue
      const sample = { tsMs, sequence, fields }
      if (needsSyncSample && atOrBeforeEnd) t3.syncSamples.push(sample)
      if (needsPostRestartSample) t3.postRestartSamples.push(sample)
    }
    for (const service of Object.values(out.services)) {
      for (const t3 of Object.values(service.tier3)) {
        for (const samples of [t3.syncSamples, t3.postRestartSamples]) {
          if (!Array.isArray(samples)) continue
          samples.sort((a, b) => a.tsMs - b.tsMs || a.sequence - b.sequence)
        }
      }
    }
  }

  fs.writeFileSync(output, JSON.stringify(out))

  const totalProgress = Object.values(out.services).reduce((a, s) => a + s.progressCount, 0)
  const serviceSummary = Object.values(out.services)
    .map((s) => `${s.name}=${s.progressCount}`)
    .join(', ')

  process.stderr.write(
    `parse [${label}] ok — ${parsedLines}/${totalLines} lines parsed, ${skipped} skipped, ` +
      `${Object.keys(out.services).length} services, ${totalProgress} progress rows [${serviceSummary}]\n`,
  )
}

main().catch((err) => {
  process.stderr.write(`parse: ${err && err.stack ? err.stack : err}\n`)
  process.exit(1)
})
