// NIPPLE-REPORT: nipple colors in the Standard order report (Release 15). Real api/index.js with Shopify and Resend mocked (no network).
//  - the report shows the nipple colors per wheel (internal email, order note, customer email text, wheel images) and the "Nipples to pull" block;
//  - the "Custom Nipple Color Configuration" fee line is ignored like the spoke fee line: same lengths, same components, same inventory with and without it;
//  - orders without nipple data (every older order, one nipple color per wheel) read exactly as before.
// The five samples (samples/standard/std-nip-*.json) come from scripts/make-nipple-samples.mjs: three are REAL Release 15 carts, two are derived from one.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { runWebhook, loadSample, createMock, loadMockShopify } from './helpers/webhook-harness.mjs';
import { findStandardStudioRecipe, standardWheels } from '../_lib/standard-build.js';
import { buildStandardAdditions } from '../_lib/standard-report.js';
import { buildCustomerEmail, renderWheelImages } from '../_lib/system-report.js';
import { nippleInfoFor, nippleHexOf, isNippleFeeLine, nippleFeeLinesOf, NIPPLE_FEE } from '../_lib/nipple-build.js';
import { wheelSvg } from '../_lib/wheel-svg.js';
import { geometry } from '../_lib/studio-geometry.js';
import { loadRing } from '../_lib/rim-rings.js';
import { runCalculationEngine, formatNote } from '../api/index.js';
import { STANDARD_STUDIO_SAMPLES, SYSTEM_SAMPLES } from '../samples/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const INDEX = path.resolve(here, '..', 'api', 'index.js');
const MASTER2 = 'std-nip-master2-front4-silver', BOTH = 'std-nip-both-wheels-painted-both-fees', BERD5 = 'std-nip-berd5-aluminum-matched', ONE = 'std-nip-one-color-no-fee', NONE = 'std-nip-none-painted';
const png = async (svg) => Buffer.from(svg); // the report modules take any renderer: the svg text as "bytes" keeps these tests fast
const clone = (o) => JSON.parse(JSON.stringify(o));
const order = (name) => clone(loadSample('standard', name));
const recipeOf = (o) => findStandardStudioRecipe(o).recipe;
const text = (html) => String(html).replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/&times;/g, 'x').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const metafieldsOf = (o) => new Map(Object.entries(o._sample.metafields));
const mockFor = (o) => createMock({ ...loadMockShopify(), metafields: o._sample.metafields, variantColors: ['Black', 'Black Berd', 'White Berd'], variantLengths: [250, 320] });
const additions = (o, extra = {}) => buildStandardAdditions({ recipe: recipeOf(o), orderData: o, componentData: metafieldsOf(o), renderPng: png, ...extra });
const withoutLines = (o, re) => { const c = clone(o); c.line_items = c.line_items.filter((li) => !re.test(li.title)); return c; };
const count = (s, re) => (String(s).match(re) || []).length;

/* ------------------------------------------------------------------ the samples */

test('the five samples are Standard builds with the studio key, and carry the fee lines they should (3 real carts, 2 derived)', () => {
  for (const n of [MASTER2, BOTH, BERD5, ONE, NONE]) assert.ok(findStandardStudioRecipe(order(n)), n);
  const fees = (n) => order(n).line_items.filter(isNippleFeeLine).map((li) => `${li.properties.find((p) => p.name === 'Wheel').value}`);
  assert.deepEqual(fees(MASTER2), ['Front']);
  assert.deepEqual(fees(BOTH), ['Front', 'Rear']);
  assert.deepEqual(fees(BERD5), ['Front']);
  assert.deepEqual(fees(ONE), []);
  assert.deepEqual(fees(NONE), []);
  const nf = order(MASTER2).line_items.find(isNippleFeeLine);
  assert.equal(nf.title, 'Custom Nipple Color Configuration'); assert.equal(nf.variant_title, 'Mixed nipple colors'); assert.equal(nf.variant_id, 67928782668083); assert.equal(nf.price, '15.00');
  assert.equal(order(BOTH).line_items.filter((li) => /Custom Spoke Color Configuration/.test(li.title)).length, 2, 'the derived both-wheels sample has a spoke fee per wheel');
});

test('master 2 with 4 front nipples Silver: the front wheel shows mixed nipples, the rear and the spokes say nothing new, no warnings', async () => {
  const o = order(MASTER2), ws = standardWheels(recipeOf(o), metafieldsOf(o), o);
  const [front, rear] = ws;
  assert.deepEqual(front.nipples.counts.all, [{ color: 'Black', n: 28 }, { color: 'Silver', n: 4 }]);
  assert.deepEqual(front.nipples.counts.drive, [{ color: 'Black', n: 12 }, { color: 'Silver', n: 4 }]);
  assert.deepEqual(front.nipples.counts.rotor, [{ color: 'Black', n: 16 }]);
  assert.equal(front.nipples.product, 'Sapim Brass Nipples'); assert.equal(front.nipples.material, 'Brass'); assert.equal(front.nipples.cartColor, 'Black'); assert.equal(front.nipples.feeLines, 1);
  assert.equal(rear.nipples, null, 'the rear has one nipple color: nothing new');
  assert.equal(front.isMultiColor, false, 'the spokes are unpainted: the spoke part is as before');
  assert.deepEqual(ws.flatMap((w) => w.warnings), []);
  assert.deepEqual(front.nipples.pull, [{ color: 'Black', n: 28, inCart: true }, { color: 'Silver', n: 4, inCart: false }]);
});

test('Berd master 5 with Aluminum nipples matched to the spokes: counts, hex from the build, the pull list; the spoke paint list is untouched', async () => {
  const o = order(BERD5), x = await additions(o);
  const f = x.wheels[0];
  assert.deepEqual(f.nipples.counts.all, [{ color: 'Black', n: 26 }, { color: 'Blue', n: 2 }]);
  assert.equal(f.nipples.material, 'Aluminum');
  assert.equal(f.nipples.hexOf('Blue'), '#244d90', 'the color map of the build wins');
  assert.equal(x.wheels[1].nipples, null);
  assert.deepEqual(x.warnings, [], 'both fee lines (spoke "Berd painted color" and nipples) are on the order');
  assert.equal(x.wheels[0].feeLines, 1, 'the spoke fee line is counted for the spoke rule');
  assert.equal(x.paintPlans.length, 1, 'the painted-spoke list is as before');
  assert.ok(x.noteText.includes('Front wheel: Aluminum Black ×26 (the cart line\'s color), Aluminum Blue ×2 (NOT in the cart line: pull from stock)'));
  assert.ok(x.noteText.includes('PAINTED SPOKES') && x.noteText.includes('paint Blue ×2'));
});

test('both wheels painted and mixed, both fees on both wheels: every fee line is found for its own wheel, no warnings, a pull line per wheel', async () => {
  const o = order(BOTH), x = await additions(o);
  assert.deepEqual(x.warnings, []);
  for (const w of x.wheels) { assert.equal(w.feeLines, 1, `${w.label}: spoke fee`); assert.equal(w.nipples.feeLines, 1, `${w.label}: nipple fee`); assert.equal(w.isMultiColor, true); }
  assert.ok(x.noteText.includes('Front wheel: Brass Black ×28') && x.noteText.includes('Rear wheel: Brass Black ×24 (the cart line\'s color), Brass Silver ×8 (NOT in the cart line: pull from stock)'));
  assert.equal(x.images.length, 6, 'three pictures per wheel, as before');
});

test('one color on every nipple of a wheel, and painted spokes without nipple painting: nothing about nipples anywhere (note, internal email, images, pull list)', async () => {
  for (const n of [ONE, NONE]) {
    const o = order(n), x = await additions(o);
    assert.equal(x.wheels.every((w) => w.nipples === null), true, n);
    assert.equal(/nipple|pull/i.test(x.noteText + text(x.html)), false, `${n}: no nipple wording`);
    assert.equal(x.images.some((i) => i.svg.includes('data-nipples')), false, `${n}: no nipples drawn`);
    assert.deepEqual(x.warnings, [], n);
  }
});

/* ------------------------------------------------------------------ task 2: the nipple fee line is ignored like the spoke fee line */

test('fee line ignored: the same order with and without the nipple fee line gives the same spoke lengths, the same component list and the same inventory (through the whole webhook)', async () => {
  const withFee = order(MASTER2), without = withoutLines(withFee, /Custom Nipple Color Configuration/);
  assert.equal(withFee.line_items.length, without.line_items.length + 1);
  const a = await runWebhook(INDEX, 'orders/create', withFee, { mock: mockFor(withFee) });
  const b = await runWebhook(INDEX, 'orders/create', without, { mock: mockFor(without) });
  assert.equal(a.status, 200); assert.equal(b.status, 200);
  assert.ok(a.inventoryAdjustments.length === 4 && b.inventoryAdjustments.length === 4, 'four length variants deducted in both');
  assert.deepEqual(a.inventoryAdjustments, b.inventoryAdjustments, 'the same inventory adjustments');
  const lengths = (note) => note.slice(0, note.indexOf('--------------------------------------------------\nSPOKE COLORS:'));
  assert.equal(lengths(a.note), lengths(b.note), 'the same spoke lengths and the same wheel sections in the note');
  assert.ok(/Left: 16 x \d+mm \(Adjusted\)/.test(a.note));
  const comp = (o) => standardWheels(recipeOf(o), metafieldsOf(o), o).map((w) => ({ position: w.position, hubTitle: w.hubTitle, hubVariantTitle: w.hubVariantTitle, rimTitle: w.rimTitle, spokeProduct: w.spokeProduct, vendor: w.vendor, spokeCountLabel: w.spokeCountLabel, total: w.total, freehub: w.freehub, hubColor: w.hubColor, counts: w.counts }));
  assert.deepEqual(comp(withFee), comp(without), 'the same component list');
  // the only difference the line makes is the cross-check warning, on the order that lacks it
  const warn = (o) => standardWheels(recipeOf(o), metafieldsOf(o), o).flatMap((w) => w.warnings);
  assert.deepEqual(warn(withFee), []);
  assert.equal(warn(without).length, 1);
  assert.ok(/should have a "Custom Nipple Color Configuration" line \(\$15\) for it, but has none/.test(warn(without)[0]));
});

test('fee lines ignored (both kinds, all lines): the same order with no fee line at all gives the same lengths and inventory as with 4 fee lines', async () => {
  const withFees = order(BOTH), none = withoutLines(withFees, /Custom (Nipple|Spoke) Color Configuration/);
  assert.equal(withFees.line_items.length - none.line_items.length, 4);
  const a = await runWebhook(INDEX, 'orders/create', withFees, { mock: mockFor(withFees) });
  const b = await runWebhook(INDEX, 'orders/create', none, { mock: mockFor(none) });
  assert.deepEqual(a.inventoryAdjustments, b.inventoryAdjustments);
  const lengths = (note) => note.slice(0, note.indexOf('--------------------------------------------------\nSPOKE COLORS:'));
  assert.equal(lengths(a.note), lengths(b.note));
  assert.equal(a.inventoryAdjustments.length, 4);
});

test('fee line recognition: by variant id or by title, per wheel, like the spoke fee; a spoke fee line is never counted as a nipple fee (and the other way round)', () => {
  assert.equal(NIPPLE_FEE.variantId, 67928782668083);
  assert.equal(isNippleFeeLine({ variant_id: 67928782668083, title: 'something else' }), true);
  assert.equal(isNippleFeeLine({ variant_id: 1, title: 'Custom Nipple Color Configuration' }), true);
  assert.equal(isNippleFeeLine({ variant_id: 67791816196403, title: 'Custom Spoke Color Configuration' }), false);
  assert.equal(isNippleFeeLine(null), false);
  const o = order(BOTH);
  assert.equal(nippleFeeLinesOf(o, 'front').length, 1); assert.equal(nippleFeeLinesOf(o, 'rear').length, 1);
  assert.equal(nippleFeeLinesOf(order(MASTER2), 'rear').length, 0);
  const w = standardWheels(recipeOf(o), metafieldsOf(o), o);
  assert.deepEqual(w.map((x) => x.feeLines), [1, 1], 'the spoke fee count does not include the nipple fee lines');
});

test('cross-check warnings: mixed nipples without the fee line, a fee line on one-color nipples, two fee lines, a wrong-length nipple map, a cart nipple color that is not on the wheel', () => {
  const cfg = { drive: { n: 16 }, rotor: { n: 16 } };
  const o = order(MASTER2), r = recipeOf(o);
  const none = withoutLines(o, /Custom Nipple Color Configuration/);
  assert.equal(nippleInfoFor(r, 'front', cfg, none).warnings.length, 1);
  const oneColor = order(ONE), withFee = clone(oneColor); withFee.line_items.push({ ...clone(o.line_items.find(isNippleFeeLine)) });
  assert.ok(/has a "Custom Nipple Color Configuration" line but the nipples are one color/.test(nippleInfoFor(recipeOf(oneColor), 'front', cfg, withFee).warnings[0]));
  const dup = clone(o); dup.line_items.push(clone(o.line_items.find(isNippleFeeLine)));
  assert.ok(/2 "Custom Nipple Color Configuration" lines/.test(nippleInfoFor(r, 'front', cfg, dup).warnings[0]));
  const short = clone(r); short.standardStudio.studio.nipples.front.drive = ['Silver', 'Silver']; short.standardStudio.studio.nipples.front.rotor[0] = 'Silver'; // still mixed after the repair
  const sw = nippleInfoFor(short, 'front', cfg, o);
  assert.ok(sw.warnings.some((w) => /nipple map has 2 entries but the wheel has 16 drive-side spokes/.test(w)));
  assert.equal(sw.nipples.drive.length, 16, 'repaired like the spoke map: filled with the side base color');
  assert.deepEqual(sw.nipples.counts.drive, [{ color: 'Black', n: 16 }]);
  const odd = clone(r); odd.components.frontNipples.selectedOptions = [{ name: 'Color', value: 'Gold' }]; odd.standardStudio.studio.nbase.front = { drive: 'Black', rotor: 'Black' };
  assert.ok(nippleInfoFor(odd, 'front', cfg, o).warnings.some((w) => /cart nipple line is Gold but no nipple on the wheel is Gold/.test(w)));
});

test('hostile or odd data cannot break the report: unknown colors are neutral gray, a hex in the color map must be #rrggbb, odd names are plain text, a missing nipple component still reports', () => {
  const cfg = { drive: { n: 16 }, rotor: { n: 16 } };
  const r = clone(recipeOf(order(MASTER2)));
  r.standardStudio.colors.Silver = '"><script>alert(1)</script>';
  assert.equal(nippleHexOf(r, 'Silver'), '#c3c8cf', 'a bad hex in the map falls back to the Studio table');
  assert.equal(nippleHexOf(r, 'No Such Color'), '#8a9099');
  assert.equal(nippleHexOf(r, '__proto__'), '#8a9099'); assert.equal(nippleHexOf(r, 'constructor'), '#8a9099');
  r.standardStudio.studio.nipples.front.drive[0] = '<img src=x onerror=alert(1)>';
  r.standardStudio.studio.nipples.front.drive[1] = 'A'.repeat(500);
  const info = nippleInfoFor(r, 'front', cfg, null);
  assert.ok(info.nipples.counts.all.every((c) => c.color.length <= 41), 'names are cut');
  assert.ok(info.nipples.hex.drive.every((h) => /^#[0-9a-f]{6}$/i.test(h)), 'every hex that reaches the drawing is #rrggbb');
  delete r.components.frontNipples;
  const noComp = nippleInfoFor(r, 'front', cfg, null);
  assert.equal(noComp.nipples.product, 'Nipples'); assert.equal(noComp.nipples.cartColor, null);
  assert.ok(noComp.nipples.pull.every((p) => p.inCart === false));
  assert.equal(nippleInfoFor({}, 'front', cfg, null).nipples, null);
  assert.equal(nippleInfoFor(null, 'front', cfg, null).nipples, null);
});

/* ------------------------------------------------------------------ the report text */

test('internal email, order note and pull list through the whole webhook: nipples shown per side, pull block present, today\'s sections kept, customer email stays off', async () => {
  const o = order(MASTER2);
  const r = await runWebhook(INDEX, 'orders/create', o, { mock: mockFor(o) });
  assert.equal(r.status, 200);
  assert.equal(r.emails.length, 1, 'internal email only: the customer email switch is off');
  const internal = r.emails[0], t = text(internal.html);
  assert.equal(internal.subject, 'Spoke Calculation Complete for Order #91101', 'the subject is unchanged');
  assert.ok(t.includes('Final Spoke Lengths') && t.includes('Inventory Adjustments (Final Lengths)'));
  assert.ok(t.includes('FRONT WHEEL NIPPLES (Sapim Brass Nipples, 32)'));
  assert.ok(t.includes('Right side (16) Black x12, Silver x4') && t.includes('Left side (16) Black x16') && t.includes('Whole wheel (32) Black x28, Silver x4'));
  assert.ok(t.includes('Nipple color fee 1 x Custom Nipple Color Configuration line on the order'));
  assert.ok(t.includes('NIPPLES TO PULL') && t.includes('Front wheel: Brass Black x28 (the cart line\'s color), Brass Silver x4 (NOT in the cart line: pull from stock)'));
  assert.equal(t.includes('REAR WHEEL NIPPLES'), false);
  assert.ok(r.note.includes('Nipples (Sapim Brass Nipples):') && r.note.includes('Whole wheel (32): Black ×28, Silver ×4'));
  assert.ok(r.note.includes('NIPPLES TO PULL') && r.note.includes('Front wheel: Brass Black ×28 (the cart line\'s color), Brass Silver ×4 (NOT in the cart line: pull from stock)'));
  assert.equal(/Left: \d+ x \d+mm \(Adjusted\)/g.exec(r.note.slice(r.note.indexOf('SPOKE COLORS:'))), null, 'the additions never look like inventory lines (the cancel handler parses those)');
  assert.equal(r.inventoryAdjustments.length, 4, 'inventory: one adjustment per side and wheel, no nipple stock touched');
  assert.equal(r.calls.inventoryAdjustments.every((a) => a.changes.every((c) => c.delta < 0)), true);
  const nippleStock = JSON.stringify(r.calls.inventoryAdjustments);
  assert.equal(/Nipple/i.test(nippleStock), false);
});

test('customer email text: the nipple colors per side are in the color tables of a mixed wheel; no pull list, no fee, no cart wording, no lengths; nothing for other wheels', async () => {
  const o = order(MASTER2), x = await additions(o);
  const c = buildCustomerEmail({ wheels: x.wheels, images: x.images, orderData: o });
  const t = text(c.html);
  assert.ok(t.includes('Nipple Colors') && t.includes('Silver x4') && t.includes('Black x28'));
  assert.equal(count(t, /Nipple Colors/g), 1, 'only the front wheel has mixed nipples');
  assert.equal(/pull|cart line|fee|stock|NOTE:|\bmm\b|inventory|Studio|System|Industry Nine/i.test(t), false);
  const none = buildCustomerEmail({ wheels: (await additions(order(NONE))).wheels, images: [], orderData: order(NONE) });
  assert.equal(/Nipple/i.test(text(none.html)), false);
});

/* ------------------------------------------------------------------ the pictures */

test('pictures: every picture of a wheel with mixed nipples draws its nipples (all-spokes: all, single-side pictures: that side), behind the rim; wheels without get none', async () => {
  const x = await additions(order(BOTH), { rimRings: true });
  const by = (cid) => x.images.find((i) => i.cid === cid).svg;
  assert.equal(count(/<g data-nipples="\d+">([\s\S]*?)<\/g>/.exec(by('front-all-spokes'))[1], /<rect /g), 32, 'one rect per nipple');
  assert.match(by('front-all-spokes'), /data-nipples="32"/);
  assert.match(by('front-rotor-only'), /data-nipples="16"/); assert.match(by('front-drive-only'), /data-nipples="16"/);
  assert.match(by('rear-all-spokes'), /data-nipples="32"/);
  for (const svg of x.images.map((i) => i.svg)) {
    const nip = svg.indexOf('<g data-nipples'), ring = svg.indexOf('<image data-ring'), valve = svg.indexOf('data-valve'), lastSpoke = svg.lastIndexOf('</g><g data-side');
    assert.ok(nip > svg.lastIndexOf('<g data-side'), 'after the spokes');
    assert.ok(ring > nip, 'the ring is drawn over the nipples (they come out from behind the rim)');
    assert.ok(valve > ring, 'the valve stem after the ring');
    assert.ok(lastSpoke < nip);
  }
  const m2 = await additions(order(MASTER2));
  assert.match(m2.images.find((i) => i.cid === 'front-all-spokes').svg, /data-nipples="32"/);
  assert.equal(m2.images.find((i) => i.cid === 'rear-all-spokes').svg.includes('data-nipples'), false, 'the rear has one nipple color: its picture is as before');
});

test('pictures: nipples only on pictures 140 px or wider, as in the theme', async () => {
  for (const [w, expect] of [[139, false], [140, true], [600, true]]) {
    const x = await additions(order(MASTER2), { imageWidth: w });
    assert.equal(x.images.find((i) => i.cid === 'front-all-spokes').svg.includes('data-nipples'), expect, `${w} px`);
  }
});

test('pictures: the nipple colors are the colors of the saved map (Silver lighter than Black; a light nipple gets the darker outline, a very dark one the pale outline)', async () => {
  const x = await additions(order(MASTER2));
  const svg = x.images.find((i) => i.cid === 'front-all-spokes').svg;
  const g = /<g data-nipples="32">([\s\S]*?)<\/g>/.exec(svg)[1];
  assert.equal(count(g, /fill="#c3c8cf"/g), 4, 'four Silver nipples');
  assert.equal(count(g, /fill="#1d1f23"/g), 28, 'twenty-eight Black nipples');
  assert.equal(count(g, /stroke="#6b6e72"/g), 4, 'light nipples: outline = 55% of each channel of the color');
  assert.equal(count(g, /stroke="#ffffff" stroke-opacity="0.4"/g), 28, 'very dark nipples: pale outline');
});

test('wheelSvg nipple option: absent / empty / too small = the exact old output; shorter lists, bad hex text and extra entries cannot break it', async () => {
  const cfg = { erd: 599, rimHoles: 32, drive: { n: 16, pcd: 44, cross: 3 }, rotor: { n: 16, pcd: 44, cross: 3 } };
  const geom = geometry({ wheels: { front: cfg } }).front;
  const colorsHex = { drive: Array(16).fill('#1d1f23'), rotor: Array(16).fill('#1d1f23') };
  const base = { config: cfg, geom, colorsHex, hubHex: '#1d1f23', pov: 'drive', size: 600 };
  for (const ring of [null, await loadRing('wao', 'front')]) {
    const old = wheelSvg({ ...base, ring });
    assert.equal(wheelSvg({ ...base, ring, nipples: undefined }), old);
    assert.equal(wheelSvg({ ...base, ring, nipples: { drive: [], rotor: [] } }), old);
    assert.equal(wheelSvg({ ...base, ring, nipples: { drive: Array(16).fill('#c3c8cf'), rotor: [] }, size: 139 }), wheelSvg({ ...base, ring, size: 139 }), 'under 140 px');
    const some = wheelSvg({ ...base, ring, nipples: { drive: ['#c3c8cf', '#a42639'], rotor: Array(40).fill('#1d1f23') } });
    assert.match(some, /data-nipples="18"/, '2 drive + 16 rotor (entries past the spoke count are ignored)');
    const evil = wheelSvg({ ...base, ring, nipples: { drive: ['"><script>x</script>'], rotor: [] } });
    assert.equal(evil.includes('<script>'), false);
    assert.equal(evil.includes('NaN'), false);
  }
  const plain = wheelSvg({ ...base, ring: null, nipples: { drive: Array(16).fill('#a42639'), rotor: Array(16).fill('#a42639') } });
  assert.ok(plain.lastIndexOf('<g data-side') < plain.indexOf('<g data-nipples') && plain.indexOf('<g data-nipples') < plain.indexOf('<circle cx'), 'plain rim: spokes, nipples, rim circle (the Studio order)');
});

/* ------------------------------------------------------------------ nothing changes without nipples */

const baseline = JSON.parse(fs.readFileSync(path.join(here, 'fixtures', 'nipple-baseline-hashes.json'), 'utf8'));
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
async function hashesFor(name, kind) {
  const o = kind === 'standard' ? clone(STANDARD_STUDIO_SAMPLES[name]) : clone(SYSTEM_SAMPLES[name]);
  if (kind === 'standard') {
    const x = await buildStandardAdditions({ recipe: recipeOf(o), orderData: o, componentData: metafieldsOf(o), renderPng: png });
    const c = buildCustomerEmail({ wheels: x.wheels, images: x.images, orderData: o });
    return { images: x.images.map((i) => `${i.cid}:${sha(i.svg)}`), html: sha(x.html), note: sha(x.noteText), customer: sha(c.html), warnings: sha(JSON.stringify(x.warnings)) };
  }
  return null;
}
test('every Standard sample WITHOUT nipple data gives exactly the pictures, internal email block, note text, customer email and warnings it gave on main before this change (hashes taken from main 85ef9b9)', async () => {
  const names = Object.keys(baseline.standard);
  assert.ok(names.length >= 7);
  for (const n of names) assert.deepEqual(await hashesFor(n, 'standard'), baseline.standard[n], `${n} changed`);
  // the new samples without nipples: the same pictures as the equivalent nipple-less orders (the one-color order is the master 2 build with no nipple keys)
  const one = await hashesFor(ONE, 'standard');
  assert.equal(one.images.length, 2);
});

/* ------------------------------------------------------------------ the vendored files carry their commit id */

test('the vendoring headers name the theme commit (9fdb48f) and the drift tests exist', () => {
  const nip = fs.readFileSync(path.join(here, '..', '_lib', 'studio-nipples.js'), 'utf8');
  assert.ok(nip.includes('9fdb48f') && nip.includes('tests/studio-nipples-drift.test.js'));
  const geo = fs.readFileSync(path.join(here, '..', '_lib', 'studio-geometry.js'), 'utf8');
  assert.ok(geo.includes('9fdb48f'));
  assert.ok(fs.existsSync(path.join(here, 'studio-nipples-drift.test.js')) && fs.existsSync(path.join(here, 'studio-geometry-drift.test.js')));
});
