import { StdioServerTransport } from '@modelcontextprotocol/server/stdio'

type StdioMessage = Parameters<StdioServerTransport['send']>[0]

/**
 * Keeps tool execution concurrent while respecting stdout backpressure with a
 * single in-flight write. The upstream transport attaches temporary error and
 * drain listeners per send, so concurrent large responses can otherwise cross
 * Node's listener warning threshold before the pipe drains.
 */
export class SerializedStdioServerTransport extends StdioServerTransport {
  private sendChain: Promise<void> = Promise.resolve()

  override send(message: StdioMessage): Promise<void> {
    const pending = this.sendChain.then(() => super.send(message))
    this.sendChain = pending.catch(() => undefined)
    return pending
  }
}
