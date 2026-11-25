#!/usr/bin/env python3
"""Structural check of the composed lawcite Settings pane (it cannot be clicked through headlessly). Prints 'pane OK ...'.

Checks that the composed fragment is well-formed as Zotero parses it (XUL default namespace, HTML under html:); has one
root carrying the `main-section` class (where Zotero puts the pane title) and the load hook; has the three sections in
order (Perma.cc, hicite, Jurisdictions); has unique ids; has no nested load hooks, namespace declarations or markers
left from composing; and that every script, stylesheet, element lookup, handler and bound preference the pane relies on
exists."""
import os, re, sys
import xml.etree.ElementTree as ET
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import build

errors = []
xhtml = build.compose_pane()
wrapped = ('<root xmlns="http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul" xmlns:html="http://www.w3.org/1999/xhtml">'
           + re.sub(r'<!--.*?-->', '', xhtml, flags=re.S) + '</root>')
try:
    tree = ET.fromstring(wrapped)
except ET.ParseError as e:
    sys.exit('FAIL\n  composed pane is not well-formed: %s' % e)

def local(el): return el.tag.rsplit('}', 1)[-1]
top = list(tree)
if len(top) != 1 or local(top[0]) != 'vbox' or top[0].get('id') != 'lawcite-prefs': errors.append('the fragment must be one <vbox id="lawcite-prefs">')
rootel = top[0]
if 'main-section' not in (rootel.get('class') or '').split(): errors.append('the root needs class main-section (the pane title goes there)')
if rootel.get('onload') != 'Zotero.LawcitePrefs.init()': errors.append('the root needs onload="Zotero.LawcitePrefs.init()"')
if xhtml.count('main-section') != 1: errors.append('main-section appears %d times; Zotero uses the first, so only the root may have it' % xhtml.count('main-section'))
if xhtml.count('onload=') != 1: errors.append('nested onload attributes would never fire')
if 'xmlns' in xhtml: errors.append('namespace declarations left in the composed fragment')
if '@@' in xhtml: errors.append('an unreplaced @@marker@@')

sections = [(g.get('id'), ''.join(next((c for c in g if local(c) == 'label'), ET.Element('x')).itertext()).strip()) for g in rootel if local(g) == 'groupbox']
if sections != [('lawcite-section-perma', 'Perma.cc'), ('lawcite-section-hicite', 'hicite'), ('lawcite-section-jurisdictions', 'Jurisdictions')]:
    errors.append('sections should be Perma.cc, hicite, Jurisdictions in that order, got %s' % sections)

ids = [el.get('id') for el in tree.iter() if el.get('id')]
dupes = sorted({i for i in ids if ids.count(i) > 1})
if dupes: errors.append('duplicate ids: %s' % dupes)
for needed in ('permacc-prefs', 'hicite-prefs', 'ibcslm-prefpane'):
    if needed not in ids: errors.append('a part\'s root element is missing: #' + needed)

# the scripts and styles the bootstrap registers, read back from bootstrap.js
boot = open(os.path.join(ROOT, 'bootstrap.js'), encoding='utf-8').read()
reg = boot[boot.index('async function lawciteRegisterPane'):boot.index('function lawciteUnregisterPane')]
files = re.findall(r"base \+ '([^']+)'", reg)
sources = {'pane/preferences.xhtml': None, 'icon.svg': os.path.join(ROOT, 'assets', 'icon.svg'),
           'permacc/preferences.js': os.path.join(ROOT, 'modules', 'permacc', 'addon', 'preferences.js'),
           'hicite/preferences.js': os.path.join(ROOT, 'modules', 'hicite', 'addon', 'preferences.js'),
           'content/prefs-abbrev.js': os.path.join(ROOT, 'modules', 'phoenix', 'content', 'prefs-abbrev.js'),
           'content/prefs-abbrev.css': os.path.join(ROOT, 'modules', 'phoenix', 'content', 'prefs-abbrev.css'),
           'pane/preferences.js': os.path.join(ROOT, 'pane', 'preferences.js'), 'pane/preferences.css': os.path.join(ROOT, 'pane', 'preferences.css')}
for f in files:
    if f not in sources: errors.append('bootstrap registers %s, which this check does not know' % f)
    elif sources[f] and not os.path.exists(sources[f]): errors.append('missing source for ' + f)
if [f for f in files if f.endswith('.js')][-1] != 'pane/preferences.js': errors.append('the coordinator script must load last')
if "label: 'lawcite'" not in reg or "id: 'lawcite-prefpane'" not in reg: errors.append('pane label/id not lawcite / lawcite-prefpane')

# handlers named in the markup exist in the scripts that define them
js = {k: open(sources[k], encoding='utf-8').read() for k in files if k.endswith('.js')}
for owner, script in (('PermaCCPrefs', 'permacc/preferences.js'), ('HiCitePrefs', 'hicite/preferences.js')):
    called = set(re.findall(r'Zotero\.%s\.([A-Za-z]+)\(' % owner, xhtml))
    defined = set(re.findall(r'^\t(?:async )?([A-Za-z]+)\(', js[script], flags=re.M)) | set(re.findall(r'^\t([A-Za-z]+):\s*(?:async )?(?:function|\()', js[script], flags=re.M))
    for h in sorted(called - defined): errors.append('markup calls Zotero.%s.%s(), which %s does not define' % (owner, h, script))
    if 'init' not in defined: errors.append('%s defines no init()' % owner)
coord = js['pane/preferences.js']
for part in ('PermaCCPrefs', 'HiCitePrefs'):
    if part not in coord: errors.append('the coordinator never starts ' + part)

# bound preferences have defaults (staged prefs.js = hicite's + permacc's)
prefs = open(os.path.join(ROOT, 'modules', 'hicite', 'addon', 'prefs.js'), encoding='utf-8').read() + open(os.path.join(ROOT, 'modules', 'permacc', 'addon', 'prefs.js'), encoding='utf-8').read()
defaults = set(re.findall(r'pref\("([^"]+)"', prefs))
for bound in sorted(set(re.findall(r'preference="([^"]+)"', xhtml))):
    if bound not in defaults: errors.append('bound preference %s has no default' % bound)

# section ids must be reachable by Zotero.Utilities.Internal.openPreferences(..., { scrollTo })
if 'lawcite-section-' not in coord: errors.append('the coordinator should document the section ids')
css = open(os.path.join(ROOT, 'pane', 'preferences.css'), encoding='utf-8').read()
for cls in ('lawcite-prefs-section', 'lawcite-prefs-subsection'):
    if '.' + cls not in css: errors.append('the stylesheet does not style .' + cls)
if 'position: sticky' not in css: errors.append('section headers should be pinned (position: sticky)')

print('pane OK (%d sections, %d ids, %d scripts)' % (len(sections), len(ids), len([f for f in files if f.endswith('.js')])) if not errors else 'FAIL\n  ' + '\n  '.join(errors))
sys.exit(1 if errors else 0)
