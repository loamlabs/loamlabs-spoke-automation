// Round 6: System spokes sold as ONE bundle line per wheel (quantity 1, $299), see the theme's round 8. The backend reads BOTH formats:
//   bundle line   (_spoke_bundle = "1", property "Spoke Colors": "Red ×22, Orange ×6" or "Black" for a solid wheel; quantity is 1 whatever the wheel)
//   per-color line (older orders: one line per color, quantity = number of spokes)
// The two sample carts come from the theme (tests/fixtures/system-bundle-sample-cart.json, converted to the order webhook shape by tests/helpers/cart-to-order.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSample, runWebhook } from './helpers/webhook-harness.mjs';
import { BUNDLE_CARTS, cartToOrder, bundleToPerColor } from './helpers/cart-to-order.mjs';
import { findSystemBuildRecipe, systemWheels, cartSpokeCounts, parseSpokeColorsProperty, isSpokeBundleLineItem, isSystemSpokeLineItem, propValue } from '../_lib/system-build.js';
import { buildSystemReport, buildCustomerEmail } from '../_lib/system-report.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const png = async () => Buffer.from('x');
const NAMES = ['hydra2-bundle-front-custom-rear-solid', 'solix-bundle-24h-both-solid-black'];
const TOTALS = { 'hydra2-bundle-front-custom-rear-solid': { front: 28, rear: 32 }, 'solix-bundle-24h-both-solid-black': { front: 24, rear: 24 } };
const clone = (o) => JSON.parse(JSON.stringify(o));
const spokeLines = (order) => order.line_items.filter(isSystemSpokeLineItem);
const lineOf = (order, wheel) => spokeLines(order).find((li) => String(propValue(li, 'Wheel')).toLowerCase() === wheel);
const setProp = (li, name, value) => { li.properties.find((p) => p.name === name).value = value; };
function wheelsOf(order) { return systemWheels(findSystemBuildRecipe(order).recipe, null, order); }
const mismatchWarnings = (order) => wheelsOf(order).flatMap((w) => w.warnings.filter((x) => x.includes('cart spoke lines do not match')));

test('the two sample orders are what the theme builds: one bundle line per wheel, quantity 1, $299, and the samples in samples/system match the cart file', () => {
  const hydra = loadSample('system', NAMES[0]), solix = loadSample('system', NAMES[1]);
  assert.deepEqual(hydra, cartToOrder(BUNDLE_CARTS.custom_front_solid_rear_hydra2_set, { orderNumber: 90021, description: hydra._sample.description }));
  assert.deepEqual(solix, cartToOrder(BUNDLE_CARTS.solid_solix_24h_set_same_color_both_wheels, { orderNumber: 90022, description: solix._sample.description }));
  for (const order of [hydra, solix]) {
    const lines = spokeLines(order);
    assert.equal(lines.length, 2, 'one spoke line per wheel');
    for (const li of lines) { assert.equal(li.quantity, 1); assert.equal(li.price, '299.00'); assert.ok(isSpokeBundleLineItem(li)); }
  }
  assert.deepEqual(spokeLines(hydra).map((li) => [propValue(li, 'Wheel'), li.variant_title, propValue(li, 'Spoke Colors')]).sort(), [['Front', 'Red / -', 'Red ×22, Orange ×6'], ['Rear', 'Gold / -', 'Gold']]);
  assert.deepEqual(spokeLines(solix).map((li) => li.variant_title), ['Black / -', 'Black / -']);
});

test('bundle orders: the cart counts are the wheel\'s own colors (not the quantity 1), and a normal bundle order raises NO warning', () => {
  const hydra = loadSample('system', NAMES[0]), solix = loadSample('system', NAMES[1]);
  const [hf, hr] = wheelsOf(hydra), [sf, sr] = wheelsOf(solix);
  assert.deepEqual({ ...hf.cartCounts }, { Red: 22, Orange: 6 });
  assert.deepEqual({ ...hr.cartCounts }, { Gold: 32 });
  assert.deepEqual({ ...sf.cartCounts }, { Black: 24 });
  assert.deepEqual({ ...sr.cartCounts }, { Black: 24 }, 'same variant on both wheels: still separate wheels, 24 each, never 48');
  for (const w of [hf, hr, sf, sr]) assert.deepEqual(w.warnings, [], `${w.label}: ${w.warnings}`);
  assert.equal(hf.isMultiColor, true); assert.equal(hr.isMultiColor, false);
  assert.equal(hf.feeLines, 1);
});

test('a real mismatch still warns: wrong count, wrong color, an extra color, a solid label on a custom wheel, a wheel total that is too small', () => {
  const edit = (name, fn) => { const o = clone(loadSample('system', name)); fn(o); return o; };
  const H = NAMES[0], S = NAMES[1];
  const cases = {
    'one spoke moved between colors': edit(H, (o) => setProp(lineOf(o, 'front'), 'Spoke Colors', 'Red ×21, Orange ×7')),
    'a color that is not in the Studio': edit(H, (o) => setProp(lineOf(o, 'front'), 'Spoke Colors', 'Red ×22, Blue ×6')),
    'a third color': edit(H, (o) => setProp(lineOf(o, 'front'), 'Spoke Colors', 'Red ×20, Orange ×6, Blue ×2')),
    'a custom wheel labelled solid': edit(H, (o) => setProp(lineOf(o, 'front'), 'Spoke Colors', 'Red')),
    'a solid wheel with the wrong color': edit(H, (o) => setProp(lineOf(o, 'rear'), 'Spoke Colors', 'Silver')),
    'a solid wheel with a count that is too small': edit(S, (o) => setProp(lineOf(o, 'rear'), 'Spoke Colors', 'Black ×20')),
    'a solid wheel listed as two colors': edit(S, (o) => setProp(lineOf(o, 'front'), 'Spoke Colors', 'Black ×12, Silver ×12'))
  };
  for (const [what, order] of Object.entries(cases)) {
    assert.equal(mismatchWarnings(order).length, 1, `${what}: ${wheelsOf(order).flatMap((w) => w.warnings)}`);
  }
  // the warning names the wheel and the numbers
  const w = mismatchWarnings(cases['one spoke moved between colors'])[0];
  assert.ok(w.startsWith('Front wheel:') && w.includes('Red (Studio 22, cart 21)') && w.includes('Orange (Studio 6, cart 7)'), w);
  // only the wheel that is wrong warns
  assert.equal(wheelsOf(cases['a solid wheel with the wrong color']).filter((x) => x.warnings.length).map((x) => x.position).join(), 'rear');
  assert.equal(wheelsOf(cases['a solid wheel with a count that is too small']).filter((x) => x.warnings.length).map((x) => x.position).join(), 'rear');
});

test('a bundle line without a "Spoke Colors" text has nothing to compare and does not warn; its quantity is never read as a spoke count', () => {
  const o = clone(loadSample('system', NAMES[0]));
  const li = lineOf(o, 'front'); li.properties = li.properties.filter((p) => p.name !== 'Spoke Colors');
  assert.equal(mismatchWarnings(o).length, 0);
  li.quantity = 28; // even a tampered quantity is ignored on a bundle line
  assert.equal(mismatchWarnings(o).length, 0);
  assert.deepEqual({ ...cartSpokeCounts(o, 'front', 28) }, {});
});

test('old format (one line per color, quantity = spokes) still works and a mismatch there still warns', () => {
  for (const name of NAMES) {
    const old = bundleToPerColor(loadSample('system', name), TOTALS[name]);
    assert.ok(spokeLines(old).every((li) => !isSpokeBundleLineItem(li) && propValue(li, 'Spoke Colors') === undefined));
    assert.equal(spokeLines(old).length > 2 || name === NAMES[1], true);
    for (const w of wheelsOf(old)) assert.deepEqual(w.warnings, [], `${name} ${w.label}: ${w.warnings}`);
    old.line_items.find((li) => isSystemSpokeLineItem(li)).quantity += 1;
    assert.equal(mismatchWarnings(old).length, 1, name);
  }
  // the original old-format samples are untouched
  for (const n of ['hydra2-wheelset-28f-32r', 'solix-24h-wheelset-multicolor', 'solix-24h-wheelset-both-solid-black']) for (const w of wheelsOf(loadSample('system', n))) assert.deepEqual(w.warnings, [], `${n} ${w.label}`);
  // old and new lines for DIFFERENT wheels in one order (a cart that was half rewritten) are each read by their own rule
  const mixed = clone(loadSample('system', NAMES[0]));
  const rear = bundleToPerColor(mixed, TOTALS[NAMES[0]]).line_items.filter((li) => isSystemSpokeLineItem(li) && String(propValue(li, 'Wheel')) === 'Rear');
  mixed.line_items = mixed.line_items.filter((li) => !(isSystemSpokeLineItem(li) && String(propValue(li, 'Wheel')) === 'Rear')).concat(rear);
  assert.equal(mismatchWarnings(mixed).length, 0);
});

test('parseSpokeColorsProperty: the theme\'s text, a solid wheel, and odd input', () => {
  assert.deepEqual({ ...parseSpokeColorsProperty('Red ×22, Orange ×6', 28) }, { Red: 22, Orange: 6 });
  assert.deepEqual({ ...parseSpokeColorsProperty('Black', 24) }, { Black: 24 });
  assert.deepEqual({ ...parseSpokeColorsProperty('  Gold  ', 32) }, { Gold: 32 });
  assert.deepEqual({ ...parseSpokeColorsProperty('Red x22,Orange x6', 28) }, { Red: 22, Orange: 6 });
  assert.deepEqual({ ...parseSpokeColorsProperty('Onyx ×6, Neon Yellow ×18', 24) }, { Onyx: 6, 'Neon Yellow': 18 });
  assert.deepEqual({ ...parseSpokeColorsProperty('Red ×10, Red ×4', 14) }, { Red: 14 });
  for (const bad of [undefined, null, '', '   ', 5, {}, ',,']) assert.equal(parseSpokeColorsProperty(bad, 24), null);
  const proto = parseSpokeColorsProperty('__proto__ ×3, constructor', 24);
  assert.equal(Object.getPrototypeOf(proto), null);
  assert.equal(proto.__proto__, 3);
  assert.equal(proto.constructor, 24);
});

test('same content for the same spokes: the internal email, order note, images and customer email of a bundle order equal those of its per-color equivalent', async () => {
  for (const name of NAMES) {
    const order = loadSample('system', name), old = bundleToPerColor(order, TOTALS[name]);
    const a = await buildSystemReport({ recipe: findSystemBuildRecipe(order).recipe, orderData: order, renderPng: png });
    const b = await buildSystemReport({ recipe: findSystemBuildRecipe(old).recipe, orderData: old, renderPng: png });
    assert.equal(a.html, b.html, `${name}: internal email`);
    assert.equal(a.note, b.note, `${name}: order note`);
    assert.equal(a.subject, b.subject);
    assert.deepEqual(a.warnings, b.warnings);
    assert.deepEqual(a.imageErrors, b.imageErrors);
    assert.deepEqual(a.images.map((i) => [i.cid, i.caption, i.svg]), b.images.map((i) => [i.cid, i.caption, i.svg]));
    assert.deepEqual(a.lengths, b.lengths);
    const ca = buildCustomerEmail({ wheels: a.wheels, images: a.images, orderData: order }), cb = buildCustomerEmail({ wheels: b.wheels, images: b.images, orderData: old });
    assert.equal(ca.html, cb.html, `${name}: customer email`);
    assert.equal(ca.fallbackHtml, cb.fallbackHtml);
    assert.equal(ca.subject, cb.subject);
    // the $299 bundle price never appears as a figure in what is reported
    for (const text of [a.html, a.note, ca.html, ca.fallbackHtml]) assert.equal(/299|per spoke|\$\d/.test(text), false, `${name}: no price in the report`);
    assert.deepEqual(a.warnings, [], name);
  }
});

test('through the webhook: a bundle order and its per-color equivalent send the same emails, write the same note, adjust no inventory, and raise no spoke warning', async () => {
  for (const name of NAMES) {
    const order = loadSample('system', name), old = bundleToPerColor(order, TOTALS[name]);
    const run = (o) => runWebhook(path.join(root, 'api', 'index.js'), 'orders/create', o, { env: { SYSTEM_CUSTOMER_EMAIL: 'on' } });
    const a = await run(order), b = await run(old);
    assert.equal(a.status, 200); assert.equal(b.status, 200);
    assert.deepEqual(a.inventoryAdjustments, []);
    assert.equal(a.emails.length, b.emails.length);
    assert.ok(a.emails.length >= 2, 'internal email and customer email');
    assert.deepEqual(a.emails.map((e) => [e.subject, e.html, (e.attachments || []).map((x) => x.content_id)]), b.emails.map((e) => [e.subject, e.html, (e.attachments || []).map((x) => x.content_id)]));
    assert.equal(a.note, b.note);
    assert.equal(a.emails.some((e) => /cart spoke lines do not match/.test(e.html)), false);
    assert.equal(a.logs.some(([level, msg]) => level === 'error' && /spoke/i.test(String(msg))), false);
  }
});
