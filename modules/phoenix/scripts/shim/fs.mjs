// node:fs/promises subset on top of jsc's synchronous read().
export async function readFile(path, encoding) {
  if (encoding !== 'utf8' && encoding !== 'utf-8' && !(encoding && encoding.encoding)) throw new Error('shim fs.readFile only reads text: pass "utf8"');
  return read(path);
}
export default { readFile };
