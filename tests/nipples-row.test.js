// NIPPLES-ROW: the key inputs of a studio build's wheel gain "Nipples: <product> (<color>)" when the wheel's nipples are ONE color (a wheel with mixed colors already has its own nipple
// section and pull list). Builds without the theme's standardStudio key, System builds, and builds without a nipple component are byte-identical to before.
// Real api/index.js, Shopify and Resend mocked.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runWebhook, loadSample, createMock, loadMockShopify } from './helpers/webhook-harness.mjs';
import { preconfiguredOrder, preconfiguredMock } from './helpers/preconfigured-order.mjs';
import { attachNippleRows } from '../_lib/order-lines.js';

const INDEX = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'api', 'index.js');
const clone = (o) => JSON.parse(JSON.stringify(o));
const mockFor = (o) => createMock({ ...loadMockShopify(), metafields: o._sample.metafields, variantColors: ['Black', 'Black Berd', 'White Berd', 'Silver'], variantLengths: [240, 330] });
const run = (o) => runWebhook(INDEX, 'orders/create', o, { mock: mockFor(o) });
const html = (r) => r.emails.map((e) => e.html).join('\n');
const text = (h) => String(h).replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const buildOf = (o) => o.line_items.flatMap((l) => l.properties || []).find((p) => p.name === '_build');
const edit = (o, fn) => { const c = clone(o); const p = buildOf(c); const b = JSON.parse(p.value); fn(b); p.value = JSON.stringify(b); return c; };
const rowsOf = (note) => (note.match(/^ {2}Nipples: .*$/gm) || []).map((s) => s.trim());
const stripRows = (n) => n.replace(/^ {2}Nipples: .*\n/gm, '');
const ONE = () => loadSample('standard', 'std-nip-one-color-no-fee');

test('one nipple color per wheel (front Silver, rear Black): each wheel gets its row, under the Spokes line, in the note and the email; lengths and stock unchanged', async () => {
  const r = await run(ONE());
  assert.deepEqual(rowsOf(r.note), ['Nipples: Sapim Brass Nipples (Silver)', 'Nipples: Sapim Brass Nipples (Black)']);
  assert.ok(/ {2}Spokes: [^\n]*\n {2}Nipples: Sapim Brass Nipples \(Silver\)\n {2}Target Tension/.test(r.note), 'sits between Spokes and Target Tension');
  const t = text(html(r));
  assert.ok(t.includes('Nipples Sapim Brass Nipples (Silver)') && t.includes('Nipples Sapim Brass Nipples (Black)'), 'email rows');
  // removing the rows gives the same text as the order without nipple components: nothing else changed
  const none = await run(edit(ONE(), (b) => { delete b.components.frontNipples; delete b.components.rearNipples; }));
  assert.equal(stripRows(r.note), none.note);
  assert.equal(r.inventoryAdjustments.length, none.inventoryAdjustments.length); assert.equal(r.emails[0].subject, none.emails[0].subject);
});

test('different nipple products on the two wheels (Aluminum front, Brass rear) are each named', async () => {
  const o = edit(ONE(), (b) => { b.components.frontNipples.title = 'Sapim Aluminum Nipples'; });
  const r = await run(o);
  assert.deepEqual(rowsOf(r.note), ['Nipples: Sapim Aluminum Nipples (Silver)', 'Nipples: Sapim Brass Nipples (Black)']);
});

test('a wheel with MIXED nipples has no row (it has its own section); the other wheel of the same order does', async () => {
  const both = await run(loadSample('standard', 'std-nip-both-wheels-painted-both-fees'));
  assert.deepEqual(rowsOf(both.note), [], 'both wheels mixed: no rows');
  const m2 = await run(loadSample('standard', 'std-nip-master2-front4-silver'));
  assert.deepEqual(rowsOf(m2.note), ['Nipples: Sapim Brass Nipples (Black)'], 'front mixed, rear one color: only the rear row');
  assert.ok(m2.note.includes('Front wheel: Brass Black') && m2.note.includes('Put 4 Brass Black back'), 'the front keeps its pull list');
});

test('no nipple component, or a blank one: no row, nothing else changes', async () => {
  const base = await run(edit(ONE(), (b) => { delete b.components.frontNipples; delete b.components.rearNipples; }));
  assert.deepEqual(rowsOf(base.note), []);
  const blank = await run(edit(ONE(), (b) => { for (const k of ['frontNipples', 'rearNipples']) { b.components[k].title = ''; b.components[k].variantTitle = ''; b.components[k].selectedOptions = []; } }));
  assert.deepEqual(rowsOf(blank.note), []); assert.equal(blank.note, base.note);
});

test('builds without the studio key and System builds are untouched', async () => {
  const pre = await runWebhook(INDEX, 'orders/create', preconfiguredOrder({ rule: null }), { mock: createMock(preconfiguredMock()) });
  assert.deepEqual(rowsOf(pre.note), []); assert.equal(/<td>Nipples<\/td>/.test(html(pre)), false);
  const sys = await runWebhook(INDEX, 'orders/create', loadSample('system', 'hydra2-wheelset-32f-32r'));
  assert.equal(/Nipples:/.test(sys.note), false);
});

test('attachNippleRows: tolerant of missing pieces, skips wheels that did not calculate', () => {
  const recipe = { components: { frontNipples: { title: 'Sapim Brass Nipples', variantTitle: 'Black', selectedOptions: [{ name: 'Color', value: 'Black' }] } } };
  assert.equal(attachNippleRows(null, recipe, []), null);
  const rep = { front: { calculationSuccessful: true, inputs: {} }, rear: { calculationSuccessful: false } };
  attachNippleRows(rep, recipe, [{ position: 'front', nipples: null }, { position: 'rear', nipples: null }, null, { position: 'front', nipples: { x: 1 } }]);
  assert.equal(rep.front.inputs.nipplesRow, 'Sapim Brass Nipples (Black)'); assert.equal(rep.rear.inputs, undefined);
  const rep2 = { front: { calculationSuccessful: true, inputs: {} } };
  attachNippleRows(rep2, recipe, [{ position: 'front', nipples: { mixed: true } }]); assert.equal(rep2.front.inputs.nipplesRow, undefined);
  attachNippleRows(rep2, recipe, undefined);
});
