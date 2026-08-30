#!/usr/bin/env tsx

import { RequestCancelledError } from '../src/helpers/errors.js'
import {
  getPortalRequestSignal,
  runAsSharedPortalWork,
  runWithPortalRequestSignal,
  waitForSharedPortalWork,
} from '../src/helpers/request-context.js'
import {
  DEFAULT_TOOL_WEIGHT_BUDGET,
  WeightedToolAdmissionController,
  getToolWorkProfile,
} from '../src/helpers/tool-admission.js'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function main() {
  const controller = new WeightedToolAdmissionController(16, 3, 80, false)
  const lookup = getToolWorkProfile('portal_get_head')
  const raw = getToolWorkProfile('portal_evm_query_transactions')
  const analytics = getToolWorkProfile('portal_hyperliquid_get_analytics')
  const wallet = getToolWorkProfile('portal_get_wallet_summary')
  assert(lookup.weight === 1 && raw.weight === 8 && analytics.weight === 16, 'tool cost classes should stay explicit')
  assert(wallet.class === 'summary' && wallet.weight === 16, 'wallet scans should admit at most two concurrent calls')
  assert(
    DEFAULT_TOOL_WEIGHT_BUDGET / analytics.weight === 2,
    'the default scheduler budget must cap concurrent analytics at the measured memory-safe level',
  )

  const first = await controller.acquire(raw, 'stdio')
  const second = await controller.acquire(raw, 'http')
  assert(controller.snapshot().activeWeight === 16, 'two raw calls should fill the test budget')

  const order: string[] = []
  const expensive = controller.acquire(analytics, 'http').then((lease) => {
    order.push('analytics')
    return lease
  })
  const cheap = controller.acquire(lookup, 'stdio').then((lease) => {
    order.push('lookup')
    return lease
  })
  await sleep(5)
  first.release()
  const cheapLease = await cheap
  assert(order[0] === 'lookup', 'a fitting lookup should bypass a temporarily blocked analytics call')
  cheapLease.release()
  second.release()
  const expensiveLease = await expensive
  assert(order[1] === 'analytics', 'the older analytics call should run as soon as enough weight is free')
  expensiveLease.release()
  assert(
    controller.snapshot().activeWeight === 0 && controller.snapshot().queuedCalls === 0,
    'all capacity should return to zero',
  )

  const blocker = await controller.acquire(analytics, 'stdio')
  const cancellation = new AbortController()
  const cancelled = controller.acquire(lookup, 'http', cancellation.signal).then(
    () => false,
    (error) => error instanceof Error && /cancel/i.test(error.message),
  )
  cancellation.abort()
  assert(await cancelled, 'queued cancellation should reject with a cancellation outcome')
  blocker.release()
  assert(
    controller.snapshot().activeWeight === 0 && controller.snapshot().queuedCalls === 0,
    'cancelled work must not leak queue or weight',
  )

  const fullController = new WeightedToolAdmissionController(1, 1, 25, false)
  const fullLease = await fullController.acquire(lookup, 'stdio')
  const timeout = fullController.acquire(lookup, 'stdio').then(
    () => false,
    (error) => error instanceof Error && /busy|bounded wait/i.test(error.message),
  )
  await sleep(2)
  const queueFull = await fullController.acquire(lookup, 'http').then(
    () => false,
    (error) => error instanceof Error && /busy|bounded wait/i.test(error.message),
  )
  assert(queueFull, 'a full queue should fail quickly with the structured overload source error')
  assert(await timeout, 'a queued call should fail inside its bounded wait budget')
  fullLease.release()
  assert(
    fullController.snapshot().activeWeight === 0 && fullController.snapshot().queuedCalls === 0,
    'timeout recovery should restore scheduler state',
  )

  const firstCaller = new AbortController()
  const secondCaller = new AbortController()
  let resolveShared!: (value: string) => void
  let sharedSignal: AbortSignal | undefined
  const shared = runWithPortalRequestSignal(firstCaller.signal, () =>
    runAsSharedPortalWork(
      () =>
        new Promise<string>((resolve) => {
          sharedSignal = getPortalRequestSignal()
          assert(
            sharedSignal !== undefined && sharedSignal !== firstCaller.signal,
            'shared work should use an independent cancellation signal',
          )
          resolveShared = resolve
        }),
    ),
  )
  const firstWait = runWithPortalRequestSignal(firstCaller.signal, () => waitForSharedPortalWork(shared))
  const secondWait = runWithPortalRequestSignal(secondCaller.signal, () => waitForSharedPortalWork(shared))
  firstCaller.abort()
  const firstCancelled = await firstWait.then(
    () => false,
    (error) => error instanceof RequestCancelledError,
  )
  assert(sharedSignal?.aborted === false, 'shared work should continue while another caller is waiting')
  resolveShared('shared result')
  assert(firstCancelled, 'one cancelled caller should stop waiting for shared work')
  assert((await secondWait) === 'shared result', 'another caller should still receive the shared result')

  const finalCaller = new AbortController()
  let sharedAbortObserved = false
  const abandoned = runAsSharedPortalWork(
    () =>
      new Promise<string>((_resolve, reject) => {
        const signal = getPortalRequestSignal()
        assert(signal !== undefined, 'shared work should expose its cancellation signal upstream')
        signal.addEventListener('abort', () => {
          sharedAbortObserved = true
          reject(new RequestCancelledError())
        }, { once: true })
      }),
  )
  const abandonedWait = waitForSharedPortalWork(abandoned, finalCaller.signal)
  finalCaller.abort()
  const finalCancelled = await abandonedWait.then(
    () => false,
    (error) => error instanceof RequestCancelledError,
  )
  assert(finalCancelled, 'the final cancelled caller should stop waiting for shared work')
  assert(sharedAbortObserved, 'shared upstream work should abort when its last caller leaves')

  console.log('PASS  weighted profiles preserve capacity for low-cost discovery')
  console.log('PASS  fair promotion avoids head-of-line blocking without starving analytics')
  console.log('PASS  queued cancellation, timeout, and overload release all scheduler state')
  console.log('PASS  shared analytics work stays live for active callers and aborts when abandoned')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
