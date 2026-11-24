// The part of node:assert/strict the tests use.
export class AssertionError extends Error {
  constructor(message, actual, expected) {
    super(message);
    this.name = 'AssertionError';
    this.actual = actual;
    this.expected = expected;
  }
}

const show = (v) => {
  try { return typeof v === 'string' ? JSON.stringify(v) : (v === undefined ? 'undefined' : JSON.stringify(v)); }
  catch (e) { return String(v); }
};

function fail(message, defaultText, actual, expected) {
  throw new AssertionError(message || defaultText, actual, expected);
}

function deepStrictEqual(a, b, seen = []) {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false;
  if (seen.some(([x, y]) => x === a && y === b)) return true;
  seen = seen.concat([[a, b]]);
  if (a instanceof Date) return a.getTime() === b.getTime();
  if (a instanceof RegExp) return String(a) === String(b);
  if (a instanceof Map) {
    if (a.size !== b.size) return false;
    for (const [k, v] of a) { if (!b.has(k) || !deepStrictEqual(v, b.get(k), seen)) return false; }
    return true;
  }
  if (a instanceof Set) {
    if (a.size !== b.size) return false;
    for (const v of a) { if (!b.has(v)) return false; }
    return true;
  }
  if (Array.isArray(a) && a.length !== b.length) return false;
  const ka = Reflect.ownKeys(a).filter((k) => Object.prototype.propertyIsEnumerable.call(a, k));
  const kb = Reflect.ownKeys(b).filter((k) => Object.prototype.propertyIsEnumerable.call(b, k));
  if (ka.length !== kb.length) return false;
  return ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && deepStrictEqual(a[k], b[k], seen));
}

const assert = (value, message) => ok(value, message);
function ok(value, message) { if (!value) fail(message, `The expression evaluated to a falsy value: ${show(value)}`, value, true); }
function equal(actual, expected, message) {
  if (!Object.is(actual, expected)) fail(message, `Expected values to be strictly equal:\n  actual:   ${show(actual)}\n  expected: ${show(expected)}`, actual, expected);
}
function notEqual(actual, expected, message) {
  if (Object.is(actual, expected)) fail(message, `Expected "actual" to be strictly unequal to: ${show(expected)}`, actual, expected);
}
function deepEqual(actual, expected, message) {
  if (!deepStrictEqual(actual, expected)) fail(message, `Expected values to be strictly deep-equal:\n  actual:   ${show(actual)}\n  expected: ${show(expected)}`, actual, expected);
}
function notDeepEqual(actual, expected, message) {
  if (deepStrictEqual(actual, expected)) fail(message, `Expected "actual" not to be strictly deep-equal to: ${show(expected)}`, actual, expected);
}
function match(string, regexp, message) {
  if (typeof string !== 'string' || !regexp.test(string)) fail(message, `The input did not match the regular expression ${regexp}. Input: ${show(string)}`, string, regexp);
}
function doesNotMatch(string, regexp, message) {
  if (typeof string === 'string' && regexp.test(string)) fail(message, `The input was expected not to match ${regexp}. Input: ${show(string)}`, string, regexp);
}
function throws(fn, expected, message) {
  try { fn(); } catch (e) {
    if (expected instanceof RegExp && !expected.test(String(e && e.message || e))) fail(message, `Thrown error did not match ${expected}: ${e}`, e, expected);
    return;
  }
  fail(message, 'Missing expected exception.');
}
async function rejects(promiseOrFn, expected, message) {
  try { await (typeof promiseOrFn === 'function' ? promiseOrFn() : promiseOrFn); } catch (e) {
    if (expected instanceof RegExp && !expected.test(String(e && e.message || e))) fail(message, `Rejection did not match ${expected}: ${e}`, e, expected);
    return;
  }
  fail(message, 'Missing expected rejection.');
}

Object.assign(assert, {
  ok, equal, strictEqual: equal, notEqual, notStrictEqual: notEqual,
  deepEqual, deepStrictEqual: deepEqual, notDeepEqual, notDeepStrictEqual: notDeepEqual,
  match, doesNotMatch, throws, rejects, AssertionError,
  fail: (message) => fail(message, 'Failed'),
});
assert.strict = assert;
export default assert;
