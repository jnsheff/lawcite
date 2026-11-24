# Attribution and licensing notice

lawcite combines three codebases. Each part keeps its provenance and terms.

| Part | Directory | Origin | Terms |
|------|-----------|--------|-------|
| citation-phoenix | `modules/phoenix/` | [rischconsulting/citation-phoenix](https://github.com/rischconsulting/citation-phoenix) by Michael Risch, via Jeremy Sheff's fork | See below: Risch's grant to Sheff, plus bundled third-party data |
| Legal Translators | `modules/translators/` | Jeremy Sheff | MIT (`LICENSE`); the translators carry Zotero's AGPL-3.0 header so they can be submitted to Zotero's translator repository |
| hicite Export | `modules/hicite/` | Jeremy Sheff | MIT (`LICENSE`) |

## Credits

- **Michael Risch** wrote citation-phoenix: the plugin, its bundling of the Juris-M
  styles and its legal data handling. Georg Duffner contributed commits to the
  upstream repository.
- **Frank Bennett** created Juris-M, CSL-M and the legal resource registry and
  abbreviation datasets on which the jurisdiction, court and abbreviation data are
  based.
- **Charles Duan** wrote [hicite](https://github.com/charlesduan/hicite), the LaTeX
  legal citation package that the hicite export targets.

## citation-phoenix (`modules/phoenix/`)

The upstream repository does not state a public license for the plugin's own code.
Michael Risch granted Jeremy Sheff, by email on November 22, 2026, a perpetual,
transferable, sublicenseable, worldwide, royalty-free license to reproduce, prepare
derivative works of, and redistribute any copyrighted content that Risch owns, or
comes to own, in the citation-phoenix repository. lawcite uses and distributes that
code under that grant. The grant is limited to what Risch owns and is not a public
license: it gives no rights to anyone but Sheff and those to whom Sheff
sublicenses. Someone who wants to reuse the upstream code directly should ask Risch.

Changes by Sheff (Bluebook periodical abbreviations, year-only dates for reports,
hearings and regulations, the Sheff-IndigoBook styles and others) are covered by the
MIT license in `LICENSE`, except the CSL styles, which are CC BY-SA as stated in
their `<rights>` elements.

Bundled third-party material keeps its own terms:

- `modules/phoenix/juris-abbrevs/` is MIT, copyright 2014 Frank Bennett
  (`juris-abbrevs/LICENSE`). The `auto-*.json` files are built from the MIT-licensed
  Juris-M legal-resource-registry, copyright 2019 Juris-M Project, whose
  contributors include Georg Duffner; its notice is in
  `juris-abbrevs/LICENSE-legal-resource-registry`. The `juris-maps/` data is built
  from the same source.
- `modules/phoenix/style-modules/` is dedicated to the public domain under CC0 1.0
  (`style-modules/LICENSE`).
- The bundled CSL styles carry the license stated in each file's `<rights>` element,
  for example CC BY-SA 3.0 for `jm-indigobook.csl`. The Sheff-IndigoBook styles,
  adapted from the JM Indigo Book style by Frank Bennett, are CC BY-SA 4.0.

## Not carried over

citation-phoenix's own `Westlaw.js` and `Lexis+.js` translators (in
`modules/phoenix/translators/`) are not shipped or installed by lawcite. The
"(legal)" Westlaw and Lexis+ translators from `modules/translators/` replace them.
