// Round 2 proof: compares the report modules of a baseline git ref with the working tree for every System sample and every keyed Standard sample.
//   node scripts/compare-round2.mjs [baseline-ref]      (default 71ddef5, the commit before round 2)
// Expected: the same images (id, caption, drawing) in a NEW ORDER (all spokes first); for Standard customer emails one new "Spokes" row; nothing else.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ref = process.argv[2] || '71ddef5';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spoke-r2-'));
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
const strip = (html) => html.replace(/<img class="wheel-img"[^>]*>\s*<p class="caption">[\s\S]*?<\/p>/g, '<IMG/>').replace(/<img[^>]*cid:[^>]*>\s*(<p[^>]*>[\s\S]*?<\/p>)?/g, '<IMG/>').replace(/\s*<tr><td>Spokes<\/td>[\s\S]*?<\/tr>/g, '').replace(/\s+/g, ' '); // whitespace-insensitive: the only blank-line difference is the empty slot of the new row
const imgSig = (images) => images.map((i) => `${i.cid}|${i.caption}|${sha(i.svg)}`);
const rows = [];
const read = (kind, f) => JSON.parse(fs.readFileSync(path.join(root, 'samples', kind, f), 'utf8'));

async function oneSystem(f) {
  const order = read('system', f), out = [];
  for (const M of [A, Z]) {
    const recipe = M.sys.findSystemBuildRecipe(order).recipe;
    const rep = await M.rep.buildSystemReport({ recipe, orderData: order, renderPng: png });
    const cust = M.rep.buildCustomerEmail({ wheels: rep.wheels, images: rep.images, orderData: order });
    out.push({ rep, cust });
  }
  return out;
}
async function oneStandard(f) {
  const order = read('standard', f), out = [];
  for (const M of [A, Z]) {
    const recipe = M.stdB.findStandardStudioRecipe(order).recipe;
    const ex = await M.stdR.buildStandardAdditions({ recipe, orderData: order, componentData: new Map(Object.entries(order._sample.metafields)), renderPng: png });
    const cust = M.rep.buildCustomerEmail({ wheels: ex.wheels, images: ex.images, orderData: order });
    out.push({ rep: { html: ex.html, note: ex.noteText, images: ex.images, subject: '' }, cust });
  }
  return out;
}
for (const [kind, f] of [...fs.readdirSync(path.join(root, 'samples', 'system')).filter((x) => x.endsWith('.json')).map((x) => ['system', x]), ...fs.readdirSync(path.join(root, 'samples', 'standard')).filter((x) => /^std-.*\.json$/.test(x)).map((x) => ['standard', x])]) {
  const [o, n] = kind === 'system' ? await oneSystem(f) : await oneStandard(f);
  const sameSet = JSON.stringify(imgSig(o.rep.images).sort()) === JSON.stringify(imgSig(n.rep.images).sort());
  const reordered = JSON.stringify(imgSig(o.rep.images)) !== JSON.stringify(imgSig(n.rep.images));
  const firstIsAll = ['front', 'rear'].every((p) => { const l = n.rep.images.filter((i) => i.position === p); return !l.length || /all-spokes$/.test(l[0].cid); });
  const same = (a, b) => a === b;
  rows.push({
    sample: f.replace('.json', ''),
    'same images, same drawings': sameSet ? 'yes' : 'NO',
    'order changed': reordered ? 'yes' : 'no (solid only)',
    'all spokes first': firstIsAll ? 'yes' : 'NO',
    'internal email, rest identical': same(strip(o.rep.html), strip(n.rep.html)) ? 'yes' : 'NO',
    'order note identical': same(o.rep.note, n.rep.note) ? 'yes' : 'NO',
    'customer email, rest identical': o.cust && n.cust ? (same(strip(o.cust.html), strip(n.cust.html)) && same(strip(o.cust.fallbackHtml), strip(n.cust.fallbackHtml)) ? 'yes' : 'NO') : 'n/a',
    'new Spokes row': n.cust && n.cust.html.includes('<td>Spokes</td>') && !(o.cust && o.cust.html.includes('<td>Spokes</td>')) ? 'yes' : 'no'
  });
}
if (process.env.R2_DEBUG) {
  const [o, n] = await oneSystem('hydra2-front-28h-only.json'); const a = strip(o.rep.html), b = strip(n.rep.html); let k = 0; while (a[k] === b[k]) k++;
  console.log(JSON.stringify(a.slice(k - 80, k + 160)));
  console.log(JSON.stringify(b.slice(k - 80, k + 160)));
}
console.table(rows);
const bad = rows.filter((r) => Object.entries(r).some(([k, v]) => v === 'NO'));
console.log(bad.length ? `${bad.length} sample(s) differ in something other than the image order / Spokes row` : `${rows.length} samples: only the image order (and, for Standard customer emails, the Spokes row) differs`);
fs.rmSync(dir, { recursive: true, force: true });
process.exit(bad.length ? 1 : 0);
