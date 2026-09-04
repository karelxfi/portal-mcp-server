/*
 * Traces, off unless an operator asks for them.
 *
 * The server already emits Prometheus histograms and structured JSON events
 * with an invocation id. What neither can do is show one slow call as a shape:
 * how long it waited for admission, how many Portal fetches it made, which one
 * retried, and where the time actually went. That is what a span tree is for.
 *
 * The OpenTelemetry SDK is not a dependency of this package. `sdk-node` and its
 * exporter pull 74 packages and about 50MB, against a published tarball of
 * roughly 3.4MB, and almost nobody running this server over stdio wants any of
 * it. They are declared as optional peer dependencies, so npm installs nothing
 * extra by default. An operator who does want traces installs them alongside:
 *
 *   npm i @opentelemetry/sdk-node @opentelemetry/exporter-trace-otlp-http
 *
 * and sets OTEL_EXPORTER_OTLP_ENDPOINT. With that unset nothing here imports
 * anything, allocates anything, or touches the network: every function below
 * is a branch on one module-level variable that forwards to its argument, and
 * neither package need be installed at all. (`@opentelemetry/api` is the one
 * exception, and it is already installed: prom-client depends on it. It is
 * still declared here, because a future prom-client is free to drop it.)
 *
 * No auto-instrumentation. The Portal fetch spans are written by hand in
 * `helpers/fetch.ts` rather than lifted from an http/undici instrumentation,
 * which costs two more packages and would still not know a dataset name or a
 * retry attempt from a socket.
 *
 * Attributes carry no addresses, hashes, cursors, arguments or free text. They
 * are the tool name, its work class, a bounded outcome, and counts. A span
 * leaves the process to somewhere the query itself never goes, so the rule is
 * the same one the metric labels follow, and stricter than the logs, which at
 * least stay on the operator's own stderr.
 */

import type * as OtelApi from '@opentelemetry/api'

import type { ToolWorkClass } from './helpers/tool-admission.js'
import type { RuntimeRequestContext, ToolEventStatus } from './observability.js'

export type SpanAttributes = Record<string, string | number | boolean>

/** What a caller may do to a span. Deliberately smaller than the OTel Span. */
export type TracedSpan = {
  setAttribute: (key: string, value: string | number | boolean) => void
  /** Bounded class name, never a message: messages carry caller input. */
  fail: (errorClass: string) => void
}

export type TracedToolSpan = TracedSpan & {
  setOutcome: (status: ToolEventStatus, errorClass?: string) => void
}

/* Undefined until start() succeeds, which is what makes the off path free. */
let active: { api: typeof OtelApi; tracer: OtelApi.Tracer } | undefined
let shutdown: (() => Promise<void>) | undefined
let startFailure: string | undefined

const NOOP_SPAN: TracedToolSpan = {
  setAttribute: () => {},
  fail: () => {},
  setOutcome: () => {},
}

export function tracingEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim())
}

/** Arguments can hold addresses and free text, so they are off unless asked for. */
export function tracingIncludesArguments(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.MCP_OTEL_INCLUDE_ARGS === '1'
}

/**
 * Called once at startup. Resolves whether or not tracing came up; a missing
 * package or an unreachable collector must never stop the server serving.
 *
 * `spanProcessors` is how the tests attach an in-memory exporter. Production
 * passes nothing and gets the SDK's batching OTLP pipeline.
 */
export async function startTracing(params: {
  serviceName: string
  serviceVersion: string
  env?: NodeJS.ProcessEnv
  spanProcessors?: unknown[]
}): Promise<void> {
  const env = params.env ?? process.env
  if (active) return
  if (!params.spanProcessors && !tracingEnabled(env)) return
  try {
    const [{ NodeSDK }, api, { OTLPTraceExporter }] = await Promise.all([
      import('@opentelemetry/sdk-node'),
      import('@opentelemetry/api'),
      import('@opentelemetry/exporter-trace-otlp-http'),
    ])
    const sdk = new NodeSDK(
      params.spanProcessors
        ? {
            serviceName: params.serviceName,
            spanProcessors: params.spanProcessors as never,
            /* Host detection resolves asynchronously, which defers the first
               export behind a promise and makes a test racy for no gain. */
            resourceDetectors: [],
          }
        : { serviceName: params.serviceName, traceExporter: new OTLPTraceExporter() },
    )
    sdk.start()
    active = { api, tracer: api.trace.getTracer(params.serviceName, params.serviceVersion) }
    startFailure = undefined
    shutdown = () => sdk.shutdown()
  } catch (error) {
    /* The most likely cause by far is that the packages are not installed. Say
       so once, on stderr, and carry on untraced rather than failing to start. */
    startFailure = error instanceof Error ? error.message : String(error)
    console.error(
      `[mcp:tracing] OTEL_EXPORTER_OTLP_ENDPOINT is set but tracing could not start, so the server is running untraced. Install @opentelemetry/sdk-node and @opentelemetry/exporter-trace-otlp-http to enable it. (${startFailure})`,
    )
  }
}

export async function stopTracing(): Promise<void> {
  const stop = shutdown
  shutdown = undefined
  active = undefined
  if (stop) await stop().catch(() => {})
}

/** For the readiness and health surfaces: configured, running, or why not. */
export function tracingStatus(env: NodeJS.ProcessEnv = process.env) {
  return {
    configured: tracingEnabled(env),
    active: Boolean(active),
    ...(startFailure ? { error: 'tracing_start_failed' } : {}),
    include_arguments: tracingIncludesArguments(env),
  }
}

/**
 * The ids of the span running right now, for the JSON log line and the Loki
 * label set, so a log event and its span can be looked up from each other.
 */
export function currentTraceIds(): { trace_id: string; span_id: string } | undefined {
  if (!active) return undefined
  const span = active.api.trace.getActiveSpan()
  if (!span) return undefined
  const context = span.spanContext()
  if (!active.api.isSpanContextValid(context)) return undefined
  return { trace_id: context.traceId, span_id: context.spanId }
}

/**
 * W3C headers for an outbound Portal request, so a Portal-side trace can join
 * this one. Undefined when tracing is off, which spreads to nothing.
 */
export function outboundTraceHeaders(): Record<string, string> | undefined {
  if (!active) return undefined
  const carrier: Record<string, string> = {}
  active.api.propagation.inject(active.api.context.active(), carrier)
  return Object.keys(carrier).length > 0 ? carrier : undefined
}

function contextFrom(traceparent: string | undefined, tracestate: string | undefined): OtelApi.Context {
  if (!active) throw new Error('unreachable: contextFrom called while tracing is off')
  const root = active.api.context.active()
  if (!traceparent) return root
  return active.api.propagation.extract(root, {
    traceparent,
    ...(tracestate ? { tracestate } : {}),
  })
}

function endWith(api: typeof OtelApi, span: OtelApi.Span, status: ToolEventStatus, errorClass?: string) {
  span.setAttribute('mcp.tool.outcome', status)
  if (errorClass) span.setAttribute('mcp.tool.error_class', errorClass)
  span.setStatus({
    code: status === 'tool_error' || status === 'request_error' ? api.SpanStatusCode.ERROR : api.SpanStatusCode.OK,
  })
  span.end()
}

/**
 * The span for one MCP HTTP request. Its children are the tool calls the
 * request carried, so a batched request shows as one tree.
 */
export async function recordRequestSpan<T>(
  params: { method: string; transport: string; traceparent?: string; tracestate?: string },
  run: () => Promise<T>,
): Promise<T> {
  const running = active
  if (!running) return run()
  const { api, tracer } = running
  return api.context.with(contextFrom(params.traceparent, params.tracestate), () =>
    tracer.startActiveSpan(
      'mcp.request',
      { attributes: { 'http.request.method': params.method, 'mcp.transport': params.transport } },
      async (span) => {
        try {
          return await run()
        } catch (error) {
          span.setAttribute('mcp.request.error_class', error instanceof Error ? error.constructor.name : 'Error')
          span.setStatus({ code: api.SpanStatusCode.ERROR })
          throw error
        } finally {
          span.end()
        }
      },
    ),
  )
}

/**
 * Wrap one tool call. Returns exactly what `run` returns, traced or not, so a
 * caller never has to know which. The caller reports the outcome, because a
 * tool that returns an error result has not thrown anything to catch.
 */
export function recordToolSpan<T>(
  params: {
    tool: string
    workClass: ToolWorkClass
    runtimeContext: RuntimeRequestContext
    /** From the tool call `_meta`; the HTTP header is handled a level up. */
    traceparent?: string
    tracestate?: string
    /** Only read when MCP_OTEL_INCLUDE_ARGS=1. */
    args?: Record<string, unknown>
  },
  run: (span: TracedToolSpan) => Promise<T>,
): Promise<T> {
  const running = active
  if (!running) return run(NOOP_SPAN)
  const { api, tracer } = running
  return api.context.with(contextFrom(params.traceparent, params.tracestate), () =>
    tracer.startActiveSpan(
      `tools/call ${params.tool}`,
      {
        attributes: {
          /* gen_ai.tool.name is the convention hosts and collectors group on. */
          'gen_ai.tool.name': params.tool,
          'gen_ai.operation.name': 'execute_tool',
          'mcp.method.name': 'tools/call',
          'mcp.tool.work_class': params.workClass,
          'mcp.transport': params.runtimeContext.transport,
          ...(params.runtimeContext.toolsetLabel ? { 'mcp.toolset': params.runtimeContext.toolsetLabel } : {}),
        },
      },
      async (span) => {
        /* Off by default and documented as unsafe: a tool argument can be a
           wallet address, a contract, or a free-text query. */
        if (params.args && tracingIncludesArguments()) {
          span.setAttribute('mcp.tool.arguments', JSON.stringify(params.args).slice(0, 4096))
        }
        let reported = false
        const handle: TracedToolSpan = {
          setAttribute: (key, value) => {
            span.setAttribute(key, value)
          },
          fail: (errorClass) => {
            reported = true
            endWith(api, span, 'tool_error', errorClass)
          },
          setOutcome: (status, errorClass) => {
            reported = true
            endWith(api, span, status, errorClass)
          },
        }
        try {
          return await run(handle)
        } catch (error) {
          if (!reported) endWith(api, span, 'tool_error', error instanceof Error ? error.constructor.name : 'Error')
          reported = true
          throw error
        } finally {
          /* A handler that returned without saying how it went still has to
             close its span, or the trace never arrives. */
          if (!reported) endWith(api, span, 'success')
        }
      },
    ),
  )
}

/**
 * A step inside the running tool call: the admission wait, one Portal fetch,
 * the formatting pass. Parented by whatever span is active, which is why
 * nothing has to be threaded through the call stack.
 */
export function recordChildSpan<T>(
  name: string,
  attributes: SpanAttributes,
  run: (span: TracedSpan) => Promise<T>,
): Promise<T> {
  const running = active
  if (!running) return run(NOOP_SPAN)
  const { api, tracer } = running
  return tracer.startActiveSpan(name, { attributes }, async (span) => {
    let failed = false
    const handle: TracedSpan = {
      setAttribute: (key, value) => {
        span.setAttribute(key, value)
      },
      fail: (errorClass) => {
        failed = true
        span.setAttribute('mcp.tool.error_class', errorClass)
        span.setStatus({ code: api.SpanStatusCode.ERROR })
      },
    }
    try {
      return await run(handle)
    } catch (error) {
      if (!failed) {
        span.setAttribute('mcp.tool.error_class', error instanceof Error ? error.constructor.name : 'Error')
        span.setStatus({ code: api.SpanStatusCode.ERROR })
      }
      throw error
    } finally {
      span.end()
    }
  })
}

/** `https://…/datasets/base-mainnet/stream` -> `base-mainnet`, or undefined. */
export function datasetFromUrl(url: string): string | undefined {
  return /\/datasets\/([^/?#]+)/.exec(url)?.[1]
}

/** A Portal request in flight: opened before the fetch, closed after the body. */
export type UpstreamSpan = TracedSpan & {
  /** W3C headers naming this span as the parent, for the outbound request. */
  headers: () => Record<string, string> | undefined
  end: () => void
}

const NOOP_UPSTREAM_SPAN: UpstreamSpan = {
  setAttribute: () => {},
  fail: () => {},
  headers: () => undefined,
  end: () => {},
}

/**
 * One Portal request, opened and closed by hand rather than around a callback.
 * The streaming readers have several exits and a `finally` that already runs on
 * every one of them, and a span that closes there covers the whole body rather
 * than stopping at the response headers.
 *
 * The URL is read for the dataset name and then dropped. A Portal address can
 * be a private deployment, and a span leaves the process.
 */
export function startUpstreamSpan(params: { method: string; url: string; attempt: number }): UpstreamSpan {
  const running = active
  if (!running) return NOOP_UPSTREAM_SPAN
  const { api, tracer } = running
  const dataset = datasetFromUrl(params.url)
  const span = tracer.startSpan('portal.fetch', {
    kind: api.SpanKind.CLIENT,
    attributes: {
      'http.request.method': params.method,
      'http.request.resend_count': params.attempt,
      ...(dataset ? { 'mcp.upstream.dataset': dataset } : {}),
    },
  })
  const spanContext = api.trace.setSpan(api.context.active(), span)
  return {
    setAttribute: (key, value) => {
      span.setAttribute(key, value)
    },
    fail: (errorClass) => {
      span.setAttribute('mcp.tool.error_class', errorClass)
      span.setStatus({ code: api.SpanStatusCode.ERROR })
    },
    headers: () => {
      const carrier: Record<string, string> = {}
      api.propagation.inject(spanContext, carrier)
      return Object.keys(carrier).length > 0 ? carrier : undefined
    },
    end: () => span.end(),
  }
}
