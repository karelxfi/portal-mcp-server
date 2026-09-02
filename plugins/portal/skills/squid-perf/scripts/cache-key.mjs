#!/usr/bin/env node

import { createHash } from 'node:crypto'

const [ref, since] = process.argv.slice(2)
if (!ref || !since) {
  process.stderr.write('usage: cache-key.mjs <ref> <since-ISO>\n')
  process.exit(2)
}

const readableRef =
  ref
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || 'deployment'
const refHash = createHash('sha256').update(ref).digest('hex').slice(0, 12)
const safeSince = since.replace(/[^a-zA-Z0-9._-]/g, '-')

process.stdout.write(`${readableRef}--${refHash}__${safeSince}.log\n`)
