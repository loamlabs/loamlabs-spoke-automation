// STANDARD fee checks pooled over the order (same fix as the System one, order #1466): the cart merges identical lines of the two wheels into ONE line with Wheel = Front/Rear and
// quantity 2, so a fee line is no longer matched to one wheel by an exact Front / Rear. Covers the "Custom Spoke Color Configuration" fee (variant-aware: Mixed colors / Berd painted
// color / Berd multi-color) and the "Custom Nipple Color Configuration" fee.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runWebhook, loadSample } from './helpers/webhook-harness.mjs';
import { findStandardStudioRecipe, standardWheels, STANDARD_FEE_NAME } from '../_lib/standard-build.js';
import { NIPPLE_FEE, nippleFeeCoverage } from '../_lib/nipple-build.js';
import { SYSTEM_FEE } from '../_lib/system-build.js';

const INDEX = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'api', 'index.js');
const clone = (o) => JSON.parse(JSON.stringify(o));
const BOTH = () => loadSample('standard', 'std-nip-both-wheels-painted-both-fees'); // both wheels: mixed spoke colors and mixed nipples, one fee line of each kind per wheel
const NIP_FRONT = () => loadSample('standard', 'std-nip-master2-front4-silver');      // front mixed nipples (fee on the front), rear one color
const STEEL_SOLID = () => loadSample('standard', 'std-steel-wheelset-solid');          // no fee expected on either wheel
const FRONT_TWO = () => loadSample('standard', 'std-steel-front-32h-3cross-two-colors'); // one wheel, two colors, Mixed colors fee
const REAR_BERD = () => loadSample('standard', 'std-berd-rear-24h-2cross-custom');      // one wheel, Berd multi-color fee

const spokeFee = (wheel, q, variant) => ({ id: 88000 + q, title: STANDARD_FEE_NAME, name: STANDARD_FEE_NAME, variant_title: variant, quantity: q, price: '25.00', variant_id: SYSTEM_FEE.variantId, properties: [{ name: 'Wheel', value: wheel }] });
const nipFee = (wheel, q) => ({ id: 89000 + q, title: NIPPLE_FEE.name, name: NIPPLE_FEE.name, variant_title: NIPPLE_FEE.variantTitle, quantity: q, price: '15.00', variant_id: NIPPLE_FEE.variantId, properties: [{ name: 'Wheel', value: wheel }] });
const isSpokeFee = (li) => Number(li.variant_id) === SYSTEM_FEE.variantId || String(li.title).includes(STANDARD_FEE_NAME);
const isNipFee = (li) => Number(li.variant_id) === NIPPLE_FEE.variantId || String(li.title).includes(NIPPLE_FEE.name);
// the order with its spoke fee lines (and/or nipple fee lines) replaced: spoke = [[wheel, qty, variant]] | undefined (keep), nip = [[wheel, qty]] | undefined (keep)
function withFees(order, { spoke, nip }) {
  const o = clone(order);
  if (spoke) { o.line_items = o.line_items.filter((li) => !isSpokeFee(li)); spoke.forEach(([w, q, v]) => o.line_items.push(spokeFee(w, q, v))); }
  if (nip) { o.line_items = o.line_items.filter((li) => !isNipFee(li)); nip.forEach(([w, q]) => o.line_items.push(nipFee(w, q))); }
  return o;
}
const wheels = (o) => standardWheels(findStandardStudioRecipe(o).recipe, null, o);
const feeWarn = (o) => wheels(o).flatMap((w) => w.warnings.map((t) => `${w.label}: ${t}`)).filter((t) => t.includes(STANDARD_FEE_NAME) || t.includes(NIPPLE_FEE.name) || /fee/.test(t));
const spokeWarn = (o) => feeWarn(o).filter((t) => !t.includes(NIPPLE_FEE.name));
const nipWarn = (o) => feeWarn(o).filter((t) => t.includes(NIPPLE_FEE.name));
const MIXED = 'Mixed colors';

/* ------------------------------------------------------------------ the spoke fee */

test('the samples still read as before: per-wheel fee lines, no fee warning, one unit per wheel', () => {
  assert.deepEqual(feeWarn(BOTH()), []); assert.deepEqual(wheels(BOTH()).map((w) => [w.feeLines, w.nipples && w.nipples.feeLines]), [[1, 1], [1, 1]]);
  assert.deepEqual(feeWarn(FRONT_TWO()), []); assert.deepEqual(feeWarn(REAR_BERD()), []); assert.deepEqual(feeWarn(STEEL_SOLID()), []);
});

test('spoke fee, Front only and Rear only builds: the line is found; without it the old warning', () => {
  assert.deepEqual(spokeWarn(withFees(FRONT_TWO(), { spoke: [['Front', 1, MIXED]] })), []);
  assert.ok(spokeWarn(withFees(FRONT_TWO(), { spoke: [] })).some((t) => t.includes('the fee rule expects a "Custom Spoke Color Configuration" line (Mixed colors) but the order has none')));
  assert.deepEqual(spokeWarn(withFees(REAR_BERD(), { spoke: [['Rear', 1, 'Berd multi-color']] })), []);
  assert.ok(spokeWarn(withFees(REAR_BERD(), { spoke: [] })).some((t) => t.startsWith('Rear: Rear wheel: the fee rule expects')));
});

test('spoke fee, Front plus Rear as separate lines: no warning', () => {
  assert.deepEqual(spokeWarn(withFees(BOTH(), { spoke: [['Front', 1, MIXED], ['Rear', 1, MIXED]] })), []);
});

test('spoke fee, ONE merged Front/Rear line with quantity 2 (the real cart shape): both wheels covered, no warning', () => {
  for (const w of ['Front/Rear', 'Rear/Front', 'front / rear']) {
    const o = withFees(BOTH(), { spoke: [[w, 2, MIXED]] });
    assert.deepEqual(spokeWarn(o), [], w); assert.deepEqual(wheels(o).map((x) => x.feeLines), [1, 1], w);
  }
});

test('spoke fee, merged quantity 1 with two wheels that need a fee: the rear wheel is reported as not verified', () => {
  const o = withFees(BOTH(), { spoke: [['Front/Rear', 1, MIXED]] });
  assert.deepEqual(wheels(o).map((x) => x.feeLines), [1, 0]);
  const w = spokeWarn(o); assert.equal(w.length, 1, w.join(' | '));
  assert.ok(w[0].startsWith('Rear: Rear wheel: the fee rule expects') && w[0].includes('one shared Front/Rear fee line with quantity 1, which covers only 1 of the 2 wheels that need one') && w[0].includes("The Rear wheel's fee is not verified."), w[0]);
});

test('spoke fee, a wheel that needs none with a fee warns (merged or not); neither wheel needing one and no fee: no warning', () => {
  const single = spokeWarn(withFees(STEEL_SOLID(), { spoke: [['Rear', 1, MIXED]] }));
  assert.equal(single.length, 1); assert.ok(single[0].includes('Rear wheel: the order has a "Custom Spoke Color Configuration" line (Mixed colors) but the fee rule expects none'), single[0]);
  assert.equal(spokeWarn(withFees(STEEL_SOLID(), { spoke: [['Front/Rear', 2, MIXED]] })).length, 2, 'a merged line on two wheels that need none: both warned');
  assert.deepEqual(spokeWarn(STEEL_SOLID()), []);
});

test('spoke fee, the variant still matters for a merged line: the wrong variant is reported on both wheels', () => {
  const w = spokeWarn(withFees(BOTH(), { spoke: [['Front/Rear', 2, 'Berd painted color']] }));
  assert.equal(w.length, 2, w.join(' | ')); assert.ok(w.every((t) => t.includes('the fee line is "Berd painted color" but the fee rule expects "Mixed colors"')), w.join(' | '));
});

test('spoke fee, two fee units for one wheel are still reported', () => {
  const w = spokeWarn(withFees(BOTH(), { spoke: [['Front', 2, MIXED], ['Rear', 1, MIXED]] }));
  assert.equal(w.length, 1); assert.ok(w[0].startsWith('Front: Front wheel: the order has 2 fee lines for this wheel (one expected)'), w[0]);
});

/* ------------------------------------------------------------------ the nipple fee */

test('nipple fee: one merged line with quantity 2 covers both wheels with mixed nipples; per-wheel lines still work', () => {
  const merged = withFees(BOTH(), { nip: [['Front/Rear', 2]] });
  assert.deepEqual(nipWarn(merged), []); assert.deepEqual(wheels(merged).map((w) => w.nipples.feeLines), [1, 1]);
  assert.deepEqual(nippleFeeCoverage(merged, { front: true, rear: true }), { units: { front: 1, rear: 1 }, shared: { lines: 1, quantity: 2 } });
  assert.deepEqual(nipWarn(withFees(BOTH(), { nip: [['Front', 1], ['Rear', 1]] })), []);
});

test('nipple fee: merged quantity 1 with two mixed wheels (rear not verified); no fee at all (the old warning); a fee for a one-color wheel (warned)', () => {
  const short = nipWarn(withFees(BOTH(), { nip: [['Front/Rear', 1]] }));
  assert.equal(short.length, 1); assert.ok(short[0].startsWith('Rear: Rear wheel:') && short[0].includes('one shared Front/Rear line with quantity 1, which covers only 1 of the 2 wheels with mixed nipples') && short[0].includes("fee is not verified"), short[0]);
  const none = nipWarn(withFees(BOTH(), { nip: [] }));
  assert.equal(none.length, 2); assert.ok(none.every((t) => /so the order should have a "Custom Nipple Color Configuration" line \(\$15\) for it, but has none/.test(t)), none.join(' | '));
  // the warning says how many colors the wheel's nipples have (the same words as the non-pooled check), not just "more than one"
  const counts = wheels(withFees(BOTH(), { nip: [] })).map((w) => w.nipples.counts.all.length);
  assert.ok(counts.every((n) => n >= 2), 'both wheels have mixed nipples: ' + counts);
  assert.deepEqual(none.map((t) => /the nipples use (\d+) colors, so the order/.exec(t)[1]), counts.map(String), none.join(' | '));
  assert.ok(none.every((t) => !t.includes('more than one color')), none.join(' | '));
  // and the shared-line warning says it too
  const sharedShort = nipWarn(withFees(BOTH(), { nip: [['Front/Rear', 1]] }))[0];
  assert.ok(new RegExp('the nipples use ' + counts[1] + ' colors, but the').test(sharedShort), sharedShort);
  const extra = nipWarn(withFees(NIP_FRONT(), { nip: [['Front/Rear', 2]] })); // only the front has mixed nipples
  assert.equal(extra.length, 1); assert.ok(extra[0].startsWith('Rear: Rear wheel: the order has a "Custom Nipple Color Configuration" line but the nipples are one color'), extra[0]);
  assert.deepEqual(nipWarn(withFees(NIP_FRONT(), { nip: [['Front/Rear', 1]] })), [], 'quantity 1 is enough when only one wheel has mixed nipples');
});

/* ------------------------------------------------------------------ through the webhook */

test('through the webhook (Shopify and Resend mocked): the merged-line order reads exactly like the per-wheel-line order, with no fee warning', async () => {
  const per = await runWebhook(INDEX, 'orders/create', BOTH());
  const merged = await runWebhook(INDEX, 'orders/create', withFees(BOTH(), { spoke: [['Front/Rear', 2, MIXED]], nip: [['Front/Rear', 2]] }));
  assert.equal(per.status, 200); assert.equal(merged.status, 200);
  assert.equal(merged.note, per.note, 'the same order note');
  assert.equal(merged.emails.map((e) => e.html).join('\n'), per.emails.map((e) => e.html).join('\n'), 'the same emails');
  assert.equal(merged.logs.filter(([k, m]) => /fee rule|Custom (Spoke|Nipple) Color Configuration/.test(m)).length, 0, 'no fee warning logged');
  // and a merged quantity-1 line is caught in the internal email
  const short = await runWebhook(INDEX, 'orders/create', withFees(BOTH(), { spoke: [['Front/Rear', 1, MIXED]], nip: [['Front/Rear', 2]] }));
  assert.ok(short.emails.map((e) => e.html).join('\n').includes("The Rear wheel&#39;s fee is not verified.") || short.emails.map((e) => e.html).join('\n').includes("The Rear wheel's fee is not verified."));
});
