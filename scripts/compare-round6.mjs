// Round 6 proof: the report modules of a baseline git ref (default a195f9b, the commit before round 6) against the working tree.
//   node scripts/compare-round6.mjs [baseline-ref]
//  1. every OLD-format System sample: baseline output vs now must be identical (internal email, order note, subject, warnings, every image, customer email, lengths)
//  2. the two bundle samples now vs the baseline reading their PER-COLOR equivalent: identical
//  3. the two bundle samples as the baseline reads them (it takes quantity 1 as a spoke count): shows the false "cart spoke lines do not match" warning this round removes
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { bundleToPerColor } from '../tests/helpers/cart-to-order.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ref = process.argv[2] || 'a195f9b';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spoke-r6-'));
for (const f of execFileSync('git', ['ls-tree', '-r', '--name-only', ref, '_lib'], { cwd: root }).toString().split('\n').filter((x) => /\.js$/.test(x))) {
  fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
  fs.writeFileSync(path.join(dir, f), execFileSync('git', ['show', `${ref}:${f}`], { cwd: root, maxBuffer: 64 * 1024 * 1024 }));
}
fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
const load = async (d) => ({ sys: await import(pathToFileURL(path.join(d, '_lib', 'system-build.js')).href), rep: await import(pathToFileURL(path.join(d, '_lib', 'system-report.js')).href) });
const A = await load(dir), Z = await load(root);
const png = async () => Buffer.from('x');
const read = (f) => JSON.parse(fs.readFileSync(path.join(root, 'samples', 'system', f), 'utf8'));
const TOTALS = { 'hydra2-bundle-front-custom-rear-solid': { front: 28, rear: 32 }, 'solix-bundle-24h-both-solid-black': { front: 24, rear: 24 } };

async function out(M, order) {
  const rep = await M.rep.buildSystemReport({ recipe: M.sys.findSystemBuildRecipe(order).recipe, orderData: order, renderPng: png });
  const cust = M.rep.buildCustomerEmail({ wheels: rep.wheels, images: rep.images, orderData: order });
  return { html: rep.html, note: rep.note, subject: rep.subject, warnings: rep.warnings, images: rep.images.map((i) => [i.cid, i.caption, i.svg]), lengths: rep.lengths, cust: cust ? [cust.subject, cust.html, cust.fallbackHtml] : null };
}
const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);
const diff = (x, y) => ['html', 'note', 'subject', 'warnings', 'images', 'lengths', 'cust'].filter((k) => !same(x[k], y[k]));
const rows = [];
for (const f of fs.readdirSync(path.join(root, 'samples', 'system')).filter((x) => x.endsWith('.json'))) {
  const name = f.replace('.json', ''), order = read(f);
  if (TOTALS[name]) {
    const now = await out(Z, order), eq = await out(A, bundleToPerColor(order, TOTALS[name])), raw = await out(A, order);
    const d = diff(now, eq);
    rows.push({ sample: name, format: 'bundle', compared: 'now vs baseline reading the per-color equivalent', differs: d.length ? d.join(', ') : 'none', verdict: d.length ? 'UNEXPECTED' : 'ok' });
    rows.push({ sample: name, format: 'bundle', compared: 'baseline reading the bundle as is (the old bug)', differs: raw.warnings.filter((w) => /cart spoke lines/.test(w)).join(' | ').slice(0, 140) || 'no warning', verdict: 'info' });
  } else {
    const d = diff(await out(Z, order), await out(A, order));
    rows.push({ sample: name, format: 'per-color', compared: 'now vs baseline', differs: d.length ? d.join(', ') : 'none', verdict: d.length ? 'UNEXPECTED' : 'ok' });
  }
}
console.table(rows);
const bad = rows.filter((r) => r.verdict === 'UNEXPECTED');
console.log(bad.length ? `${bad.length} comparison(s) differ` : 'every comparison identical: internal email, order note, subject, warnings, images, lengths, customer email');
fs.rmSync(dir, { recursive: true, force: true });
process.exit(bad.length ? 1 : 0);
