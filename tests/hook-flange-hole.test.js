// HOOK-FLANGE-HOLE: Hook Flange hubs take half the spoke hole diameter off the geometric length, exactly like Classic Flange hubs.
// Why: Berd's own calculator (berdspokes.com/pages/calculator) subtracts Dh / 2 for its "Hook Flange" hub type as well as for J-Bend, and the customer
// calculator (spoke-calculator.js) subtracts it for every hub that is not Straight Pull. Before this change the order (webhook) left Hook Flange raw (1.3 mm too long at 2.6 mm).
// A hole diameter that is blank, missing or not a number (for example "-") is the 2.6 default, as in Berd's page and the customer calculator.
// The Berd PolyLight "-2 mm with the puller" rule, PolyLightX +1, the hub constant 2.0 and all rounding are unchanged.
import test from 'node:test';
import assert from 'node:assert/strict';
import './helpers/webhook-harness.mjs'; // registers the module loader hooks (resend mock) before api/index.js is imported
import { calculateSpokeLength, calculateBerdFinalLength, applyRounding } from '../_lib/calculator.js';
import { runCalculationEngine } from '../api/index.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} expected ${b} +-${tol}, got ${a}`);

// ---- the pure function -------------------------------------------------------------------------------------------------------------------------------
const base = { baseCrossPattern: 3, spokeCount: 28, finalErd: 599, hubFlangeDiameter: 44, flangeOffset: 28 };
const raw = Math.sqrt(28 ** 2 + 22 ** 2 + 299.5 ** 2 - 2 * 22 * 299.5 * Math.cos((2 * Math.PI * 3) / 14));

test('calculateSpokeLength: Hook Flange takes half the hole diameter off (hole 2.6, 3.0, 2.1) and equals Classic Flange for the same numbers', () => {
  for (const hole of [2.6, 3.0, 2.1, 2.5]) {
    const hook = calculateSpokeLength({ ...base, hubType: 'Hook Flange', hubSpokeHoleDiameter: hole });
    const classic = calculateSpokeLength({ ...base, hubType: 'Classic Flange', hubSpokeHoleDiameter: hole });
    near(hook, raw - hole / 2, 1e-9, `hook hole ${hole}`);
    assert.equal(hook, classic, `hole ${hole}: Hook Flange and Classic Flange give the same length`);
  }
});

test('calculateSpokeLength: no hole diameter given = the 2.6 default for Hook Flange (as for Classic Flange)', () => {
  near(calculateSpokeLength({ ...base, hubType: 'Hook Flange' }), raw - 1.3, 1e-9);
  near(calculateSpokeLength({ ...base, hubType: 'Hook Flange', hubSpokeHoleDiameter: undefined }), raw - 1.3, 1e-9);
});

test('calculateSpokeLength: Straight Pull and unknown hub types are unchanged (no hole deduction)', () => {
  near(calculateSpokeLength({ ...base, hubType: 'Straight Pull', baseCrossPattern: 3, spOffset: 1.5, hubSpokeHoleDiameter: 2.6 }), Math.sqrt(28 ** 2 + 22 ** 2 + 299.5 ** 2 - 2 * 22 * 299.5 * Math.cos((2 * Math.PI * 3.5) / 14)) + 1.5, 1e-9);
  near(calculateSpokeLength({ ...base, hubType: 'Something Else', hubSpokeHoleDiameter: 2.6 }), raw, 1e-9);
});

// ---- the whole engine: Berd Talon MTB rear 12x157 (the variant's own flange numbers), XM 481 29" 28h, 2.75 cross ----------------------------------------
function engine({ hubType = 'Hook Flange', hole, vendor = 'Berd', spokeTitle = 'Berd PolyLight Spokes', group = 'Berd PolyLight' } = {}) {
  const hub = { hub_type: hubType, hub_flange_diameter_left: '60.0', hub_flange_diameter_right: '64.0', hub_flange_offset_left: '46.75', hub_flange_offset_right: '27.3', hub_lacing_policy: 'Use Manual Override Field', hub_manual_cross_value: '2.75' };
  if (hole !== undefined) hub.hub_spoke_hole_diameter = hole;
  const recipe = { buildType: 'Rear', specs: { brakeStyle: 'Centerlock', rearSpokeCount: '28h' }, components: { rearRim: { variantId: 'R', title: 'rim', variantTitle: '', vendor: 'x', selectedOptions: [] }, rearHub: { variantId: 'H', title: 'hub', variantTitle: '', vendor: 'x', selectedOptions: [] }, rearSpokes: { variantId: 'S', title: spokeTitle, vendor, variantTitle: '', selectedOptions: [{ name: 'Color', value: 'Black' }] } } };
  const data = new Map([['R', { rim_erd: '597', rim_spoke_hole_offset: '0.0', rim_washer_policy: 'Mandatory', nipple_washer_thickness: '1.0' }], ['H', hub], ['S', { spoke_model_group: group }]]);
  const log = console.log; console.log = () => {};
  try { const w = runCalculationEngine(recipe, data).rear; assert.ok(w && w.calculationSuccessful, w && w.error); return { geoL: parseFloat(w.lengths.left.geo), geoR: parseFloat(w.lengths.right.geo), roundedL: w.lengths.left.rounded, roundedR: w.lengths.right.rounded }; } finally { console.log = log; }
}

test('Berd Talon, hole 2.6: lengths equal Berd\'s own calculator at its default (292.2 / 287.1), then round and take 2 mm off: 290 / 285 (before the change: 293.49 / 288.42 and 291 / 286)', () => {
  const r = engine({ hole: '2.6' });
  near(r.geoL, 292.19, 0.006, 'left'); near(r.geoR, 287.12, 0.006, 'right');
  assert.equal(r.roundedL, 290); assert.equal(r.roundedR, 285);
});

test('Berd Talon: a hole diameter of "-", blank or missing gives exactly the 2.6 result', () => {
  const ref = engine({ hole: '2.6' });
  for (const hole of ['-', '', undefined, 'n/a']) assert.deepEqual(engine({ hole }), ref, `hole ${JSON.stringify(hole)}`);
});

test('Berd Talon, hole 3.0: 0.2 mm shorter than at 2.6, as Berd\'s own calculator (292.0 / 286.9); rounded 290 / 285', () => {
  const r = engine({ hole: '3.0' }), ref = engine({ hole: '2.6' });
  near(ref.geoL - r.geoL, 0.2, 0.006); near(ref.geoR - r.geoR, 0.2, 0.006);
  near(r.geoL, 291.99, 0.006); near(r.geoR, 286.92, 0.006);
  assert.equal(r.roundedL, 290); assert.equal(r.roundedR, 285);
});

test('Berd Talon, hole 0 is a real number: it is used as 0 (no deduction), as the old Hook Flange maths', () => {
  const r = engine({ hole: '0' });
  near(r.geoL, 293.49, 0.006); near(r.geoR, 288.42, 0.006);
});

test('steel spokes on a Hook Flange hub: same deduction, rounding to the next even mm unchanged; equals the same hub typed as Classic Flange', () => {
  const sp = { vendor: 'Sapim', spokeTitle: 'Sapim Race Spokes- J-Bend', group: 'Sapim Race' };
  for (const hole of ['2.6', '-', '', '3.0', '2.1']) {
    const hook = engine({ ...sp, hole, hubType: 'Hook Flange' });
    const classic = engine({ ...sp, hole, hubType: 'Classic Flange' });
    assert.equal(hook.geoL, classic.geoL, `hole ${hole}`); assert.equal(hook.geoR, classic.geoR);
    assert.equal(hook.roundedL, Math.ceil(hook.geoL / 2) * 2); assert.equal(hook.roundedR, Math.ceil(hook.geoR / 2) * 2);
  }
  const old = engine({ ...sp, hole: '0' }), now = engine({ ...sp, hole: '2.6' });
  near(old.geoL - now.geoL, 1.3, 0.011);
});

test('unchanged rules: Berd hub constant 2.0 for Hook Flange, PolyLight minus 2 after rounding, PolyLightX plus 1', () => {
  assert.equal(applyRounding(292.19, 'Berd'), 290);
  assert.equal(applyRounding(292.19, 'Berd', true), 293);
  const ctx = { flangeL: 46.75, flangeR: 27.3, metalLengthL: 291, metalLengthR: 290 };
  const hook = calculateBerdFinalLength(290, 'Hook Flange', true, ctx), classic = calculateBerdFinalLength(290, 'Classic Flange', true, ctx);
  near(classic - hook, 7.0, 1e-9, 'hub constants 9.0 and 2.0');
  const px = engine({ hole: '2.6', spokeTitle: 'Berd PolyLightX Spokes', group: 'Berd PolyLightX' });
  assert.equal(px.roundedL, Math.round(px.geoL) + 1);
});
