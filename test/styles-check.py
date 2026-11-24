#!/usr/bin/env python3
"""Checks lawcite's own CSL styles: well-formed, ID/self link/filename agree, attribution kept, listed in
modules/phoenix/styles/index.json, and covered by the plugin's fallback allow-list.  Prints 'styles OK'."""
import json, os, re, sys, xml.etree.ElementTree as ET
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STY = os.path.join(ROOT, 'modules', 'phoenix', 'styles')
NS = {'c': 'http://purl.org/net/xbiblio/csl'}
errors = []
index = json.load(open(os.path.join(STY, 'index.json'), encoding='utf-8-sig'))
patcher = open(os.path.join(ROOT, 'modules', 'phoenix', 'lib', 'services', 'patcher.mjs'), encoding='utf-8').read()
for short in ('lawcite-indigobook-lawreview', 'lawcite-indigobook-memoranda'):
    name = short + '.csl'
    path = os.path.join(STY, name)
    if not os.path.exists(path):
        errors.append('missing ' + name); continue
    try:
        info = ET.parse(path).getroot().find('c:info', NS)
    except ET.ParseError as e:
        errors.append(f'{name}: not well-formed: {e}'); continue
    sid = info.findtext('c:id', namespaces=NS)
    want = 'http://www.zotero.org/styles/' + short
    if sid != want: errors.append(f'{name}: id {sid!r} != {want!r}')
    selfs = [l.get('href') for l in info.findall('c:link', NS) if l.get('rel') == 'self']
    if selfs != [want]: errors.append(f'{name}: self link {selfs}')
    if 'sheff-indigobook' in open(path, encoding='utf-8').read(): errors.append(f'{name}: still mentions the old id')
    rights = info.find('c:rights', NS)
    if rights is None or 'by-sa/4.0' not in (rights.get('license') or ''): errors.append(f'{name}: CC BY-SA 4.0 notice missing')
    if 'Bennett' not in (info.findtext('c:author/c:name', namespaces=NS) or ''): errors.append(f'{name}: attribution to Bennett missing')
    if name not in index: errors.append(f'{name}: not in styles/index.json')
    if f"'{want}'" not in patcher: errors.append(f'{name}: id not in the fallback allow-list (patcher.mjs)')
missing = [n for n in index if not os.path.exists(os.path.join(STY, n))]
if missing: errors.append('index.json lists files that do not exist: ' + ', '.join(missing))
extra = [f for f in os.listdir(STY) if f.endswith('.csl') and f not in index]
if extra: errors.append('styles/ has .csl files not in index.json (never installed): ' + ', '.join(extra))
print('styles OK (%d indexed, 2 lawcite styles)' % len(index) if not errors else 'FAIL\n  ' + '\n  '.join(errors))
sys.exit(1 if errors else 0)
