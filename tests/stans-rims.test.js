// STANS-ROWS (Jerry, Nov 7): Stan's Arch MK4 and Flow MK4 29" 32h used to BORROW the Wanderer 29" row (TR309, H2 32h, ERD 600, 299/300). Since 2026-11-14 (Jerry) they are on the offset-aware
// ESTIMATE rule (_lib/rim-length-estimate.js): matched to the same Wanderer row (ERD gap 0, offset gap +0.5 and +1.0), 300 / 300 (the 299 is rounded up: correction +0.04 / +0.09 mm); marked "estimated".
// The data and the internal marker say so; the "check ERD" compare stays quiet at the store ERD 600; ENVE M630, WTB i30 and Light Bicycle AM928 get no row (NOT CALCULATED).
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runWebhook, loadSample, createMock, loadMockShopify } from './helpers/webhook-harness.mjs';
import { chartLengthsForRim, RIM_VARIANT_MAP, CHART_ROWS } from '../_lib/i9-system-chart.js';

const INDEX = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'api', 'index.js');
const clone = (o) => JSON.parse(JSON.stringify(o));
const ARCH = '51797701067059', FLOW = '51797701263667', FUSE = '51797702967603';
const MARK = { [ARCH]: 'estimated from I9 Wanderer 29" TR309 (ERD gap 0 mm, offset gap +0.5 mm): verify', [FLOW]: 'estimated from I9 Wanderer 29" TR309 (ERD gap 0 mm, offset gap +1 mm): verify' };
const SRCLINE = "ESTIMATED from I9 System chart 2026, row Wanderer 29\" TR309 (this rim is not in I9's chart)";
const rimComp = (id, title) => ({ variantId: `gid://shopify/ProductVariant/${id}`, title, variantTitle: '29" / 32h / Black', vendor: "Stan's", selectedOptions: [{ name: 'Size', value: '29"' }, { name: 'Spoke Count', value: '32h' }, { name: 'Color', value: 'Black' }] });
function order(rim) {
  const o = clone(loadSample('system', 'hydra2-wheelset-32f-32r')); const p = o.line_items.flatMap((l) => l.properties || []).find((x) => x.name === '_build'); const b = JSON.parse(p.value);
  b.components.frontRim = { ...b.components.frontRim, ...rim }; b.components.rearRim = { ...b.components.rearRim, ...rim }; p.value = JSON.stringify(b); return o;
}
const withErd = (rim, erd) => createMock({ ...loadMockShopify(), metafields: { [rim.variantId]: { rim_erd: erd, rim_spoke_hole_offset: '2.5', _parent_product_id: 'gid://shopify/Product/8482354168115' } } });
const run = (o, mock) => runWebhook(INDEX, 'orders/create', o, mock ? { mock } : undefined);
const mail = (r) => r.emails.map((e) => e.html).join(' ').replace(/<[^>]+>/g, ' ').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' '); // the internal email as text

test('data: both rims are matched to the Wanderer 29" row TR309 (ERD 600, H2 32h, I9 299/300) and carry the estimate 300 / 300 (not "borrowed" any more)', () => {
  const wanderer = CHART_ROWS.findIndex((r) => r.partNumber === 'TR309' && r.hub === 'H2 32h');
  assert.ok(wanderer >= 0 && CHART_ROWS[wanderer].erd === 600 && CHART_ROWS[wanderer].driveColumn === 299 && CHART_ROWS[wanderer].nonDriveColumn === 300);
  for (const [id, name, offGap] of [[ARCH, 'Arch MK4', 0.5], [FLOW, 'Flow MK4', 1]]) {
    assert.equal(RIM_VARIANT_MAP[id].row, wanderer, name); assert.equal(RIM_VARIANT_MAP[id].borrowed, undefined); assert.equal(RIM_VARIANT_MAP[id].estimated.offsetGap, offGap);
    const hit = chartLengthsForRim(`gid://shopify/ProductVariant/${id}`); assert.equal(hit.driveColumn, 300); assert.equal(hit.nonDriveColumn, 300); assert.equal(hit.borrowed, undefined); assert.equal(hit.estimated.gap, 0); assert.match(hit.variantTitle, new RegExp(name));
  }
  // unknown ids stay out; the two 28h MK4 29" variants are no longer "not in the chart": since 2026-11-14 they carry ESTIMATED lengths (nearest I9 H2 28h row, see tests/estimated-lengths.test.js)
  assert.equal(chartLengthsForRim('1'), null, 'unknown ids stay out');
  for (const id of ['51797701034291', '51797701230899']) assert.ok(chartLengthsForRim(id).estimated, 'the 28h MK4 29" variants are estimated, not I9-listed');
});

test('orders: Arch MK4 and Flow MK4 29" 32h on a Hydra2 32h wheel set give the estimated 300 / 300, marked in the note and the internal email, no "check ERD" at the store ERD 600', async () => {
  for (const [id, title] of [[ARCH, "Stan's Arch MK4 Alloy Rim"], [FLOW, "Stan's Flow MK4 Alloy Rim"]]) {
    const rim = rimComp(id, title); const r = await run(order(rim), withErd(rim, '600.0'));
    assert.equal(r.status, 200); assert.equal(r.inventoryAdjustments.length, 0);
    const [front, rear] = r.note.split('\n\nREAR   ');
    assert.ok(front.includes('  Rotor side  300 mm:  ') && front.includes('  Drive side  300 mm:  '), `${title} front`); assert.ok(rear.includes('  Rotor side  300 mm:  ') && rear.includes('  Drive side  300 mm:  '), `${title} rear`);
    assert.ok(mail(r).includes(`Source: ${SRCLINE}, 32h pair`), 'front source line (internal email)');
    assert.ok(mail(r).includes(`source: ${SRCLINE}`), 'rear source line (internal email)');
    assert.ok(r.note.includes(`Lengths ${MARK[id]}`), 'the order note says estimated, under the wheel');
    assert.equal(/check ERD|store ERD/.test(r.note), false, 'the ERD compare is quiet at 600');
    assert.ok(mail(r).includes(MARK[id]), 'internal email too');
  }
});

test('the ERD compare still works for these rims: a store ERD of 604 is flagged against the ERD the estimate was made from (600)', async () => {
  const rim = rimComp(ARCH, "Stan's Arch MK4 Alloy Rim"); const r = await run(order(rim), withErd(rim, '604.0'));
  assert.ok(/check ERD|store ERD 604/.test(mail(r)) && !/check ERD|store ERD/.test(r.note), 'flagged in the internal email only');
});

test('ENVE M630, WTB i30 and Light Bicycle AM928 (no I9 data) and the other Stan\'s variants stay NOT CALCULATED', async () => {
  for (const [id, title] of [['51000000000001', 'ENVE M630 Rim'], ['51000000000002', 'WTB ST i30 Rim'], ['51000000000003', 'Light Bicycle AM928 Rim'], ['51797701099827', "Stan's Arch MK4 Alloy Rim 27.5\" (28h variant: no I9 row and no estimate, 37 mm from the nearest H2 28h row)"]]) {
    const r = await run(order(rimComp(id, title))); assert.ok(mail(r).includes('NOT CALCULATED'), title); assert.equal(r.note.includes('NOT CALCULATED'), false, title);
  }
});

test('Arch MK4 as a customer-supplied rim: the same estimated lengths and the marker, plus the customer-supplied lines', async () => {
  const o = order({ ...rimComp(ARCH, "Stan's Arch MK4 Alloy Rim"), supplied: true });
  const p = o.line_items.flatMap((l) => l.properties || []).find((x) => x.name === '_build'); const b = JSON.parse(p.value); b.customerSupplied = { front: { rim: true, hub: false }, rear: { rim: true, hub: false } }; p.value = JSON.stringify(b);
  const r = await run(o);
  assert.ok(r.note.includes('CUSTOMER-SUPPLIED PARTS: front rim')); assert.ok(r.note.includes('  Rotor side  300 mm:  ')); assert.ok(mail(r).includes(MARK[ARCH]));
  void FUSE;
});
