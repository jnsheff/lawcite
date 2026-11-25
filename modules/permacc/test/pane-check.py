#!/usr/bin/env python3
"""Structural check of the Perma.cc Settings pane (it cannot be clicked through headlessly): the XUL fragment is
well-formed, every element id preferences.js looks up exists, every Zotero.PermaCCPrefs.* handler named in the markup is
defined, every bound preference has a default, and the preference names agree. Prints 'pane OK ...'."""
import os, re, sys
import xml.etree.ElementTree as ET
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ADDON = os.path.join(ROOT, 'addon')
xhtml = open(os.path.join(ADDON, 'preferences.xhtml'), encoding='utf-8').read()
js = open(os.path.join(ADDON, 'preferences.js'), encoding='utf-8').read()
core = open(os.path.join(ADDON, 'permacc.js'), encoding='utf-8').read()
prefs = open(os.path.join(ADDON, 'prefs.js'), encoding='utf-8').read()
errors = []

# Zotero parses the file as a fragment with the XUL and HTML namespaces already declared
wrapped = '<root xmlns="http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul" xmlns:html="http://www.w3.org/1999/xhtml">' + re.sub(r'<!--.*?-->', '', xhtml, flags=re.S) + '</root>'
try:
    tree = ET.fromstring(wrapped)
except ET.ParseError as e:
    sys.exit('FAIL\n  preferences.xhtml is not well-formed: %s' % e)

ids = {el.get('id') for el in tree.iter() if el.get('id')}
for used in set(re.findall(r"this\.el\('([a-zA-Z]+)'\)", js)):
    if 'permacc-' + used not in ids: errors.append(f"preferences.js looks up #permacc-{used}, which the markup does not have")
if 'permacc-prefs' not in ids: errors.append('the root vbox #permacc-prefs is missing')

handlers = set(re.findall(r'Zotero\.PermaCCPrefs\.([A-Za-z]+)\(', xhtml))
defined = set(re.findall(r'^\t(?:async )?([A-Za-z]+)\(', js, flags=re.M)) | set(re.findall(r'^\tget ([A-Za-z]+)\(', js, flags=re.M))
for h in sorted(handlers - defined): errors.append(f'the markup calls Zotero.PermaCCPrefs.{h}(), which preferences.js does not define')

default_names = set(re.findall(r'pref\("extensions\.zotero\.(.+?)"', prefs))
for bound in set(re.findall(r'preference="extensions\.zotero\.([^"]+)"', xhtml)):
    if bound not in default_names: errors.append(f'bound preference {bound} has no default in prefs.js')
for name in set(re.findall(r"(?:pref|setPref|json|saveJSON)\('([A-Za-z]+)'", core + js)) | set(re.findall(r"this\.(?:pref|json)\('([A-Za-z]+)'", core)):
    if 'lawcite.permacc.' + name not in default_names: errors.append(f'permacc.js / preferences.js use the preference "{name}", which has no default')

formats = re.findall(r'<menuitem[^>]*value="([^"]+)"', xhtml)
if formats != ['url-archived', 'perma', 'url']: errors.append('URL format menu should offer url-archived, perma, url (got %s)' % formats)
labels = re.findall(r'<menuitem label="([^"]+)"', xhtml)
if labels != ['[URL], archived at [Perma.cc URL]', '[Perma.cc URL]', '[URL]']: errors.append('URL format labels: %s' % labels)
if 'type="password"' not in xhtml: errors.append('the API key field should be a password field')
print('pane OK (%d ids, %d handlers, %d defaults)' % (len(ids), len(handlers), len(default_names)) if not errors else 'FAIL\n  ' + '\n  '.join(errors))
sys.exit(1 if errors else 0)
