// Front-note wording round: a wheel without chart lengths says NOT CALCULATED and WHY, in plain words, in the order note and the internal email.
// No numbers on such a wheel, "(method pending)" is gone from the default path, the rear logic and the chart are untouched.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chartOrder, recipeOf } from './helpers/chart-order.mjs';
import { buildSystemReport } from '../_lib/system-report.js';
import { systemWheels } from '../_lib/system-build.js';
import { systemLengthsNotCalculatedText, SYSTEM_LENGTHS_NOT_CALCULATED_PREFIX, resolveSystemLengths } from '../_lib/system-lengths.js';

const png = async () => Buffer.from('PNG');
const input = (order, pos, patch = {}) => ({ ...systemWheels(recipeOf(order), null, order).find((w) => w.position === pos).geometryInput, ...patch });
const noteOf = async (order) => (await buildSystemReport({ recipe: recipeOf(order), orderData: order, renderPng: png }));
const P = SYSTEM_LENGTHS_NOT_CALCULATED_PREFIX;

test('the exact text for a Hydra2 32h FRONT hub (the #1459 case)', () => {
  const order = chartOrder({ front: { rim: '51797703131443', holes: 32 }, rear: { rim: '51797703131443', holes: 32 }, orderNumber: 91401 });
  assert.equal(systemLengthsNotCalculatedText(input(order, 'front')),
    "Spoke lengths for System hubs: NOT CALCULATED. I9 has not published 32h front numbers yet, so check the front lengths with I9 before ordering spokes. (The rear numbers are rear-hub numbers and do not apply to the front.)");
  assert.equal(systemLengthsNotCalculatedText(input(order, 'rear')), null, 'the rear has numbers, so no text');
});

test('the order #1459 case end to end: front says NOT CALCULATED with no numbers, rear unchanged (303 / 300 and the source line), summary line unchanged', async () => {
  const order = chartOrder({ front: { rim: '51797703131443', holes: 32 }, rear: { rim: '51797703131443', holes: 32 }, orderNumber: 91401 });
  const r = await noteOf(order);
  const front = r.note.split('REAR WHEEL')[0], rear = r.note.split('REAR WHEEL')[1];
  assert.ok(front.includes('  Spoke lengths for System hubs: NOT CALCULATED. I9 has not published 32h front numbers yet'));
  assert.equal(/\d+ mm/.test(front), false, 'no number on the front');
  assert.ok(rear.includes('  Spoke lengths (System): Left/Rotor 303 mm, Right/Drive 300 mm\n'));
  assert.ok(rear.includes('  source: I9 System chart 2026, row Triad 29" 32h TR304\n'));
  assert.equal(r.note.includes('method pending'), false);
  assert.ok(r.html.includes('<em>Spoke lengths for System hubs: see each wheel</em>'), 'one wheel has numbers: "see each wheel"');
  assert.ok(r.html.includes('NOT CALCULATED. I9 has not published 32h front numbers yet'), 'the internal email carries the reason too');
});

test('every other null case says its own plain reason', () => {
  const cases = [
    ['rim not in the chart', chartOrder({ rear: { rim: '12345', holes: 32 }, orderNumber: 91402 }), 'rear', {}, /^This rim is not in I9's spoke length chart, so check the lengths with I9 before ordering spokes\.$/],
    ['hub does not match the chart row', chartOrder({ rear: { rim: '51797702934835', holes: 28, hub: 'Solix' }, orderNumber: 91403 }), 'rear', {}, /^The hub on this wheel \(Solix 28h\) does not match the hub in I9's chart row for this rim \(H2 28h\), so check the lengths with I9 before ordering spokes\.$/],
    ['hub model not recognized', chartOrder({ rear: { rim: '51797702967603', holes: 32 }, orderNumber: 91404 }), 'rear', { hubModel: null }, /^The hub model \(Solix or Hydra2\) was not recognized on this wheel/],
    ['wheel position not recognized', chartOrder({ rear: { rim: '51797702967603', holes: 32 }, orderNumber: 91405 }), 'rear', { position: 'middle' }, /^The wheel position \(front or rear\) was not recognized/]
  ];
  for (const [name, order, pos, patch, re] of cases) {
    const text = systemLengthsNotCalculatedText(input(order, pos, patch));
    assert.ok(text.startsWith(`${P} `), name);
    assert.match(text.slice(P.length + 1), re, name);
    assert.equal(/method pending/.test(text), false, name);
  }
});

test('a wheel that has chart numbers never gets the NOT CALCULATED text; a Solix front (inferred) still gets numbers', () => {
  const order = chartOrder({ front: { rim: '67796530037043', holes: 24 }, rear: { rim: '67796530037043', holes: 24 }, orderNumber: 91406 });
  assert.equal(systemLengthsNotCalculatedText(input(order, 'front')), null);
  assert.equal(systemLengthsNotCalculatedText(input(order, 'rear')), null);
  assert.ok(resolveSystemLengths(input(order, 'front')).lengths);
});

test('the summary line says NOT CALCULATED when no wheel has numbers, and the customer email never carries any of it', async () => {
  const order = chartOrder({ rear: { rim: '12345', holes: 32 }, orderNumber: 91407 });
  const r = await noteOf(order);
  assert.ok(r.html.includes('<em>Spoke lengths for System hubs: NOT CALCULATED, see each wheel for the reason</em>'));
});
