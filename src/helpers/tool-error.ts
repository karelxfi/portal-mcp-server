import type { CallToolResult } from '@modelcontextprotocol/server'

import { describeToolError } from './errors.js'
import { getToolContract } from './tool-ux.js'
import { npmVersion } from '../version.js'

/**
 * Convert expected handler failures into a stable MCP tool result. Protocol
 * validation and transport failures remain JSON-RPC errors outside handlers.
 */
export function formatToolError(error: unknown, toolName: string): CallToolResult {
  const descriptor = describeToolError(error)
  const suggestions = descriptor.suggestions.slice(0, 4)
  const payload: Record<string, unknown> = {
    error: {
      code: descriptor.code,
      origin: descriptor.origin,
      summary: descriptor.summary,
      retryable: descriptor.retryable,
      ...(descriptor.retryAfterMs !== undefined ? { retry_after_ms: descriptor.retryAfterMs } : {}),
      suggestions,
    },
    next_steps: {
      actions: suggestions.map((label) => ({ label, executable: false })),
    },
    _pagination: { has_more: false },
    _ordering: { kind: 'not_applicable' },
    _freshness: { kind: 'not_applicable' },
    _coverage: { kind: 'not_applicable', result_complete: false },
    _execution: { kind: 'failed', source: 'portal_mcp', tool: toolName },
    _server: { name: 'SQD', version: npmVersion },
    _llm: {
      primary_path: 'error',
      safe_to_retry: descriptor.retryable,
    },
  }

  const toolContract = getToolContract(toolName)
  if (toolContract) payload._tool_contract = toolContract

  return {
    isError: true,
    content: [{ type: 'text', text: JSON.stringify(payload) }],
    structuredContent: payload,
  }
}
