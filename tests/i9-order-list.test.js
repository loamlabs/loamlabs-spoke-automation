// I9 ORDER LIST v1 (internal System email only): spokes on the B2B dealer list with spares and ONE cart link, spokes off the list to order by email, hubs and rims in words.
// Order #1466 (tests/fixtures/order-1466.json, customer details removed) is the main case. Shopify and Resend are mocked; nothing is sent.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { runWebhook, loadSample } from './helpers/webhook-harness.mjs';
import { findSystemBuildRecipe, systemWheels } from '../_lib/system-build.js';
import { buildSystemReport } from '../_lib/system-report.js';
import { buildI9OrderList, findDealerSpoke, parseCartLink, I9_CART_BASE } from '../_lib/i9-order-list.js';
import SNAPSHOT from '../_lib/i9-b2b-spokes.json' with { type: 'json' };
import { SYSTEM_SAMPLES } from '../samples/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const INDEX = path.resolve(here, '..', 'api', 'index.js');
const clone = (o) => JSON.parse(JSON.stringify(o));
const png = async () => Buffer.from('PNG');
const order1466 = () => clone(JSON.parse(fs.readFileSync(path.join(here, 'fixtures', 'order-1466.json'), 'utf8')));
const recipeOf = (o) => findSystemBuildRecipe(o).recipe;
const buildProp = (o) => o.line_items.flatMap((l) => l.properties || []).find((p) => p.name === '_build');
const report = (o, lengthCalculator) => buildSystemReport({ recipe: recipeOf(o), orderData: o, renderPng: png, ...(lengthCalculator ? { lengthCalculator } : {}) });
const listOf = async (o, lengthCalculator) => (await report(o, lengthCalculator)).i9OrderList;
const stub = (front, rear) => (wheel) => (wheel.position === 'front' ? front : rear); // chart lengths { left: rotor, right: drive } per wheel
const rowOf = (variantId) => SNAPSHOT.spokes.find((r) => r.variantId === variantId);
const NOTE_1466 = ['FRONT  We Are One TRIAD Carbon Rim (Enduro) - 29"  /  Hydra2, Bronze', '  Rotor side  305 mm:  7 Black, 7 Bronze', '  Drive side  307 mm:  7 Black, 7 Bronze', '', 'REAR   We Are One TRIAD Carbon Rim (Enduro) - 27.5"  /  Hydra2, Bronze', '  Rotor side  284 mm:  8 Black, 8 Bronze', '  Drive side  282 mm:  8 Black, 8 Bronze', ''].join('\n');
// edits the build recipe of an order (and the order), returns the order
const edit = (o, fn) => { const p = buildProp(o); const b = JSON.parse(p.value); fn(b, o); p.value = JSON.stringify(b); return o; };
const solidRear = (o) => edit(o, (b) => { const s = b.system.studio.spokes.rear; b.system.studio.spokes.rear = { drive: s.drive.map(() => 'Black'), rotor: s.rotor.map(() => 'Black') }; o.line_items.find((li) => li.title === 'Industry Nine SYSTEM Spokes' && li.properties.some((x) => x.name === 'Wheel' && x.value === 'Rear')).properties.find((x) => x.name === 'Spoke Colors').value = 'Black'; });
const frontOnly = (o) => { edit(o, (b) => { b.buildType = 'Front'; for (const k of ['rearRim', 'rearHub', 'rearSpokes']) delete b.components[k]; delete b.system.studio.spokes.rear; delete b.system.wheels.rear; }); o.line_items = o.line_items.filter((li) => ((li.properties.find((x) => x.name === 'Wheel') || {}).value || '') !== 'Rear'); return o; };
const rearOnly = (o) => { edit(o, (b) => { b.buildType = 'Rear'; for (const k of ['frontRim', 'frontHub', 'frontSpokes']) delete b.components[k]; delete b.system.studio.spokes.front; delete b.system.wheels.front; }); o.line_items = o.line_items.filter((li) => ((li.properties.find((x) => x.name === 'Wheel') || {}).value || '') !== 'Front'); return o; };

/* ------------------------------------------------------------------ #1466 */

test('#1466: block B holds the rear 282/284 spokes with one spare per side in the base color; block C holds the front 305/307 with the text for Thomas', async () => {
  const l = await listOf(order1466());
  const t = l.text;
  assert.ok(t.startsWith('I9 ORDER LIST  -  order #1466\n\nA. PRE-BUILT WHEELS\n   none for this order (both wheels are two-color)\n\nB. SPOKES on'));
  assert.ok(t.includes('   Rear   rotor  284 mm  Black 8 +1 spare = 9   Bronze 8  (base color: Black)\n'));
  assert.ok(t.includes('   Rear   drive  282 mm  Black 8 +1 spare = 9   Bronze 8  (base color: Black)\n'));
  assert.ok(t.includes('   THE LINK ADDS:  9 x 282 mm Black, 8 x 282 mm Bronze, 9 x 284 mm Black, 8 x 284 mm Bronze (total 34 spokes, includes 2 spares)\n'));
  assert.ok(t.includes('   Check the cart against this list before paying. Variant ids from the 2026-11-08 B2B file.\n'));
  assert.ok(t.includes('   Front  rotor  305 mm  Black 7 +1 spare = 8   Bronze 7  (base color: Black)\n'));
  assert.ok(t.includes('   Front  drive  307 mm  Black 7 +1 spare = 8   Bronze 7  (base color: Black)\n'));
  assert.equal(l.thomasText, 'Hi Thomas, for LoamLabs order #1466 please add System spokes: 305 mm: 8 Black, 7 Bronze; 307 mm: 8 Black, 7 Bronze. Thank you.');
  assert.ok(t.includes(`   Text: "${l.thomasText}"\n`));
  assert.ok(t.includes('D. HUBS (from I9)\n   Front: Industry Nine Hydra2 SYSTEM Front Hub - 6-Bolt (28h / Bronze / 15x110mm)\n   Rear: Industry Nine Hydra2 SYSTEM Rear Hub - 6-Bolt (32h / Bronze / 12x148mm), driver XD\n'));
  assert.ok(t.includes('E. RIMS (from I9)\n   Front: We Are One TRIAD Carbon Rim (Enduro) - 29", 28h  (I9 code TR303)\n   Rear: We Are One TRIAD Carbon Rim (Enduro) - 27.5", 32h  (I9 code TR305)\n'));
  // the link: only the rear dealer-list spokes, the front lengths are not in it
  assert.equal(l.linkUrl, `${I9_CART_BASE}43663812755591:9,43663812821127:8,43663819047047:9,43663819112583:8`);
  assert.equal(l.totals.spokes, 34); assert.equal(l.totals.spares, 2);
});

test('the cart link parses back to exactly the variant ids and quantities that "THE LINK ADDS" shows', async () => {
  const l = await listOf(order1466());
  const parsed = parseCartLink(l.linkUrl);
  const shown = parsed.map(({ variantId, qty }) => { const r = rowOf(variantId); assert.ok(r, `variant ${variantId} is in the snapshot`); return `${qty} x ${Math.round(r.mm)} mm ${r.color}`; });
  const adds = l.linkAdds.replace(/ \(total .*$/, '').split(', ');
  assert.deepEqual(shown, adds);
  // every id belongs to the standard-gauge product of the length shown, and the total adds up
  for (const { variantId } of parsed) assert.equal(rowOf(variantId).gauge, 'standard');
  assert.equal(parsed.reduce((s, x) => s + x.qty, 0), l.totals.spokes);
  assert.equal(parseCartLink('https://example.com/cart/1:2'), null);
});

test('the internal email carries the block with a clickable cart link and the plain URL; the order note is exactly the short note of PR #1 with nothing of the list in it', async () => {
  const r = await runWebhook(INDEX, 'orders/create', order1466());
  assert.equal(r.status, 200);
  assert.equal(r.note, NOTE_1466, 'the order note is unchanged');
  assert.equal(/I9 ORDER|b2b\.industrynine|cart|spare|Thomas|THE LINK/i.test(r.note), false, 'nothing of the list in the note the customer reads');
  const html = r.restEmails[0].html;
  assert.equal(r.restEmails.length, 1);
  assert.ok(html.includes('<pre ') && html.includes('I9 ORDER LIST  -  order #1466'));
  assert.ok(html.includes('<a href="https://b2b.industrynine.com/cart/43663812755591:9,43663812821127:8,43663819047047:9,43663819112583:8"><strong>Open I9 cart link</strong></a>'));
  assert.ok(html.includes('Cart link (plain): https://b2b.industrynine.com/cart/43663812755591:9,'));
  assert.ok(html.includes('THE LINK ADDS:  9 x 282 mm Black'));
  assert.ok(html.indexOf('I9 ORDER LIST') < html.indexOf('FRONT WHEEL'), 'the block sits above the wheel sections');
});

test('the order note of every System sample is free of the list and has no I9 wording; the customer email is untouched', async () => {
  for (const name of Object.keys(SYSTEM_SAMPLES)) {
    const o = loadSample('system', name); const r = await report(o);
    assert.equal(/I9 ORDER|b2b\.industrynine|cart|spare|Thomas/i.test(r.note), false, name);
    assert.ok(r.html.includes('I9 ORDER LIST'), `${name}: the internal email has the block`);
  }
});

/* ------------------------------------------------------------------ cases */

test('a one-color wheel: block A reminds to check for a pre-built wheelset; the spare is in that color', async () => {
  const l = await listOf(solidRear(order1466()));
  assert.ok(l.text.includes('A. PRE-BUILT WHEELS\n   Rear: ONE COLOR (Black): check I9 for a pre-built wheelset with these specs before ordering parts.\n'));
  assert.ok(l.text.includes('   Rear   rotor  284 mm  Black 16 +1 spare = 17  (one color, Black)\n'));
  assert.ok(l.text.includes('   Rear   drive  282 mm  Black 16 +1 spare = 17  (one color, Black)\n'));
  assert.equal(l.linkUrl, `${I9_CART_BASE}43663812755591:17,43663819047047:17`);
  assert.equal(l.totals.spares, 2);
  // two one-color wheels: two reminder lines
  const both = solidRear(order1466()); edit(both, (b) => { const s = b.system.studio.spokes.front; b.system.studio.spokes.front = { drive: s.drive.map(() => 'Purple'), rotor: s.rotor.map(() => 'Purple') }; });
  const l2 = await listOf(both, stub({ left: 284, right: 282 }, { left: 284, right: 282 }));
  assert.ok(l2.text.includes('   Front: ONE COLOR (Purple)') && l2.text.includes('   Rear: ONE COLOR (Black)'));
});

test('a one-wheel build: one wheel in the list, "the wheel is two-color", and no link when the only wheel is off the dealer list', async () => {
  const f = await listOf(frontOnly(order1466()));
  assert.ok(f.text.includes('none for this order (the wheel is two-color)'));
  assert.ok(f.text.includes("none: no spokes of this order are on I9's dealer list (no cart link)"));
  assert.equal(f.linkUrl, null); assert.equal(f.linkAdds, null);
  assert.equal(f.text.includes('Cart link'), false); assert.equal(f.text.includes('[Open I9 cart link]'), false);
  assert.ok(f.text.includes('305 mm: 8 Black, 7 Bronze; 307 mm: 8 Black, 7 Bronze'));
  assert.equal(/Rear:|Rear /.test(f.text.replace(/Rear.*B2B.*$/m, '')), false, 'no rear lines in a front-only list');
  const r = await listOf(rearOnly(order1466()));
  assert.ok(r.linkUrl && r.text.includes('Rear   rotor  284 mm') && !r.text.includes('Front'), 'a rear-only build: the rear spokes in the link, nothing from the front');
  assert.equal(r.thomasText, null); assert.ok(r.text.includes("none: every length and color of this order is on I9's dealer list"));
});

test('front and rear with the same length and color: the lines stay per wheel and side, the link sums the quantities per variant', async () => {
  const l = await listOf(order1466(), stub({ left: 284, right: 282 }, { left: 284, right: 282 }));
  assert.ok(l.text.includes('   Front  rotor  284 mm  Black 7 +1 spare = 8   Bronze 7') && l.text.includes('   Rear   rotor  284 mm  Black 8 +1 spare = 9   Bronze 8'));
  assert.ok(l.text.includes('   Front  drive  282 mm  Black 7 +1 spare = 8   Bronze 7') && l.text.includes('   Rear   drive  282 mm  Black 8 +1 spare = 9   Bronze 8'));
  assert.equal(l.linkAdds, '17 x 282 mm Black, 15 x 282 mm Bronze, 17 x 284 mm Black, 15 x 284 mm Bronze (total 64 spokes, includes 4 spares)');
  assert.deepEqual(parseCartLink(l.linkUrl).map((x) => x.qty), [17, 15, 17, 15]);
  assert.equal(l.thomasText, null);
});

test('base color not recorded: the most common color gets the spare and the list says so; a recorded base color that is not on the side is reported too', async () => {
  const none = order1466(); edit(none, (b) => { delete b.system.studio.base; const s = b.system.studio.spokes.rear; b.system.studio.spokes.rear = { drive: s.drive.map((c, i) => (i < 12 ? 'Bronze' : 'Black')), rotor: s.rotor }; });
  const l = await listOf(none);
  assert.ok(l.text.includes('Rear   drive  282 mm  Bronze 12 +1 spare = 13   Black 4  (base color not recorded: used the most common color, Bronze)'), l.text);
  assert.ok(l.text.includes('Rear   rotor  284 mm  Black 8 +1 spare = 9   Bronze 8  (base color not recorded: used the most common color, Black)'), 'a tie: the first by name, and it says so');
  const odd = order1466(); edit(odd, (b) => { b.system.studio.base.rear.drive = 'Orange'; });
  const l2 = await listOf(odd);
  assert.ok(l2.text.includes('(recorded base color Orange is not used on this side: used the most common color, Black)'), l2.text);
});

test('a length or color that is not in the snapshot goes to block C, never replaced by a nearby length', async () => {
  // 283 is not on the list (282 and 284 are): all of it goes to block C, nothing is moved to a neighbour
  const l = await listOf(order1466(), stub({ left: 283, right: 283 }, { left: 283, right: 283 }));
  assert.equal(l.linkUrl, null); assert.equal(l.thomasText, 'Hi Thomas, for LoamLabs order #1466 please add System spokes: 283 mm: 34 Black, 30 Bronze. Thank you.');
  assert.equal(l.text.includes('284 mm') || l.text.includes('282 mm'), false, 'no neighbouring length is used');
  // 301 mm is on the list only for Hydra (not tagged Hydra2): a Hydra2 wheel does not get it in the link, it goes to block C with the reason
  const m = await listOf(order1466(), stub({ left: 301, right: 301 }, { left: 301, right: 301 }));
  assert.equal(m.linkUrl, null); assert.ok(m.text.includes('[I9 lists this length only for other hubs (Hydra, Torch)]'), m.text);
  // a color the length does not have: only that color goes to block C, the rest stays in the link
  const snap = clone(SNAPSHOT); snap.spokes = snap.spokes.filter((r) => !(r.gauge === 'standard' && Math.round(r.mm) === 282 && r.color === 'Bronze'));
  const o = order1466(); const rec = recipeOf(o);
  const wheels = systemWheels(rec, null, o).filter((w) => w.position === 'rear');
  const c = buildI9OrderList({ wheels, lengthsByPos: { rear: { pending: false, left: 284, right: 282 } }, orderNumber: 1466, recipe: rec, snapshot: snap });
  assert.ok(c.linkAdds.startsWith('9 x 282 mm Black, 9 x 284 mm Black, 8 x 284 mm Bronze'), c.linkAdds);
  assert.ok(c.text.includes("Bronze 8 [color not on I9's list at this length (I9 has: "), c.text);
  assert.equal(c.thomasText, 'Hi Thomas, for LoamLabs order #1466 please add System spokes: 282 mm: 8 Bronze. Thank you.');
});

test('the gauge decision: only the standard System spoke is used (the DH and Straight gauge products are tagged Hydra / Torch only); a length tagged for other hubs goes to block C', () => {
  const dh = SNAPSHOT.spokes.filter((r) => r.gauge === 'dh' || r.gauge === 'straight');
  assert.ok(dh.length > 0 && dh.every((r) => !r.tags.includes('Hydra2') && !r.tags.includes('Solix')), 'no DH or Straight gauge product carries a Hydra2 or Solix tag');
  // 270 mm exists as standard (Hydra, Hydra2) and straight gauge: a Hydra2 wheel gets the standard one, a Solix wheel does not (not tagged Solix)
  const h = findDealerSpoke({ mm: 270, color: 'Black', hubModel: 'Hydra2' }); assert.equal(h.found, true); assert.equal(h.row.gauge, 'standard'); assert.equal(h.row.title, 'System Spoke - 270mm');
  assert.deepEqual(findDealerSpoke({ mm: 270, color: 'Black', hubModel: 'Solix' }), { found: false, reason: 'hub', detail: 'Hydra, Hydra2, Torch' });
  assert.equal(findDealerSpoke({ mm: 295, color: 'Black', hubModel: 'Hydra2' }).reason, 'length', 'a length only in the Straight Gauge product is not on the standard list');
  assert.equal(findDealerSpoke({ mm: 305, color: 'Black', hubModel: 'Hydra2' }).reason, 'length');
  assert.equal(findDealerSpoke({ mm: 282, color: 'Chartreuse', hubModel: 'Hydra2' }).reason, 'color');
  assert.equal(findDealerSpoke({ mm: 282, color: 'black', hubModel: 'Hydra2' }).found, true, 'color names match without regard to case');
  for (const mm of [261, 265, 293, 305, 307, 325, 326, 328, 331, 333]) assert.equal(findDealerSpoke({ mm, color: 'Black', hubModel: 'Hydra2' }).found, false, `${mm} mm is not on the dealer list`);
});

test('a variant listed as out of stock stays in the link and is marked with the file date', async () => {
  const snap = clone(SNAPSHOT); const row = snap.spokes.find((r) => r.gauge === 'standard' && Math.round(r.mm) === 282 && r.color === 'Black'); row.available = false;
  const o = order1466(); const rec = recipeOf(o);
  const wheels = systemWheels(rec, null, o);
  const lengths = { front: { pending: true }, rear: { pending: false, left: 284, right: 282 } };
  const l = buildI9OrderList({ wheels: wheels.filter((w) => w.position === 'rear'), lengthsByPos: lengths, orderNumber: 1466, recipe: rec, snapshot: snap });
  assert.ok(l.text.includes('Black 8 +1 spare = 9 (listed as out of stock on 2026-11-08)'), l.text);
  assert.ok(l.linkAdds.includes('9 x 282 mm Black (listed as out of stock on 2026-11-08)'));
  assert.ok(l.linkUrl.includes('43663812755591:9'), 'still in the link');
  assert.equal(l.link.find((x) => x.variantId === 43663812755591).available, false);
  // the real snapshot has 8 unavailable variants; the generator carries the flag
  assert.equal(SNAPSHOT.spokes.filter((r) => !r.available).length, 8);
});

test('a wheel with no chart length: its spokes are listed as "length not calculated", left out of the link and out of block C', async () => {
  const l = await listOf(order1466(), (w) => (w.position === 'rear' ? { left: 284, right: 282 } : null));
  assert.ok(l.text.includes('   Front  rotor  length not calculated  Black 7 +1 spare = 8   Bronze 7') && l.text.includes('(left out of the link and out of block C: no chart length for this wheel)'));
  assert.equal(l.thomasText, null); assert.equal(l.text.includes('Hi Thomas'), false);
  assert.equal(l.linkUrl, `${I9_CART_BASE}43663812755591:9,43663812821127:8,43663819047047:9,43663819112583:8`);
  const none = await listOf(order1466(), () => null);
  assert.equal(none.linkUrl, null); assert.equal(none.link.length, 0);
  assert.equal((none.text.match(/length not calculated/g) || []).length, 4);
});

test('an own-parts order: the customer-supplied hub and rim are skipped in D and E (marked customer-supplied); the spokes are still listed', async () => {
  const o = order1466(); edit(o, (b) => { b.customerSupplied = { front: { rim: true, hub: true }, rear: { rim: true, hub: false } }; for (const k of ['frontRim', 'frontHub', 'rearRim']) b.components[k].supplied = true; });
  const l = await listOf(o);
  assert.ok(l.text.includes('D. HUBS (from I9)\n   Front: customer-supplied\n   Rear: Industry Nine Hydra2 SYSTEM Rear Hub'), l.text);
  assert.ok(l.text.includes('E. RIMS (from I9)\n   Front: customer-supplied\n   Rear: customer-supplied\n'), l.text);
  assert.ok(l.text.includes('Rear   rotor  284 mm') && l.text.includes('Front  rotor  305 mm'), 'spokes are listed as usual');
});

test('a rim that is not an I9 or We Are One rim is marked, and a borrowed chart row gives no I9 code', async () => {
  const o = order1466(); edit(o, (b) => { b.components.frontRim.vendor = "Stan's"; });
  const l = await listOf(o);
  assert.ok(l.text.includes('Front: We Are One TRIAD Carbon Rim (Enduro) - 29", 28h  (I9 code TR303)  (vendor Stan\'s: probably not sold by I9)'), l.text);
  const borrowed = await listOf(o, (w) => ({ left: 300, right: 299, sourceText: 'Source: I9 System chart 2026, row Wanderer 29" TR309 (borrowed from Wanderer row, same ERD and offset)', chart: { partNumber: 'TR309' } }));
  assert.equal(borrowed.text.includes('TR309'), false, 'no code for a borrowed row');
});

test('hostile build data (a base color that is not text) does not break the list or the report', async () => {
  const real = console.error; console.error = () => {};
  try {
    const odd = order1466(); edit(odd, (b) => { b.system.studio.base.rear.drive = { not: 'a string' }; });
    const r = await report(odd);
    assert.ok(r.i9OrderList && r.i9OrderList.text.includes('I9 ORDER LIST') && r.html.includes('I9 ORDER LIST'));
    assert.ok(r.i9OrderList.text.includes('base color not recorded'), 'an unusable base color counts as not recorded and the list says so');
  } finally { console.error = real; }
});

/* ------------------------------------------------------------------ the snapshot and its generator */

test('the snapshot: 344 variants of 30 products from the 2026-11-08 file, with the fields the list needs', () => {
  assert.equal(SNAPSHOT.source.date, '2026-11-08'); assert.equal(SNAPSHOT.source.file, 'i9_spokes_2026-11-08.json');
  assert.equal(SNAPSHOT.source.products, 30); assert.equal(SNAPSHOT.source.variants, 344); assert.equal(SNAPSHOT.spokes.length, 344);
  assert.deepEqual(Object.keys(SNAPSHOT.spokes[0]).sort(), ['available', 'color', 'gauge', 'handle', 'mm', 'price', 'productId', 'sku', 'tags', 'title', 'titleMm', 'variantId'].sort());
  assert.deepEqual([...new Set(SNAPSHOT.spokes.map((r) => r.gauge))].sort(), ['dh', 'standard', 'straight']);
  assert.equal(rowOf(43663812755591).title, 'System Spoke - 282mm'); assert.equal(rowOf(43663812755591).color, 'Black');
});

test('the generator: reads a saved file, takes the date from the name, refuses a login page and a missing date', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'i9snap-'));
  const saved = { products: [{ id: 11, title: 'System Spoke - 300mm', handle: 'h300', tags: ['Aluminum', 'Hydra2'], variants: [{ id: 101, title: 'Black', option1: 'Black', sku: '11.810/.114-.106_Black', available: true, price: '5.40' }, { id: 102, title: 'Red', option1: 'Red', sku: '11.810/.114-.106_Red', available: false, price: '5.40' }] }, { id: 12, title: 'System Spoke - DH Gauge - 300mm', handle: 'hdh', tags: 'Hydra,Torch', variants: [{ id: 201, title: 'Black', option1: 'Black', sku: '11.810/.118-.110_Black', available: true, price: '5.40' }] }] };
  const file = path.join(dir, 'i9_spokes_2030-01-02.json'), out = path.join(dir, 'out.json');
  fs.writeFileSync(file, JSON.stringify(saved));
  const script = path.resolve(here, '..', 'scripts', 'generate-i9-b2b-spokes.mjs');
  execFileSync('node', [script, file, '--out', out]);
  const j = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.equal(j.source.date, '2030-01-02'); assert.equal(j.source.variants, 3); assert.equal(j.source.products, 2); assert.match(j.source.sha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(j.spokes.map((r) => [r.gauge, r.color, r.titleMm, r.variantId, r.available]), [['dh', 'Black', 300, 201, true], ['standard', 'Black', 300, 101, true], ['standard', 'Red', 300, 102, false]]);
  assert.equal(j.spokes[1].mm, 300); assert.deepEqual(j.spokes[0].tags, ['Hydra', 'Torch']);
  // a --date overrides a name without one; a name without a date and no --date fails; an HTML page fails
  const noDate = path.join(dir, 'spokes.json'); fs.writeFileSync(noDate, JSON.stringify(saved));
  assert.throws(() => execFileSync('node', [script, noDate, '--out', out], { stdio: 'pipe' }));
  execFileSync('node', [script, noDate, '--date', '2031-05-06', '--out', out]); assert.equal(JSON.parse(fs.readFileSync(out, 'utf8')).source.date, '2031-05-06');
  const html = path.join(dir, 'i9_spokes_2030-01-03.json'); fs.writeFileSync(html, '<!doctype html><html>login</html>');
  assert.throws(() => execFileSync('node', [script, html, '--out', out], { stdio: 'pipe' }));
});
