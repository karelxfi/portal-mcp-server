import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { createReadinessTracker } from './readiness.js'

describe('createReadinessTracker', () => {
  it('is not ready until the catalog loads, then follows the probe age', async () => {
    let clock = 1_000_000
    let catalogAvailable = false
    let probeOk = true
    const tracker = createReadinessTracker({
      probeIntervalMs: 100,
      maxAgeMs: 1_000,
      now: () => clock,
      loadCatalog: async () => {
        if (!catalogAvailable) throw new Error('catalog offline')
        return { length: 3 }
      },
      probe: async () => {
        if (!probeOk) throw new Error('portal 503')
      },
    })

    assert.deepEqual(tracker.snapshot(), {
      ready: false,
      reason: 'catalog_not_loaded',
      probe_interval_ms: 100,
      max_age_ms: 1_000,
    })

    await tracker.tick()
    assert.equal(tracker.snapshot().ready, false)
    assert.equal(tracker.snapshot().reason, 'catalog_not_loaded')
    assert.equal(tracker.snapshot().last_probe_error, 'catalog offline')

    catalogAvailable = true
    await tracker.tick()
    const loaded = tracker.snapshot()
    assert.equal(loaded.ready, true)
    assert.equal(loaded.catalog_datasets, 3)
    assert.equal(loaded.catalog_loaded_at, new Date(clock).toISOString())
    assert.equal('last_probe_error' in loaded, false)

    clock += 1_500
    assert.equal(tracker.snapshot().ready, false)
    assert.equal(tracker.snapshot().reason, 'portal_probe_stale')

    await tracker.tick()
    assert.equal(tracker.snapshot().ready, true)

    probeOk = false
    clock += 1_500
    await tracker.tick()
    const failed = tracker.snapshot()
    assert.equal(failed.ready, false)
    assert.equal(failed.reason, 'portal_probe_failed')
    assert.equal(failed.last_probe_error, 'portal 503')

    probeOk = true
    await tracker.tick()
    assert.equal(tracker.snapshot().ready, true)
  })

  it('shares one in-flight tick', async () => {
    let calls = 0
    const tracker = createReadinessTracker({
      probeIntervalMs: 100,
      maxAgeMs: 1_000,
      loadCatalog: async () => {
        calls += 1
        return { length: 1 }
      },
      probe: async () => {},
    })
    await Promise.all([tracker.tick(), tracker.tick(), tracker.tick()])
    assert.equal(calls, 1)
  })
})
