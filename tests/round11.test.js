// Round 11: the System order note no longer says "no length yet" (the lookup now gives lengths). One wording for hit and miss; a miss keeps its own
// per-wheel "not calculated (method pending)" line.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chartOrder, recipeOf } from './helpers/chart-order.mjs';
import { buildSystemReport } from '../_lib/system-report.js';
import { SYSTEM_LENGTHS_PENDING_TEXT } from '../_lib/system-lengths.js';

const png = async () => Buffer.from('PNG');
const NEW_LINE = 'System spokes are one bundle per wheel; no length-variant inventory is deducted.';
const noteOf = async (order) => (await buildSystemReport({ recipe: recipeOf(order), orderData: order, renderPng: png })).note;

test('note: a chart hit and a miss both carry the new inventory line, and the old wording is gone', async () => {
  const hit = await noteOf(chartOrder({ rear: { rim: '51797702967603', holes: 32 }, orderNumber: 91301 }));
  const miss = await noteOf(chartOrder({ rear: { rim: '12345', holes: 32 }, orderNumber: 91302 }));
  for (const note of [hit, miss]) {
    assert.equal(note.split('\n').filter((l) => l === NEW_LINE).length, 1, 'the new line appears once');
    assert.ok(!/No Length Variant inventory was deducted|have no length yet/.test(note), 'the old wording is gone');
  }
  assert.ok(/Spoke lengths \(System\): Left\/Rotor \d+ mm, Right\/Drive \d+ mm/.test(hit), 'a hit shows the lengths');
  assert.ok(miss.includes(`  ${SYSTEM_LENGTHS_PENDING_TEXT}\n`), 'a miss keeps "not calculated (method pending)"');
  assert.ok(!hit.includes('method pending'), 'a hit does not say method pending');
});
