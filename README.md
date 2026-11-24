# lawcite

One Zotero plugin for legal citation (Zotero 9 and 10), replacing three separate plugins:

| Part | What it does | Was |
|------|--------------|-----|
| **phoenix** | Juris-M-style legal item types and fields, CSL-M modules, Juris-M abbreviations and the Bluebook abbreviation rules | citation-phoenix (fork of Michael Risch's plugin) |
| **translators** | Web translators for Westlaw, Lexis+, Cornell LII, Federal Register, Bloomberg Law dockets and LegiScan bills | zotero-legal-translators |
| **hicite** | Pinned citation keys, hicite export and auto-export, collection and item menus, Settings pane | zotero-hicite |

Plugin ID `lawcite@zotero.local`. Requires Zotero 8.999 or later (the menu API hicite uses first appears in Zotero 9).

## Installing

lawcite replaces `citation-phoenix@michaelrisch.com`, `zotero-legal-translators@zotero.local` and
`hicite-export@zotero.local`. Running them together would patch Zotero twice and install duplicate
translators, so lawcite checks at startup: if any of the three is still enabled it starts nothing and
shows a message naming them. Disable or remove them under Tools > Plugins, then restart Zotero.

Your data is untouched: the legal fields, `Extra` data, citation keys and auto-export jobs are stored
in the library and in the same preferences the standalone plugins used.

## Styles

lawcite installs its own CSL styles into Zotero at startup, next to the Juris-M styles from citation-phoenix:

| Style | For | ID |
|-------|-----|----|
| Lawcite IndigoBook Law Review | law-review footnotes | `lawcite-indigobook-lawreview` |
| Lawcite IndigoBook Memoranda | legal memoranda, briefs and other practitioner documents | `lawcite-indigobook-memoranda` |
| Lawcite APA Style 7th edition | APA 7 with corrected legal references for bills, hearings and statutes | `lawcite-apa` |

Both are adapted from the JM Indigo Book styles by Frank Bennett (CC BY-SA 4.0) and add the Bluebook periodical
abbreviation rules. A bundled style is installed when it is missing and updated when its `<updated>` date is newer;
a style you have edited in Zotero's styles folder is overwritten only by a newer bundled version. Earlier copies
named `sheff-indigobook` and `sheff-indigobook-law-review` keep working but are no longer shipped.

In the IndigoBook-family styles (these two and the Juris-M Indigo Book styles) a U.S. Supreme Court case is cited by
its reporter alone, `5 U.S. 137 (1803)`, as Bluebook and Indigo Book require, even when the item's Court field is
set to the Supreme Court. State supreme courts, other courts and other styles are unaffected. APA 7 follows the same rule.

**Court keys in plain styles.** The Court field may hold a Juris-M key such as `court.appeals`. The Juris-M and lawcite
IndigoBook styles resolve it themselves; for every other style (APA, Chicago, ...) lawcite replaces the key with the
court's Bluebook abbreviation, found with the item's jurisdiction: `2d Cir.`, `S.D.N.Y.`, `N.Y. Sup. Ct.`. Court text you
typed yourself, and keys with no known abbreviation, are left exactly as entered.

**`lawcite-apa`** is Zotero's stock `apa.csl` with three corrections to legal references, made by
`modules/phoenix/scripts/make-lawcite-apa.py` (rerun it against a newer `apa.csl` to refresh the style):
bills and hearings print the congress from the Session field (`H.R. 6580, 117th Cong. (2022)`; stock APA printed the
legislative body and a bare `117`); a statute with a Section prints the code citation (`42 U.S.C. § 12101`; stock APA
dropped the section); and a public law number is always singular (`Pub. L. No. 101-336`, not `Nos.`).

## Layout

```
bootstrap.js        starts and stops the three parts; refuses to run beside the old plugins
manifest.json       plugin ID, version, Zotero range
build.py            builds dist/lawcite-<version>.xpi
test/               bootstrap tests and run-all.sh
modules/phoenix/    citation-phoenix (lib/ is bundled by esbuild into content/citation-phoenix.js)
modules/translators/  src/ + build.py -> translators/*.js, tests, fixtures
modules/hicite/     addon/ (hicite-export.js, translator, Settings pane), tests, tools
```

Each module keeps its own README (`README-*.md`) and tests, and still builds on its own. The module
READMEs describe the standalone plugins and may mention their old install steps.

## Building

```sh
ESBUILD=/path/to/esbuild python3 build.py     # or put esbuild on PATH
sh test/run-all.sh
```

`build.py` assembles the translators, bundles citation-phoenix, generates the
`locale/<lang>/citation-phoenix.ftl` files, stages the three parts into one tree and writes
`dist/lawcite-<version>.xpi`, then verifies it. Without esbuild it uses the committed bundle
and warns. The locale files are required in the xpi: without them Zotero's menu localization fails and
the item right-click menu does not open.

Tests need only macOS (JavaScriptCore and osascript) and Python 3.

## Attribution and licensing

See [NOTICE.md](NOTICE.md). In short: lawcite's own code, hicite and the translators are MIT
(Jeremy Sheff); the citation-phoenix code is used under a license grant from Michael Risch to Jeremy
Sheff, and the bundled Juris-M data keeps its own MIT and CC0 terms.
