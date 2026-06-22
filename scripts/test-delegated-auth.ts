#!/usr/bin/env tsx

import assert from 'node:assert/strict'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createHash } from 'node:crypto'
import { setTimeout as sleep } from 'node:timers/promises'

const PORT = 3196
const BASE_URL = `http://localhost:${PORT}`
const LOCAL_PORTAL_HOST = 'sqd.portal.localhost'
const PORTAL_KEY_FIELD = 'api_key'
const TEST_PORTAL_KEY = 'local-test-key'

let child: ChildProcessWithoutNullStreams | undefined

async function waitForHealth() {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${BASE_URL}/health`)
      if (response.ok) return
    } catch {
      // keep polling until ready
    }
    await sleep(150)
  }
  throw new Error('Delegated auth test server did not become healthy')
}

function parseSseJson(text: string) {
  const dataLine = text
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.startsWith('data: '))
  assert(dataLine, `Expected SSE data line, got: ${text.slice(0, 240)}`)
  return JSON.parse(dataLine.slice('data: '.length))
}

function pkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url')
}

async function postRpc(token: string | undefined, host = LOCAL_PORTAL_HOST) {
  const response = await fetch(`${BASE_URL}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'x-forwarded-host': host,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
  })
  const text = await response.text()
  return { response, text }
}

async function main() {
  console.log('Starting delegated MCP auth QA...\n')

  child = spawn('node', ['dist/http.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(PORT),
      MCP_DELEGATED_AUTH: 'true',
      MCP_DELEGATED_AUTH_VALIDATE: 'false',
      MCP_TRUST_FORWARDED_HOST: 'true',
      PORTAL_ENDPOINTS: JSON.stringify([
        { id: 'public', portalBaseUrl: 'https://portal.sqd.dev', label: 'Public Portal' },
        {
          id: 'sqd-internal',
          portalBaseUrl: 'https://portal.sqd.dev',
          label: 'SQD internal Portal',
          endpointClass: 'internal',
          tenantScope: 'tenant',
          tenantId: 'sqd',
          authMode: 'delegated_api_key',
          headerName: 'x-api-key',
          mcpHostnames: [LOCAL_PORTAL_HOST],
        },
      ]),
      PORTAL_DEFAULT_ENDPOINT_ID: 'sqd-internal',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  child.stderr.on('data', (chunk) => process.stderr.write(chunk))

  await waitForHealth()

  const ready = await fetch(`${BASE_URL}/ready`, { headers: { 'x-forwarded-host': LOCAL_PORTAL_HOST } })
  assert.equal(ready.ok, true)
  const readyJson = await ready.json()
  const authCheck = readyJson.checks.find((check: { name: string }) => check.name === 'mcp_auth')
  assert.equal(authCheck.status, 'ok')
  assert.equal(authCheck.details.delegated_enabled, true)
  const portalCheck = readyJson.checks.find((check: { name: string }) => check.name === 'portal_reachability')
  assert.equal(portalCheck.status, 'skipped')

  const page = await fetch(`${BASE_URL}/mcp/auth`, { headers: { 'x-forwarded-host': LOCAL_PORTAL_HOST } })
  assert.equal(page.ok, true)
  assert.match(page.headers.get('content-security-policy') ?? '', /frame-ancestors 'none'/)
  assert.equal(page.headers.get('referrer-policy'), 'no-referrer')
  assert.equal(page.headers.get('x-content-type-options'), 'nosniff')
  assert.equal(page.headers.get('x-frame-options'), 'DENY')
  const pageHtml = await page.text()
  assert.match(pageHtml, /Portal MCP/)
  assert.match(pageHtml, /class="sqd-symbol"/)
  assert.match(pageHtml, /SQD internal Portal/)
  assert.match(pageHtml, /Manual bootstrap/)
  assert.match(pageHtml, /Hidden from browser/)
  assert.match(pageHtml, /Connect MCP/)
  assert.equal(pageHtml.includes(TEST_PORTAL_KEY), false)

  const coercedAuthPage = await fetch(`${BASE_URL}/mcp/auth?host=attacker.portal.sqd.dev`, {
    headers: { 'x-forwarded-host': LOCAL_PORTAL_HOST },
  })
  assert.equal(coercedAuthPage.ok, true)
  const coercedAuthHtml = await coercedAuthPage.text()
  assert.match(coercedAuthHtml, /SQD internal Portal/)
  assert.equal(coercedAuthHtml.includes('attacker.portal.sqd.dev'), false)

  const publicAnonymous = await postRpc(undefined, 'portal.sqd.dev')
  assert.equal(publicAnonymous.response.ok, true)
  const publicAnonymousJson = parseSseJson(publicAnonymous.text)
  assert.equal(Boolean(publicAnonymousJson.error), false)
  assert.equal(Array.isArray(publicAnonymousJson.result.tools), true)

  const missing = await postRpc(undefined)
  assert.equal(missing.response.status, 401)
  assert.match(missing.response.headers.get('www-authenticate') ?? '', /resource_metadata=/)
  assert.match(missing.response.headers.get('www-authenticate') ?? '', /scope="mcp:invoke"/)
  assert.equal(JSON.parse(missing.text).error.message, 'Unauthorized.')

  const protectedResource = await fetch(`${BASE_URL}/.well-known/oauth-protected-resource`, {
    headers: { 'x-forwarded-host': LOCAL_PORTAL_HOST },
  })
  assert.equal(protectedResource.ok, true)
  const protectedResourceJson = await protectedResource.json()
  assert.equal(protectedResourceJson.resource, `http://${LOCAL_PORTAL_HOST}/mcp`)
  assert.deepEqual(protectedResourceJson.scopes_supported, ['mcp:invoke'])

  const malformedForwardedHost = await fetch(`${BASE_URL}/.well-known/oauth-protected-resource`, {
    headers: { 'x-forwarded-host': 'evil.example/path' },
  })
  assert.equal(malformedForwardedHost.ok, true)
  const malformedForwardedHostText = await malformedForwardedHost.text()
  assert.equal(malformedForwardedHostText.includes('evil.example'), false)

  const unknownForwardedHost = await fetch(`${BASE_URL}/.well-known/oauth-protected-resource`, {
    headers: { 'x-forwarded-host': 'evil.example' },
  })
  assert.equal(unknownForwardedHost.status, 400)
  assert.equal((await unknownForwardedHost.json()).error, 'Unknown MCP host.')

  const authorizationServer = await fetch(`${BASE_URL}/.well-known/oauth-authorization-server`, {
    headers: { 'x-forwarded-host': LOCAL_PORTAL_HOST },
  })
  assert.equal(authorizationServer.ok, true)
  const authorizationServerJson = await authorizationServer.json()
  assert.equal(authorizationServerJson.authorization_endpoint, `http://${LOCAL_PORTAL_HOST}/oauth/authorize`)
  assert.equal(authorizationServerJson.token_endpoint, `http://${LOCAL_PORTAL_HOST}/oauth/token`)
  assert.deepEqual(authorizationServerJson.code_challenge_methods_supported, ['S256'])

  const registration = await fetch(`${BASE_URL}/oauth/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-forwarded-host': LOCAL_PORTAL_HOST,
    },
    body: JSON.stringify({
      client_name: 'Local delegated auth smoke',
      redirect_uris: ['http://127.0.0.1/callback'],
      grant_types: ['authorization_code'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    }),
  })
  assert.equal(registration.status, 201)
  const registrationJson = await registration.json()
  assert.match(registrationJson.client_id, /^mcp_client_/)
  assert.equal(registrationJson.token_endpoint_auth_method, 'none')

  const codeVerifier = 'local-test-code-verifier-with-enough-entropy'
  const resource = `http://${LOCAL_PORTAL_HOST}/mcp`
  const authorizeParams = new URLSearchParams({
    response_type: 'code',
    client_id: registrationJson.client_id,
    redirect_uri: 'http://127.0.0.1/callback',
    scope: 'openid profile mcp:invoke extra:ignored',
    state: 'delegated-state',
    code_challenge: pkceChallenge(codeVerifier),
    code_challenge_method: 'S256',
    resource,
  })
  const authorizePage = await fetch(`${BASE_URL}/oauth/authorize?${authorizeParams}`, {
    headers: { 'x-forwarded-host': LOCAL_PORTAL_HOST },
  })
  assert.equal(authorizePage.ok, true)
  assert.match(authorizePage.headers.get('content-security-policy') ?? '', /form-action 'self'/)
  assert.match(authorizePage.headers.get('content-security-policy') ?? '', /frame-ancestors 'none'/)
  assert.equal(authorizePage.headers.get('referrer-policy'), 'no-referrer')
  assert.equal(authorizePage.headers.get('x-content-type-options'), 'nosniff')
  assert.equal(authorizePage.headers.get('x-frame-options'), 'DENY')
  const authorizeHtml = await authorizePage.text()
  assert.match(authorizeHtml, /Portal MCP/)
  assert.match(authorizeHtml, /class="sqd-symbol"/)
  assert.match(authorizeHtml, /This connection is scoped to sqd\.portal\.localhost/)
  assert.match(authorizeHtml, /<span class="summary-label">Return<\/span><span class="summary-value">http:\/\/127\.0\.0\.1<\/span>/)
  assert.match(authorizeHtml, /Your Portal API key is used only for this Portal endpoint/)
  assert.match(authorizeHtml, /Connect MCP/)
  assert.equal(authorizeHtml.includes('no MCP bearer token is shown'), false)
  assert.equal(authorizeHtml.includes('is not shown back here'), false)
  assert.equal(authorizeHtml.includes('Connection request'), false)
  assert.equal(authorizeHtml.includes('Connect SQD internal Portal'), false)
  assert.equal(authorizeHtml.includes('Paste your Portal API key'), false)
  assert.equal(authorizeHtml.includes('Local delegated auth smoke'), false)
  assert.equal(authorizeHtml.includes('Access'), false)
  assert.equal(authorizeHtml.includes('This Portal only'), false)
  assert.equal(authorizeHtml.includes(TEST_PORTAL_KEY), false)

  const attackerResourceParams = new URLSearchParams({
    ...Object.fromEntries(authorizeParams),
    resource: 'https://attacker.example/mcp',
  })
  const attackerResourcePage = await fetch(`${BASE_URL}/oauth/authorize?${attackerResourceParams}`, {
    headers: { 'x-forwarded-host': LOCAL_PORTAL_HOST },
  })
  assert.equal(attackerResourcePage.status, 400)
  assert.match(await attackerResourcePage.text(), /OAuth resource must match this Portal MCP endpoint/)

  const attackerPortalResourceParams = new URLSearchParams({
    ...Object.fromEntries(authorizeParams),
    resource: 'https://attacker.portal.sqd.dev/mcp',
  })
  const attackerPortalResourcePage = await fetch(`${BASE_URL}/oauth/authorize?${attackerPortalResourceParams}`, {
    headers: { 'x-forwarded-host': LOCAL_PORTAL_HOST },
  })
  assert.equal(attackerPortalResourcePage.status, 400)
  const attackerPortalResourceHtml = await attackerPortalResourcePage.text()
  assert.match(attackerPortalResourceHtml, /OAuth resource must match this Portal MCP endpoint/)
  assert.match(attackerPortalResourceHtml, /This connection is scoped to sqd\.portal\.localhost/)

  const attackerHostParamPage = await fetch(`${BASE_URL}/oauth/authorize?${authorizeParams}&host=attacker.portal.sqd.dev`, {
    headers: { 'x-forwarded-host': LOCAL_PORTAL_HOST },
  })
  assert.equal(attackerHostParamPage.ok, true)
  const attackerHostParamHtml = await attackerHostParamPage.text()
  assert.match(attackerHostParamHtml, /This connection is scoped to sqd\.portal\.localhost/)
  assert.equal(attackerHostParamHtml.includes('attacker.portal.sqd.dev'), false)

  const authorizeSubmit = await fetch(`${BASE_URL}/oauth/authorize`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'x-forwarded-host': LOCAL_PORTAL_HOST,
    },
    body: new URLSearchParams({
      ...Object.fromEntries(authorizeParams),
      [PORTAL_KEY_FIELD]: TEST_PORTAL_KEY,
    }),
  })
  assert.equal(authorizeSubmit.status, 302)
  const redirectLocation = authorizeSubmit.headers.get('location') ?? ''
  assert.match(redirectLocation, /^http:\/\/127\.0\.0\.1\/callback\?/)
  assert.equal(redirectLocation.includes(TEST_PORTAL_KEY), false)
  assert.equal(redirectLocation.includes('mcp_'), false)
  const redirectUrl = new URL(redirectLocation)
  assert.match(redirectUrl.searchParams.get('code') ?? '', /^oauth_code_/)
  assert.equal(redirectUrl.searchParams.get('state'), 'delegated-state')
  assert.equal(redirectUrl.searchParams.get('iss'), `http://${LOCAL_PORTAL_HOST}`)

  const oauthToken = await fetch(`${BASE_URL}/oauth/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'x-forwarded-host': LOCAL_PORTAL_HOST,
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: redirectUrl.searchParams.get('code') ?? '',
      client_id: registrationJson.client_id,
      redirect_uri: 'http://127.0.0.1/callback',
      code_verifier: codeVerifier,
      resource,
    }),
  })
  assert.equal(oauthToken.ok, true)
  const oauthTokenJson = await oauthToken.json()
  assert.match(oauthTokenJson.access_token, /^mcp_/)
  assert.equal(oauthTokenJson.token_type, 'Bearer')
  assert.equal(oauthTokenJson.scope, 'mcp:invoke')
  assert.equal(JSON.stringify(oauthTokenJson).includes(TEST_PORTAL_KEY), false)

  const oauthListed = await postRpc(oauthTokenJson.access_token)
  assert.equal(oauthListed.response.ok, true)
  const oauthListedJson = parseSseJson(oauthListed.text)
  assert.equal(Boolean(oauthListedJson.error), false)

  const oauthWrongHost = await postRpc(oauthTokenJson.access_token, 'portal.sqd.dev')
  assert.equal(oauthWrongHost.response.status, 401)

  const authorizeSubmitForMissingResource = await fetch(`${BASE_URL}/oauth/authorize`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'x-forwarded-host': LOCAL_PORTAL_HOST,
    },
    body: new URLSearchParams({
      ...Object.fromEntries(authorizeParams),
      state: 'missing-resource-state',
      [PORTAL_KEY_FIELD]: TEST_PORTAL_KEY,
    }),
  })
  assert.equal(authorizeSubmitForMissingResource.status, 302)
  const missingResourceRedirectUrl = new URL(authorizeSubmitForMissingResource.headers.get('location') ?? '')
  const missingResourceToken = await fetch(`${BASE_URL}/oauth/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'x-forwarded-host': LOCAL_PORTAL_HOST,
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: missingResourceRedirectUrl.searchParams.get('code') ?? '',
      client_id: registrationJson.client_id,
      redirect_uri: 'http://127.0.0.1/callback',
      code_verifier: codeVerifier,
    }),
  })
  assert.equal(missingResourceToken.status, 400)
  const missingResourceTokenJson = await missingResourceToken.json()
  assert.equal(missingResourceTokenJson.error, 'invalid_grant')
  assert.match(missingResourceTokenJson.error_description, /resource is required/)

  const reusedCode = await fetch(`${BASE_URL}/oauth/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'x-forwarded-host': LOCAL_PORTAL_HOST,
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: redirectUrl.searchParams.get('code') ?? '',
      client_id: registrationJson.client_id,
      redirect_uri: 'http://127.0.0.1/callback',
      code_verifier: codeVerifier,
      resource,
    }),
  })
  assert.equal(reusedCode.status, 400)

  const auth = await fetch(`${BASE_URL}/mcp/auth`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'x-forwarded-host': LOCAL_PORTAL_HOST,
    },
    body: JSON.stringify({ [PORTAL_KEY_FIELD]: TEST_PORTAL_KEY }),
  })
  assert.equal(auth.ok, true)
  const authJson = await auth.json()
  assert.match(authJson.mcp_token, /^mcp_/)
  assert.equal(authJson.endpoint_id, 'sqd-internal')
  assert.equal(JSON.stringify(authJson).includes(TEST_PORTAL_KEY), false)

  const htmlAuth = await fetch(`${BASE_URL}/mcp/auth?debug=1`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'x-forwarded-host': LOCAL_PORTAL_HOST,
    },
    body: new URLSearchParams({ [PORTAL_KEY_FIELD]: TEST_PORTAL_KEY }),
  })
  assert.equal(htmlAuth.ok, true)
  const htmlAuthText = await htmlAuth.text()
  assert.match(htmlAuthText, /Connected\./)
  assert.match(htmlAuthText, /Return to your MCP client/)
  assert.equal(htmlAuthText.includes(TEST_PORTAL_KEY), false)
  assert.equal(htmlAuthText.includes('mcp_'), false)
  assert.equal(htmlAuthText.includes('<textarea'), false)

  const listed = await postRpc(authJson.mcp_token)
  assert.equal(listed.response.ok, true)
  const listedJson = parseSseJson(listed.text)
  assert.equal(Boolean(listedJson.error), false)
  assert.equal(Array.isArray(listedJson.result.tools), true)
  assert.equal(listedJson.result.tools.length, 28)

  const tools = await fetch(`${BASE_URL}/tools`, { headers: { 'x-forwarded-host': LOCAL_PORTAL_HOST } })
  assert.equal(tools.ok, true)
  const toolsJson = await tools.json()
  assert.equal(toolsJson.endpoint.id, 'sqd-internal')
  assert.equal(toolsJson.endpoint.auth_mode, 'delegated_api_key')
  assert.equal(toolsJson.endpoint.auth_required, true)

  console.log('PASS  /mcp/auth renders the local API-key bootstrap page')
  console.log('PASS  MCP OAuth discovery, registration, PKCE auth code, and token exchange work without user token copy')
  console.log('PASS  /mcp/auth JSON bootstrap mints an MCP bearer token without echoing the Portal key')
  console.log('PASS  /mcp/auth browser success hides internal MCP bearer token')
  console.log('PASS  Delegated MCP bearer token authorizes HTTP tools/list')
  console.log('PASS  Host-routed metadata reports delegated_api_key safely')
  console.log('\nDelegated MCP auth QA passed')
}

main()
  .catch((error) => {
    console.error('Delegated MCP auth QA failed:', error)
    process.exitCode = 1
  })
  .finally(() => {
    child?.kill()
  })
