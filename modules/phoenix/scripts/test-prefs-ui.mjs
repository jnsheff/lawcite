import './shim/node-env.mjs';
import assert from './shim/assert.mjs';
import { PrefsUI } from '../lib/services/prefsUI.mjs';

// The Jurisdictions section's markup is registered by lawcite's own pane; PrefsUI registers a pane only when this part runs alone.
const registered = [];
const unregistered = [];
function makeZotero(withLawcite) {
  return {
    debug() {},
    logError(e) { throw e; },
    ...(withLawcite ? { Lawcite: { version: 'test' } } : {}),
    PreferencePanes: {
      async register(options) { registered.push(options); return 'pane-1'; },
      unregister(id) { unregistered.push(id); },
    },
  };
}

globalThis.Zotero = makeZotero(false);
const alone = new PrefsUI({ pluginID: 'citation-phoenix@michaelrisch.com', rootURI: { spec: 'jar:file:///x.xpi!/' } });
await alone.register();
assert.equal(registered.length, 1, 'on its own it registers a pane');
assert.equal(registered[0].src, 'jar:file:///x.xpi!/content/prefs-abbrev.xhtml', 'the pane is the abbreviation/jurisdiction editor');
alone.unregister();
assert.equal(unregistered.length, 1, 'and unregisters it');
assert.equal(unregistered[0], 'pane-1', 'the pane it registered');

registered.length = 0;
globalThis.Zotero = makeZotero(true);
const inside = new PrefsUI({ pluginID: 'lawcite@zotero.local', rootURI: { spec: 'jar:file:///x.xpi!/' } });
await inside.register();
assert.equal(registered.length, 0, 'inside lawcite it registers no pane of its own (lawcite\'s pane has its section)');
assert.equal(inside._registerTimer, null, 'and does not keep retrying');

console.log('prefs ui tests passed');
