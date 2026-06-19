#!/usr/bin/env tsx

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

import { getReadinessReport, type ReadinessReport } from '../src/readiness.js'

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function findCheck(report: ReadinessReport, name: string) {
  const check = report.checks.find((entry) => entry.name === name)
  assert(check, `Readiness report should include ${name}`)
  return check
}

function assertSafeReport(report: ReadinessReport) {
  const serialized = JSON.stringify(report)
  assert.equal(serialized.includes('https://portal.sqd.dev'), false, 'Readiness should not expose Portal base URLs')
  assert.equal(serialized.includes('enterprise.portal.example.com'), false, 'Readiness should not expose enterprise Portal base URLs')
  assert.equal(serialized.includes('tenant-secret'), false, 'Readiness should not expose raw tenant ids')
  assert.equal(serialized.includes('super-secret'), false, 'Readiness should not expose credential values')
}

async function main() {
  console.log('Starting readiness QA...\n')

  const strictMissing = await getReadinessReport({
    MCP_READINESS_STRICT: 'true',
    MCP_READY_CHECK_PORTAL: 'false',
    METRICS_PUBLIC: 'true',
  })
  assert.equal(strictMissing.status, 'not_ready')
  assert.equal(findCheck(strictMissing, 'portal_endpoint_config').status, 'ok')
  assert.equal(findCheck(strictMissing, 'cursor_secret').status, 'error')
  assert.equal(findCheck(strictMissing, 'mcp_auth').status, 'error')
  assert.equal(findCheck(strictMissing, 'metrics_protection').status, 'error')
  assert.equal(findCheck(strictMissing, 'portal_reachability').status, 'skipped')
  assertSafeReport(strictMissing)

  const strictReady = await getReadinessReport({
    MCP_READINESS_STRICT: 'true',
    MCP_READY_CHECK_PORTAL: 'false',
    MCP_CURSOR_SECRET: 'cursor-secret',
    MCP_HTTP_BEARER_TOKEN: 'mcp-token',
    METRICS_BEARER_TOKEN: 'metrics-token',
  })
  assert.equal(strictReady.status, 'ready')
  assert.equal(findCheck(strictReady, 'cursor_secret').status, 'ok')
  assert.equal(findCheck(strictReady, 'mcp_auth').status, 'ok')
  assert.equal(findCheck(strictReady, 'metrics_protection').status, 'ok')
  assertSafeReport(strictReady)

  const enterpriseMissingPortalCredential = await getReadinessReport({
    MCP_READY_CHECK_PORTAL: 'true',
    MCP_CURSOR_SECRET: 'cursor-secret',
    METRICS_BEARER_TOKEN: 'metrics-token',
    PORTAL_ENDPOINTS: JSON.stringify([
      {
        id: 'enterprise-prod',
        baseUrl: 'https://enterprise.portal.example.com/sqd',
        label: 'Enterprise safe label',
        endpointClass: 'enterprise',
        tenantScope: 'tenant',
        tenantId: 'tenant-secret',
        authMode: 'bearer',
        tokenEnv: 'ENTERPRISE_PORTAL_TOKEN',
      },
    ]),
    MCP_AUTH_KEYS: JSON.stringify([
      {
        id: 'enterprise-user-key',
        audience: 'portal-mcp',
        tokenSha256: sha256Hex('hosted-secret'),
        principalId: 'user:alex',
        endpointId: 'enterprise-prod',
        scopes: ['mcp:invoke'],
      },
    ]),
  })
  assert.equal(enterpriseMissingPortalCredential.status, 'not_ready')
  assert.equal(findCheck(enterpriseMissingPortalCredential, 'portal_reachability').status, 'error')
  assert.match(findCheck(enterpriseMissingPortalCredential, 'portal_reachability').message, /Missing Portal credential/)
  assertSafeReport(enterpriseMissingPortalCredential)

  console.log('PASS  Strict readiness reports missing cursor secret, MCP auth, and metrics protection')
  console.log('PASS  Strict readiness passes with auth, cursor signing, and metrics protection configured')
  console.log('PASS  Enterprise Portal credential failures are visible without leaking URLs, tenant ids, or secrets')
  console.log('\nReadiness QA passed')
}

main().catch((error) => {
  console.error('Readiness QA failed:', error)
  process.exitCode = 1
})
