import { defineConfig } from 'vite'

/**
 * Minimal Vite config for local UI iteration with HMR.
 *
 *   npm run dev:ui   → serves src/ui/preview.tsx at http://localhost:5173
 *
 * This has nothing to do with the MCP server build pipeline (esbuild →
 * single inline HTML bundle). It only exists so we can edit React
 * components and see the result in a browser without restarting anything.
 */
export default defineConfig({
  root: 'src/ui',
  server: {
    allowedHosts: ['.trycloudflare.com'],
    port: 5173,
    strictPort: true,
    open: false,
  },
  build: {
    outDir: '../../.preview-dist',
    emptyOutDir: true,
  },
  esbuild: {
    jsx: 'automatic',
  },
})
