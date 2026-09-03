import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  connectionKeyFromRequest,
  evaluateBodyLimit,
  evaluateRequestGuard,
  hostnameFromHostHeader,
  hostnameFromOriginHeader,
  isLoopbackBind,
  parseHostList,
  readPositiveInt,
  readTrustedProxyCount,
  resolveRequestGuardPolicy,
} from './http-guard.js'

describe('header parsing', () => {
  it('drops the port and keeps IPv6 brackets', () => {
    assert.equal(hostnameFromHostHeader('portal.sqd.dev:443'), 'portal.sqd.dev')
    assert.equal(hostnameFromHostHeader('LOCALHOST:3000'), 'localhost')
    assert.equal(hostnameFromHostHeader('[::1]:3000'), '[::1]')
    assert.equal(hostnameFromHostHeader(''), undefined)
    assert.equal(hostnameFromHostHeader('bad host'), undefined)
    assert.equal(hostnameFromHostHeader(undefined), undefined)
  })

  it('reads the origin hostname and rejects opaque or malformed origins', () => {
    assert.equal(hostnameFromOriginHeader('https://Claude.ai'), 'claude.ai')
    assert.equal(hostnameFromOriginHeader('http://localhost:5173'), 'localhost')
    assert.equal(hostnameFromOriginHeader('null'), undefined)
    assert.equal(hostnameFromOriginHeader('not a url'), undefined)
  })

  it('splits comma lists and ignores blanks', () => {
    assert.deepEqual(parseHostList(' portal.sqd.dev, Example.com ,,'), ['portal.sqd.dev', 'example.com'])
    assert.deepEqual(parseHostList(undefined), [])
  })
})

describe('evaluateRequestGuard', () => {
  const policy = { allowedHosts: ['portal.sqd.dev'], allowedOrigins: ['claude.ai'] }

  it('accepts loopback hosts on any port without configuration', () => {
    assert.deepEqual(evaluateRequestGuard({ host: 'localhost:3000' }, { allowedHosts: [], allowedOrigins: [] }), {
      allowed: true,
    })
    assert.deepEqual(evaluateRequestGuard({ host: '127.0.0.1:9' }, { allowedHosts: [], allowedOrigins: [] }), {
      allowed: true,
    })
  })

  it('rejects a Host that is neither loopback nor allowlisted', () => {
    assert.deepEqual(evaluateRequestGuard({ host: 'attacker.example:3000' }, policy), {
      allowed: false,
      reason: 'host_not_allowed',
    })
    assert.deepEqual(evaluateRequestGuard({}, policy), { allowed: false, reason: 'host_not_allowed' })
    assert.deepEqual(evaluateRequestGuard({ host: 'portal.sqd.dev' }, policy), { allowed: true })
  })

  it('lets requests without Origin through and checks the ones that carry it', () => {
    assert.deepEqual(evaluateRequestGuard({ host: 'localhost' }, policy), { allowed: true })
    assert.deepEqual(evaluateRequestGuard({ host: 'localhost', origin: 'https://claude.ai' }, policy), {
      allowed: true,
    })
    assert.deepEqual(evaluateRequestGuard({ host: 'localhost', origin: 'http://localhost:4174' }, policy), {
      allowed: true,
    })
    assert.deepEqual(evaluateRequestGuard({ host: 'localhost', origin: 'https://evil.example' }, policy), {
      allowed: false,
      reason: 'origin_not_allowed',
    })
    assert.deepEqual(evaluateRequestGuard({ host: 'localhost', origin: 'null' }, policy), {
      allowed: false,
      reason: 'origin_not_allowed',
    })
  })

  it('treats * as an explicit off switch per header', () => {
    assert.deepEqual(
      evaluateRequestGuard(
        { host: 'anything.example', origin: 'https://evil.example' },
        { allowedHosts: ['*'], allowedOrigins: ['*'] },
      ),
      { allowed: true },
    )
    assert.deepEqual(
      evaluateRequestGuard(
        { host: 'anything.example', origin: 'https://evil.example' },
        { allowedHosts: ['*'], allowedOrigins: [] },
      ),
      { allowed: false, reason: 'origin_not_allowed' },
    )
  })
})

describe('resolveRequestGuardPolicy', () => {
  it('needs no configuration on loopback', () => {
    const policy = resolveRequestGuardPolicy({})
    assert.equal(policy.bind, '127.0.0.1')
    assert.deepEqual(policy.allowedHosts, [])
    assert.deepEqual(policy.allowedOrigins, [])
    assert.deepEqual(policy.warnings, [])
    assert.equal(isLoopbackBind('localhost'), true)
    assert.equal(isLoopbackBind('::1'), true)
    assert.equal(isLoopbackBind('0.0.0.0'), false)
  })

  it('records a startup error and switches the check off when a public bind has no list', () => {
    const policy = resolveRequestGuardPolicy({ MCP_BIND: '0.0.0.0' })
    assert.equal(policy.warnings.length, 2)
    assert.match(policy.warnings[0], /MCP_ALLOWED_HOSTS is not set/)
    assert.match(policy.warnings[1], /MCP_ALLOWED_ORIGINS is not set/)
    assert.deepEqual(policy.allowedHosts, ['*'])
    assert.deepEqual(policy.allowedOrigins, ['*'])
  })

  it('is quiet when a public bind names its hosts and origins', () => {
    const policy = resolveRequestGuardPolicy({
      MCP_BIND: '0.0.0.0',
      MCP_ALLOWED_HOSTS: 'portal.sqd.dev',
      MCP_ALLOWED_ORIGINS: '*',
    })
    assert.deepEqual(policy.warnings, [])
    assert.deepEqual(policy.allowedHosts, ['portal.sqd.dev'])
    assert.deepEqual(policy.allowedOrigins, ['*'])
  })
})

describe('connectionKeyFromRequest', () => {
  it('hashes the socket address, and a proxy hop only when a proxy is trusted', () => {
    const direct = connectionKeyFromRequest({ remoteAddress: '203.0.113.9', forwardedFor: '198.51.100.7, 10.0.0.1' }, 0)
    const trusted = connectionKeyFromRequest(
      { remoteAddress: '203.0.113.9', forwardedFor: '198.51.100.7, 10.0.0.1' },
      1,
    )
    assert.equal(direct, connectionKeyFromRequest({ remoteAddress: '203.0.113.9' }, 0))
    assert.notEqual(direct, trusted)
    assert.match(direct, /^[0-9a-f]{16}$/)
    assert.equal(direct.includes('203'), false)
    assert.equal(connectionKeyFromRequest({}, 0), connectionKeyFromRequest({ remoteAddress: undefined }, 1))
  })

  it('takes the hop the proxy wrote, not the one the caller chose', () => {
    // One proxy in front. The caller controls everything to the left of the
    // hop that proxy appends, so a key read from the front changes on every
    // request and the per-caller share stops limiting anything.
    const forged = (claim: string) =>
      connectionKeyFromRequest({ remoteAddress: '10.0.0.1', forwardedFor: `${claim}, 198.51.100.7` }, 1)

    assert.equal(forged('1.2.3.4'), forged('5.6.7.8'))
    assert.equal(forged('1.2.3.4'), connectionKeyFromRequest({ remoteAddress: '198.51.100.7' }, 0))
  })

  it('counts the trusted hops from the right', () => {
    const twoProxies = connectionKeyFromRequest(
      { remoteAddress: '10.0.0.1', forwardedFor: 'forged, 198.51.100.7, 10.0.0.2' },
      2,
    )

    assert.equal(twoProxies, connectionKeyFromRequest({ remoteAddress: '198.51.100.7' }, 0))
  })

  it('falls back to the socket when the header is shorter than the trusted chain', () => {
    // A request that did not come through the expected proxies carries no hop
    // this deployment can trust, so the socket address is the only usable key.
    assert.equal(
      connectionKeyFromRequest({ remoteAddress: '203.0.113.9', forwardedFor: '198.51.100.7' }, 2),
      connectionKeyFromRequest({ remoteAddress: '203.0.113.9' }, 0),
    )
    assert.equal(
      connectionKeyFromRequest({ remoteAddress: '203.0.113.9', forwardedFor: '  ,  ' }, 1),
      connectionKeyFromRequest({ remoteAddress: '203.0.113.9' }, 0),
    )
  })
})

describe('readTrustedProxyCount', () => {
  it('reads a switch or a hop count and refuses anything else', () => {
    assert.equal(readTrustedProxyCount('1'), 1)
    assert.equal(readTrustedProxyCount('true'), 1)
    assert.equal(readTrustedProxyCount('TRUE'), 1)
    assert.equal(readTrustedProxyCount('3'), 3)
    assert.equal(readTrustedProxyCount('0'), 0)
    assert.equal(readTrustedProxyCount('false'), 0)
    assert.equal(readTrustedProxyCount(undefined), 0)
    assert.equal(readTrustedProxyCount(''), 0)
    assert.equal(readTrustedProxyCount('yes'), 0)
    assert.equal(readTrustedProxyCount('-2'), 0)
  })
})

describe('evaluateBodyLimit', () => {
  it('bounds declared bodies and refuses unbounded uploads', () => {
    assert.deepEqual(evaluateBodyLimit({ 'content-length': '512' }, 'POST', 1024), { ok: true })
    assert.deepEqual(evaluateBodyLimit({ 'content-length': '2048' }, 'POST', 1024), {
      ok: false,
      status: 413,
      reason: 'body_too_large',
      declared: 2048,
    })
    assert.deepEqual(evaluateBodyLimit({ 'transfer-encoding': 'chunked' }, 'POST', 1024), {
      ok: false,
      status: 411,
      reason: 'length_required',
    })
    assert.deepEqual(evaluateBodyLimit({ 'content-length': 'abc' }, 'POST', 1024), {
      ok: false,
      status: 411,
      reason: 'length_required',
    })
    assert.deepEqual(evaluateBodyLimit({}, 'GET', 1024), { ok: true })
    assert.deepEqual(evaluateBodyLimit({}, 'POST', 1024), { ok: true })
  })

  it('reads positive integers from the environment with a fallback', () => {
    assert.equal(readPositiveInt('120000', 1), 120_000)
    assert.equal(readPositiveInt('', 7), 7)
    assert.equal(readPositiveInt('-1', 7), 7)
    assert.equal(readPositiveInt('nope', 7), 7)
    assert.equal(readPositiveInt(undefined, 7), 7)
  })
})
