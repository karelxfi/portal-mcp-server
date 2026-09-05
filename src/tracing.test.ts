import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, it } from 'node:test'

import { InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base'

import {
  currentTraceIds,
  datasetFromUrl,
  outboundTraceHeaders,
  recordChildSpan,
  recordRequestSpan,
  recordToolSpan,
  startTracing,
  startUpstreamSpan,
  stopTracing,
  tracingEnabled,
  tracingStatus,
} from './tracing.js'

/*
 * A span leaves the process for a collector the query itself never reaches, so
 * these tests care as much about what is not on a span as what is. The
 * arguments below are the shapes that must never appear: a wallet address, a
 * transaction hash, an opaque cursor.
 */
const SENSITIVE_ARGS = {
  address: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
  transaction: '0x88df016429689c079f3b2f6ad39fa052532c56795b733da78a91ebe6a713944b',
  cursor: 'eyJibG9jayI6MTIzNDU2fQ',
  query: 'find every transfer this whale made last week',
}

const ADDRESS_PATTERN = /0x[0-9a-fA-F]{40}/
const HASH_PATTERN = /\b[0-9a-fA-F]{64}\b/

const RUNTIME = { transport: 'http' as const, toolsetLabel: 'evm' }

describe('with no collector configured', () => {
  it('reads the endpoint, not a flag of its own', () => {
    assert.equal(tracingEnabled({}), false)
    assert.equal(tracingEnabled({ OTEL_EXPORTER_OTLP_ENDPOINT: '   ' }), false)
    assert.equal(tracingEnabled({ OTEL_EXPORTER_OTLP_ENDPOINT: 'http://collector:4318' }), true)
  })

  it('reports itself off, and stays off', () => {
    assert.deepEqual(tracingStatus({}), { configured: false, active: false, include_arguments: false })
  })

  it('returns the handler result untouched and offers no trace context', async () => {
    const result = await recordToolSpan(
      { tool: 'portal_get_head', workClass: 'lookup', runtimeContext: RUNTIME, args: SENSITIVE_ARGS },
      async (span) => {
        /* Every method still has to be callable: the caller must not have to
           know whether tracing is on. */
        span.setAttribute('mcp.admission.wait_ms', 4)
        span.setOutcome('success')
        assert.equal(currentTraceIds(), undefined)
        assert.equal(outboundTraceHeaders(), undefined)
        return 'answer'
      },
    )
    assert.equal(result, 'answer')
  })

  it('adds no header to an outbound Portal request', () => {
    const upstream = startUpstreamSpan({
      method: 'POST',
      url: 'https://portal.example/datasets/base-mainnet/stream',
      attempt: 0,
    })
    assert.equal(upstream.headers(), undefined)
    assert.deepEqual({ Accept: 'application/x-ndjson', ...upstream.headers() }, { Accept: 'application/x-ndjson' })
    upstream.end()
  })
})

describe('with a collector configured', () => {
  const exporter = new InMemorySpanExporter()

  before(async () => {
    await startTracing({
      serviceName: 'sqd-portal-mcp-server',
      serviceVersion: '0.0.0-test',
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    })
    assert.equal(tracingStatus({}).active, true, 'the OpenTelemetry packages must be installed to run this test')
  })

  after(async () => {
    await stopTracing()
  })

  beforeEach(() => {
    exporter.reset()
  })

  const spanNamed = (name: string) => {
    const span = exporter.getFinishedSpans().find((candidate) => candidate.name === name)
    assert.ok(
      span,
      `no span named ${name} in [${exporter
        .getFinishedSpans()
        .map((s) => s.name)
        .join(', ')}]`,
    )
    return span
  }

  /** One request, one tool call, one admission wait, one Portal fetch. */
  async function traceOneCall(params: { traceparent?: string; metaTraceparent?: string } = {}) {
    return recordRequestSpan({ method: 'POST', transport: 'http', traceparent: params.traceparent }, async () =>
      recordToolSpan(
        {
          tool: 'portal_evm_query_logs',
          workClass: 'raw_query',
          runtimeContext: RUNTIME,
          traceparent: params.metaTraceparent,
          args: SENSITIVE_ARGS,
        },
        async (span) => {
          span.setAttribute('mcp.admission.wait_ms', 12)
          const ids = currentTraceIds()
          await recordChildSpan('mcp.admission', { 'mcp.tool.work_class': 'raw_query' }, async () => undefined)
          const upstream = startUpstreamSpan({
            method: 'POST',
            url: 'https://portal.example/datasets/base-mainnet/stream',
            attempt: 1,
          })
          const headers = upstream.headers()
          upstream.setAttribute('http.response.status_code', 200)
          upstream.setAttribute('mcp.upstream.bytes', 4096)
          upstream.end()
          span.setOutcome('success')
          return { ids, headers }
        },
      ),
    )
  }

  it('records the whole call as one tree', async () => {
    await traceOneCall()
    const request = spanNamed('mcp.request')
    const tool = spanNamed('tools/call portal_evm_query_logs')
    const admission = spanNamed('mcp.admission')
    const upstream = spanNamed('portal.fetch')

    assert.equal(tool.parentSpanContext?.spanId, request.spanContext().spanId)
    assert.equal(admission.parentSpanContext?.spanId, tool.spanContext().spanId)
    assert.equal(upstream.parentSpanContext?.spanId, tool.spanContext().spanId)
    assert.equal(request.parentSpanContext, undefined, 'nothing above it, so it is the root')

    const traceIds = new Set([request, tool, admission, upstream].map((span) => span.spanContext().traceId))
    assert.equal(traceIds.size, 1, 'four spans, one trace')
  })

  it('names the tool the way a collector groups on', async () => {
    await traceOneCall()
    const tool = spanNamed('tools/call portal_evm_query_logs')
    assert.equal(tool.attributes['gen_ai.tool.name'], 'portal_evm_query_logs')
    assert.equal(tool.attributes['gen_ai.operation.name'], 'execute_tool')
    assert.equal(tool.attributes['mcp.method.name'], 'tools/call')
    assert.equal(tool.attributes['mcp.tool.work_class'], 'raw_query')
    assert.equal(tool.attributes['mcp.transport'], 'http')
    assert.equal(tool.attributes['mcp.toolset'], 'evm')
    assert.equal(tool.attributes['mcp.tool.outcome'], 'success')
    assert.equal(tool.attributes['mcp.admission.wait_ms'], 12)
  })

  it('says which dataset a Portal fetch read, and how it went', async () => {
    await traceOneCall()
    const upstream = spanNamed('portal.fetch')
    assert.equal(upstream.attributes['mcp.upstream.dataset'], 'base-mainnet')
    assert.equal(upstream.attributes['http.request.method'], 'POST')
    assert.equal(upstream.attributes['http.request.resend_count'], 1)
    assert.equal(upstream.attributes['http.response.status_code'], 200)
    assert.equal(upstream.attributes['mcp.upstream.bytes'], 4096)
    /* The Portal address can be a private deployment, so only the dataset
       name survives the trip. */
    for (const value of Object.values(upstream.attributes)) {
      assert.doesNotMatch(String(value), /portal\.example/)
    }
  })

  it('carries no address, hash, cursor or free text on any span', async () => {
    await traceOneCall()
    for (const span of exporter.getFinishedSpans()) {
      for (const [key, value] of Object.entries(span.attributes)) {
        const rendered = `${key}=${String(value)}`
        assert.doesNotMatch(rendered, ADDRESS_PATTERN, `${span.name} leaked an address in ${key}`)
        assert.doesNotMatch(rendered, HASH_PATTERN, `${span.name} leaked a hash in ${key}`)
        assert.notEqual(key, 'mcp.tool.arguments', `${span.name} recorded arguments by default`)
        assert.doesNotMatch(rendered, /whale/, `${span.name} leaked a free-text query in ${key}`)
        assert.doesNotMatch(rendered, /eyJ/, `${span.name} leaked a cursor in ${key}`)
      }
    }
  })

  it('records arguments only when an operator asks for them, unsafely and on purpose', async () => {
    const previous = process.env.MCP_OTEL_INCLUDE_ARGS
    process.env.MCP_OTEL_INCLUDE_ARGS = '1'
    try {
      assert.equal(tracingStatus({ MCP_OTEL_INCLUDE_ARGS: '1' }).include_arguments, true)
      await traceOneCall()
      const tool = spanNamed('tools/call portal_evm_query_logs')
      assert.match(String(tool.attributes['mcp.tool.arguments']), ADDRESS_PATTERN)
    } finally {
      if (previous === undefined) delete process.env.MCP_OTEL_INCLUDE_ARGS
      else process.env.MCP_OTEL_INCLUDE_ARGS = previous
    }
  })

  it('joins the caller trace when the request header carries one', async () => {
    const traceId = '4bf92f3577b34da6a3ce929d0e0e4736'
    const parentSpanId = '00f067aa0ba902b7'
    await traceOneCall({ traceparent: `00-${traceId}-${parentSpanId}-01` })
    const request = spanNamed('mcp.request')
    assert.equal(request.spanContext().traceId, traceId)
    assert.equal(request.parentSpanContext?.spanId, parentSpanId)
    assert.equal(spanNamed('portal.fetch').spanContext().traceId, traceId, 'the whole tree joins it')
  })

  it('prefers the trace context on the tool call itself', async () => {
    const headerTrace = '4bf92f3577b34da6a3ce929d0e0e4736'
    const metaTrace = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    await traceOneCall({
      traceparent: `00-${headerTrace}-00f067aa0ba902b7-01`,
      metaTraceparent: `00-${metaTrace}-bbbbbbbbbbbbbbbb-01`,
    })
    assert.equal(spanNamed('mcp.request').spanContext().traceId, headerTrace)
    const tool = spanNamed('tools/call portal_evm_query_logs')
    assert.equal(tool.spanContext().traceId, metaTrace, 'the client said which trace this call belongs to')
    assert.equal(tool.parentSpanContext?.spanId, 'bbbbbbbbbbbbbbbb')
  })

  it('hands the log line the ids of the span it was written inside', async () => {
    const result = await traceOneCall()
    const tool = spanNamed('tools/call portal_evm_query_logs')
    assert.deepEqual(result.ids, {
      trace_id: tool.spanContext().traceId,
      span_id: tool.spanContext().spanId,
    })
  })

  it('hands Portal a traceparent naming the fetch span', async () => {
    const result = await traceOneCall()
    const upstream = spanNamed('portal.fetch')
    assert.equal(
      result.headers?.traceparent,
      `00-${upstream.spanContext().traceId}-${upstream.spanContext().spanId}-01`,
    )
  })

  it('marks a failed call failed, with a class and no message', async () => {
    await recordToolSpan({ tool: 'portal_get_head', workClass: 'lookup', runtimeContext: RUNTIME }, async (span) => {
      span.setOutcome('tool_error', 'ActionableError')
    })
    const tool = spanNamed('tools/call portal_get_head')
    assert.equal(tool.attributes['mcp.tool.outcome'], 'tool_error')
    assert.equal(tool.attributes['mcp.tool.error_class'], 'ActionableError')
    assert.equal(tool.status.code, 2, 'SpanStatusCode.ERROR')
  })

  it('closes the span of a handler that threw, and lets the error through', async () => {
    await assert.rejects(
      recordToolSpan({ tool: 'portal_get_head', workClass: 'lookup', runtimeContext: RUNTIME }, async () => {
        throw new TypeError('boom')
      }),
      TypeError,
    )
    const tool = spanNamed('tools/call portal_get_head')
    assert.equal(tool.attributes['mcp.tool.outcome'], 'tool_error')
    assert.equal(tool.attributes['mcp.tool.error_class'], 'TypeError')
    assert.doesNotMatch(JSON.stringify(tool.attributes), /boom/, 'a message can carry caller input')
  })

  it('closes the span of a handler that reported nothing', async () => {
    await recordToolSpan({ tool: 'portal_get_head', workClass: 'lookup', runtimeContext: RUNTIME }, async () => 1)
    assert.equal(spanNamed('tools/call portal_get_head').attributes['mcp.tool.outcome'], 'success')
  })
})

describe('dataset names', () => {
  it('reads the dataset out of a Portal URL and nothing else', () => {
    assert.equal(datasetFromUrl('https://portal.example/datasets/base-mainnet/stream'), 'base-mainnet')
    assert.equal(
      datasetFromUrl('https://portal.example/datasets/bitcoin-mainnet/timestamps/1700/block'),
      'bitcoin-mainnet',
    )
    assert.equal(datasetFromUrl('https://portal.example/datasets'), undefined)
  })
})
