// BERD-NO-DEDUCT: product metafield custom.deduct_length_stock = "No" (Berd spokes are not stocked by length) and reading ALL variants of a spoke product (more than 250).
// Real api/index.js with Shopify and Resend mocked (no network). Blank setting = today's behaviour.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runWebhook, createMock } from './helpers/webhook-harness.mjs';
import { preconfiguredOrder, preconfiguredMock, preconfiguredBuild, preconfiguredMetafields, PRE } from './helpers/preconfigured-order.mjs';

const INDEX = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'api', 'index.js');
const summary = (note) => note.split('FINAL SPOKE SUMMARY:\n')[1].split('\n-----')[0];
const SUBJECT = 'Spoke Calculation Complete for Order #90301';

function berdBuild(color = 'Black Berd') {
  const b = preconfiguredBuild();
  for (const k of ['frontSpokes', 'rearSpokes']) b.components[k] = { ...b.components[k], title: 'Berd PolyLight Spokes', vendor: 'Berd', selectedOptions: [{ name: 'Color', value: color }, { name: 'Length', value: '-' }] };
  return b;
}
function metafields({ flag, hubType } = {}) {
  const mf = preconfiguredMetafields();
  if (flag !== undefined) mf[PRE.spokes] = { ...mf[PRE.spokes], deduct_length_stock: flag };
  if (hubType) for (const h of [PRE.frontHub, PRE.rearHub]) mf[h] = { ...mf[h], hub_type: hubType };
  return mf;
}
const run = (build, { flag, hubType, ...tweaks } = {}) => runWebhook(INDEX, 'orders/create', preconfiguredOrder({ build }), { mock: createMock({ ...preconfiguredMock(metafields({ flag, hubType })), ...tweaks }) });

for (const hubType of ['Straight Pull', 'Classic Flange', 'Hook Flange']) {
  test(`Berd with setting "No" (${hubType}): nothing deducted, no length variant looked up, no flag, normal subject, lengths and counts still printed`, async () => {
    const ref = await run(berdBuild(), { hubType, variantColors: ['Black Berd'], variantLengths: [250, 310] }); // setting blank, lengths present: today's result
    const r = await run(berdBuild(), { flag: 'No', hubType, variantColors: ['Black Berd'], variantLengths: [250, 310] });
    assert.equal(ref.inventoryAdjustments.length, 4);
    assert.equal(r.inventoryAdjustments.length, 0);
    assert.equal(r.variantQueries.length, 0, 'the spoke product variants are not even read');
    assert.equal(r.note.includes('NOT DEDUCTED'), false);
    assert.equal(r.note.includes('ACTION REQUIRED'), false);
    assert.equal(r.emails[0].subject, SUBJECT);
    assert.equal(summary(r.note), summary(ref.note), 'same lengths and counts as the deducting run');
    assert.ok(/Left: 12 x \d+mm \(not tracked, not stocked\)/.test(r.note));
    assert.equal(r.status, 200);
  });
}

test('Berd coloured (uses White Berd stock) with "No" and no length variants at all: nothing flagged, lengths printed', async () => {
  const r = await run(berdBuild('Robin Red'), { flag: 'No', variantColors: [], variantLengths: [250, 310] });
  assert.equal(r.inventoryAdjustments.length, 0);
  assert.equal(r.note.includes('NOT DEDUCTED') || r.note.includes('ACTION REQUIRED'), false);
  assert.equal(r.emails[0].subject, SUBJECT);
  assert.ok(/FRONT:  L: 12x\d+mm  \|  R: 12x\d+mm/.test(summary(r.note)));
});

test('setting blank or any other value than "No" = today (flag raised when the variants are missing, deducted when present)', async () => {
  for (const flag of [undefined, '', 'Yes', 'false', 'no thanks']) {
    const missing = await run(berdBuild(), { flag, variantColors: [], variantLengths: [250, 310] });
    assert.equal(missing.inventoryAdjustments.length, 0, String(flag));
    assert.ok(missing.emails[0].subject.startsWith('ACTION REQUIRED: '), String(flag));
    assert.ok(missing.note.includes('NOT DEDUCTED (no variant)'), String(flag));
    const there = await run(berdBuild(), { flag, variantColors: ['Black Berd'], variantLengths: [250, 310] });
    assert.equal(there.inventoryAdjustments.length, 4, String(flag));
    assert.equal(there.emails[0].subject, SUBJECT);
  }
});

test('"No" is read case and space insensitive: "no", " NO "', async () => {
  for (const flag of ['no', ' NO ', 'No']) {
    const r = await run(berdBuild(), { flag, variantColors: ['Black Berd'], variantLengths: [250, 310] });
    assert.equal(r.inventoryAdjustments.length, 0, flag);
    assert.equal(r.variantQueries.length, 0, flag);
  }
});

test('steel control (blank setting): 4 adjustments of the wheel counts, same wording as before', async () => {
  const r = await run(preconfiguredBuild(), { variantColors: ['Black'], variantLengths: [250, 310] });
  assert.equal(r.inventoryAdjustments.length, 4);
  assert.equal(summary(r.note), 'FRONT:  L: 12x280mm  |  R: 12x282mm\nREAR:  L: 12x276mm  |  R: 12x274mm');
  assert.ok(r.note.includes('Left: 12 x 280mm (Adjusted)'));
  assert.equal(r.emails[0].subject, SUBJECT);
});

test('the setting is per product: front Berd "No" + rear steel in one order: only the rear is deducted, nothing is flagged', async () => {
  const FRONT_BERD = 'gid://shopify/ProductVariant/9107';
  const b = berdBuild();
  b.components.rearSpokes = preconfiguredBuild().components.rearSpokes;
  b.components.frontSpokes = { ...b.components.frontSpokes, variantId: FRONT_BERD };
  const mf = metafields();
  mf[FRONT_BERD] = { spoke_cross_section_area_mm2: '1.767', spoke_type: 'Steel', spoke_hub_interface: 'Straight Pull', deduct_length_stock: 'No', _parent_product_id: 'gid://shopify/Product/811' };
  const r = await runWebhook(INDEX, 'orders/create', preconfiguredOrder({ build: b }), { mock: createMock({ ...preconfiguredMock(mf), variantColors: ['Black', 'Black Berd'], variantLengths: [250, 310] }) });
  assert.equal(r.inventoryAdjustments.length, 2);
  assert.equal(r.note.includes('NOT DEDUCTED'), false);
  assert.equal(r.emails[0].subject, SUBJECT);
  assert.ok(r.note.includes('(not tracked, not stocked)') && r.note.includes('(Adjusted)'));
});

// ---- paging ----
test('paging: a spoke product with 260 variants (Black 1-130, White 131-260): White 298-307 sit past the first 250 and are now found and deducted', async () => {
  // colours are listed one after the other, so White starts at position 131 and its last lengths (298-307) are at 251-260
  const b = berdBuild('White Berd');
  const r = await run(b, { variantColors: ['Black Berd', 'White Berd'], variantLengths: [178, 307] });
  assert.equal(r.inventoryAdjustments.length, 4);
  assert.ok(r.variantQueries.length >= 2, 'at least two pages were read');
  assert.equal(r.note.includes('NOT DEDUCTED'), false);
});

test('paging: the query follows the cursor (267 variants = 2 pages) and finds a variant that sits at position 267', async () => {
  const b = berdBuild('White Berd');
  const mock = createMock({ ...preconfiguredMock(metafields()), variantColors: ['Black Berd', 'White Berd'], variantLengths: [178, 311] }); // 134 x 2 = 268 variants
  const seenAfter = [];
  const real = globalThis.fetch;
  const wrapped = mock.fetch;
  mock.fetch = async (url, init) => { const body = JSON.parse(init.body || '{}'); if (String(body.query || '').includes('getProductVariants')) seenAfter.push(body.variables.after ?? null); return wrapped(url, init); };
  const r = await runWebhook(INDEX, 'orders/create', preconfiguredOrder({ build: b }), { mock });
  assert.equal(globalThis.fetch, real);
  assert.deepEqual([...new Set(seenAfter)].sort(), ['250', null].sort(), 'page 1 without cursor, page 2 after cursor 250, nothing more'); // the two sides of a wheel may each read the product before the cache is filled
  assert.equal(r.inventoryAdjustments.length, 4);
});

test('paging: a product with exactly 250 variants needs no second page', async () => {
  const mock = createMock({ ...preconfiguredMock(metafields()), variantColors: ['Black'], variantLengths: [1, 250] });
  const seen = [];
  const wrapped = mock.fetch;
  mock.fetch = async (url, init) => { const body = JSON.parse(init.body || '{}'); if (String(body.query || '').includes('getProductVariants')) seen.push(body.variables.after ?? null); return wrapped(url, init); };
  await runWebhook(INDEX, 'orders/create', preconfiguredOrder({ build: preconfiguredBuild() }), { mock });
  assert.deepEqual([...new Set(seen)], [null]);
});

// ---- cancel ----
test('cancel after a "not tracked" order: nothing restocked, no note written, no FAILED', async () => {
  const mk = () => createMock({ ...preconfiguredMock(metafields({ flag: 'No' })), variantColors: ['Black Berd'], variantLengths: [250, 310] });
  const created = await run(berdBuild(), { flag: 'No', variantColors: ['Black Berd'], variantLengths: [250, 310] });
  assert.equal(created.note.includes('(Adjusted)'), false);
  const r = await runWebhook(INDEX, 'orders/cancelled', { ...preconfiguredOrder({ build: berdBuild() }), note: created.note }, { mock: mk() });
  assert.equal(r.inventoryAdjustments.length, 0);
  assert.equal(r.note, null, 'no restock note');
  assert.equal(r.variantQueries.length, 0);
});

test('cancel of an OLD Berd order that did deduct, after the setting was turned on: lines say "not restocked (not tracked)", no FAILED, no stock moved', async () => {
  const created = await run(berdBuild(), { variantColors: ['Black Berd'], variantLengths: [250, 310] }); // made before the setting existed
  assert.equal(created.inventoryAdjustments.length, 4);
  const mock = createMock({ ...preconfiguredMock(metafields({ flag: 'No' })), variantColors: [], variantLengths: [250, 310] });
  const r = await runWebhook(INDEX, 'orders/cancelled', { ...preconfiguredOrder({ build: berdBuild() }), note: created.note }, { mock });
  assert.equal(r.inventoryAdjustments.length, 0);
  assert.ok(r.note.includes('AUTOMATED RESTOCK COMPLETE'));
  assert.equal((r.note.match(/not restocked \(not tracked\)/g) || []).length, 4);
  assert.equal(r.note.includes('FAILED'), false);
});

test('cancel of a mixed order (front Berd "No", rear steel adjusted): only the rear lengths are put back, on the right lengths', async () => {
  const FRONT_BERD = 'gid://shopify/ProductVariant/9107';
  const b = berdBuild();
  b.components.rearSpokes = preconfiguredBuild().components.rearSpokes;
  b.components.frontSpokes = { ...b.components.frontSpokes, variantId: FRONT_BERD };
  const mf = metafields();
  mf[FRONT_BERD] = { spoke_cross_section_area_mm2: '1.767', spoke_type: 'Steel', spoke_hub_interface: 'Straight Pull', deduct_length_stock: 'No', _parent_product_id: 'gid://shopify/Product/811' };
  const data = { ...preconfiguredMock(mf), variantColors: ['Black', 'Black Berd'], variantLengths: [250, 310] };
  const created = await runWebhook(INDEX, 'orders/create', preconfiguredOrder({ build: b }), { mock: createMock(data) });
  const r = await runWebhook(INDEX, 'orders/cancelled', { ...preconfiguredOrder({ build: b }), note: created.note }, { mock: createMock(data) });
  assert.equal(r.inventoryAdjustments.length, 2);
  assert.deepEqual(r.inventoryAdjustments.map((a) => a.changes[0].delta), [12, 12]);
  assert.ok(r.note.includes('Left (rear): 12 x 276mm (Black) - Restocked') && r.note.includes('Right (rear): 12 x 274mm (Black) - Restocked'));
  assert.equal(r.note.includes('FAILED'), false);
});

test('steel cancel unchanged: deducted lines are restocked', async () => {
  const created = await run(preconfiguredBuild(), { variantColors: ['Black'], variantLengths: [250, 310] });
  const r = await runWebhook(INDEX, 'orders/cancelled', { ...preconfiguredOrder(), note: created.note }, { mock: createMock(preconfiguredMock()) });
  assert.equal(r.inventoryAdjustments.length, 4);
  assert.ok(r.note.includes('AUTOMATED RESTOCK COMPLETE') && !r.note.includes('FAILED'));
});
