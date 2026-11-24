// Node globals the tests expect, for JavaScriptCore's command-line shell (jsc), which has neither.
// Import this first: `import './shim/node-env.mjs';`
if (typeof globalThis.console === 'undefined') {
  const out = (...a) => print(a.map((x) => (typeof x === 'string' ? x : (() => { try { return JSON.stringify(x); } catch (e) { return String(x); } })())).join(' '));
  globalThis.console = { log: out, error: out, warn: out, info: out, debug: out };
}
if (typeof globalThis.process === 'undefined') {
  globalThis.process = { exitCode: 0, argv: [], env: {} };
}
