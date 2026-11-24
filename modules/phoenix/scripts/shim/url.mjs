export function fileURLToPath(url) {
  const s = String(url);
  if (!s.startsWith('file://')) throw new TypeError('not a file: URL: ' + s);
  return decodeURIComponent(s.slice('file://'.length));
}
export function pathToFileURL(p) {
  const href = 'file://' + encodeURI(p);
  return { href, toString: () => href };
}
