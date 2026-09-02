#!/usr/bin/env tsx
// Packages the MCP Bundle, unpacks it in a temporary directory, starts it over
// stdio the way Claude Desktop would, and checks version, tool count, and
// prompt count. Needs `npm run build` first; no network.

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { Client } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const SIZE_BUDGET_BYTES = 15 * 1024 * 1024

async function main() {
  const packageVersion = String(JSON.parse(readFileSync('package.json', 'utf8')).version)
  execFileSync('node', ['scripts/package-mcpb.mjs'], { stdio: 'inherit' })
  const bundle = path.resolve('dist/mcpb/sqd.mcpb')
  const bytes = statSync(bundle).size
  assert(
    bytes > 1024 * 1024 && bytes <= SIZE_BUDGET_BYTES,
    `sqd.mcpb is ${bytes} bytes; expected between 1 MB and 15 MB`,
  )

  const unpacked = mkdtempSync(path.join(tmpdir(), 'sqd-mcpb-'))
  try {
    execFileSync('unzip', ['-q', bundle, '-d', unpacked])
    const manifest = JSON.parse(readFileSync(path.join(unpacked, 'manifest.json'), 'utf8'))
    assert(manifest.name === 'sqd' && manifest.display_name === 'SQD', 'manifest must name the bundle sqd / SQD')
    assert(manifest.version === packageVersion, `manifest version ${manifest.version} must match ${packageVersion}`)
    assert(manifest.server?.type === 'node' && manifest.server.entry_point === 'dist/index.js', 'manifest entry point')
    assert(manifest.user_config?.app_enabled?.type === 'boolean', 'manifest must expose MCP_APP_ENABLED as a boolean')
    assert(Array.isArray(manifest.tools) && manifest.tools.length === 31, 'manifest must list the 31 tools')
    assert(statSync(path.join(unpacked, 'icon.png')).size > 0, 'bundle must carry the icon')
    assert(statSync(path.join(unpacked, 'LICENSE')).size > 0, 'bundle must carry the licence')
    for (const forbidden of ['dist/index.js.map', 'dist/index.d.ts']) {
      let present = true
      try {
        statSync(path.join(unpacked, forbidden))
      } catch {
        present = false
      }
      assert(!present, `bundle must not ship ${forbidden}`)
    }

    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [path.join(unpacked, 'dist/index.js')],
      cwd: unpacked,
      env: { PATH: process.env.PATH ?? '', PORTAL_URL: 'http://127.0.0.1:9', MCP_APP_ENABLED: 'false' },
      stderr: 'pipe',
    })
    const client = new Client({ name: 'sqd-mcpb-test', version: '1.0.0' })
    await client.connect(transport)
    try {
      const serverVersion = client.getServerVersion()
      assert(serverVersion?.version === packageVersion, `bundle server reports ${serverVersion?.version}`)
      const tools = await client.listTools()
      assert(tools.tools.length === 31, `bundle should list 31 tools, got ${tools.tools.length}`)
      const prompts = await client.listPrompts()
      assert(prompts.prompts.length === 3, `bundle should list 3 prompts, got ${prompts.prompts.length}`)
      assert(
        tools.tools.every((tool) => tool._meta === undefined || !('ui/resourceUri' in (tool._meta as object))),
        'the bundle must not offer the beta app unless the user opts in',
      )
    } finally {
      await client.close()
    }
  } finally {
    rmSync(unpacked, { recursive: true, force: true })
  }

  console.log(
    `PASS  sqd.mcpb (${(bytes / 1024 / 1024).toFixed(2)} MB) unpacks, starts over stdio, and lists 31 tools at v${packageVersion}`,
  )
  console.log('\nMCPB QA passed')
}

main().catch((error) => {
  console.error('MCPB QA failed:', error)
  process.exitCode = 1
})
