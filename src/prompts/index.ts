import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

import { registerAnalystPrompt } from './analyst.js'

export function registerAllPrompts(server: McpServer) {
  registerAnalystPrompt(server)
}
