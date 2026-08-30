#!/usr/bin/env tsx

import { assert, closeTestClient, connectTestClient } from './test-helpers.ts'

async function main() {
  const connected = await connectTestClient('investigation-prompt-runner')
  const { client } = connected

  try {
    const listed = await client.listPrompts()
    const names = listed.prompts.map((prompt) => prompt.name)
    for (const name of ['investigate-wallet', 'investigate-contract', 'investigate-market']) {
      assert(names.includes(name), `prompts/list should include ${name}`)
    }

    const prompt = await client.getPrompt({
      name: 'investigate-market',
      arguments: {
        network: 'hyperliquid-fills',
        market: 'BTC',
        timeframe: '24h',
        question: 'Explain the largest price and volume changes.',
      },
    })
    const text = prompt.messages
      .map((message) => (message.content.type === 'text' ? message.content.text : ''))
      .join('\n')
    assert(text.includes('portal_hyperliquid_get_ohlc'), 'market prompt should route to OHLC')
    assert(text.includes('_evidence'), 'market prompt should require the evidence receipt')
    assert(text.includes('Never make a claim'), 'market prompt should require factual claims')
    assert(!text.includes('—'), 'public prompt copy should not use em dashes')

    const completion = await client.complete({
      ref: { type: 'ref/prompt', name: 'investigate-wallet' },
      argument: { name: 'network', value: 'bas' },
    })
    assert(completion.completion.values.includes('base-mainnet'), 'network completion should suggest Base')

    for (const name of ['investigate-wallet', 'investigate-contract', 'investigate-market']) {
      const tronCompletion = await client.complete({
        ref: { type: 'ref/prompt', name },
        argument: { name: 'network', value: 'tron' },
      })
      assert(tronCompletion.completion.values.length === 0, `${name} should not suggest unsupported Tron queries`)
      let rejected = false
      try {
        await client.getPrompt({
          name,
          arguments:
            name === 'investigate-wallet'
              ? { network: 'tron-mainnet', address: 'TExampleAddress', timeframe: '1h' }
              : name === 'investigate-contract'
                ? { network: 'tron-mainnet', contract: 'TExampleContract', timeframe: '1h' }
                : { network: 'tron-mainnet', market: 'TRX', timeframe: '1h' },
        })
      } catch {
        rejected = true
      }
      assert(rejected, `${name} should reject an unsupported Tron workflow before suggesting query tools`)
    }

    const resources = await client.listResources()
    assert(
      resources.resources.some((resource) => resource.uri === 'sqd://investigations'),
      'resources/list should expose the investigation guide',
    )
    const guide = await client.readResource({ uri: 'sqd://investigations' })
    const guideText = guide.contents[0]?.text
    assert(typeof guideText === 'string', 'investigation guide should return JSON text')
    const parsed = JSON.parse(guideText as string)
    assert(parsed.investigations.length === 3, 'investigation guide should contain the three golden journeys')
    assert(
      parsed.investigations.every((investigation: any) => investigation.completion_contract.length >= 4),
      'every journey should define a factual completion contract',
    )

    console.log('PASS  three golden investigation prompts, completion, and resources are available')
  } finally {
    await closeTestClient(connected)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
