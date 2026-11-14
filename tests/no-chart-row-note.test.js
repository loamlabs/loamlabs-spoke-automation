// NO CHART ROW: a System wheel whose rim has no I9 chart row has no spoke length. The Shopify order note used to say nothing about it (colors only); it now says so in one plain line
// per such wheel. Wheels WITH a chart row keep a byte-identical note. The I9 order list block C no longer claims "every length ... is on I9's dealer list" when lengths were left out.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSystemReport, NOTE_NO_CHART_ROW } from '../_lib/system-report.js';
import { buildCustomerEmail } from '../_lib/system-report.js';
import { buildOrderSheet } from '../_lib/order-sheet.js';
import { chartOrder, recipeOf } from './helpers/chart-order.mjs';
import { runWebhook, loadMockShopify, createMock } from './helpers/webhook-harness.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const order1466 = () => JSON.parse(fs.readFileSync(path.join(here, 'fixtures', 'order-1466.json'), 'utf8'));
const png = async () => Buffer.from('PNG');
const SENTENCE = "Lengths not calculated: this rim is not in I9's chart, check the lengths with I9.";
const NO_ROW = '51797701361971';   // Stan's Flow EX3 29" 32h: flag true, no chart row
const ROW = '51797702967603';      // We Are One FUSE 29" 32h: chart row TR307
const count = (s, t) => s.split(t).length - 1;
const report = (o) => buildSystemReport({ recipe: recipeOf(o), orderData: o, renderPng: png });

test('the sentence is exactly the one Jerry asked for', () => { assert.equal(NOTE_NO_CHART_ROW, SENTENCE); });

test('a wheel set with no chart row: the note says so once under each wheel, after the color lines, with no mm', async () => {
  const r = await report(chartOrder({ front: { rim: NO_ROW, holes: 32 }, rear: { rim: NO_ROW, holes: 32 }, orderNumber: 94001 }));
  assert.equal(count(r.note, SENTENCE), 2);
  assert.ok(!/ mm/.test(r.note));
  const blocks = r.note.trim().split('\n\n');
  assert.equal(blocks.length, 2);
  for (const b of blocks) { const lines = b.split('\n'); assert.equal(lines[lines.length - 1].trim(), SENTENCE, 'last line of the wheel block'); assert.match(lines[1], /^ {2}Rotor side:/); assert.match(lines[2], /^ {2}Drive side:/); }
});

test('a single wheel with no chart row: one line; a mixed order: only the wheel without a row says it, the other keeps its mm', async () => {
  const one = await report(chartOrder({ rear: { rim: NO_ROW, holes: 32 }, orderNumber: 94002 }));
  assert.equal(count(one.note, SENTENCE), 1);
  const mixed = await report(chartOrder({ front: { rim: ROW, holes: 32 }, rear: { rim: NO_ROW, holes: 32 }, orderNumber: 94003 }));
  const [front, rear] = mixed.note.trim().split('\n\n');
  assert.ok(!front.includes('Lengths not calculated') && / mm:/.test(front), 'front (chart row) keeps its lengths, no sentence');
  assert.ok(rear.includes(SENTENCE) && !/ mm:/.test(rear), 'rear (no row) says it');
});

test('wheels WITH a chart row: the note has no new line (byte-identical to before: #1466 and a chart-row set)', async () => {
  const a = await report(order1466());
  assert.ok(!a.note.includes('Lengths not calculated'));
  assert.match(a.note, /Rotor side {2}305 mm: {2}14 Bronze|Rotor side {2}\d+ mm:/);
  const b = await report(chartOrder({ front: { rim: ROW, holes: 32 }, rear: { rim: ROW, holes: 32 }, orderNumber: 94004 }));
  assert.ok(!b.note.includes('Lengths not calculated'));
  assert.equal(b.note.trim().split('\n\n').every((blk) => /^ {2}Drive side {2}\d+ mm:/m.test(blk)), true);
});

test('other reasons for "not calculated" are NOT touched: a hub that does not match the chart row (28h rim row on a Solix hub) keeps its silent note', async () => {
  const o = chartOrder({ rear: { rim: '51797702934835', holes: 28, hub: 'Solix' }, orderNumber: 94005 }); // FUSE 29" 28h row is for a Hydra2 28h hub
  const r = await report(o);
  assert.ok(r.html.includes('NOT CALCULATED'), 'the internal email still says why');
  assert.ok(!r.note.includes('Lengths not calculated'), 'the note is unchanged for this other reason');
});

test('the internal email, the order sheet and the I9 list are unchanged by the note line, and the customer email never carries it', async () => {
  const o = chartOrder({ front: { rim: NO_ROW, holes: 32 }, rear: { rim: NO_ROW, holes: 32 }, orderNumber: 94006 });
  const r = await report(o);
  assert.ok(r.html.includes("NOT CALCULATED. This rim is not in I9&#39;s spoke length chart, so check the lengths with I9 before ordering spokes.") || r.html.includes("NOT CALCULATED. This rim is not in I9's spoke length chart"));
  const cust = buildCustomerEmail({ wheels: r.wheels, images: r.images, orderData: o });
  for (const t of [cust.html, cust.fallbackHtml, cust.subject]) assert.ok(!/Lengths not calculated|NOT CALCULATED|chart/i.test(t));
  const sheet = buildOrderSheet({ orderData: o, calculatedAt: '2026-11-13T12:00:00.000Z' });
  assert.deepEqual(sheet.wheels.map((w) => w.lengths.status), ['not-calculated', 'not-calculated']);
  assert.ok(!JSON.stringify(sheet).includes('Lengths not calculated: this rim'), 'the sheet keeps its own sentence');
});

test('I9 list block C: no length at all -> says nothing could be matched; some sides left out -> says so; fully calculated -> the old sentence, unchanged', async () => {
  const none = (await report(chartOrder({ front: { rim: NO_ROW, holes: 32 }, rear: { rim: NO_ROW, holes: 32 }, orderNumber: 94007 }))).i9OrderList.text;
  const c = (t) => t.split('C. SPOKES NOT on the dealer list')[1].split('\n')[1];
  assert.equal(c(none), '   none: no length is calculated for this order, so nothing could be matched against the dealer list (see block B)');
  assert.ok(!none.includes("every length and color of this order is on I9's dealer list"));
  const mixed = (await report(chartOrder({ front: { rim: ROW, holes: 32 }, rear: { rim: NO_ROW, holes: 32 }, orderNumber: 94008 }))).i9OrderList.text;
  assert.ok(!mixed.includes("every length and color of this order is on I9's dealer list"));
  assert.ok(/length not calculated/.test(mixed.split('C. SPOKES NOT')[0]));
  const calc = (await report(chartOrder({ front: { rim: ROW, holes: 32 }, rear: { rim: ROW, holes: 32 }, orderNumber: 94009 }))).i9OrderList.text;
  assert.ok(calc.includes("none: every length and color of this order is on I9's dealer list") || /C\. SPOKES NOT/.test(calc), 'fully calculated lists are not changed');
  // the structured copy on the sheet follows the same lines
  const sheet = buildOrderSheet({ orderData: chartOrder({ front: { rim: NO_ROW, holes: 32 }, rear: { rim: NO_ROW, holes: 32 }, orderNumber: 94010 }), calculatedAt: '2026-11-13T12:00:00.000Z' });
  assert.equal(sheet.orderList.sections.orderByEmail.lines[1], '   none: no length is calculated for this order, so nothing could be matched against the dealer list (see block B)');
  assert.equal(sheet.orderList.orderByEmailText, null);
});

test('webhook: the order note written to Shopify has the sentence for a no-row order and not for #1466', async () => {
  const api = path.join(here, '..', 'api', 'index.js');
  const run = (o) => runWebhook(api, 'orders/create', JSON.parse(JSON.stringify(o)), { mock: createMock(loadMockShopify()) });
  const a = await run(chartOrder({ front: { rim: NO_ROW, holes: 32 }, rear: { rim: NO_ROW, holes: 32 }, orderNumber: 94011 }));
  assert.equal(a.notes.length, 1); assert.equal(count(a.notes[0], SENTENCE), 2);
  const b = await run(order1466());
  assert.equal(b.notes.length, 1); assert.ok(!b.notes[0].includes('Lengths not calculated'));
  assert.equal(a.inventoryAdjustments.length, 0);
});
