// ============================================================================
// Toolsets: let a deployment or a single connection trim the catalog
// ============================================================================
//
// Every tool belongs to exactly one toolset, the category it already declares
// in `src/helpers/tool-ux.ts`. Filtering happens at registration time from
// that one typed list, so MCP discovery still comes from a single registry.
//
//   MCP_TOOLSETS=discovery,evm   deployment keeps only those sets (`all` or
//                                `default` keep today's full surface)
//   MCP_TOOLS=portal_get_head    deployment keeps exact names; ignored when
//                                MCP_TOOLSETS is set
//   ?toolsets=evm / X-MCP-Toolsets: evm
//                                a connection narrows the deployment set; it
//                                can never widen it
//
// The default, with nothing configured, is the full 31-tool surface.

import { AsyncLocalStorage } from 'node:async_hooks'

import { getToolContract } from './helpers/tool-ux.js'

export const TOOLSETS = [
  'discovery',
  'convenience',
  'evm',
  'solana',
  'bitcoin',
  'substrate',
  'hyperliquid',
  'tron',
  'debug',
] as const

export type Toolset = (typeof TOOLSETS)[number]

export interface ToolSelection {
  /** Toolsets a tool may belong to. */
  toolsets: ReadonlySet<Toolset>
  /** Exact tool names, when `MCP_TOOLS` is the source. */
  tools?: ReadonlySet<string>
  /** Bounded metric label: `all`, one toolset name, or `custom`. */
  label: 'all' | 'custom' | Toolset
  /** Configuration problems worth a startup log line. */
  warnings: string[]
}

const ALL_TOOLSETS: ReadonlySet<Toolset> = new Set(TOOLSETS)

function isToolset(value: string): value is Toolset {
  return (TOOLSETS as readonly string[]).includes(value)
}

export function parseToolsetList(raw: string | undefined): { toolsets: Toolset[]; unknown: string[]; all: boolean } {
  const toolsets: Toolset[] = []
  const unknown: string[] = []
  let all = false
  for (const entry of (raw ?? '').split(',')) {
    const value = entry.trim().toLowerCase()
    if (!value) continue
    if (value === 'all' || value === 'default') {
      all = true
    } else if (isToolset(value)) {
      if (!toolsets.includes(value)) toolsets.push(value)
    } else {
      unknown.push(value)
    }
  }
  return { toolsets, unknown, all }
}

function labelFor(toolsets: ReadonlySet<Toolset>, tools?: ReadonlySet<string>): ToolSelection['label'] {
  if (tools) return 'custom'
  if (toolsets.size === TOOLSETS.length) return 'all'
  if (toolsets.size === 1) return [...toolsets][0]
  return 'custom'
}

export const FULL_TOOL_SELECTION: ToolSelection = { toolsets: ALL_TOOLSETS, label: 'all', warnings: [] }

/**
 * Deployment-wide selection from the environment. `MCP_TOOLSETS` wins over
 * `MCP_TOOLS`. Unknown names are ignored and reported; an empty result falls
 * back to the full surface so a typo cannot publish an empty catalog.
 */
export function resolveDeploymentToolSelection(env: { MCP_TOOLSETS?: string; MCP_TOOLS?: string }): ToolSelection {
  const warnings: string[] = []
  if (env.MCP_TOOLSETS?.trim()) {
    const parsed = parseToolsetList(env.MCP_TOOLSETS)
    if (parsed.unknown.length > 0) {
      warnings.push(
        `MCP_TOOLSETS ignores unknown toolset name(s): ${parsed.unknown.join(', ')}. Known: ${TOOLSETS.join(', ')}.`,
      )
    }
    if (env.MCP_TOOLS?.trim()) warnings.push('MCP_TOOLS is ignored because MCP_TOOLSETS is set.')
    if (parsed.all || parsed.toolsets.length === 0) {
      if (!parsed.all) warnings.push('MCP_TOOLSETS named no known toolset; serving the full surface.')
      return { toolsets: ALL_TOOLSETS, label: 'all', warnings }
    }
    const toolsets = new Set(parsed.toolsets)
    return { toolsets, label: labelFor(toolsets), warnings }
  }
  if (env.MCP_TOOLS?.trim()) {
    const tools = new Set<string>()
    const unknown: string[] = []
    for (const entry of env.MCP_TOOLS.split(',')) {
      const name = entry.trim()
      if (!name) continue
      if (getToolContract(name)) tools.add(name)
      else unknown.push(name)
    }
    if (unknown.length > 0) warnings.push(`MCP_TOOLS ignores unknown tool name(s): ${unknown.join(', ')}.`)
    if (tools.size === 0) {
      warnings.push('MCP_TOOLS named no known tool; serving the full surface.')
      return { toolsets: ALL_TOOLSETS, label: 'all', warnings }
    }
    return { toolsets: ALL_TOOLSETS, tools, label: 'custom', warnings }
  }
  return { toolsets: ALL_TOOLSETS, label: 'all', warnings }
}

/**
 * Per-connection narrowing. The requested toolsets are intersected with the
 * deployment's; unknown names are ignored; when nothing valid was requested the
 * deployment selection stands. A connection can never add a toolset.
 */
export function narrowToolSelection(base: ToolSelection, requested: string[] | undefined): ToolSelection {
  if (!requested || requested.length === 0) return base
  const parsed = parseToolsetList(requested.join(','))
  if (parsed.all || parsed.toolsets.length === 0) return base
  const toolsets = new Set(parsed.toolsets.filter((toolset) => base.toolsets.has(toolset)))
  return { toolsets, tools: base.tools, label: labelFor(toolsets, base.tools), warnings: [] }
}

export function toolsetOf(toolName: string): Toolset | undefined {
  const category = getToolContract(toolName)?.category
  return category && isToolset(category) ? category : undefined
}

export function isToolEnabled(selection: ToolSelection, toolName: string): boolean {
  if (toolName.startsWith('__test_')) return true
  const toolset = toolsetOf(toolName)
  if (!toolset) return false
  if (!selection.toolsets.has(toolset)) return false
  return selection.tools ? selection.tools.has(toolName) : true
}

/** Read `?toolsets=` and the `X-MCP-Toolsets` header from an HTTP request. */
export function requestedToolsetsFromRequest(
  request: { url?: string; headers?: { get(name: string): string | null } } | undefined,
): string[] | undefined {
  if (!request) return undefined
  const values: string[] = []
  const header = request.headers?.get('x-mcp-toolsets')
  if (header) values.push(header)
  if (request.url) {
    try {
      const query = new URL(request.url).searchParams.get('toolsets')
      if (query) values.push(query)
    } catch {
      // a malformed URL cannot narrow anything
    }
  }
  return values.length > 0 ? values : undefined
}

const selectionStorage = new AsyncLocalStorage<ToolSelection>()

export function runWithToolSelection<T>(selection: ToolSelection, callback: () => T): T {
  return selectionStorage.run(selection, callback)
}

export function getActiveToolSelection(): ToolSelection {
  return selectionStorage.getStore() ?? FULL_TOOL_SELECTION
}

export function isToolActive(toolName: string): boolean {
  return isToolEnabled(getActiveToolSelection(), toolName)
}
