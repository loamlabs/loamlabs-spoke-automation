// Round 3 proof: compares the report modules of a baseline git ref with the working tree for every System sample and every keyed Standard sample.
//   node scripts/compare-round3.mjs [baseline-ref]      (default b9f9638, the commit before round 3)
// Expected: NOTHING differs for System (images, order, captions, emails, note). For Standard only the DRAWINGS of wheels whose valve was not between two
// parallel spokes change (the lacing is rotated by whole rim holes); image ids, captions, order, emails and the note are identical.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ref = process.argv[2] || 'b9f9638';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spoke-r3-'));
for (const f of execFileSync('git', ['ls-tree', '-r', '--name-only', ref, '_lib'], { cwd: root }).toString().split('\n').filter((x) => /\.js$/.test(x))) {
  fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
  fs.writeFileSync(path.join(dir, f), execFileSync('git', ['show', `${ref}:${f}`], { cwd: root, maxBuffer: 64 * 1024 * 1024 }));
}
fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
const sha = (s) => crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, 10);
const load = async (d) => ({
  sys: await import(pathToFileURL(path.join(d, '_lib', 'system-build.js')).href),
  rep: await import(pathToFileURL(path.join(d, '_lib', 'system-report.js')).href),
  stdB: await import(pathToFileURL(path.join(d, '_lib', 'standard-build.js')).href),
  stdR: await import(pathToFileURL(path.join(d, '_lib', 'standard-report.js')).href)
});
const A = await load(dir), Z = await load(root);
process.env.SHOPIFY_STORE_DOMAIN = 'x.myshopify.com';
const png = async () => Buffer.from('x');
const read = (kind, f) => JSON.parse(fs.readFileSync(path.join(root, 'samples', kind, f), 'utf8'));
const listing = (kind, re) => fs.readdirSync(path.join(root, 'samples', kind)).filter((x) => re.test(x));

async function build(kind, f) {
  const order = read(kind, f), out = [];
  for (const M of [A, Z]) {
    if (kind === 'system') {
      const rep = await M.rep.buildSystemReport({ recipe: M.sys.findSystemBuildRecipe(order).recipe, orderData: order, renderPng: png });
      out.push({ html: rep.html, note: rep.note, images: rep.images, cust: M.rep.buildCustomerEmail({ wheels: rep.wheels, images: rep.images, orderData: order }) });
    } else {
      const ex = await M.stdR.buildStandardAdditions({ recipe: M.stdB.findStandardStudioRecipe(order).recipe, orderData: order, componentData: new Map(Object.entries(order._sample.metafields)), renderPng: png });
      out.push({ html: ex.html, note: ex.noteText, images: ex.images, cust: M.rep.buildCustomerEmail({ wheels: ex.wheels, images: ex.images, orderData: order }) });
    }
  }
  return out;
}

const rows = [];
for (const [kind, f] of [...listing('system', /\.json$/).map((x) => ['system', x]), ...listing('standard', /^std-.*\.json$/).map((x) => ['standard', x])]) {
  const [o, n] = await build(kind, f);
  const meta = (r) => r.images.map((i) => `${i.cid}|${i.caption}`).join(';');
  const changed = o.images.map((i, k) => (n.images[k] && sha(i.svg) !== sha(n.images[k].svg) ? i.cid : null)).filter(Boolean);
  const oldOnly = !o.images.length; // a sample that did not exist at the baseline cannot be compared (never the case for the baseline samples)
  rows.push({
    sample: f.replace('.json', ''), kind,
    'image ids, captions, order': meta(o) === meta(n) ? 'identical' : 'DIFFERENT',
    'drawings changed': changed.length ? changed.join(', ') : 'none',
    'internal email': o.html === n.html ? 'identical' : 'DIFFERENT',
    'order note': o.note === n.note ? 'identical' : 'DIFFERENT',
    'customer email': o.cust && n.cust ? (o.cust.html === n.cust.html && o.cust.fallbackHtml === n.cust.fallbackHtml ? 'identical' : 'DIFFERENT') : 'n/a',
    verdict: (meta(o) === meta(n) && o.html === n.html && o.note === n.note && (!o.cust || o.cust.html === n.cust.html) && (kind === 'standard' || !changed.length) && !oldOnly) ? 'ok' : 'UNEXPECTED'
  });
}
console.table(rows);
const bad = rows.filter((r) => r.verdict !== 'ok');
console.log(bad.length ? `${bad.length} sample(s) differ in something other than a Standard drawing` : `${rows.length} samples: System identical in every respect; Standard differs only in the drawings listed (ids, captions, order, emails and note identical)`);
fs.rmSync(dir, { recursive: true, force: true });
process.exit(bad.length ? 1 : 0);
