/*
 * A ceiling an operator can set on what one tool call may cost upstream,
 * without cutting a release.
 *
 * Every bound the server has today is compiled in, and they are per tool
 * rather than per class: a filtered trace scan stops at 5,000 blocks, a
 * contract-deployment search at 1,000,000, a Tron log scan at 50,000. Those
 * stay exactly as they are. This adds a second ceiling above them that a
 * deployment sets from the environment, so a hosted endpoint under load can be
 * turned down without shipping an image.
 *
 * There is no numeric default. A class with nothing configured has no extra
 * ceiling, which is what makes `off` and `enforce` with default settings the
 * same server: the only way a guardrail can change behaviour is if somebody
 * set a number. Collapsing the per-tool bounds into one number per class would
 * either loosen the tight tools or tighten the loose ones, and both would be a
 * behaviour change hiding inside a default.
 *
 * Enforcement never invents a new failure shape. A scan that hits the ceiling
 * stops and reports through the same partial-coverage path a scan that hits its
 * compiled bound already uses, so `_coverage.result_complete` goes to false and
 * the response says which blocks were searched. A window that is over the
 * ceiling before any upstream call is refused with an ActionableError naming
 * the cap, because there is nothing honest to return for a request that was
 * never allowed to start.
 */

import { AsyncLocalStorage } from 'node:async_hooks'

import {
  guardrailAdmittedTotal,
  guardrailBlockedTotal,
  guardrailFailOpenTotal,
  guardrailWouldBlockTotal,
} from '../metrics.js'
import { ActionableError } from './errors.js'
import type { ToolWorkClass } from './tool-admission.js'

export type GuardrailMode = 'off' | 'shadow' | 'enforce'

export type GuardrailLimit = 'max_scan_blocks' | 'max_window_seconds' | 'max_upstream_bytes'

const LIMITS: GuardrailLimit[] = ['max_scan_blocks', 'max_window_seconds', 'max_upstream_bytes']
const CLASSES: ToolWorkClass[] = ['lookup', 'raw_query', 'summary', 'analytics']

export type GuardrailSettings = {
  mode: GuardrailMode
  /** Undefined for a limit nobody configured, which is every limit by default. */
  limits: Record<ToolWorkClass, Partial<Record<GuardrailLimit, number>>>
}

/** Which tool is running, so a helper deep in a scan can find its own ceiling. */
export type GuardrailScope = {
  tool: string
  workClass: ToolWorkClass
}

const scopeStorage = new AsyncLocalStorage<GuardrailScope>()

export function runWithGuardrailScope<T>(scope: GuardrailScope, callback: () => T): T {
  return scopeStorage.run(scope, callback)
}

export function getGuardrailScope(): GuardrailScope | undefined {
  return scopeStorage.getStore()
}

function readMode(value: string | undefined): GuardrailMode {
  const normalized = (value ?? '').trim().toLowerCase()
  return normalized === 'shadow' || normalized === 'enforce' ? normalized : 'off'
}

function readLimit(value: string | undefined): number | undefined {
  if (value === undefined) return undefined
  const parsed = Number(value.trim())
  /* A limit that does not parse, or is zero or negative, is a configuration
     mistake. Refusing to guess keeps a typo from silently capping every call
     at zero; the fail-open counter is what makes it visible. */
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : undefined
}

export function envVariableName(workClass: ToolWorkClass, limit: GuardrailLimit): string {
  return `MCP_GUARDRAIL_${workClass.toUpperCase()}_${limit.toUpperCase()}`
}

export function readGuardrailSettings(env: NodeJS.ProcessEnv = process.env): GuardrailSettings {
  const limits = {} as GuardrailSettings['limits']
  let misconfigured = 0
  for (const workClass of CLASSES) {
    const perClass: Partial<Record<GuardrailLimit, number>> = {}
    for (const limit of LIMITS) {
      const raw = env[envVariableName(workClass, limit)]
      const parsed = readLimit(raw)
      if (parsed !== undefined) perClass[limit] = parsed
      else if (raw !== undefined && raw.trim() !== '') misconfigured += 1
    }
    limits[workClass] = perClass
  }
  const settings = { mode: readMode(env.MCP_GUARDRAIL_MODE), limits }
  /* Counted once at read time rather than per call: an unreadable setting is a
     deployment fact, not a property of any one request. */
  if (misconfigured > 0 && settings.mode !== 'off') {
    guardrailFailOpenTotal.inc({ reason: 'unreadable_limit' }, misconfigured)
  }
  return settings
}

let cached: GuardrailSettings | undefined

export function getGuardrailSettings(): GuardrailSettings {
  if (!cached) cached = readGuardrailSettings()
  return cached
}

/** Tests set the environment and re-read; production reads once at startup. */
export function resetGuardrailSettingsForTest(settings?: GuardrailSettings) {
  cached = settings
}

export function guardrailCap(limit: GuardrailLimit, scope = getGuardrailScope()): number | undefined {
  if (!scope) return undefined
  const settings = getGuardrailSettings()
  if (settings.mode === 'off') return undefined
  return settings.limits[scope.workClass]?.[limit]
}

export type GuardrailOutcome = {
  /** What the caller should actually use. Unchanged unless enforce clamped it. */
  value: number
  cap?: number
  wouldBlock: boolean
  blocked: boolean
}

/**
 * Hold `requested` against the ceiling for the running tool's class.
 *
 * In shadow mode the requested value comes back untouched and the counter
 * records what enforcing would have done, which is the point of shadow: run it
 * on production for a week and read `would_block_total` before turning it on.
 */
export function applyGuardrail(
  limit: GuardrailLimit,
  requested: number,
  scope = getGuardrailScope(),
): GuardrailOutcome {
  const settings = getGuardrailSettings()
  if (settings.mode === 'off' || !scope) return { value: requested, wouldBlock: false, blocked: false }
  const cap = guardrailCap(limit, scope)
  const labels = { class: scope.workClass, limit }
  if (cap === undefined || requested <= cap) {
    guardrailAdmittedTotal.inc({ class: scope.workClass })
    return { value: requested, cap, wouldBlock: false, blocked: false }
  }
  if (settings.mode === 'shadow') {
    guardrailWouldBlockTotal.inc(labels)
    return { value: requested, cap, wouldBlock: true, blocked: false }
  }
  guardrailBlockedTotal.inc(labels)
  return { value: cap, cap, wouldBlock: true, blocked: true }
}

/**
 * A window that is over the ceiling before anything is fetched. Unlike a scan,
 * there is no honest partial to return for a window the operator did not allow,
 * so enforce refuses and names the cap.
 */
export function assertWindowWithinGuardrail(windowSeconds: number, scope = getGuardrailScope()) {
  const outcome = applyGuardrail('max_window_seconds', windowSeconds, scope)
  if (!outcome.blocked || outcome.cap === undefined) return
  throw new ActionableError(
    `This deployment caps a ${scope?.workClass ?? 'tool'} query window at ${humanWindow(outcome.cap)}; the request asked for ${humanWindow(windowSeconds)}.`,
    [
      `Ask for ${humanWindow(outcome.cap)} or less.`,
      'Split the window into parts that each fit the cap and page through them.',
      'An operator can raise the cap; it is a setting on this deployment, not a limit of the data.',
    ],
    { requested_window_seconds: windowSeconds, max_window_seconds: outcome.cap },
    /* The request was refused because it asked for more than this deployment
       allows, which is something the caller can fix by asking for less. Calling
       that an internal error would blame the server for a decision the operator
       made and would tell the caller nothing they can act on. */
    { code: 'unsupported_operation', origin: 'client_input', retryable: false },
  )
}

/** Minutes below an hour, hours below a day, days above: "15m" beats "0.25h". */
function humanWindow(seconds: number): string {
  if (seconds < 3_600) return `${Math.round(seconds / 60)}m`
  if (seconds < 86_400) return `${Number((seconds / 3_600).toFixed(1))}h`
  return `${Number((seconds / 86_400).toFixed(1))}d`
}

/** For the readiness and status surfaces: what is configured, never a secret. */
export function guardrailStatus() {
  const settings = getGuardrailSettings()
  return {
    mode: settings.mode,
    configured: CLASSES.flatMap((workClass) =>
      LIMITS.filter((limit) => settings.limits[workClass][limit] !== undefined).map((limit) => ({
        class: workClass,
        limit,
        value: settings.limits[workClass][limit] as number,
      })),
    ),
  }
}
