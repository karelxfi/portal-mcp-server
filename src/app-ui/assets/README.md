# Explorer fonts

Only the mono face ships. Interface text uses the host's `--font-sans`
(every MCP Apps host supplies one through `applyHostFonts`) and falls back to
the system stack, so embedding a sans face cost 51 KB of base64 to render text
in a typeface the host had already chosen.

`jetbrains-mono-latin.woff2` is a variable face (weight 100–800) subset to the
101 characters the Explorer can emit: printable ASCII plus `·…↑→↓─` and the
punctuation and currency marks `formatValue` may produce. Values render in it
in every host, because a column of numbers that changes width as it updates is
harder to read than one that does not.

Regenerate it from an upstream JetBrains Mono release with:

```bash
pyftsubset JetBrainsMono[wght].ttf \
  --output-file=jetbrains-mono-latin.woff2 \
  --flavor=woff2 --layout-features='' --no-hinting --desubroutinize \
  --unicodes="U+0020-007E,U+00B7,U+2026,U+2191,U+2192,U+2193,U+2500,U+2212,U+00D7,U+00B1,U+2248,U+2264,U+2265,U+00A0,U+2007,U+2009,U+2013,U+2014,U+2018-201D,U+20AC,U+00A3,U+00A5,U+20BF"
```

`pyftsubset` comes from `fonttools`; `brotli` is needed for the woff2 flavor.
A glyph outside the subset falls back to the next family in `--sqd-font-mono`,
so adding a character to the UI does not break it, it only loses the SQD face.
