# lawcite

One Zotero plugin for legal citation (Zotero 9 and 10), replacing three separate plugins and adding Perma.cc archiving:

| Part | What it does | Was |
|------|--------------|-----|
| **phoenix** | Juris-M-style legal item types and fields, CSL-M modules, Juris-M abbreviations and the Bluebook abbreviation rules | citation-phoenix (fork of Michael Risch's plugin) |
| **translators** | Web translators for Westlaw, Lexis+, Cornell LII, Federal Register, Bloomberg Law dockets and LegiScan bills | zotero-legal-translators |
| **hicite** | Pinned citation keys, hicite export and auto-export, collection and item menus, Settings pane | zotero-hicite |
| **permacc** | Perma.cc archives for the web URLs in your libraries, shown in citations (new) | |

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

## Perma.cc archiving

The Perma.cc part keeps a [Perma.cc](https://perma.cc) archive for every web URL in your libraries and can show the
archive in your citations. Set it up under Settings, then Perma.cc.

- **Signing in.** Perma.cc's API has no password login, only API keys, so the pane links you to Perma.cc's key page
  (Settings, then Tools, then "Generate an API key") and asks you to paste the key. "Save and verify" checks it with
  Perma.cc. The key is kept in Zotero's password store (the login manager) by default; untick "Remember my API key" and
  lawcite keeps it in memory only, deleting any stored copy, so you paste it again each session.
- **What is stored.** The archive's link goes in the item's Extra field as a line, `perma-cc: https://perma.cc/ABCD-1234`
  (the form already used in the author's library). The item's own URL field is never changed. Delete that line to have
  the item archived again.
- **Never paying twice.** Before anything is sent to Perma.cc, lawcite checks for an archive that already exists:
  an Extra line in any spelling (`perma-cc:`, `Perma.cc:`, `perma.cc:`, `permacc:`, extra spaces, or a bare
  `https://perma.cc/ABCD-1234` line), a child link attachment whose address is a Perma.cc link, or a child note that holds
  one. Lines that only look related (`Library Catalog: perma.cc`, a citation key that contains "perma") are not archives,
  and an item whose URL is itself a Perma.cc page is skipped. Then it reads the archives already in your Perma.cc account
  (the API's paged list) and, for a URL that is already archived there, records that archive in Extra instead of creating
  another (the newest, skipping deleted archives and failed captures); it does not move your existing archives between
  folders. If your account cannot be read, nothing is archived rather than risk duplicates. Existing lines are never
  rewritten.
- **How URLs appear.** Choose `[URL], archived at [Perma.cc URL]` (the default), `[Perma.cc URL]`, or `[URL]`. This
  applies to items that have an archive, in every citation style, because it is applied when the citation is built.
- **Folders.** Archives are filed in Perma.cc folders that mirror your collections: your organization folder (the default; or your personal folder, if you choose it in settings), then `Zotero`, then
  the library's name (shared group libraries get their own), then the collection path. A Perma.cc archive lives in one
  folder, so an item in several collections is filed under its first collection by name; an item in none goes in the
  library's folder. Folders are created and reused as needed; renaming a collection later does not rename the folder.
- **Turning it on.** Nothing is archived until you say so. After the first successful connection lawcite counts the URLs
  that need an archive and asks whether to archive new ones automatically. Automatic archiving is prospective only: it
  covers items added after you switch it on. Existing libraries are archived only when you press "Archive now". The
  "Archive new URLs automatically" checkbox and "Archive now" are in the pane, as are "Pause", "Retry failed", the list of libraries to include
  (libraries you can edit, including shared groups; archiving writes the Extra line into those items) and a list of
  sites never to archive. The list starts with subscription sites whose pages need a login (Westlaw, Lexis, Bloomberg
  Law, HeinOnline), which would only be captured as a login page, and with repositories that are already permanent
  records (arXiv, SSRN, JSTOR).
- **Cost and privacy.** Every archived page is sent to Perma.cc and counts against your account's allowance. Perma.cc
  does not document its quotas or rate limits in the developer docs, so lawcite paces its requests, retries on
  rate-limit and server errors, stops when Perma.cc reports a limit or rejects the key, and gives up after five failures in
  a row. Archives follow your Perma.cc default visibility; tick "Make my archives private" to make every one private.
- **Failures.** A page Perma.cc rejects is not retried for a day. If a capture later fails, lawcite takes the link back
  out of Extra so the item is retried.
- **Limits.** If you change an item's URL, delete its `Perma.cc:` line so the new address is archived. The Extra line is
  matched by its form, so edits that keep the form are fine. Archives you made by hand are recognized only if your account
  holds an archive of the same address (compared without regard to the host's case or a trailing slash); a page that
  Perma.cc archived under a different address is not.

To test the whole flow without a real account, `modules/permacc/test/mock-perma.py` is a local stand-in for the Perma.cc
API: point the hidden preference `extensions.zotero.lawcite.permacc.apiBase` at it. Only while that preference is changed
may the hidden `testKey` preference supply the key.

## Layout

```
bootstrap.js        starts and stops the three parts; refuses to run beside the old plugins
manifest.json       plugin ID, version, Zotero range
build.py            builds dist/lawcite-<version>.xpi
test/               bootstrap tests and run-all.sh
modules/phoenix/    citation-phoenix (lib/ is bundled by esbuild into content/citation-phoenix.js)
modules/translators/  src/ + build.py -> translators/*.js, tests, fixtures
modules/hicite/     addon/ (hicite-export.js, translator, Settings pane), tests, tools
modules/permacc/    addon/ (permacc.js, Settings pane, default prefs), tests, a mock Perma.cc server
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
