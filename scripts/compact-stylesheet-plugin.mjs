import { readFile } from 'node:fs/promises'

/* The Explorer stylesheet is authored with comments and indentation; the
   shipped resource carries neither. Both the release bundle and the preview
   load it through this plugin so tests exercise what ships. */
export const compactStylesheet = {
  name: 'sqd-compact-stylesheet',
  setup(build) {
    build.onLoad({ filter: /app-ui[\\/]styles\.ts$/ }, async (args) => {
      const source = await readFile(args.path, 'utf8')
      const contents = source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\n[ \t]+/g, '\n')
        .replace(/\n{2,}/g, '\n')
      return { contents, loader: 'ts' }
    })
  },
}
