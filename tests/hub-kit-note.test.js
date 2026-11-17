// HUB-KIT-NOTE: the order note and the builder email name the hub VARIANT (spacing, color, spoke count), print "Kit needed: <product> (<variant>) <SKU>" for every kit the hub variant
// lists in custom.required_addon_variants (with "(in this order)" when the kit is a line of the order), and warn (yellow, not an error, email only) about a kit that is not a line of the
// order, a kit that cannot be looked up, an unreadable kit list, or a hub variant that is not a line of the order. Display only: lengths, stock, subject and recipients are the same
// with and without. Real api/index.js with Shopify and Resend mocked (no network).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runWebhook, createMock } from './helpers/webhook-harness.mjs';
import { preconfiguredOrder, preconfiguredMock, preconfiguredMetafields, preconfiguredBuild, PRE } from './helpers/preconfigured-order.mjs';
import { hubVariantText, hubDisplayText, kitIdsOf, kitLineText, hubInputsExtras, attachKitLines, hubWarnings, addHubWarningNotice } from '../_lib/hub-order-lines.js';
import { escapeText } from '../_lib/order-lines.js';

const INDEX = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'api', 'index.js');
const gid = (n) => `gid://shopify/ProductVariant/${n}`;
const K1 = gid(9301), K2 = gid(9302), K3 = gid(9303), GONE = gid(9399);
const KITS = { [K1]: { title: 'Black', sku: 'HUB2202', product: 'Spank QR 135/141 Adapter Kit' }, [K2]: { title: 'Default Title', sku: '', product: 'Spank Boost 15x110 Conversion Kit' }, [K3]: { title: 'Silver / Long', sku: 'HUB2207', product: 'Spank 12x100 End Caps' } };
const num = (g) => Number(String(g).split('/').pop());
const run = (order, extra = {}, kits = KITS) => { const m = preconfiguredMetafields(); for (const [k, v] of Object.entries(extra)) m[k] = { ...m[k], ...v }; const data = preconfiguredMock(m); data.kitVariants = kits; const mock = createMock(data); return runWebhook(INDEX, 'orders/create', order, { mock }).then((r) => ({ ...r, mock })); };
const html = (r) => r.emails.map((e) => e.html).join('\n');
const side = (note, pos) => note.split(`${pos.toUpperCase()} WHEEL\n`)[1].split('\nREAR WHEEL')[0];
const addLines = (o, ids) => { ids.forEach((g, i) => o.line_items.push({ id: 15300 + i, title: 'addon', name: 'addon', variant_title: null, quantity: 1, price: '9.00', product_id: 8, variant_id: num(g), properties: [] })); return o; };
// the same order with the component lines a builder cart has (one line per rim, hub, spokes), minus the named variants
const cartLike = (without = []) => { const o = preconfiguredOrder(); const ids = ['frontRim', 'rearRim', 'frontHub', 'rearHub'].map((k) => PRE[k]).concat(PRE.spokes).filter((g) => !without.includes(g)); return addLines(o, ids); };

test('helpers: variant text and the kit id list', () => {
  assert.equal(hubVariantText({ title: 'Hub', variantTitle: '32h / Blue / 12x148mm (Boost)' }), '32h / Blue / 12x148mm (Boost)');
  for (const v of ['', 'Default Title', 'default title', undefined, null, 'Hub']) assert.equal(hubVariantText({ title: 'Hub', variantTitle: v }), '');
  assert.equal(hubDisplayText('Spank HEX Rear Hub', '32h / Blue'), 'Spank HEX Rear Hub (32h / Blue)'); assert.equal(hubDisplayText('Spank HEX Rear Hub', ''), 'Spank HEX Rear Hub');
  assert.deepEqual(kitIdsOf(JSON.stringify([K1, K2])), { ids: [K1, K2], problem: null });
  assert.deepEqual(kitIdsOf(K1), { ids: [K1], problem: null }, 'a single GID text');
  assert.deepEqual(kitIdsOf(JSON.stringify([K1, K1, K2])).ids, [K1, K2], 'repeats are dropped');
  for (const empty of [undefined, null, '', '   ', '[]']) assert.deepEqual(kitIdsOf(empty), { ids: [], problem: null });
  for (const bad of ['not json', '{"a":1}', '["x"]', '[1]', '["gid://shopify/Product/5"]', JSON.stringify([K1, 'oops'])]) assert.ok(kitIdsOf(bad).problem, bad);
  assert.deepEqual(hubInputsExtras({ title: 'H', variantTitle: 'V' }, null), { hubVariant: 'V' }); assert.deepEqual(hubInputsExtras({ title: 'H' }, undefined), {});
  assert.deepEqual(hubInputsExtras({ title: 'H' }, JSON.stringify([K1])), { kitVariantIds: [K1] }); assert.ok(hubInputsExtras({ title: 'H' }, 'oops').kitProblem);
});

test('helpers: kit line text, one batched lookup, a failed lookup leaves the kits unresolved', async () => {
  assert.equal(kitLineText({ resolved: true, product: 'Kit', variant: 'Black', sku: 'S1', inOrder: true }), 'Kit (Black) S1 (in this order)');
  assert.equal(kitLineText({ resolved: true, product: 'Kit', variant: 'Default Title', sku: '', inOrder: false }), 'Kit');
  assert.equal(kitLineText({ resolved: false, id: GONE }), 'variant 9399 (not found)'); assert.equal(kitLineText({ resolved: false, id: GONE }, { withNotFound: false }), '');
  const report = { front: { calculationSuccessful: true, inputs: { kitVariantIds: [K1, K2] } }, rear: { calculationSuccessful: true, inputs: { kitVariantIds: [K2, GONE] } }, };
  const calls = []; const order = { line_items: [{ variant_id: num(K1) }] };
  await attachKitLines(report, order, async (ids) => { calls.push(ids); return [{ id: K1, title: 'Black', sku: 'HUB2202', product: { title: 'Adapter' } }, { id: K2, title: 'Default Title', sku: null, product: { title: 'Conversion kit' } }, null]; });
  assert.equal(calls.length, 1, 'one request for both wheels'); assert.deepEqual(calls[0], [K1, K2, GONE]);
  assert.deepEqual(report.front.inputs.kitNeeded.map((k) => [k.resolved, k.inOrder]), [[true, true], [true, false]]);
  assert.deepEqual(report.rear.inputs.kitNeeded.map((k) => [k.resolved, k.inOrder]), [[true, false], [false, false]]);
  const r2 = { front: { calculationSuccessful: true, inputs: { kitVariantIds: [K1] } } };
  const quiet = console.error; console.error = () => {}; try { await attachKitLines(r2, order, async () => { throw new Error('down'); }); } finally { console.error = quiet; }
  assert.equal(r2.front.inputs.kitNeeded[0].resolved, false);
  const none = { front: { calculationSuccessful: true, inputs: {} } }; let called = false; await attachKitLines(none, order, async () => { called = true; return []; }); assert.equal(called, false, 'no kit list, no request');
});

test('helpers: warnings (kit not in the order, unresolved kit, unreadable list) and the missing-hub-line warning', () => {
  const recipe = preconfiguredBuild(); const noReport = {};
  assert.deepEqual(hubWarnings(noReport, preconfiguredOrder(), recipe), [], 'one-line preconfigured order: no component lines at all');
  assert.deepEqual(hubWarnings(noReport, cartLike(), recipe), []);
  const w = hubWarnings(noReport, cartLike([PRE.rearHub]), recipe); assert.equal(w.length, 1); assert.ok(w[0].includes('rear hub') && w[0].includes('(24h / Black)') && !w[0].includes('front hub'));
  assert.equal(hubWarnings(noReport, cartLike([PRE.frontHub, PRE.rearHub]), recipe).length, 2);
  const own = preconfiguredBuild(); own.customerSupplied.rear.hub = true; assert.deepEqual(hubWarnings(noReport, cartLike([PRE.rearHub]), own), []);
  const own2 = preconfiguredBuild(); own2.components.rearHub.vendor = 'Your Own Component'; assert.deepEqual(hubWarnings(noReport, cartLike([PRE.rearHub]), own2), []);
  assert.deepEqual(hubWarnings(null, null, null), []); assert.deepEqual(hubWarnings({}, { line_items: 'x' }, { components: [] }), []);
  const kit = (resolved, inOrder, id = K1) => ({ id, resolved, inOrder, product: 'Adapter', variant: 'Black', sku: 'S' });
  const rep = { front: { calculationSuccessful: true, inputs: { kitNeeded: [kit(true, false), kit(false, false, GONE)] } }, rear: { calculationSuccessful: true, inputs: { kitProblem: 'the kit list (required_addon_variants) on the hub variant is not valid json' } } };
  const ws = hubWarnings(rep, cartLike(), recipe);
  assert.ok(ws.some((t) => t.startsWith('Front hub: the kit "Adapter (Black) S" is named by the hub variant but is not a line of this order')));
  assert.ok(ws.some((t) => t.startsWith('Front hub: the kit variant 9399 named by the hub could not be looked up')));
  assert.ok(ws.some((t) => t.startsWith('Rear hub: the kit list (required_addon_variants)')));
  assert.equal(hubWarnings(rep, preconfiguredOrder(), recipe).filter((t) => t.includes('is named by the hub variant but is not a line')).length, 0, 'a one-line order cannot judge the kit lines');
  assert.equal(addHubWarningNotice('<div class="container">x', [], escapeText), '<div class="container">x');
  assert.ok(addHubWarningNotice('<div class="container">x', ['a & b'], escapeText).includes('a &amp; b'));
});

test('rear hub with one kit that is a line of the order: note and email say so; no price anywhere; lengths, stock, subject and recipients as without', async () => {
  const plain = await run(cartLike());
  const r = await run(addLines(cartLike(), [K1]), { [PRE.rearHub]: { required_addon_variants: JSON.stringify([K1]) } });
  assert.equal(r.status, 200); assert.equal(r.mock.calls.kitQueries.length, 1); assert.deepEqual(r.mock.calls.kitQueries[0], [K1]);
  const rear = side(r.note, 'rear'), front = side(r.note, 'front');
  assert.ok(rear.includes('  Hub: Test Hub 240 EXP SP Rear Hub - Centerlock - 12x142mm (24h / Black)\n  Kit needed: Spank QR 135/141 Adapter Kit (Black) HUB2202 (in this order)\n  Spokes:'), 'kit line directly under the hub');
  assert.equal(front.includes('Kit needed'), false);
  const h = html(r); assert.ok(h.includes('<tr><td>Kit needed</td><td>Spank QR 135/141 Adapter Kit (Black) HUB2202 (in this order)</td></tr>'));
  assert.equal(h.includes('Hub note'), false, 'the kit is a line of the order: no warning');
  assert.equal(/\$|9\.00/.test(r.note.split('Kit needed')[1].split('\n')[0]) || /Kit needed<\/td><td>[^<]*(\$|9\.00)/.test(h), false, 'no price');
  assert.equal(/price/i.test(fs.readFileSync(INDEX, 'utf8').match(/KIT_VARIANTS_QUERY = `[^`]*`/)[0]), false, 'the lookup does not ask for a price');
  assert.equal(r.note.replace(/^ {2}Kit needed: .*\n/gm, ''), plain.note);
  assert.equal(h.replace(/\n *<tr><td>Kit needed<\/td><td>[^<]*<\/td><\/tr>/g, ''), html(plain));
  assert.deepEqual(r.inventoryAdjustments, plain.inventoryAdjustments); assert.equal(r.emails[0].subject, plain.emails[0].subject); assert.deepEqual(r.emails[0].to, plain.emails[0].to);
  assert.equal(r.logs.some(([k]) => k === 'error'), false);
  assert.equal(plain.mock.calls.kitQueries.length, 0, 'no kit list, no kit request');
});

test('front hub with two kits, one missing from the order, and one unresolved id: ONE request for the order, warnings in the email only, the note stays quiet', async () => {
  const front = JSON.stringify([K2, K3]), rear = JSON.stringify([K1, GONE]);
  const plain = await run(cartLike());
  const r = await run(addLines(cartLike(), [K2, K1]), { [PRE.frontHub]: { required_addon_variants: front }, [PRE.rearHub]: { required_addon_variants: rear } });
  assert.equal(r.mock.calls.kitQueries.length, 1, 'one batched request'); assert.deepEqual(r.mock.calls.kitQueries[0].slice().sort(), [K1, K2, K3, GONE].sort());
  const f = side(r.note, 'front'), b = side(r.note, 'rear');
  assert.ok(f.includes('  Kit needed: Spank Boost 15x110 Conversion Kit (in this order)\n  Kit needed: Spank 12x100 End Caps (Silver / Long) HUB2207\n'), 'the default-title kit has no variant part, the missing one has no "(in this order)"');
  assert.ok(b.includes('  Kit needed: Spank QR 135/141 Adapter Kit (Black) HUB2202 (in this order)\n') && !b.includes('9399'), 'the unresolved kit is not in the note');
  const h = html(r);
  assert.ok(h.includes('variant 9399 (not found)'), 'the email row says it');
  assert.ok(h.includes('<strong>Hub note:</strong>')); assert.ok(h.includes('Front hub: the kit "Spank 12x100 End Caps (Silver / Long) HUB2207" is named by the hub variant but is not a line of this order'));
  assert.ok(h.includes('Rear hub: the kit variant 9399 named by the hub could not be looked up'));
  assert.equal(r.note.includes('Hub note') || r.note.includes('not a line of this order') || r.note.includes('could not be looked up'), false, 'no warning in the customer-visible note');
  assert.ok(h.includes('background-color:#FEEFB3') && !h.includes('Check this order by hand'), 'yellow, not the red box');
  assert.equal(r.emails[0].subject, plain.emails[0].subject); assert.deepEqual(r.inventoryAdjustments, plain.inventoryAdjustments);
  assert.equal(r.logs.some(([k]) => k === 'error'), false);
});

test('a kit name with HTML is escaped in the email; the lookup failing leaves the build intact (kits "not found", warning, no error, same note lengths)', async () => {
  const kits = { [K1]: { title: 'A & B', sku: 'X<1>', product: 'Kit <b>' } };
  const r = await run(addLines(cartLike(), [K1]), { [PRE.rearHub]: { required_addon_variants: JSON.stringify([K1]) } }, kits);
  assert.ok(html(r).includes('Kit &lt;b&gt; (A &amp; B) X&lt;1&gt; (in this order)') && !html(r).includes('Kit <b>'));
  const noKits = await run(addLines(cartLike(), [K1]), { [PRE.rearHub]: { required_addon_variants: JSON.stringify([K1]) } }, {});
  assert.equal(noKits.status, 200); assert.ok(html(noKits).includes('variant 9301 (not found)')); assert.ok(html(noKits).includes('could not be looked up'));
  assert.equal(noKits.note.includes('Kit needed'), false);
});

test('unreadable required_addon_variants: no Kit line, a yellow "Hub note" in the email only, not an error, subject unchanged', async () => {
  const plain = await run(preconfiguredOrder());
  const r = await run(preconfiguredOrder(), { [PRE.rearHub]: { required_addon_variants: '[{oops' } });
  assert.equal(r.status, 200); assert.equal(r.note.includes('Kit needed'), false); assert.equal(r.note.includes('Hub note'), false, 'not in the note');
  assert.ok(html(r).includes('<strong>Hub note:</strong> Rear hub: the kit list (required_addon_variants) on the hub variant is not valid json'));
  assert.equal(r.emails[0].subject, plain.emails[0].subject); assert.equal(r.note, plain.note);
  assert.equal(r.logs.some(([k]) => k === 'error'), false); assert.equal(r.mock.calls.kitQueries.length, 0);
});

test('a build that names a hub variant which is not a line of the order: yellow warning in the email, not in the note, not an error, no subject change; with every line present nothing is added', async () => {
  const full = await run(cartLike());
  assert.equal(html(full).includes('Hub note'), false);
  const r = await run(cartLike([PRE.rearHub]));
  assert.equal(r.status, 200);
  assert.ok(html(r).includes('<strong>Hub note:</strong> The build names the rear hub "Test Hub 240 EXP SP Rear Hub - Centerlock - 12x142mm (24h / Black)" but that hub variant is not a line of this order.'));
  assert.equal(r.note.includes('not a line of this order'), false);
  assert.equal(r.emails[0].subject, full.emails[0].subject); assert.equal(r.note, full.note); assert.deepEqual(r.inventoryAdjustments, full.inventoryAdjustments);
  const one = await run(preconfiguredOrder()); assert.equal(html(one).includes('Hub note'), false, 'a one-line preconfigured order is left alone');
});
