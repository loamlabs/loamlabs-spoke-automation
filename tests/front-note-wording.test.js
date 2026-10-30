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

test('a Hydra2 32h FRONT hub no longer says NOT CALCULATED when its rim has a chart row (the #1459 case)', () => {
  const order = chartOrder({ front: { rim: '51797703131443', holes: 32 }, rear: { rim: '51797703131443', holes: 32 }, orderNumber: 91401 });
  assert.equal(systemLengthsNotCalculatedText(input(order, 'front')), null);
  assert.equal(systemLengthsNotCalculatedText(input(order, 'rear')), null);
});

test('the order #1459 case end to end: front gets the rear 32h pair labelled by disc / non-disc side, rear unchanged, the geometry line only in the internal email', async () => {
  const order = chartOrder({ front: { rim: '51797703131443', holes: 32 }, rear: { rim: '51797703131443', holes: 32 }, orderNumber: 91401 });
  const r = await noteOf(order);
  const front = r.note.split('REAR WHEEL')[0], rear = r.note.split('REAR WHEEL')[1];
  assert.ok(front.includes('  Spoke lengths (System): Disc side 300 mm, Non-disc side 303 mm\n'));
  assert.ok(front.includes('  Source: I9 System chart 2026, row Triad 29" 32h TR304, 32h pair (Thomas Ward, I9, 2026-10-30: same lengths front and rear)\n'));
  assert.ok(rear.includes('  Spoke lengths (System): Left/Rotor 303 mm, Right/Drive 300 mm\n'));
  assert.ok(rear.includes('  source: I9 System chart 2026, row Triad 29" 32h TR304\n'));
  assert.equal(/NOT CALCULATED|method pending/.test(r.note), false);
  assert.equal(r.note.includes('geometry check') || r.note.includes('Front uses the rear'), false, 'the caveat is NOT in the order note');
  assert.equal(r.html.split('Front uses the rear 32h pair per I9. Jerry').length - 1, 1, 'the caveat is in the internal email exactly once (front wheel only)');
  assert.ok(r.html.includes('geometry check differs by up to about 4 mm on one side; if the first real front build looks off, tell Claude.'));
  assert.ok(r.html.includes('Disc side 300 mm, Non-disc side 303 mm'));
  assert.ok(r.html.includes('<em>Spoke lengths for System hubs: see each wheel</em>'));
});

test('front 32h on I9 and We Are One rims; a rim with no chart row still says NOT CALCULATED, check with I9; any front axle spacing gives the same pair', async () => {
  // I9 rim: Sector alloy 29" 32h (TR256) 299 / 300; We Are One rim: Fuse carbon 29" 32h (TR307) 300 / 303
  for (const [rim, disc, nonDisc, row] of [['53530701168947', 299, 300, 'Sector 29" 32h TR256'], ['51797702967603', 300, 303, 'Fuse 29" 32h TR307']]) {
    const r = await noteOf(chartOrder({ front: { rim, holes: 32 }, rear: { rim, holes: 32 }, orderNumber: 91408 }));
    const front = r.note.split('REAR WHEEL')[0];
    assert.ok(front.includes(`Disc side ${disc} mm, Non-disc side ${nonDisc} mm`), row);
    assert.ok(front.includes(`row ${row}, 32h pair`), row);
    assert.equal(r.lengths.front.pending, false);
  }
  const miss = await noteOf(chartOrder({ front: { rim: '12345', holes: 32 }, rear: { rim: '12345', holes: 32 }, orderNumber: 91409 }));
  assert.ok(miss.note.split('REAR WHEEL')[0].includes("Spoke lengths for System hubs: NOT CALCULATED. This rim is not in I9's spoke length chart"));
  assert.equal(miss.note.includes('Disc side'), false);
  // the lookup has no axle-spacing input at all (15x110, 20x110, 15x100 ... all give the same pair): the wheel geometry it reads has no such field
  const w = input(chartOrder({ front: { rim: '51797703131443', holes: 32 }, orderNumber: 91410 }), 'front');
  assert.equal(Object.keys(w).some((k) => /spacing|axle/i.test(k)), false);
});

test('every Hydra2 32h chart row has drive <= non-drive, so the front mapping (shorter = disc side) puts the longer number on the non-disc side, as the hub geometry says', async () => {
  const { CHART_ROWS } = await import('../_lib/i9-system-chart.js');
  const rows = CHART_ROWS.filter((r) => r.hub === 'H2 32h');
  assert.ok(rows.length >= 15);
  assert.ok(rows.every((r) => r.driveColumn <= r.nonDriveColumn), 'a row with drive > non-drive would put the longer number on the disc side: look at it before using it');
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
