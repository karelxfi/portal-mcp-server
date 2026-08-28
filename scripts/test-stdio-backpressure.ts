#!/usr/bin/env tsx

import { Readable, Writable } from 'node:stream'

import { SerializedStdioServerTransport } from '../src/helpers/serialized-stdio-transport.js'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Assertion failed: ${message}`)
}

class SlowWritable extends Writable {
  constructor() {
    super({ highWaterMark: 1 })
  }

  override _write(_chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void) {
    setTimeout(callback, 5)
  }
}

async function main() {
  const input = new Readable({ read() {} })
  const output = new SlowWritable()
  const transport = new SerializedStdioServerTransport(input, output)
  await transport.start()

  let maxErrorListeners = 0
  let maxDrainListeners = 0
  const sampler = setInterval(() => {
    maxErrorListeners = Math.max(maxErrorListeners, output.listenerCount('error'))
    maxDrainListeners = Math.max(maxDrainListeners, output.listenerCount('drain'))
  }, 1)

  try {
    await Promise.all(
      Array.from({ length: 32 }, (_, index) =>
        transport.send({
          jsonrpc: '2.0',
          id: index,
          result: { payload: 'x'.repeat(16_384) },
        }),
      ),
    )
  } finally {
    clearInterval(sampler)
    await transport.close()
  }

  assert(maxErrorListeners <= 2, `serialized writes should keep error listeners bounded, observed ${maxErrorListeners}`)
  assert(maxDrainListeners <= 1, `serialized writes should keep drain listeners bounded, observed ${maxDrainListeners}`)
  assert(output.listenerCount('error') === 0, 'transport close should remove its stdout error listener')
  assert(output.listenerCount('drain') === 0, 'completed writes should remove every drain listener')
  console.log('PASS  stdio responses remain serialized and listener-bounded under backpressure')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
