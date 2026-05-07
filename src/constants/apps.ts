import { PORTAL_APP_BUNDLE_HASH } from '../generated/portal-app.version.js'

/**
 * MCP app resource URI.
 *
 * The suffix is a content hash of the compiled UI bundle (see
 * scripts/build-app-ui.mjs). Every time the UI source changes, the hash
 * flips and MCP clients (Claude Desktop / Claude.ai) refetch the HTML
 * instead of replaying cached copies. Fully automatic — nothing to bump
 * by hand.
 */
export const PORTAL_APP_RESOURCE_URI = `ui://portal/app.${PORTAL_APP_BUNDLE_HASH}.html` as const
