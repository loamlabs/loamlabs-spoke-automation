// Round 11: the System order note no longer says "no length yet" (the lookup now gives lengths). One wording for hit and miss; a miss keeps its own
// per-wheel "NOT CALCULATED" line that says why.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chartOrder, recipeOf } from './helpers/chart-order.mjs';
import { buildSystemReport } from '../_lib/system-report.js';
const MISS_LINE = "Spoke lengths for System hubs: NOT CALCULATED. This rim is not in I9's spoke length chart, so check the lengths with I9 before ordering spokes.";

const png = async () => Buffer.from('PNG');
const NEW_LINE = 'System spokes are one bundle per wheel; no length-variant inventory is deducted.';
const reportOf = async (order) => buildSystemReport({ recipe: recipeOf(order), orderData: order, renderPng: png });

test('inventory line: in the internal email once (the order note is short and does not carry it), the old wording is gone; a hit shows lengths in the note, a miss says why in the email', async () => {
  const hit = await reportOf(chartOrder({ rear: { rim: '51797702967603', holes: 32 }, orderNumber: 91301 }));
  const miss = await reportOf(chartOrder({ rear: { rim: '12345', holes: 32 }, orderNumber: 91302 }));
  for (const r of [hit, miss]) {
    assert.equal(r.html.replace(/<[^>]+>/g, ' ').split(NEW_LINE).length - 1, 1, 'the line appears once in the email');
    assert.equal(r.note.includes(NEW_LINE), false, 'and not in the order note');
    assert.ok(!/No Length Variant inventory was deducted|have no length yet/.test(r.note + r.html), 'the old wording is gone');
  }
  assert.ok(/Rotor side {2}\d+ mm:/.test(hit.note) && /Drive side {2}\d+ mm:/.test(hit.note), 'a hit shows the lengths');
  assert.ok(miss.html.includes('NOT CALCULATED') && !/ mm:/.test(miss.note), 'a miss says why in the email and prints no length in the note');
  assert.ok(!hit.html.includes('method pending') && !hit.html.includes('NOT CALCULATED'), 'a hit says neither');
});
