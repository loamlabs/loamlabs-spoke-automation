// FEE-CHECK and SHORT NOTE (order #1466, Nov 12 2026).
//  1. The "Custom Spoke Color Configuration" check is pooled over the order: a merged Front/Rear line (quantity 2) covers both wheels, so the real #1466 order no longer
//     warns falsely; a quantity-1 merged line covers one wheel only; a fee on a one-color wheel warns (it was silent for a merged line).
//  2. The System order note is short and calm (the customer reads it): per wheel the wheel line, then each side with its spoke length and colors together. Warnings, the chart
//     source and the "why no length" text are in the internal email only.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runWebhook, loadSample } from './helpers/webhook-harness.mjs';
import { findSystemBuildRecipe, systemWheels, feeWheelsOf, feeCoverage, SYSTEM_FEE } from '../_lib/system-build.js';
import { buildSystemReport } from '../_lib/system-report.js';
import { SYSTEM_SAMPLES } from '../samples/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const INDEX = path.resolve(here, '..', 'api', 'index.js');
const clone = (o) => JSON.parse(JSON.stringify(o));
const png = async () => Buffer.from('PNG');
const order1466 = () => clone(JSON.parse(fs.readFileSync(path.join(here, 'fixtures', 'order-1466.json'), 'utf8')));
const recipeOf = (o) => findSystemBuildRecipe(o).recipe;
const buildProp = (o) => o.line_items.flatMap((l) => l.properties || []).find((p) => p.name === '_build');
const feeLine = (wheel, quantity) => ({ id: 77000 + quantity, title: SYSTEM_FEE.name, name: SYSTEM_FEE.name, variant_title: 'Mixed colors', quantity, price: '25.00', variant_id: SYSTEM_FEE.variantId, properties: [{ name: 'Wheel', value: wheel }] });
// the order with its fee lines replaced by exactly these: [wheel text, quantity]
function withFees(order, fees) { const o = clone(order); o.line_items = o.line_items.filter((li) => li.title !== SYSTEM_FEE.name && li.variant_id !== SYSTEM_FEE.variantId); fees.forEach(([w, q]) => o.line_items.push(feeLine(w, q))); return o; }
const feeWarnings = (o) => systemWheels(recipeOf(o), null, o).flatMap((w) => w.warnings.map((t) => `${w.label}: ${t}`)).filter((t) => t.includes(SYSTEM_FEE.name));
const units = (o) => systemWheels(recipeOf(o), null, o).map((w) => w.feeLines);
const TWO = () => loadSample('system', 'hydra2-wheelset-28f-32r');   // front and rear both have two or more colors
const FRONT_MULTI = () => loadSample('system', 'solix-24h-wheelset-front-custom-rear-solid'); // front custom, rear one color
const SOLID = () => loadSample('system', 'solix-24h-wheelset-both-solid-black');
const FRONT_ONLY = () => loadSample('system', 'hydra2-front-28h-only'); // one wheel build, multi-color
const REAR_ONLY = () => loadSample('system', 'hydra2-rear-32h-all-different');

/* ------------------------------------------------------------------ Job 1: the fee check */

test('feeWheelsOf: Front, Rear, and a merged line in any case, spacing and order', () => {
  const w = (v) => feeWheelsOf({ properties: [{ name: 'Wheel', value: v }] });
  assert.deepEqual(w('Front'), ['front']); assert.deepEqual(w('rear'), ['rear']);
  for (const v of ['Front/Rear', 'Rear/Front', 'front / rear', 'FRONT,REAR', ' Rear , Front ']) assert.deepEqual(w(v), ['front', 'rear'], v);
  assert.deepEqual(w(''), []); assert.deepEqual(w('Frontier'), [], 'whole words only'); assert.deepEqual(feeWheelsOf({ properties: [] }), []);
});

test('fee check, Front only: a front-only build with its fee line has no fee warning; without it, it warns', () => {
  assert.deepEqual(feeWarnings(withFees(FRONT_ONLY(), [['Front', 1]])), []);
  assert.deepEqual(units(withFees(FRONT_ONLY(), [['Front', 1]])), [1]);
  assert.ok(feeWarnings(withFees(FRONT_ONLY(), [])).some((t) => t.includes('Front wheel uses 2 colors but the order has no "Custom Spoke Color Configuration" line for it')));
});

test('fee check, Rear only: a rear-only build with its fee line has no fee warning; without it, it warns', () => {
  assert.deepEqual(feeWarnings(withFees(REAR_ONLY(), [['Rear', 1]])), []);
  assert.ok(feeWarnings(withFees(REAR_ONLY(), [])).some((t) => t.startsWith('Rear: Rear wheel uses')));
});

test('fee check, Front plus Rear as two separate lines (the older cart shape): no fee warning', () => {
  assert.deepEqual(feeWarnings(withFees(TWO(), [['Front', 1], ['Rear', 1]])), []);
  assert.deepEqual(units(withFees(TWO(), [['Front', 1], ['Rear', 1]])), [1, 1]);
  // the sample itself carries the two lines
  assert.deepEqual(feeWarnings(TWO()), []);
});

test('fee check, ONE merged Front/Rear line with quantity 2 (the #1466 shape): both wheels covered, no warning', () => {
  const o = withFees(TWO(), [['Front/Rear', 2]]);
  assert.deepEqual(feeWarnings(o), []); assert.deepEqual(units(o), [1, 1]);
  assert.deepEqual(feeCoverage(o, { front: true, rear: true }), { units: { front: 1, rear: 1 }, shared: { lines: 1, quantity: 2 } });
  for (const spelling of ['Rear/Front', 'front / rear']) assert.deepEqual(feeWarnings(withFees(TWO(), [[spelling, 2]])), [], spelling);
});

test('fee check, merged Front/Rear line with quantity 1 and two multi-color wheels: the rear wheel is reported as not verified (never guessed as covered)', () => {
  const o = withFees(TWO(), [['Front/Rear', 1]]);
  assert.deepEqual(units(o), [1, 0]);
  const w = feeWarnings(o); assert.equal(w.length, 1, w.join(' | '));
  assert.ok(w[0].startsWith('Rear: Rear wheel uses 3 colors') && w[0].includes('one shared Front/Rear line with quantity 1, which covers only 1 of the 2 wheels with custom colors') && w[0].includes("The Rear wheel's fee is not verified."), w[0]);
});

test('fee check: a merged line quantity 1 is enough when only ONE wheel has custom colors; quantity 2 then leaves a fee on the one-color wheel (warned)', () => {
  assert.deepEqual(feeWarnings(withFees(FRONT_MULTI(), [['Front/Rear', 1]])), []);
  const w = feeWarnings(withFees(FRONT_MULTI(), [['Front/Rear', 2]]));
  assert.equal(w.length, 1); assert.ok(w[0].startsWith('Rear: Rear wheel is one color but the order has a "Custom Spoke Color Configuration" line for it'), w[0]);
});

test('fee check, a one-color wheel with a fee line warns (this direction was silent for a merged line); neither wheel multi-color and no fee: no warning', () => {
  const w = feeWarnings(withFees(FRONT_MULTI(), [['Front', 1], ['Rear', 1]]));
  assert.equal(w.length, 1); assert.ok(w[0].startsWith('Rear: Rear wheel is one color but'));
  assert.deepEqual(feeWarnings(withFees(SOLID(), [])), []);
  const both = feeWarnings(withFees(SOLID(), [['Front/Rear', 2]]));
  assert.equal(both.length, 2, 'both one-color wheels have a fee they should not');
});

test('fee check, the real #1466 order: no fee warning, units 1 + 1, the email row says covered', async () => {
  const o = order1466();
  assert.deepEqual(feeWarnings(o), []); assert.deepEqual(units(o), [1, 1]);
  const r = await buildSystemReport({ recipe: recipeOf(o), orderData: o, renderPng: png });
  assert.deepEqual(r.warnings, [], 'no warning of any kind on #1466');
  assert.equal((r.html.match(/on the order \(covers this wheel\)/g) || []).length, 2);
  assert.equal(/expected, none found|expected, not found/.test(r.html), false);
  // the same order without its fee line: the row says so, and warns
  const none = withFees(o, []); const r2 = await buildSystemReport({ recipe: recipeOf(none), orderData: none, renderPng: png });
  assert.equal((r2.html.match(/expected, not found on the order for this wheel/g) || []).length, 2); assert.equal(r2.warnings.length, 2);
});

/* ------------------------------------------------------------------ Job 2: the short order note */

const NOTE_1466 = [
  'FRONT  We Are One TRIAD Carbon Rim (Enduro) - 29"  /  Hydra2, Bronze',
  '  Rotor side  305 mm:  7 Black, 7 Bronze',
  '  Drive side  307 mm:  7 Black, 7 Bronze',
  '',
  'REAR   We Are One TRIAD Carbon Rim (Enduro) - 27.5"  /  Hydra2, Bronze',
  '  Rotor side  284 mm:  8 Black, 8 Bronze',
  '  Drive side  282 mm:  8 Black, 8 Bronze',
  ''
].join('\n');

test('order #1466 replayed through the webhook (Shopify and Resend mocked): the new short note, no fee warning, one internal email', async () => {
  const r = await runWebhook(INDEX, 'orders/create', order1466());
  assert.equal(r.status, 200); assert.equal(r.inventoryAdjustments.length, 0);
  assert.equal(r.note, NOTE_1466);
  assert.equal(r.logs.filter(([k, m]) => k === 'warn' && /I9-SYSTEM note:/.test(m)).length, 0, 'no warning logged');
  assert.equal(r.restEmails.length, 1, 'flag off: only the internal email');
  const html = r.restEmails[0].html;
  assert.ok(html.includes('Rotor side 305 mm:') && html.includes('Drive side 307 mm:') && html.includes('Rotor side 284 mm:') && html.includes('Drive side 282 mm:'));
  assert.ok(html.includes('source: I9 System chart 2026, row Triad 29&quot; 28h TR303'), 'the chart source is in the internal email');
  assert.equal(html.includes('Whole wheel'), false, 'the redundant Whole wheel row is gone from the internal email');
  assert.equal(/NOTE:/.test(html), false);
});

test('the note text itself: no header, hub color line, whole-wheel line, length line, chart source, warnings or empty headers', async () => {
  const r = await runWebhook(INDEX, 'orders/create', order1466());
  for (const forbidden of [/AUTOMATED/, /REPORT/, /Hub color/, /Whole wheel/, /Spoke lengths/, /source/i, /chart/i, /I9/, /NOTE/, /warning/i, /one bundle/, /inventory/i, /IMAGES/, /Freehub/i, /Left\/Rotor|Right\/Drive|Disc side/]) {
    assert.equal(forbidden.test(r.note), false, `the order note must not match ${forbidden}`);
  }
  assert.ok(r.note.split('\n').every((l) => l.length <= 80), 'short lines for a packing slip');
});

test('warnings go to the internal email only: a noisy order has a clean note and a noisy email', async () => {
  const o = withFees(order1466(), []); // both fees missing
  o.line_items.filter((li) => li.title === 'Industry Nine SYSTEM Spokes')[0].quantity += 1;
  const r = await runWebhook(INDEX, 'orders/create', o);
  assert.equal(r.note, NOTE_1466, 'the note is exactly the same short text');
  const html = r.restEmails[0].html;
  assert.ok(html.includes('NOTE:') && html.includes('has no &quot;Custom Spoke Color Configuration&quot; line for it'), 'the fee warning is in the email');
  const q = order1466(); q.line_items.find((l) => (l.properties || []).some((p) => p.name === '_build')).quantity = 2;
  const rq = await runWebhook(INDEX, 'orders/create', q);
  assert.equal(rq.note, NOTE_1466, 'quantity 2: still only the short note'); assert.ok(rq.restEmails[0].html.includes('Check this order by hand')); assert.match(rq.restEmails[0].subject, /^ACTION REQUIRED: /);
});

test('one-color wheel and one-wheel builds: one entry for a single-color side, one block for a one-wheel build, no empty headers', async () => {
  // rear wheel one color (a set whose rear is solid Black), only the front has custom colors
  const o = order1466(); const p = buildProp(o); const b = JSON.parse(p.value);
  b.system.studio.spokes.rear = { drive: b.system.studio.spokes.rear.drive.map(() => 'Black'), rotor: b.system.studio.spokes.rear.rotor.map(() => 'Black') };
  p.value = JSON.stringify(b);
  const rearBundle = o.line_items.find((li) => li.title === 'Industry Nine SYSTEM Spokes' && (li.properties || []).some((x) => x.name === 'Wheel' && x.value === 'Rear'));
  rearBundle.properties.find((x) => x.name === 'Spoke Colors').value = 'Black'; // the cart line of a solid wheel says just the color
  const wset = withFees(o, [['Front', 1]]);
  const r = await runWebhook(INDEX, 'orders/create', wset);
  assert.equal(r.note, NOTE_1466.replace('  Rotor side  284 mm:  8 Black, 8 Bronze', '  Rotor side  284 mm:  16 Black').replace('  Drive side  282 mm:  8 Black, 8 Bronze', '  Drive side  282 mm:  16 Black'));
  assert.deepEqual(r.logs.filter(([k, m]) => k === 'warn' && /I9-SYSTEM note:/.test(m)), [], 'a one-color rear with no fee for it: no warning');
  // one-wheel build (front only)
  const f = order1466(); const fb = JSON.parse(buildProp(f).value); fb.buildType = 'Front'; delete fb.components.rearRim; delete fb.components.rearHub; delete fb.components.rearSpokes; delete fb.system.studio.spokes.rear; delete fb.system.wheels.rear; buildProp(f).value = JSON.stringify(fb);
  f.line_items = f.line_items.filter((li) => !/Rear/.test((li.properties.find((x) => x.name === 'Wheel') || {}).value || '') || /Front/.test((li.properties.find((x) => x.name === 'Wheel') || {}).value));
  const fo = withFees(f, [['Front', 1]]);
  const rf = await runWebhook(INDEX, 'orders/create', fo);
  assert.equal(rf.note, NOTE_1466.split('\n\n')[0] + '\n');
});

test('the counts in the note add up to the wheel spoke count and agree with the per-spoke map, for every System sample and for #1466', async () => {
  const orders = [...Object.keys(SYSTEM_SAMPLES).map((n) => [n, loadSample('system', n)]), ['order-1466', order1466()]];
  for (const [name, order] of orders) {
    const recipe = recipeOf(order);
    const report = await buildSystemReport({ recipe, orderData: order, renderPng: png, lengthCalculator: () => ({ left: 290, right: 292 }) });
    const blocks = report.note.split('\n\n').filter((b) => /^(FRONT|REAR) /.test(b));
    assert.equal(blocks.length, report.wheels.length, `${name}: one block per wheel`);
    blocks.forEach((block, i) => {
      const w = report.wheels[i], lines = block.split('\n');
      assert.ok(lines[0].startsWith(w.label.toUpperCase()), `${name}: ${w.label} block first`);
      const parse = (side) => { const l = lines.find((x) => x.startsWith(`  ${side} side`)); const m = /:  (.*)$/.exec(l); return Object.fromEntries(m[1].split(', ').map((e) => { const mm = /^(\d+) (.+)$/.exec(e); return [mm[2], Number(mm[1])]; })); };
      const tally = (list) => list.reduce((a, c) => { a[c] = (a[c] || 0) + 1; return a; }, {});
      const rotor = parse('Rotor'), drive = parse('Drive');
      assert.deepEqual(rotor, tally(w.colors.rotor), `${name} ${w.label}: rotor side agrees with the per-spoke map`);
      assert.deepEqual(drive, tally(w.colors.drive), `${name} ${w.label}: drive side agrees with the per-spoke map`);
      const sum = (o) => Object.values(o).reduce((s, n) => s + n, 0);
      assert.equal(sum(rotor) + sum(drive), w.total, `${name} ${w.label}: the printed counts add up to the wheel's ${w.total} spokes`);
    });
    for (const forbidden of [/NOTE/, /warning/i, /source/i, /chart/i, /AUTOMATED/, /Whole wheel/]) assert.equal(forbidden.test(report.note.replace(/^CUSTOMER-SUPPLIED[^\n]*\n[^\n]*\n\n/, '')), false, `${name}: no ${forbidden} in the note`);
  }
});

test('a wheel without chart lengths prints its colors without a length, and the reason is in the internal email only', async () => {
  const o = loadSample('system', 'hydra2-front-28h-only'); // its rim is not in the chart
  const r = await buildSystemReport({ recipe: recipeOf(o), orderData: o, renderPng: png });
  assert.ok(/^ {2}Rotor side:  .+$/m.test(r.note) && /^ {2}Drive side:  .+$/m.test(r.note) && !/ mm:/.test(r.note));
  assert.equal(/NOT CALCULATED|chart|I9/.test(r.note), false);
  assert.ok(r.html.includes('NOT CALCULATED'));
});

test('the duplicate-delivery guard recognises the short note (it has no header): a second delivery of #1466 sends and writes nothing', async () => {
  const first = await runWebhook(INDEX, 'orders/create', order1466());
  assert.equal(first.notes.length, 1);
  // Shopify re-delivers the original payload while the live note now holds the short note
  const { createMock, loadMockShopify } = await import('./helpers/webhook-harness.mjs');
  const o = order1466(); const mock = createMock(loadMockShopify()); mock.state.orderNotes[o.admin_graphql_api_id] = first.note;
  const again = await runWebhook(INDEX, 'orders/create', o, { mock });
  assert.equal(again.status, 200); assert.equal(again.notes.length, 0, 'no second note'); assert.equal(again.restEmails.length, 0, 'no second email');
});
