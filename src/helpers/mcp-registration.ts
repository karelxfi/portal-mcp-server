import type {
  CallToolResult,
  InputRequiredResult,
  McpServer,
  RegisteredTool,
  ServerContext,
} from '@modelcontextprotocol/server'
import { type ZodRawShape, z } from 'zod'

type PortalToolResult = CallToolResult | InputRequiredResult

/**
 * Registers Portal's concise Zod raw shapes through the MCP SDK v2 schema API.
 * Keeping this translation in one place lets every tool use the modern API
 * without duplicating schema wrapping or reaching into SDK internals.
 */
export function registerPortalTool<InputShape extends ZodRawShape>(
  server: McpServer,
  name: string,
  description: string,
  inputShape: InputShape,
  handler: (
    args: z.infer<z.ZodObject<InputShape>>,
    context: ServerContext,
  ) => PortalToolResult | Promise<PortalToolResult>,
): RegisteredTool {
  return server.registerTool(name, { description, inputSchema: z.object(inputShape) }, handler)
}
