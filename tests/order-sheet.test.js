// ORDER-SHEET: buildOrderSheet() on the System and Standard samples and on order #1466. The lengths and the counts on the sheet are the ones in the email; no customer field is ever in it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildOrderSheet, OrderSheetError, ORDER_SHEET_VERSION } from '../_lib/order-sheet.js';
import { buildSystemReport } from '../_lib/system-report.js';
import { buildStandardAdditions } from '../_lib/standard-report.js';
import { buildI9OrderList } from '../_lib/i9-order-list.js';
import { findSystemBuildRecipe, systemWheels } from '../_lib/system-build.js';
import { findStandardStudioRecipe } from '../_lib/standard-build.js';
import { SYSTEM_SAMPLES, STANDARD_STUDIO_SAMPLES } from '../samples/index.js';
import { runCalculationEngine } from '../api/index.js';
import { loadSample, loadMockShopify } from './helpers/webhook-harness.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const golden = JSON.parse(fs.readFileSync(path.join(here, 'fixtures', 'order-1466-numbering.json'), 'utf8'));
const order1466 = () => JSON.parse(fs.readFileSync(path.join(here, 'fixtures', 'order-1466.json'), 'utf8'));
const clone = (o) => JSON.parse(JSON.stringify(o));
const AT = '2026-11-12T12:00:00.000Z';
const png = async () => Buffer.from('PNG');
const metaOf = (o) => (o._sample && o._sample.metafields ? new Map(Object.entries(o._sample.metafields)) : new Map(Object.entries(loadMockShopify().metafields)));
const standardSheet = (o) => {
  const componentData = metaOf(o);
  const std = findStandardStudioRecipe(o) || { recipe: JSON.parse(o.line_items.flatMap((l) => l.properties || []).find((p) => p.name === '_build').value) };
  const buildReport = componentData ? runCalculationEngine(std.recipe, componentData) : null;
  return { sheet: buildOrderSheet({ orderData: o, componentData, buildReport, calculatedAt: AT }), buildReport, componentData, recipe: std.recipe };
};

test('shape: version, kind, order number, numbering label and the "recalculated" label (PR 1 always recalculates); JSON round-trips', () => {
  const s = buildOrderSheet({ orderData: order1466(), calculatedAt: AT });
  assert.equal(s.sheetVersion, ORDER_SHEET_VERSION);
  assert.equal(s.kind, 'system'); assert.equal(s.orderNumber, '1466'); assert.equal(s.orderName, '#1466');
  assert.equal(s.numbering.label, 'numbering version 1, provisional'); assert.equal(s.numberingVersion, 1);
  assert.equal(s.calculatedAt, AT); assert.equal(s.calculation.mode, 'recalculated');
  assert.equal(s.calculation.text, 'recalculated on 2026-11-12, may differ from what was sent');
  assert.deepEqual(JSON.parse(JSON.stringify(s)), s, 'plain JSON only');
  assert.ok(JSON.stringify(s).length < 60000, 'small: no images in the sheet');
});

test('order #1466: lengths, sources, numbered spokes and lists equal the expected sheet', () => {
  const s = buildOrderSheet({ orderData: order1466(), calculatedAt: AT });
  assert.deepEqual(s.wheels.map((w) => [w.position, w.hubModel, w.total, w.ratio, w.highSide, w.lowSide]), [['front', 'Hydra2', 28, '1:1', 'rotor', 'drive'], ['rear', 'Hydra2', 32, '1:1', 'drive', 'rotor']]);
  const [f, r] = s.wheels;
  assert.deepEqual([f.lengths.status, f.lengths.rotorMm, f.lengths.driveMm], ['calculated', 305, 307]);
  assert.deepEqual([r.lengths.status, r.lengths.rotorMm, r.lengths.driveMm], ['calculated', 284, 282]);
  assert.match(f.lengths.sourceText, /I9 System chart 2026, row Triad 29" 28h TR303/); assert.equal(f.lengths.chart.partNumber, 'TR303');
  assert.equal(r.lengths.chart.partNumber, 'TR305');
  for (const w of s.wheels) assert.deepEqual(w.spokes.map((p) => [p.number, p.side, p.color]), golden[w.position], `${w.position} per-spoke list`);
  assert.deepEqual(f.lists.rotor.slice(0, 4).map((p) => `${p.number} ${p.color}`), ['2 Bronze', '4 Black', '6 Bronze', '8 Black']);
  assert.deepEqual(f.lists.drive.slice(0, 3).map((p) => `${p.number} ${p.color}`), ['1 Bronze', '3 Black', '5 Bronze']);
  assert.deepEqual(r.lists.drive.slice(0, 2).map((p) => `${p.number} ${p.color}`), ['2 Bronze', '4 Black']);
  assert.deepEqual(r.sides.drive.counts, [{ color: 'Black', n: 8 }, { color: 'Bronze', n: 8 }]);
  assert.deepEqual(f.counts.map((c) => c.n), [14, 14]);
  assert.deepEqual(s.wheels.map((w) => w.images.map((i) => i.view)), [['all', 'high', 'low'], ['all', 'high', 'low']]);
  assert.equal(s.customerSupplied, null);
});

test('order #1466: the I9 order list on the sheet is the one the email carries (text and link)', () => {
  const o = order1466(), s = buildOrderSheet({ orderData: o, calculatedAt: AT });
  const { recipe } = findSystemBuildRecipe(o);
  const wheels = systemWheels(recipe, null, o);
  assert.ok(s.orderList.text.startsWith('I9 ORDER LIST  -  order #1466'));
  assert.equal(s.orderList.cartLink, 'https://b2b.industrynine.com/cart/43663812755591:9,43663812821127:8,43663819047047:9,43663819112583:8');
  assert.match(s.orderList.orderByEmailText, /^Hi Thomas, for LoamLabs order #1466/);
  assert.ok(s.orderList.snapshotDate); assert.equal('i9OrderList' in s, false, 'the PR 1 field is gone');
  void wheels; void buildI9OrderList;
});

test('every System sample: the lengths, counts and spoke totals equal what the email report has (same functions); numbers are unique per wheel', async () => {
  for (const [name, sample] of Object.entries(SYSTEM_SAMPLES)) {
    const o = clone(sample), found = findSystemBuildRecipe(o);
    const report = await buildSystemReport({ recipe: found.recipe, orderData: o, renderPng: png });
    const s = buildOrderSheet({ orderData: o, calculatedAt: AT });
    assert.equal(s.wheels.length, report.wheels.length, name);
    for (const rw of report.wheels) {
      const w = s.wheels.find((x) => x.position === rw.position), L = report.lengths[rw.position];
      assert.ok(w, `${name} ${rw.position}`);
      if (L.pending) assert.equal(w.lengths.status, 'not-calculated', `${name} ${rw.position}`);
      else assert.deepEqual([w.lengths.rotorMm, w.lengths.driveMm, w.lengths.sourceText], [L.left, L.right, L.sourceText || null], `${name} ${rw.position} lengths`);
      assert.deepEqual(w.counts, rw.counts.all.map((c) => ({ color: c.color, n: c.n })), `${name} ${rw.position} counts`);
      assert.equal(w.spokes.length, rw.total, `${name} ${rw.position} one row per spoke`);
      assert.equal(new Set(w.spokes.map((p) => `${p.side}:${p.text}`)).size, rw.total, `${name} ${rw.position} numbers are unique`);
      assert.ok(w.spokes.every((p) => p.number != null && p.color), `${name}: every spoke has a number and a color`);
      const bySide = (side) => w.spokes.filter((p) => p.side === side).length;
      assert.deepEqual([bySide('drive'), bySide('rotor')], [w.sides.drive.count, w.sides.rotor.count], `${name} ${rw.position} spokes per side`);
      // the colors per color equal the counts
      const tally = {}; w.spokes.forEach((p) => { tally[p.color] = (tally[p.color] || 0) + 1; });
      assert.deepEqual(Object.entries(tally).sort(), w.counts.map((c) => [c.color, c.n]).sort(), `${name} ${rw.position} color tally`);
      if (w.ratio === '1:1') assert.deepEqual(w.spokes.map((p) => p.number), Array.from({ length: rw.total }, (_, i) => i + 1), `${name} ${rw.position} 1..N`);
      assert.deepEqual(w.warnings, rw.warnings, `${name} ${rw.position} warnings`);
      assert.equal(w.images.length, rw.isMultiColor ? 3 : 1, `${name} ${rw.position} image descriptors (3 for multi-color, 1 for a solid wheel)`);
    }
    assert.equal(!!s.orderList, true, name); assert.equal('i9OrderList' in s, false, name);
  }
});

test('every keyed Standard sample: counts equal the Standard email, lengths equal the engine (the numbers the Standard email and note print)', async () => {
  for (const [name, sample] of Object.entries(STANDARD_STUDIO_SAMPLES)) {
    const o = clone(sample), { sheet, buildReport, componentData, recipe } = standardSheet(o);
    assert.equal(sheet.kind, 'standard', name); assert.equal(sheet.studio, true, name); assert.equal(sheet.orderList, null, name); assert.equal('i9OrderList' in sheet, false, name);
    const extra = await buildStandardAdditions({ recipe, orderData: o, componentData, buildReport, renderPng: png });
    assert.equal(sheet.wheels.length, extra.wheels.length, name);
    for (const ew of extra.wheels) {
      const w = sheet.wheels.find((x) => x.position === ew.position);
      assert.deepEqual(w.counts, ew.counts.all.map((c) => ({ color: c.color, n: c.n })), `${name} ${ew.position} counts`);
      const er = buildReport[ew.position];
      if (er && er.calculationSuccessful) {
        assert.deepEqual([w.lengths.status, w.lengths.rotorMm, w.lengths.driveMm], ['calculated', Number(er.lengths.left.rounded), Number(er.lengths.right.rounded)], `${name} ${ew.position} lengths`);
      } else assert.equal(w.lengths.status, 'not-calculated', `${name} ${ew.position}`);
      if (w.redraw) { assert.equal(w.spokes.length, ew.total, `${name} ${ew.position} spokes`); assert.equal(w.redraw.autoValvePhase, true, 'Standard wheels are drawn with autoValvePhase'); }
      assert.equal(w.spokeProduct, ew.spokeProduct);
    }
    assert.deepEqual(sheet.warnings.filter((t) => extra.warnings.includes(t)).length > 0 || extra.warnings.length === 0, true, `${name}: the Standard warnings are on the sheet`);
  }
});

test('a Standard build without the Studio key (classic custom wheel): lengths and parts only, no per-spoke list', () => {
  const o = loadSample('standard', 'steel-jbend-wheelset');
  const { sheet, buildReport } = standardSheet(o);
  assert.equal(sheet.kind, 'standard'); assert.equal(sheet.studio, false);
  assert.ok(sheet.wheels.length >= 1);
  for (const w of sheet.wheels) {
    const er = buildReport[w.position];
    assert.deepEqual([w.lengths.rotorMm, w.lengths.driveMm], [Number(er.lengths.left.rounded), Number(er.lengths.right.rounded)]);
    assert.deepEqual([w.spokes, w.images, w.redraw], [[], [], null]);
    assert.ok(w.rimTitle && w.hubTitle && w.spokeProduct);
  }
});

test('a Standard order with no calculation passed in: its lengths say "not calculated" (never a number)', () => {
  const o = clone(STANDARD_STUDIO_SAMPLES['std-berd-rear-custom-two-painted']);
  const s = buildOrderSheet({ orderData: o, componentData: metaOf(o), calculatedAt: AT });
  assert.ok(s.wheels.length >= 1 && s.wheels.every((w) => w.lengths.status === 'not-calculated' && w.lengths.rotorMm === null && w.lengths.driveMm === null));
});

test('a chart miss (unknown rim variant): the wheel says NOT CALCULATED with the reason, the rest of the sheet is complete', () => {
  const o = order1466();
  const line = o.line_items.find((l) => (l.properties || []).some((p) => p.name === '_build')), prop = line.properties.find((p) => p.name === '_build');
  const b = JSON.parse(prop.value); b.components.frontRim.variantId = 'gid://shopify/ProductVariant/1'; prop.value = JSON.stringify(b);
  const s = buildOrderSheet({ orderData: o, calculatedAt: AT });
  const f = s.wheels[0];
  assert.equal(f.lengths.status, 'not-calculated'); assert.equal(f.lengths.rotorMm, null);
  assert.match(f.lengths.text, /NOT CALCULATED/);
  assert.equal(f.spokes.length, 28, 'the spoke list is still complete');
  assert.equal(s.wheels[1].lengths.status, 'calculated');
  assert.ok(s.orderList.text.includes('length not calculated'), 'the I9 list says so for that wheel');
});

test('customer-supplied parts are reported (System)', () => {
  const name = Object.keys(SYSTEM_SAMPLES).find((n) => /own|supplied/i.test(n));
  const o = name ? clone(SYSTEM_SAMPLES[name]) : null;
  if (o) { assert.ok(buildOrderSheet({ orderData: o, calculatedAt: AT }).customerSupplied); return; }
  // no such sample: build one from #1466 by marking the front rim as the customer's
  const x = order1466(), line = x.line_items.find((l) => (l.properties || []).some((p) => p.name === '_build')), prop = line.properties.find((p) => p.name === '_build');
  const b = JSON.parse(prop.value); b.components.frontRim.supplied = true; prop.value = JSON.stringify(b);
  const s = buildOrderSheet({ orderData: x, calculatedAt: AT });
  assert.ok(s.customerSupplied && /front rim/i.test(s.customerSupplied.text), JSON.stringify(s.customerSupplied));
  assert.match(s.customerSupplied.reminder, /Parts must arrive/);
  assert.ok(s.wheels[0].supplied && s.wheels[0].supplied.rim === true);
});

test('ORDER-CHECK flags: a second build line or a quantity above 1 is on the sheet', () => {
  const o = order1466();
  const line = o.line_items.find((l) => (l.properties || []).some((p) => p.name === '_build'));
  line.quantity = 2;
  const s = buildOrderSheet({ orderData: o, calculatedAt: AT });
  assert.equal(s.orderChecks.length, 1); assert.match(s.orderChecks[0], /quantity 2/);
  assert.equal(buildOrderSheet({ orderData: order1466(), calculatedAt: AT }).orderChecks.length, 0);
});

test('an order without a wheel build throws NOT_A_BUILDER_ORDER (and bad input never gives a half sheet)', () => {
  for (const o of [{ order_number: 5, line_items: [{ title: 'Spoke wrench', quantity: 1, properties: [] }] }, { line_items: [] }, {}, undefined]) {
    assert.throws(() => buildOrderSheet({ orderData: o }), (e) => e instanceof OrderSheetError && e.code === 'NOT_A_BUILDER_ORDER');
  }
});

/* ------------------------------------------------------------------ privacy */

const CUSTOMER_KEYS = /^(email|phone|contact_email|customer|shipping_address|billing_address|default_address|note|note_attributes|browser_ip|first_name|last_name|address1|address2|city|zip|province|name_on_card)$/i;
function walk(v, fn, keyPath = '') {
  if (Array.isArray(v)) v.forEach((x, i) => walk(x, fn, `${keyPath}[${i}]`));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { fn(k, x, `${keyPath}.${k}`); walk(x, fn, `${keyPath}.${k}`); }
}

test('PRIVACY: customer name, email, address, phone and note never appear in the sheet, for every sample and #1466 (values and key names)', () => {
  const PII = { first_name: 'Zebulon', last_name: 'Quimby-Faraday', email: 'zebulon.q@private-mail.example', phone: '+1 555 010 4242', address1: '12 Hidden Lane Unit 9', city: 'Nowhereville', zip: '99999-1234', note: 'ZZ-SECRET-NOTE please leave at back door' };
  const inject = (o) => {
    o.email = PII.email; o.contact_email = PII.email; o.phone = PII.phone; o.note = PII.note; o.browser_ip = '203.0.113.77';
    o.customer = { id: 4242, first_name: PII.first_name, last_name: PII.last_name, email: PII.email, phone: PII.phone, default_address: { address1: PII.address1, city: PII.city, zip: PII.zip } };
    o.shipping_address = { first_name: PII.first_name, last_name: PII.last_name, address1: PII.address1, city: PII.city, zip: PII.zip, phone: PII.phone, name: `${PII.first_name} ${PII.last_name}` };
    o.billing_address = { ...o.shipping_address };
    o.note_attributes = [{ name: 'gift', value: PII.note }];
    return o;
  };
  const orders = [['order-1466', inject(order1466())], ...Object.entries(SYSTEM_SAMPLES).map(([n, s]) => [n, inject(clone(s))]), ...Object.entries(STANDARD_STUDIO_SAMPLES).map(([n, s]) => [n, inject(clone(s))]), ['steel-jbend', inject(loadSample('standard', 'steel-jbend-wheelset'))]];
  for (const [name, o] of orders) {
    const { sheet } = o.line_items.some((l) => (l.properties || []).some((p) => p.name === '_build' && /standardStudio|"spokeInterface":"system"/.test(String(p.value)))) && !findSystemBuildRecipe(o) ? standardSheet(o) : (findSystemBuildRecipe(o) ? { sheet: buildOrderSheet({ orderData: o, calculatedAt: AT }) } : standardSheet(o));
    const text = JSON.stringify(sheet);
    for (const [k, v] of Object.entries(PII)) assert.equal(text.includes(v), false, `${name}: the sheet must not contain the customer's ${k}`);
    for (const frag of ['Zebulon', 'Quimby', 'private-mail', '555 010', 'Hidden Lane', 'Nowhereville', 'ZZ-SECRET', '203.0.113.77', 'customer@example.com', 'Alex']) assert.equal(text.includes(frag), false, `${name}: "${frag}"`);
    walk(sheet, (k, v, p) => { assert.equal(CUSTOMER_KEYS.test(k), false, `${name}: key ${p} looks like a customer field`); });
  }
});

test('PRIVACY: the order queries ask for no customer field at all', async () => {
  const { ORDER_QUERY, COMPONENT_QUERY } = await import('../_lib/order-sheet-api.js');
  for (const q of [ORDER_QUERY, COMPONENT_QUERY]) assert.equal(/email|phone|customer\b|customerJourney|address|shipping|billing|\bnote\b|displayAddress|client/i.test(q.replace(/customAttributes/g, '')), false, q);
});

/* ------------------------------------------------------------------ spoke counts on Standard sheets */

import { runWebhook } from './helpers/webhook-harness.mjs';
const INDEX = path.resolve(here, '..', 'api', 'index.js');
const buildOf = (o) => JSON.parse(o.line_items.flatMap((l) => l.properties || []).find((p) => p.name === '_build').value);
const setBuild = (o, fn) => { const prop = o.line_items.flatMap((l) => l.properties || []).find((p) => p.name === '_build'); const b = JSON.parse(prop.value); fn(b); prop.value = JSON.stringify(b); return o; };

test('Standard sheet (no Studio key, like order #1377): total, label, per-side count and ratio come from the build and are the numbers the calculation and the stock step used', async () => {
  const o = loadSample('standard', 'steel-jbend-wheelset');
  const { sheet, buildReport } = standardSheet(o);
  assert.equal(sheet.studio, false);
  const specs = buildOf(o).specs;
  for (const w of sheet.wheels) {
    const n = parseInt(specs[`${w.position}SpokeCount`], 10);
    assert.deepEqual([w.total, w.spokeCountLabel, w.ratio, w.sides.drive.count, w.sides.rotor.count], [n, `${n}h`, '1:1', n / 2, n / 2], w.position);
    assert.match(w.countsNote, /half of the spokes for each side/); assert.match(w.countsNote, /no lacing ratio for Standard hubs/);
    assert.equal(buildReport[w.position].calculationSuccessful, true);
  }
  // the webhook's own stock step deducts exactly this many spokes per side
  const hook = await runWebhook(INDEX, 'orders/create', clone(o));
  const deltas = hook.inventoryAdjustments.map((a) => Math.abs(a.changes[0].delta));
  assert.ok(deltas.length >= 4 && deltas.every((d) => d === sheet.wheels[0].sides.drive.count), `stock deltas ${deltas}`);
});

test('Standard sheet: an odd spoke count keeps the total and the label but no per-side count and no ratio; a missing count leaves everything null; a failed wheel keeps its count', () => {
  const odd = setBuild(loadSample('standard', 'steel-jbend-wheelset'), (b) => { b.specs.frontSpokeCount = '25h'; });
  const sOdd = standardSheet(odd).sheet, f = sOdd.wheels.find((w) => w.position === 'front');
  assert.deepEqual([f.total, f.spokeCountLabel, f.ratio, f.sides.drive.count, f.sides.rotor.count], [25, '25h', null, null, null]);
  const rear = sOdd.wheels.find((w) => w.position === 'rear'); assert.equal(rear.total, 32);
  const gone = setBuild(loadSample('standard', 'steel-jbend-wheelset'), (b) => { delete b.specs.frontSpokeCount; b.specs.rearSpokeCount = ''; });
  const sGone = standardSheet(gone).sheet;
  for (const w of sGone.wheels) assert.deepEqual([w.total, w.spokeCountLabel, w.ratio, w.sides.drive.count, w.sides.rotor.count, w.countsNote], [null, null, null, null, null, null], w.position);
});

test('Standard sheet WITH the Studio key: the counts and the ratio come from the Studio wheel; a 2:1 split (16 drive / 8 rotor) is reported as 2:1', () => {
  const o = clone(STANDARD_STUDIO_SAMPLES['std-berd-rear-custom-two-painted']);
  const base = standardSheet(clone(o)).sheet.wheels[0];
  assert.deepEqual([base.total, base.spokeCountLabel, base.ratio], [base.sides.drive.count + base.sides.rotor.count, `${base.total}h`, base.sides.drive.count === base.sides.rotor.count ? '1:1' : '2:1']);
  const two = setBuild(clone(o), (b) => { const w = b.standardStudio.wheels.rear; w.drive.n = 16; w.rotor.n = 8; b.specs.rearSpokeCount = '24h'; if (b.standardStudio.studio && b.standardStudio.studio.spokes) delete b.standardStudio.studio.spokes; });
  const r = standardSheet(two).sheet.wheels.find((w) => w.position === 'rear');
  assert.deepEqual([r.total, r.spokeCountLabel, r.ratio, r.sides.drive.count, r.sides.rotor.count], [24, '24h', '2:1', 16, 8]);
  assert.equal(r.highSide, null, 'unequal sides have no high-tension side in the numbering');
  assert.equal('countsNote' in r, false, 'the note only belongs to the Studio-less Standard builds');
});

test('System sheets are unchanged by this: the same keys on the sheet and on every wheel, no countsNote, ratio and counts as before', () => {
  const WHEEL_KEYS = ['position', 'label', 'hubModel', 'hubTitle', 'hubVariantTitle', 'hubColor', 'freehub', 'rimTitle', 'spokeCountLabel', 'total', 'ratio', 'highSide', 'lowSide', 'sides', 'lengths', 'counts', 'isMultiColor', 'spokes', 'lists', 'images', 'redraw', 'supplied', 'warnings'];
  const s = buildOrderSheet({ orderData: order1466(), calculatedAt: AT });
  for (const w of s.wheels) { assert.deepEqual(Object.keys(w), WHEEL_KEYS); assert.equal('countsNote' in w, false); }
  assert.deepEqual(s.wheels.map((w) => [w.total, w.spokeCountLabel, w.ratio, w.sides.drive.count, w.sides.rotor.count]), [[28, '28h (14 drive / 14 rotor)', '1:1', 14, 14], [32, '32h (16 drive / 16 rotor)', '1:1', 16, 16]]);
  for (const [name, sample] of Object.entries(SYSTEM_SAMPLES)) for (const w of buildOrderSheet({ orderData: clone(sample), calculatedAt: AT }).wheels) assert.equal('countsNote' in w, false, name);
});
