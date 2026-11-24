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
# lawcite-apa: derived from Zotero's apa.csl (Wiernik, Dunning; CC BY-SA 3.0)
apa_path = os.path.join(STY, 'lawcite-apa.csl')
if not os.path.exists(apa_path):
    errors.append('missing lawcite-apa.csl')
else:
    try:
        apa = ET.parse(apa_path).getroot()
        ainfo = apa.find('c:info', NS)
        if ainfo.findtext('c:id', namespaces=NS) != 'http://www.zotero.org/styles/lawcite-apa': errors.append('lawcite-apa.csl: wrong id')
        authors = [a.findtext('c:name', namespaces=NS) for a in ainfo.findall('c:author', NS)]
        if not {'Brenton M. Wiernik', 'Andrew Dunning'} <= set(authors): errors.append('lawcite-apa.csl: original authors not credited: %s' % authors)
        if 'by-sa/3.0' not in (ainfo.find('c:rights', NS).get('license') or ''): errors.append('lawcite-apa.csl: CC BY-SA 3.0 notice missing')
        if 'lawcite-apa.csl' not in index: errors.append('lawcite-apa.csl: not in styles/index.json')
        macros = {m.get('name') for m in apa.findall('c:macro', NS)}
        if 'legal-congress' not in macros: errors.append('lawcite-apa.csl: legal-congress macro missing')
    except ET.ParseError as e:
        errors.append(f'lawcite-apa.csl: not well-formed: {e}')
print('styles OK (%d indexed, 3 lawcite styles)' % len(index) if not errors else 'FAIL\n  ' + '\n  '.join(errors))
sys.exit(1 if errors else 0)
