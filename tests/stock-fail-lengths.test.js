// STOCK-FAIL-LENGTHS: when the stock step cannot run (spoke without a Color option, or without a product id), the note and the builder email still print the
// calculated lengths and spoke counts with the failure status beside them, never "undefined x undefinedmm". Nothing is deducted; lengths and the subject are unchanged.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runWebhook, createMock } from './helpers/webhook-harness.mjs';
import { preconfiguredOrder, preconfiguredMock, preconfiguredBuild } from './helpers/preconfigured-order.mjs';
import { stockFailed, formatNote, anySideNotDeducted } from '../api/index.js';

const INDEX = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'api', 'index.js');
const run = (order) => runWebhook(INDEX, 'orders/create', order, { mock: createMock(preconfiguredMock()) });
const html = (r) => r.emails.map((e) => e.html).join('\n');
const text = (h) => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const noColorBuild = () => { const b = preconfiguredBuild(); for (const k of ['frontSpokes', 'rearSpokes']) b.components[k] = { ...b.components[k], selectedOptions: [] }; return b; };

test('baseline: with the Color option the stock step runs and prints "(Adjusted)"', async () => {
  const r = await run(preconfiguredOrder({ rule: null }));
  assert.equal(r.inventoryAdjustments.length, 4);
  assert.ok(r.note.includes('Left: 12 x 280mm (Adjusted)'));
});

test('spoke without a Color option: lengths and counts are printed everywhere, status beside them, nothing deducted, flagged', async () => {
  const ok = await run(preconfiguredOrder({ rule: null }));
  const r = await run(preconfiguredOrder({ rule: null, build: noColorBuild() }));
  assert.equal(r.status, 200); assert.equal(r.inventoryAdjustments.length, 0, 'no stock touched');
  assert.equal(/undefined/.test(r.note), false, 'no "undefined" in the note'); assert.equal(/undefined/.test(html(r)), false, 'no "undefined" in the email');
  // the same lengths and counts as the working order (12 per side per length)
  for (const line of ['Left: 12 x 280mm (FAIL: No Color)', 'Right: 12 x 282mm (FAIL: No Color)', 'Left: 12 x 276mm (FAIL: No Color)', 'Right: 12 x 274mm (FAIL: No Color)']) assert.ok(r.note.includes(line), line);
  assert.ok(r.note.includes('FRONT:  L: 12x280mm NOT DEDUCTED (no color)  |  R: 12x282mm NOT DEDUCTED (no color)'), 'note summary');
  const t = text(html(r));
  assert.ok(t.includes('Left: 12 x 280mm Right: 12 x 282mm') || (t.includes('Left: 12 x 280mm') && t.includes('Right: 12 x 282mm')), 'email top block');
  assert.ok(t.includes('Left 12 x 280mm (FAIL: No Color)'), 'email inventory table');
  assert.match(r.emails[0].subject, /^ACTION REQUIRED: /, 'still flagged as needing action');
  assert.equal(r.note.replace(/\(FAIL: No Color\)/g, '(Adjusted)').replace(/ NOT DEDUCTED \(no color\)/g, ''), ok.note, 'apart from the status words the note is the working order\'s');
});

test('spoke without a product id (the branch cannot be reached through the mocked store, so the helper and the note builder are checked directly): lengths, counts, status, flag', () => {
  const wheel = { calculationSuccessful: true, lengths: { left: { rounded: 290 }, right: { rounded: 292 } } };
  assert.deepEqual(stockFailed(wheel, 16, 'FAIL: No Product ID'), { left: { length: 290, quantity: 16, status: 'FAIL: No Product ID' }, right: { length: 292, quantity: 16, status: 'FAIL: No Product ID' } });
  const w = (inv) => ({ calculationSuccessful: true, crossPattern: 3, alert: null, inputs: { rim: 'R', erd: 600, washerThickness: 0, washerPolicy: 'Optional', finalErd: 600, hub: 'H', spokes: 'S', targetTension: 120 }, lengths: { left: { geo: '289.1', stretch: '0.6', rounded: 290 }, right: { geo: '291.0', stretch: '0.6', rounded: 292 } }, inventory: inv });
  const note = formatNote({ front: w(stockFailed(wheel, 16, 'FAIL: No Product ID')), rear: null });
  assert.equal(/undefined/.test(note), false);
  assert.ok(note.includes('FRONT:  L: 16x290mm NOT DEDUCTED (no product id)  |  R: 16x292mm NOT DEDUCTED (no product id)'));
  assert.ok(note.includes('Left: 16 x 290mm (FAIL: No Product ID)') && note.includes('Right: 16 x 292mm (FAIL: No Product ID)'));
  assert.equal(anySideNotDeducted({ front: w(stockFailed(wheel, 16, 'FAIL: No Product ID')) }), true, 'still flagged (subject ACTION REQUIRED)');
});
