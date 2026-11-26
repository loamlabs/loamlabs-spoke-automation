// CANCEL-WHEEL-MATCH: every "(Adjusted)" line of the order note is restocked on its own wheel and side, not by its position in a flat list.
// Real api/index.js with Shopify and Resend mocked (no network).
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runWebhook, createMock } from './helpers/webhook-harness.mjs';
import { preconfiguredOrder, preconfiguredMock, preconfiguredBuild } from './helpers/preconfigured-order.mjs';

const INDEX = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'api', 'index.js');
const item = (n) => `gid://shopify/InventoryItem/${n}`;
const create = (lens, build = preconfiguredBuild()) => runWebhook(INDEX, 'orders/create', preconfiguredOrder({ build }), { mock: createMock({ ...preconfiguredMock(), variantLengths: lens }) });
const cancel = (lens, note, build = preconfiguredBuild()) => runWebhook(INDEX, 'orders/cancelled', { ...preconfiguredOrder({ build }), note }, { mock: createMock({ ...preconfiguredMock(), variantLengths: lens }) });
const lines = (note) => note.split('\n').filter((l) => l.startsWith('- '));
const restocked = (r) => r.inventoryAdjustments.map((a) => a.changes[0]);

test('normal steel order (all four deducted): cancel text and stock moves exactly as before', async () => {
  const c = await create([250, 310]);
  const r = await cancel([250, 310], c.note);
  assert.equal(r.note, 'AUTOMATED RESTOCK COMPLETE\n--------------------------\n- Left (front): 12 x 280mm (Black) - Restocked\n- Right (front): 12 x 282mm (Black) - Restocked\n- Left (rear): 12 x 276mm (Black) - Restocked\n- Right (rear): 12 x 274mm (Black) - Restocked\n');
  assert.deepEqual(restocked(r).map((x) => [x.inventoryItemId, x.delta]), [[item('0280'), 12], [item('0282'), 12], [item('0276'), 12], [item('0274'), 12]]);
});

test('FRONT not deducted (its length variants missing), REAR deducted: only the rear lengths are put back, labelled rear', async () => {
  const c = await create([250, 277]); // front 280 / 282 missing, rear 276 / 274 present
  assert.ok(c.note.includes('Left: 12 x 280mm (ACTION REQUIRED'));
  const r = await cancel([250, 277], c.note);
  assert.deepEqual(lines(r.note), ['- Left (rear): 12 x 276mm (Black) - Restocked', '- Right (rear): 12 x 274mm (Black) - Restocked']);
  assert.deepEqual(restocked(r).map((x) => [x.inventoryItemId, x.delta]), [[item('0276'), 12], [item('0274'), 12]]);
  assert.equal(r.note.includes('FAILED'), false);
  assert.equal(r.note.includes('(front)'), false);
});

test('REAR not deducted, FRONT deducted: only the front lengths are put back', async () => {
  const c = await create([278, 310]); // front 280 / 282 present, rear 276 / 274 missing
  const r = await cancel([278, 310], c.note);
  assert.deepEqual(lines(r.note), ['- Left (front): 12 x 280mm (Black) - Restocked', '- Right (front): 12 x 282mm (Black) - Restocked']);
  assert.deepEqual(restocked(r).map((x) => x.inventoryItemId), [item('0280'), item('0282')]);
});

test('one SIDE not deducted: the surviving line keeps its own wheel and side (before: it shifted to the wrong side / wheel)', async () => {
  const c = await create([250, 281]); // front right 282 missing; front left 280, rear 276 / 274 present
  const r = await cancel([250, 281], c.note);
  assert.deepEqual(lines(r.note), ['- Left (front): 12 x 280mm (Black) - Restocked', '- Left (rear): 12 x 276mm (Black) - Restocked', '- Right (rear): 12 x 274mm (Black) - Restocked']);
  // the right side of a wheel alone
  const note = c.note.replace('Left: 12 x 280mm (Adjusted)', 'Left: 12 x 280mm (NOT adjusted)');
  const r2 = await cancel([250, 310], note);
  assert.deepEqual(lines(r2.note), ['- Left (rear): 12 x 276mm (Black) - Restocked', '- Right (rear): 12 x 274mm (Black) - Restocked']);
});

test('a missing variant at cancel time is still reported FAILED (Variant not found) on the right wheel and side', async () => {
  const c = await create([250, 310]);
  const r = await cancel([250, 275], c.note); // rear 276 and front 280 / 282 are gone now, 274 exists
  assert.deepEqual(lines(r.note), ['- Left (front): 12 x 280mm (Black) - FAILED (Variant not found)', '- Right (front): 12 x 282mm (Black) - FAILED (Variant not found)', '- Left (rear): 12 x 276mm (Black) - FAILED (Variant not found)', '- Right (rear): 12 x 274mm (Black) - Restocked']);
});

test('a customer note in front of the report, even one that says "FRONT WHEEL", does not confuse the matching', async () => {
  const c = await create([250, 277]);
  const r = await cancel([250, 277], 'Please build the\nFRONT WHEEL\nLeft: 99 x 111mm (Adjusted)\n\n--------------------------------------------------\n\n' + c.note);
  assert.deepEqual(lines(r.note), ['- Left (rear): 12 x 276mm (Black) - Restocked', '- Right (rear): 12 x 274mm (Black) - Restocked']);
});

test('an old note without wheel headings keeps the old order-based matching (two lines per wheel, front first)', async () => {
  const old = 'AUTOMATED SPOKE CALCULATION & INVENTORY\n  Left: 12 x 280mm (Adjusted)\n  Right: 12 x 282mm (Adjusted)\n  Left: 12 x 276mm (Adjusted)\n  Right: 12 x 274mm (Adjusted)\n';
  const r = await cancel([250, 310], old);
  assert.deepEqual(lines(r.note), ['- Left (front): 12 x 280mm (Black) - Restocked', '- Right (front): 12 x 282mm (Black) - Restocked', '- Left (rear): 12 x 276mm (Black) - Restocked', '- Right (rear): 12 x 274mm (Black) - Restocked']);
});

test('no "(Adjusted)" lines at all: nothing to restock, no note, as before', async () => {
  const r = await cancel([250, 310], 'AUTOMATED SPOKE CALCULATION & INVENTORY\n\nFRONT WHEEL\n  Left: 12 x 280mm (ACTION REQUIRED: Variant not found!)\n');
  assert.equal(r.inventoryAdjustments.length, 0);
  assert.equal(r.note, null);
});
