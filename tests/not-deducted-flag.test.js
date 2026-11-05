// A spoke length that was NOT deducted from inventory must be impossible to miss: flagged in the FINAL SPOKE SUMMARY of the note and at the start of the email subject.
// Wording only: lengths, rounding, variant matching and deductions are unchanged. Real api/index.js with Shopify and Resend mocked (no network).
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runWebhook, createMock } from './helpers/webhook-harness.mjs';
import { preconfiguredOrder, preconfiguredMock, preconfiguredBuild, preconfiguredMetafields, PRE } from './helpers/preconfigured-order.mjs';

const INDEX = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'api', 'index.js');
const run = (build, tweaks) => runWebhook(INDEX, 'orders/create', preconfiguredOrder({ build }), { mock: createMock({ ...preconfiguredMock(), ...tweaks }) });
const summary = (note) => note.split('FINAL SPOKE SUMMARY:\n')[1].split('\n-----')[0];

function berdBuild() {
  const b = preconfiguredBuild();
  for (const k of ['frontSpokes', 'rearSpokes']) b.components[k] = { ...b.components[k], title: 'Berd PolyLight Spokes', vendor: 'Berd', selectedOptions: [{ name: 'Color', value: 'Black Berd' }, { name: 'Length', value: '-' }] };
  return b;
}

test('odd Berd lengths with every variant present: deducted exactly, no flag, normal subject', async () => {
  const r = await run(berdBuild(), { variantColors: ['Black Berd'], variantLengths: [263, 307] });
  assert.equal(summary(r.note), 'FRONT:  L: 12x279mm  |  R: 12x282mm\nREAR:  L: 12x277mm  |  R: 12x273mm');
  assert.equal(r.note.includes('NOT DEDUCTED'), false);
  assert.equal(r.emails[0].subject, 'Spoke Calculation Complete for Order #90301');
  assert.equal(r.inventoryAdjustments.length, 4, 'four length variants deducted');
  assert.deepEqual(r.inventoryAdjustments.map((a) => a.changes[0].inventoryItemId).sort(), ['0273', '0277', '0279', '0282'].map((n) => `gid://shopify/InventoryItem/${n}`));
});

test('no variant for one wheel: that wheel is flagged in the summary, the subject starts with ACTION REQUIRED, the good wheel is deducted and not flagged', async () => {
  const r = await run(preconfiguredBuild(), { variantLengths: [250, 277] }); // store ends at 277: front 280/282 missing, rear 276/274 present
  assert.equal(summary(r.note), 'FRONT:  L: 12x280mm NOT DEDUCTED (no variant)  |  R: 12x282mm NOT DEDUCTED (no variant)\nREAR:  L: 12x276mm  |  R: 12x274mm');
  assert.equal(r.emails[0].subject, 'ACTION REQUIRED: Spoke Calculation Complete for Order #90301');
  assert.equal(r.inventoryAdjustments.length, 2, 'only the rear wheel was deducted');
  assert.ok(r.note.includes('Left: 12 x 280mm (ACTION REQUIRED: Variant not found!)'), 'the existing wheel-section wording is unchanged');
});

test('no variant on one side only (the other side exists): only that side is flagged', async () => {
  // variants 250..281 exist, so front right 282 is missing; everything else exists
  const r = await run(preconfiguredBuild(), { variantLengths: [250, 281] });
  assert.equal(summary(r.note), 'FRONT:  L: 12x280mm  |  R: 12x282mm NOT DEDUCTED (no variant)\nREAR:  L: 12x276mm  |  R: 12x274mm');
  assert.ok(r.emails[0].subject.startsWith('ACTION REQUIRED: '));
  assert.equal(r.inventoryAdjustments.length, 3);
});

test('no variant for either wheel (colour missing): all four sides flagged, subject flagged, nothing deducted', async () => {
  const r = await run(preconfiguredBuild(), { variantColors: ['Silver'], variantLengths: [250, 310] });
  assert.equal(summary(r.note), 'FRONT:  L: 12x280mm NOT DEDUCTED (no variant)  |  R: 12x282mm NOT DEDUCTED (no variant)\nREAR:  L: 12x276mm NOT DEDUCTED (no variant)  |  R: 12x274mm NOT DEDUCTED (no variant)');
  assert.ok(r.emails[0].subject.startsWith('ACTION REQUIRED: Spoke Calculation Complete for Order #90301'));
  assert.equal(r.inventoryAdjustments.length, 0);
});

test('a CALC FAILED wheel (missing data) is not a "not deducted" flag: nothing was calculated, the subject stays normal', async () => {
  const mf = preconfiguredMetafields(); delete mf[PRE.frontRim]; // retired front rim: the front is CALC FAILED, the rear is calculated and deducted
  const r = await run(preconfiguredBuild(), { metafields: mf });
  assert.ok(r.note.includes('FRONT WHEEL:\nCALC FAILED - Missing data in Shopify'));
  assert.equal(r.note.includes('NOT DEDUCTED'), false);
  assert.equal(r.emails[0].subject, 'Spoke Calculation Complete for Order #90301');
  assert.equal(r.inventoryAdjustments.length, 2);
});

test('cancel and restock are unaffected: flagged sides are not restocked, deducted sides are', async () => {
  const created = await run(preconfiguredBuild(), { variantLengths: [250, 277] });
  const cancelled = { ...preconfiguredOrder(), note: created.note };
  const r = await runWebhook(INDEX, 'orders/cancelled', cancelled, { mock: createMock({ ...preconfiguredMock(), variantLengths: [250, 277] }) });
  assert.equal(r.inventoryAdjustments.length, 2, 'only the two rear lengths that were deducted are put back');
  assert.ok(r.note.includes('AUTOMATED RESTOCK COMPLETE'));
});

test('the staff test endpoint\'s "test only, nothing adjusted" status is not flagged (no ACTION REQUIRED subject, no NOT DEDUCTED in its note); a real missing deduction still is', async () => {
  const { TEST_ONLY_STATUS, anySideNotDeducted, formatNote } = await import('../api/index.js');
  assert.equal(TEST_ONLY_STATUS, 'test only, nothing adjusted');
  const w = (status) => ({ calculationSuccessful: true, crossPattern: { left: 3, right: 3 }, lengths: { left: { geo: '290.00', rounded: 290 }, right: { geo: '290.00', rounded: 290 } }, inputs: { rim: 'r', hub: 'h', spokes: 's', erd: 599, finalErd: '599', washerPolicy: 'x', washerThickness: 0, targetTension: 120, hubDimensions: {} }, inventory: { left: { quantity: 16, length: 290, status }, right: { quantity: 16, length: 290, status } } });
  const testRep = { front: w(TEST_ONLY_STATUS), rear: null };
  assert.equal(anySideNotDeducted(testRep), false);
  assert.equal(formatNote(testRep).includes('NOT DEDUCTED'), false);
  assert.equal(anySideNotDeducted({ front: w('ACTION REQUIRED: Variant not found!'), rear: null }), true);
  assert.equal(anySideNotDeducted({ front: w('test only'), rear: null }), true, 'only the exact test-endpoint status is exempt');
});
