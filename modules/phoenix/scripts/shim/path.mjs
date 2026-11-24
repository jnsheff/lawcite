// POSIX-only subset of node:path.
function normalize(p) {
  const abs = p.startsWith('/');
  const out = [];
  for (const seg of p.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') { if (out.length && out[out.length - 1] !== '..') out.pop(); else if (!abs) out.push('..'); }
    else out.push(seg);
  }
  return (abs ? '/' : '') + out.join('/') || (abs ? '/' : '.');
}
const join = (...parts) => normalize(parts.filter(Boolean).join('/'));
const dirname = (p) => { const i = p.replace(/\/+$/, '').lastIndexOf('/'); return i < 0 ? '.' : (i === 0 ? '/' : p.slice(0, i)); };
const resolve = (...parts) => {
  let acc = '';
  for (let i = parts.length - 1; i >= 0 && !acc.startsWith('/'); i--) if (parts[i]) acc = parts[i] + (acc ? '/' + acc : '');
  if (!acc.startsWith('/')) throw new Error('shim path.resolve needs an absolute segment: ' + parts.join(' | '));
  return normalize(acc);
};
const basename = (p) => p.slice(p.lastIndexOf('/') + 1);
export default { join, dirname, resolve, basename, normalize, sep: '/' };
