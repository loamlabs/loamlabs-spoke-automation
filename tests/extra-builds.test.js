// ORDER-CHECK-FLAGS: the webhook calculates and deducts ONE wheel build (the first build line, quantity ignored). When the order has more, the note's WARNINGS, the top of the builder email and the
// subject now say so. Orders with one build line of quantity 1 (with or without accessory lines) are byte-identical to before; lengths and stock never change.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runWebhook, createMock } from './helpers/webhook-harness.mjs';
import { preconfiguredOrder, preconfiguredMock } from './helpers/preconfigured-order.mjs';
import { extraBuildNotice, addAttentionNotice, reportNeedsAction } from '../_lib/order-lines.js';

const INDEX = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'api', 'index.js');
const run = (order) => runWebhook(INDEX, 'orders/create', order, { mock: createMock(preconfiguredMock()) });
const html = (r) => r.emails.map((e) => e.html).join('\n');
const buildLine = (o) => o.line_items.find((l) => l.properties.some((p) => p.name === '_build'));
const QTY = 'The wheel build line has quantity 2. The report and the spoke deduction cover ONE wheelset; deduct the spokes for the other 1 by hand.';

test('helpers: the notice for quantity above 1 and for a second build line; nothing for one build of quantity 1 (accessory lines do not count)', () => {
  const o = preconfiguredOrder();
  assert.equal(extraBuildNotice(o, buildLine(o)), null);
  const acc = preconfiguredOrder(); acc.line_items.push({ id: 1, title: 'Valve stem', quantity: 3, properties: [] }, { id: 2, title: 'x', quantity: 1 });
  assert.equal(extraBuildNotice(acc, buildLine(acc)), null, 'accessories, even with quantity 3, say nothing');
  const q2 = preconfiguredOrder(); buildLine(q2).quantity = 2;
  assert.equal(extraBuildNotice(q2, buildLine(q2)), QTY);
  const two = preconfiguredOrder(); const second = JSON.parse(JSON.stringify(buildLine(two))); second.id = 15999; two.line_items.push(second);
  assert.match(extraBuildNotice(two, buildLine(two)), /^This order has 2 wheel build lines\. Only the FIRST was calculated and only its spokes were deducted; calculate and deduct the other 1 by hand\.$/);
  buildLine(two).quantity = 3; assert.match(extraBuildNotice(two, buildLine(two)), /2 wheel build lines.*quantity 3.*other 2 by hand\.$/, 'both reasons together');
  assert.equal(extraBuildNotice(null, null), null);
  assert.equal(reportNeedsAction({ attention: ['x'] }, false), true); assert.equal(reportNeedsAction({}, false), false); assert.equal(reportNeedsAction({}, true), true); assert.equal(reportNeedsAction(null, false), false);
  assert.equal(addAttentionNotice('<div class="container">z', []), '<div class="container">z');
  assert.ok(addAttentionNotice('<div class="container">z', ['A & B']).includes('Check this order by hand:</strong> A &amp; B</p>z'));
});

test('quantity 2 on the build line: note WARNINGS, red box at the top of the email, subject ACTION REQUIRED; lengths and stock exactly as for quantity 1', async () => {
  const one = await run(preconfiguredOrder());
  const o = preconfiguredOrder(); buildLine(o).quantity = 2;
  const r = await run(o);
  assert.equal(r.status, 200);
  assert.ok(r.note.includes(`WARNINGS:\n- ${QTY}`), 'in the note');
  assert.ok(html(r).includes(`<div class="container"><p style="color:#D8000C;background-color:#FFD2D2;padding:10px;border-radius:3px"><strong>Check this order by hand:</strong> ${QTY}</p>`), 'top of the email');
  assert.equal(r.emails[0].subject, 'ACTION REQUIRED: Spoke Calculation Complete for Order #90301');
  assert.deepEqual(r.inventoryAdjustments, one.inventoryAdjustments, 'stock unchanged (still one wheelset)');
  assert.equal(r.note.replace(/\n\nWARNINGS:\n- .*$/s, ''), one.note, 'apart from the warning the note is the quantity-1 note');
});

test('two build lines in one order: the second is named as not calculated; the first is reported as before', async () => {
  const one = await run(preconfiguredOrder());
  const o = preconfiguredOrder(); const second = JSON.parse(JSON.stringify(buildLine(o))); second.id = 15999; o.line_items.push(second);
  const r = await run(o);
  assert.ok(r.note.includes('WARNINGS:\n- This order has 2 wheel build lines. Only the FIRST was calculated'));
  assert.match(r.emails[0].subject, /^ACTION REQUIRED: /);
  assert.deepEqual(r.inventoryAdjustments, one.inventoryAdjustments);
});

test('one build of quantity 1, with or without accessory lines: byte-identical to the plain order (no warning, normal subject)', async () => {
  const base = await run(preconfiguredOrder());
  const o = preconfiguredOrder(); o.line_items.push({ id: 15200, title: 'Valve Stem', name: 'Valve Stem', variant_title: 'Black', quantity: 4, price: '9.00', product_id: 8, variant_id: 77, vendor: 'x', properties: [] });
  const r = await run(o);
  assert.equal(r.note, base.note); assert.equal(html(r), html(base)); assert.equal(r.emails[0].subject, base.emails[0].subject);
  assert.equal(/WARNINGS|Check this order by hand/.test(r.note + html(r)), false); assert.equal(/^ACTION REQUIRED/.test(r.emails[0].subject), false);
});
