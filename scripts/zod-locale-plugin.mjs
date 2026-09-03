/*
 * zod ships 53 locale tables and `zod/v4/core/index.js` re-exports them as a
 * namespace (`export * as locales`), which a bundler cannot tree-shake: the
 * namespace object has to be complete, so every language ships. In the SQD
 * Explorer bundle that was 149,086 bytes — 21% of the whole app — for error
 * messages in languages it never renders. The Explorer never calls
 * `z.config({ locale })`, and zod's default is English.
 *
 * This plugin replaces the locale barrel with one that has the same shape and
 * one implementation behind it. `locales.de` still resolves to a function, so
 * any code reaching for a locale keeps working; it just answers in English.
 */

import { readFileSync } from 'node:fs'

const LOCALE_BARREL = /[\\/]zod[\\/]v4[\\/]locales[\\/]index\.js$/

export const zodEnglishLocaleOnly = {
  name: 'zod-english-locale-only',
  setup(build) {
    build.onLoad({ filter: LOCALE_BARREL }, (args) => {
      const source = readFileSync(args.path, 'utf8')
      const names = [...source.matchAll(/export \{ default as (\w+) \} from/g)].map((match) => match[1])
      if (!names.includes('en')) return null

      const aliases = names.filter((name) => name !== 'en').map((name) => `export { en as ${name} }`)
      return {
        contents: [
          `export { default as en } from './en.js'`,
          `import { default as en } from './en.js'`,
          ...aliases,
        ].join('\n'),
        loader: 'js',
        resolveDir: args.path.replace(/[\\/]index\.js$/, ''),
      }
    })
  },
}
