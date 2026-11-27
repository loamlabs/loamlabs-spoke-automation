// PER-SPOKE: the order engine accepts both cart models for builder spoke products (old: flat "-" variant, quantity 1 per wheel; new: per-spoke variant "Each",
// quantity = the wheel's spoke count, merged Front/Rear line = front + rear) and says ACTION REQUIRED when a per-spoke variant comes with the wrong quantity.
// Real api/index.js with Shopify and Resend mocked (no network).
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runWebhook, createMock, loadSample } from './helpers/webhook-harness.mjs';
import { preconfiguredOrder, preconfiguredMock, preconfiguredBuild } from './helpers/preconfigured-order.mjs';
import { findStandardStudioRecipe, standardWheels } from '../_lib/standard-build.js';
import { perSpokeNotices, isPerSpokeLine, isFlatLine } from '../_lib/per-spoke.js';

const INDEX = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'api', 'index.js');
const NOMATCH = /cart spoke lines do not match/;

// ---- Standard Studio cross-check: no false warning in any model ----
// std-steel-wheelset-solid: front Silver 32h, rear Black 32h (D-Light, "Silver / 290mm" x 32 per wheel)
const studio = (edit) => {
  const o = loadSample('standard', 'std-steel-wheelset-solid');
  const spokes = o.line_items.filter((l) => l.title === 'Sapim D-Light J-Bend');
  edit(o, spokes);
  return o;
};
const warnings = (o) => standardWheels(findStandardStudioRecipe(o).recipe, null, o).flatMap((w) => w.warnings);
const setLine = (l, variant, q) => { l.variant_title = variant; l.quantity = q; };
const mergeWheel = (l) => { l.properties = l.properties.map((p) => (p.name === 'Wheel' ? { ...p, value: 'Front/Rear' } : p)); };

test('Standard cross-check, older length lines (quantity = spokes of the colour): still matches, and a wrong count still warns', () => {
  assert.equal(warnings(studio(() => {})).some((w) => NOMATCH.test(w)), false);
  assert.equal(warnings(studio((o, [f]) => { f.quantity = 30; })).some((w) => NOMATCH.test(w)), true);
});

test('Standard cross-check, old flat model (variant "-", quantity 1 per wheel): no false warning', () => {
  const o = studio((o, [f, r]) => { setLine(f, 'Silver / -', 1); setLine(r, 'Black / -', 1); });
  assert.deepEqual(warnings(o).filter((w) => NOMATCH.test(w)), []);
});

test('Standard cross-check, new per-spoke model (variant "Each", quantity = spoke count): no false warning, one line per wheel', () => {
  const o = studio((o, [f, r]) => { setLine(f, 'Silver / Each', 32); setLine(r, 'Black / Each', 32); });
  assert.deepEqual(warnings(o).filter((w) => NOMATCH.test(w)), []);
});

test('Standard cross-check, new per-spoke model on a MIXED-colour wheel (one line of the main colour holding all the spokes): no false warning, unlike the old check', () => {
  const o = loadSample('standard', 'std-steel-front-32h-3cross-two-colors');
  const sp = o.line_items.filter((l) => l.title === 'Sapim D-Light J-Bend');
  assert.equal(sp.length, 2);
  setLine(sp[0], 'Black / Each', 32);
  o.line_items = o.line_items.filter((l) => l !== sp[1]);
  assert.deepEqual(warnings(o).filter((w) => NOMATCH.test(w)), []);
  assert.deepEqual(perSpokeNotices(o, findStandardStudioRecipe(o).recipe), []);
});

test('Standard cross-check, new model with a merged Front/Rear line (quantity = front + rear): no false warning and no notice', () => {
  const o = studio((o, [f, r]) => { setLine(f, 'Black / Each', 64); mergeWheel(f); o.line_items = o.line_items.filter((l) => l !== r); });
  assert.deepEqual(warnings(o).filter((w) => NOMATCH.test(w)), []);
  assert.deepEqual(perSpokeNotices(o, findStandardStudioRecipe(o).recipe), []);
});

test('Standard cross-check, old model with a merged Front/Rear flat line (quantity 2): no false warning', () => {
  const o = studio((o, [f, r]) => { setLine(f, 'Black / -', 2); mergeWheel(f); o.line_items = o.line_items.filter((l) => l !== r); });
  assert.deepEqual(warnings(o).filter((w) => NOMATCH.test(w)), []);
});

// ---- wrong-quantity notices (pure) ----
const recipeOf = (o) => findStandardStudioRecipe(o).recipe;

test('notice: a per-spoke line with quantity 1 names the order, product, colour, the quantity and the expected count', () => {
  const o = studio((o, [f, r]) => { setLine(f, 'Silver / Each', 1); setLine(r, 'Black / Each', 32); o.order_number = 91234; });
  const n = perSpokeNotices(o, recipeOf(o));
  assert.equal(n.length, 1);
  for (const part of ['wrong quantity', '#91234', 'Sapim D-Light J-Bend', 'Silver', 'front wheel', 'quantity 1', 'expected 32']) assert.ok(n[0].includes(part), `${part}: ${n[0]}`);
});

test('notice: both wheels wrong, a merged line with the wrong total, per-colour lines that add up, flat lines, odd input', () => {
  const both = studio((o, [f, r]) => { setLine(f, 'Silver / Each', 1); setLine(r, 'Black / Each', 31); });
  assert.equal(perSpokeNotices(both, recipeOf(both)).length, 2);
  const merged = studio((o, [f, r]) => { setLine(f, 'Black / Each', 32); mergeWheel(f); o.line_items = o.line_items.filter((l) => l !== r); });
  const nm = perSpokeNotices(merged, recipeOf(merged));
  assert.equal(nm.length, 1);
  assert.ok(nm[0].includes('quantity 32') && nm[0].includes('expected 64') && /front and rear/.test(nm[0]));
  const split = studio((o, [f, r]) => { setLine(f, 'Silver / Each', 20); const extra = JSON.parse(JSON.stringify(f)); setLine(extra, 'Black / Each', 12); o.line_items.push(extra); setLine(r, 'Black / Each', 32); });
  assert.deepEqual(perSpokeNotices(split, recipeOf(split)), [], 'two colour lines of one wheel add up to the wheel count');
  const flat = studio((o, [f, r]) => { setLine(f, 'Silver / -', 1); setLine(r, 'Black / -', 1); });
  assert.deepEqual(perSpokeNotices(flat, recipeOf(flat)), [], 'old flat lines are never reported');
  const legacy = studio(() => {});
  assert.deepEqual(perSpokeNotices(legacy, recipeOf(legacy)), [], 'older length lines: nothing');
  assert.equal(isPerSpokeLine({ variant_title: 'Black Berd / Each' }), true);
  assert.equal(isPerSpokeLine({ variant_title: 'Black Berd / -' }), false);
  assert.equal(isFlatLine({ variant_title: 'Black Berd / -' }), true);
  assert.deepEqual(perSpokeNotices(null, null), []);
  assert.deepEqual(perSpokeNotices({ line_items: [] }, {}), []);
});

// ---- whole webhook: lengths and stock unchanged in both models, the notice reaches note, email and subject ----
const SPOKE = 'Test Spoke CX Straight Pull';
function webhookOrder(variantTitle, front, rear, merged = null) {
  const o = preconfiguredOrder({ build: preconfiguredBuild() });
  const line = (wheel, q) => ({ id: 15200 + q, title: SPOKE, name: SPOKE, variant_title: variantTitle, quantity: q, price: '1.00', product_id: 805, variant_id: 9105, properties: [{ name: 'Wheel', value: wheel }] });
  if (merged != null) o.line_items.push(line('Front/Rear', merged));
  else { o.line_items.push(line('Front', front)); o.line_items.push(line('Rear', rear)); }
  return o;
}
const runOrder = (o) => runWebhook(INDEX, 'orders/create', o, { mock: createMock({ ...preconfiguredMock(), variantLengths: [250, 310] }) });
const summaryOf = (note) => note.split('FINAL SPOKE SUMMARY:\n')[1].split('\n-----')[0];
const moves = (r) => r.inventoryAdjustments.map((a) => [a.changes[0].inventoryItemId, a.changes[0].delta]);

test('whole webhook: old flat lines, correct per-spoke lines and wrong per-spoke lines all give the SAME lengths and the SAME steel stock deduction', async () => {
  const old = await runOrder(webhookOrder('Black / -', 1, 1));
  const good = await runOrder(webhookOrder('Black / Each', 24, 24));
  const goodMerged = await runOrder(webhookOrder('Black / Each', 0, 0, 48));
  const bad = await runOrder(webhookOrder('Black / Each', 1, 1));
  for (const r of [old, good, goodMerged, bad]) {
    assert.equal(r.status, 200);
    assert.equal(summaryOf(r.note), 'FRONT:  L: 12x280mm  |  R: 12x282mm\nREAR:  L: 12x276mm  |  R: 12x274mm');
    assert.equal(r.inventoryAdjustments.length, 4);
    assert.deepEqual(moves(r), moves(old));
  }
  for (const r of [old, good, goodMerged]) {
    assert.equal(r.emails[0].subject, 'Spoke Calculation Complete for Order #90301');
    assert.equal(/wrong quantity/.test(r.note), false);
  }
});

test('whole webhook: a per-spoke variant with quantity 1 gives ACTION REQUIRED in the subject, the email top and the note warnings (order, product, colour, expected count)', async () => {
  const r = await runOrder(webhookOrder('Black / Each', 1, 1));
  assert.equal(r.emails[0].subject, 'ACTION REQUIRED: Spoke Calculation Complete for Order #90301');
  assert.ok(r.emails[0].html.includes('Check this order by hand') && r.emails[0].html.includes('wrong quantity'));
  for (const part of ['wrong quantity', '#90301', SPOKE, 'Black', 'quantity 1', 'expected 24']) assert.ok(r.note.includes(part), `${part} in the note`);
  assert.equal(r.note.split('wrong quantity').length - 1, 2, 'one notice per wheel');
});

test('whole webhook: the cancel path still restocks exactly the deducted lengths for a per-spoke order', async () => {
  const created = await runOrder(webhookOrder('Black / Each', 24, 24));
  const r = await runWebhook(INDEX, 'orders/cancelled', { ...webhookOrder('Black / Each', 24, 24), note: created.note }, { mock: createMock({ ...preconfiguredMock(), variantLengths: [250, 310] }) });
  assert.equal(r.inventoryAdjustments.length, 4);
  assert.ok(r.inventoryAdjustments.every((a) => a.changes[0].delta === 12));
});
