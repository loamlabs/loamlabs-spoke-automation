// NIPPLE-REPORT proof: the report modules of a baseline git ref (default main, the code before the nipple work) against the working tree, for every EXISTING sample
// (the 12 System samples and the 7 Standard samples that carry the standardStudio key). Builds without nipples must produce identical output:
//   - every picture: the SVG text AND the rendered PNG bytes (the real @resvg/resvg-js renderer on both sides)
//   - the internal email block, the order note text, the customer email, the warnings, the subject, the lengths
//   node scripts/compare-nipples.mjs [baseline-ref]
//   node scripts/compare-nipples.mjs [baseline-ref] --write-baseline    also writes tests/fixtures/nipple-baseline-hashes.json from the BASELINE code (used by tests/nipple-report.test.js)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const ref = args.find((a) => !a.startsWith('--')) || 'main';
const writeBaseline = args.includes('--write-baseline');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spoke-nip-'));
for (const f of execFileSync('git', ['ls-tree', '-r', '--name-only', ref, '_lib'], { cwd: root }).toString().split('\n').filter((x) => /\.js$/.test(x))) {
  fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
  fs.writeFileSync(path.join(dir, f), execFileSync('git', ['show', `${ref}:${f}`], { cwd: root, maxBuffer: 64 * 1024 * 1024 }));
}
fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
try { fs.symlinkSync(path.join(root, 'node_modules'), path.join(dir, 'node_modules'), 'junction'); } catch (e) { /* the renderer must resolve from the baseline copy too */ }

const load = async (d) => ({
  sys: await import(pathToFileURL(path.join(d, '_lib', 'system-build.js')).href), rep: await import(pathToFileURL(path.join(d, '_lib', 'system-report.js')).href),
  std: await import(pathToFileURL(path.join(d, '_lib', 'standard-build.js')).href), stdRep: await import(pathToFileURL(path.join(d, '_lib', 'standard-report.js')).href),
  png: await import(pathToFileURL(path.join(d, '_lib', 'wheel-png.js')).href)
});
const A = await load(dir), Z = await load(root);
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const readJson = (kind, f) => JSON.parse(fs.readFileSync(path.join(root, 'samples', kind, f), 'utf8'));
const STD = ['std-steel-wheelset-solid', 'std-berd-rear-custom-two-painted', 'std-berd-front-24h-radial-solid-purple', 'std-berd-rear-24h-2cross-custom', 'std-steel-front-32h-3cross-two-colors', 'std-steel-rear-36h-3cross-custom', 'std-steel-front-28h-3cross-custom'];
const svgOnly = async (svg) => Buffer.from(svg);

async function stdOut(M, name, real) {
  const order = readJson('standard', name + '.json'), found = M.std.findStandardStudioRecipe(order), recipe = found.recipe;
  const cd = new Map(Object.entries(order._sample.metafields));
  const x = await M.stdRep.buildStandardAdditions({ recipe, orderData: order, componentData: cd, renderPng: real ? M.png.svgToPng : svgOnly });
  const c = M.rep.buildCustomerEmail({ wheels: x.wheels, images: x.images, orderData: order });
  return { images: x.images.map((i) => [i.cid, i.caption, i.svg, sha(i.png)]), html: x.html, note: x.noteText, customer: [c.subject, c.html, c.fallbackHtml], warnings: x.warnings, errors: x.imageErrors };
}
async function sysOut(M, name, real) {
  const order = readJson('system', name + '.json'), recipe = M.sys.findSystemBuildRecipe(order).recipe;
  const rep = await M.rep.buildSystemReport({ recipe, orderData: order, renderPng: real ? M.png.svgToPng : svgOnly });
  const c = M.rep.buildCustomerEmail({ wheels: rep.wheels, images: rep.images, orderData: order });
  return { images: rep.images.map((i) => [i.cid, i.caption, i.svg, sha(i.png)]), html: rep.html, note: rep.note, subject: rep.subject, warnings: rep.warnings, lengths: rep.lengths, customer: c ? [c.subject, c.html, c.fallbackHtml] : null };
}
const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);
const rows = [];
let pngCount = 0;
for (const name of STD) {
  const [a, z] = [await stdOut(A, name, true), await stdOut(Z, name, true)];
  pngCount += z.images.length;
  const d = Object.keys(z).filter((k) => !same(a[k], z[k]));
  rows.push({ kind: 'standard', sample: name, images: z.images.length, differs: d.length ? d.join(', ') : 'none', verdict: d.length ? 'UNEXPECTED' : 'identical' });
}
for (const f of fs.readdirSync(path.join(root, 'samples', 'system')).filter((x) => x.endsWith('.json'))) {
  const name = f.replace('.json', '');
  const [a, z] = [await sysOut(A, name, true), await sysOut(Z, name, true)];
  pngCount += z.images.length;
  const d = Object.keys(z).filter((k) => !same(a[k], z[k]));
  rows.push({ kind: 'system', sample: name, images: z.images.length, differs: d.length ? d.join(', ') : 'none', verdict: d.length ? 'UNEXPECTED' : 'identical' });
}
// the five new samples through the BASELINE code (which ignores the nipple keys): the two without nipple painting must be identical; the three with mixed nipples must be identical
// once the added nipple layer (<g data-nipples>) is cut out of each picture, i.e. the nipples are a pure addition
const NEW = ['std-nip-one-color-no-fee', 'std-nip-none-painted', 'std-nip-master2-front4-silver', 'std-nip-berd5-aluminum-matched', 'std-nip-both-wheels-painted-both-fees'];
const cutNipples = (svg) => svg.replace(/<g data-nipples="\d+">[\s\S]*?<\/g>/, '');
for (const name of NEW) {
  const [a, z] = [await stdOut(A, name, false), await stdOut(Z, name, false)];
  const mixed = z.images.some((i) => i[2].includes('data-nipples'));
  const zImages = z.images.map((i) => [i[0], i[1], cutNipples(i[2])]), aImages = a.images.map((i) => [i[0], i[1], i[2]]);
  const d = [];
  if (!same(aImages, zImages)) d.push('images (even without the nipple layer)');
  if (!mixed) for (const k of ['html', 'note', 'customer', 'warnings']) if (!same(a[k], z[k])) d.push(k);
  rows.push({ kind: mixed ? 'new, mixed nipples' : 'new, no nipple painting', sample: name, images: z.images.length, differs: d.length ? d.join(', ') : (mixed ? 'only the added nipple layer / text' : 'none'), verdict: d.length ? 'UNEXPECTED' : 'identical' });
}
console.table(rows);
const bad = rows.filter((r) => r.verdict !== 'identical');
console.log(bad.length ? `${bad.length} sample(s) differ` : `all ${rows.length} comparisons identical to ${ref} (19 existing samples: ${pngCount} pictures as SVG text and PNG bytes, internal email block, order note text, customer email, warnings, lengths; 5 new samples: identical, or identical apart from the added nipple layer and nipple text)`);

if (writeBaseline) {
  const out = { _comment: `sha256 of the report pieces of the 7 existing Standard samples, taken from the BASELINE code (${ref} ${execFileSync('git', ['rev-parse', '--short', ref], { cwd: root }).toString().trim()}) by scripts/compare-nipples.mjs --write-baseline; the images are the SVG text per picture (renderer = svg text)`, standard: {} };
  for (const name of STD) {
    const o = readJson('standard', name + '.json'), r = A.std.findStandardStudioRecipe(o).recipe, cd = new Map(Object.entries(o._sample.metafields));
    const x = await A.stdRep.buildStandardAdditions({ recipe: r, orderData: o, componentData: cd, renderPng: svgOnly });
    const c = A.rep.buildCustomerEmail({ wheels: x.wheels, images: x.images, orderData: o });
    out.standard[name] = { images: x.images.map((i) => `${i.cid}:${sha(i.svg)}`), html: sha(x.html), note: sha(x.noteText), customer: sha(c.html), warnings: sha(JSON.stringify(x.warnings)) };
  }
  fs.writeFileSync(path.join(root, 'tests', 'fixtures', 'nipple-baseline-hashes.json'), JSON.stringify(out, null, 2) + '\n');
  console.log('wrote tests/fixtures/nipple-baseline-hashes.json');
}
fs.rmSync(dir, { recursive: true, force: true });
process.exit(bad.length ? 1 : 0);
