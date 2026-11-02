// A preconfigured order: ONE line item (the master variant) carrying _build and _Preconfigured_Rule, no separate rim / hub / spoke lines.
// These go through the real api/index.js with Shopify and Resend mocked (no network). Fixture: tests/helpers/preconfigured-order.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runWebhook, createMock } from './helpers/webhook-harness.mjs';
import { preconfiguredOrder, preconfiguredMock, preconfiguredMetafields, preconfiguredBuild, PRE } from './helpers/preconfigured-order.mjs';

const INDEX = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'api', 'index.js');
const run = (order, metafields, topic = 'orders/create') => runWebhook(INDEX, topic, order, { mock: createMock(preconfiguredMock(metafields)) });
const emailHtml = (r) => r.emails.map((e) => e.html).join('\n');

test('master-variant order: the lengths come from the components named in _build, the note is written, the builder gets the report, inventory is adjusted', async () => {
  const r = await run(preconfiguredOrder());
  assert.equal(r.status, 200);
  assert.equal(r.notes.length, 1);
  for (const line of ['Left (Geo):  278.45 mm', 'Right (Geo): 280.08 mm', 'Left: 12 x 280mm (Adjusted)', 'Right: 12 x 282mm (Adjusted)',
    'Left (Geo):  275.22 mm', 'Right (Geo): 272.58 mm', 'Left: 12 x 276mm (Adjusted)', 'Right: 12 x 274mm (Adjusted)']) assert.ok(r.note.includes(line), line);
  assert.equal(r.emails.length, 1); assert.match(r.emails[0].subject, /Order #90301/);
  assert.deepEqual(r.emails[0].to, ['builder@example.com']);
  assert.equal(r.inventoryAdjustments.length, 4);
  assert.deepEqual(r.metafieldQueries[0].slice().sort(), Object.values(PRE).sort(), 'metafields are fetched for the variants named in _build (rims, hubs, spokes, nipples), not for the master variant');
  assert.equal(r.logs.some(([k, m]) => k === 'error'), false, 'no error in the log');
});

test('_Preconfigured_Rule changes nothing: the same order without it gives the same note, inventory and email', async () => {
  const a = await run(preconfiguredOrder()), b = await run(preconfiguredOrder({ rule: null }));
  assert.equal(a.note, b.note);
  assert.deepEqual(a.inventoryAdjustments, b.inventoryAdjustments);
  assert.equal(a.emails[0].html, b.emails[0].html);
});

test('cancelling a master-variant order restocks the spokes that were adjusted', async () => {
  const created = await run(preconfiguredOrder());
  const cancelled = { ...preconfiguredOrder(), note: created.note };
  const r = await run(cancelled, undefined, 'orders/cancelled');
  assert.equal(r.inventoryAdjustments.length, 4, 'four length variants put back');
  assert.ok(r.note.includes('AUTOMATED RESTOCK COMPLETE') && !r.note.includes('FAILED'));
});

test('a retired component (Shopify returns nothing for it) or one with blank numbers is NOT calculated as zeros: CALC FAILED with what is missing, nothing deducted for that wheel', async () => {
  const retiredRim = preconfiguredMetafields(); delete retiredRim[PRE.frontRim];
  const blankRim = preconfiguredMetafields(); blankRim[PRE.frontRim] = { _parent_product_id: 'gid://shopify/Product/801' };
  const blankRearHub = preconfiguredMetafields(); blankRearHub[PRE.rearHub] = { _parent_product_id: 'gid://shopify/Product/804' };
  for (const [name, mf, wheel, what, kept] of [['retired front rim', retiredRim, 'FRONT', 'rim ERD (Test Rim 40 GR 700c Carbon Rim)', 'Left: 12 x 276mm (Adjusted)'],
    ['blank front rim', blankRim, 'FRONT', 'rim ERD (Test Rim 40 GR 700c Carbon Rim)', 'Left: 12 x 276mm (Adjusted)'],
    ['blank rear hub', blankRearHub, 'REAR', 'hub left flange diameter, right flange diameter, left flange offset, right flange offset', 'Left: 12 x 280mm (Adjusted)']]) {
    const r = await run(preconfiguredOrder(), mf);
    assert.ok(r.note.includes(`${wheel} WHEEL:\nCALC FAILED - Missing data in Shopify, so the ${wheel.toLowerCase()} lengths were NOT calculated and no inventory was changed for this wheel: ${what}`), name);
    assert.ok(r.note.includes(kept), `${name}: the other wheel is still calculated and adjusted`);
    assert.equal(r.inventoryAdjustments.length, 2, `${name}: only the good wheel changed inventory`);
    const failedSection = r.note.split(`${wheel} WHEEL:\n`)[1].split('\nREAR WHEEL')[0].split('\nFRONT WHEEL')[0];
    assert.equal(failedSection.includes('(Geo)'), false, `${name}: no zero-based length for the failed wheel`);
    assert.ok(emailHtml(r).includes('NOT calculated'), `${name}: the builder email says so too`);
  }
});

test('the guard does not touch a complete order: lengths are the same with and without the new check (the numbers in the first test)', async () => {
  const r = await run(preconfiguredOrder({ build: preconfiguredBuild() }));
  assert.equal(r.note.includes('CALC FAILED'), false);
});
