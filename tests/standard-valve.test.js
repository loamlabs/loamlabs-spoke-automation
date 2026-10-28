// Round 3: Standard wheels are drawn with the Studio's autoValvePhase (valve between the two most parallel spokes); System wheels never are.
// The valve angle is measured three ways: in the vendored geometry, in the drawn SVG of every Standard sample, and against the minimum over all rotations.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSample } from './helpers/webhook-harness.mjs';
import { geometry, normalizeWheels } from '../_lib/studio-geometry.js';
import { STANDARD_WHEELS, STANDARD_AUTO_WHEELS } from './fixtures/sandbox-wheels.js';
import { valveDeg, bestValve, svgValveAngle, unphasedGeometry } from './helpers/valve.mjs';
import { findStandardStudioRecipe, standardWheels } from '../_lib/standard-build.js';
import { renderWheelImages } from '../_lib/system-report.js';
import { findSystemBuildRecipe, systemWheels } from '../_lib/system-build.js';
import { wheelSvg } from '../_lib/wheel-svg.js';

const png = async () => Buffer.from('PNG');
const STD_SAMPLES = ['std-steel-wheelset-solid', 'std-berd-rear-custom-two-painted', 'std-berd-front-24h-radial-solid-purple', 'std-berd-rear-24h-2cross-custom', 'std-steel-front-32h-3cross-two-colors', 'std-steel-rear-36h-3cross-custom', 'std-steel-front-28h-3cross-custom'];

function wheelsOfSample(name) {
  const order = loadSample('standard', name), recipe = findStandardStudioRecipe(order).recipe;
  return standardWheels(recipe, new Map(Object.entries(order._sample.metafields)), order);
}
const lacing = (svg) => [...svg.matchAll(/x1="([-\d.]+)" y1="([-\d.]+)" x2="([-\d.]+)" y2="([-\d.]+)"/g)].map((m) => m.slice(1).join(',')).join(';');

test('all 38 Standard wheels with autoValvePhase: the vendored geometry has the minimum valve angle over every rotation (the theme test\'s definition)', () => {
  assert.equal(Object.keys(STANDARD_AUTO_WHEELS).length, 38);
  for (const [name, cfg] of Object.entries(STANDARD_AUTO_WHEELS)) {
    const [pos] = Object.keys(cfg.wheels), w = normalizeWheels(cfg).W[pos], g = geometry(cfg)[pos];
    const { min, rotation } = bestValve(pos, cfg.wheels[pos]);
    assert.ok(Math.abs(valveDeg(g, w) - min) < 1e-6, `${name}: valve angle ${valveDeg(g, w)} is not the minimum ${min}`);
    assert.ok(Number.isInteger(rotation));
  }
});

test('autoValvePhase is switched on only by a strict true; absent, false, "true" and 1 draw exactly today\'s wheel', () => {
  for (const [name, cfg] of Object.entries(STANDARD_WHEELS)) {
    const plain = geometry(cfg);
    for (const v of [false, 'true', 1, null, undefined]) assert.deepEqual(geometry({ ...cfg, autoValvePhase: v }), plain, `${name} autoValvePhase ${String(v)}`);
  }
});

test('the flag never makes a wheel worse (valve angle at or below the old phase table\'s) and fixes the wheels Jerry reported', () => {
  const rows = {};
  for (const [name, cfg] of Object.entries(STANDARD_AUTO_WHEELS)) {
    const [pos] = Object.keys(cfg.wheels), w = normalizeWheels(cfg).W[pos];
    const oldG = geometry({ wheels: cfg.wheels })[pos]; // what the first Standard drawings used (System table: front 32h -2, rear 28h +2)
    const a = valveDeg(geometry(cfg)[pos], w), o = valveDeg(oldG, w);
    assert.ok(a <= o + 1e-6, `${name}: new ${a} worse than old ${o}`);
    rows[name] = { a, o };
  }
  assert.ok(rows['std-auto-rear-24h-x2'].o > 20 && rows['std-auto-rear-24h-x2'].a < 6.5, 'rear 24h 2-cross: about 24 degrees before, about 6 now');
  assert.ok(rows['std-auto-front-32h-x3'].o > 15 && rows['std-auto-front-32h-x3'].a < 3, 'front 32h 3-cross');
  assert.ok(rows['std-auto-rear-36h-x3'].o > 8 && rows['std-auto-rear-36h-x3'].a < 2, 'rear 36h 3-cross');
  assert.ok(rows['std-auto-front-28h-x3'].o > 20 && rows['std-auto-front-28h-x3'].a < 3, 'front 28h 3-cross');
});

test('every drawn Standard image (solid, custom, front, rear) uses autoValvePhase: the valve angle MEASURED ON THE SVG equals the minimum over all rotations', async () => {
  let checked = 0;
  for (const name of STD_SAMPLES) {
    for (const w of wheelsOfSample(name)) {
      const { images, errors } = await renderWheelImages({ ...w, rimRing: null }, png, 600);
      assert.equal(errors.length, 0, `${name} ${w.position}: ${errors}`);
      const cfgW = { erd: w.config.erd, rimHoles: w.config.rimHoles, drive: w.config.drive, rotor: w.config.rotor };
      const { min } = bestValve(w.position, cfgW);
      for (const img of images) { // the all-spokes views show both sides, which is where the valve pair is measured
        if (img.sides.length < 2) continue;
        const measured = svgValveAngle(img.svg);
        assert.ok(Math.abs(measured - min) < 0.05, `${name} ${w.position}: drawn valve angle ${measured.toFixed(2)} but the minimum is ${min.toFixed(2)}`);
        checked++;
      }
    }
  }
  assert.equal(checked, 8, "one all-spokes drawing for each of the 8 Standard sample wheels");
});

test('a Standard wheel is drawn with the flag, a System wheel never: the lacing of the SVGs equals geometry() with exactly that setting', async () => {
  const [rear] = wheelsOfSample('std-berd-rear-24h-2cross-custom');
  const all = (await renderWheelImages({ ...rear, rimRing: null }, png, 600)).images[0];
  const draw = (cfg) => wheelSvg({ config: rear.config, geom: geometry(cfg)[rear.position], colorsHex: { drive: rear.colors.drive.map((c) => rear.hexOf(c)), rotor: rear.colors.rotor.map((c) => rear.hexOf(c)) }, hubHex: rear.hubColorHex, pov: all.pov, sides: all.sides, size: 600 });
  assert.equal(all.svg, draw({ autoValvePhase: true, wheels: { rear: rear.config } }), 'Standard image = flag on');
  assert.notEqual(all.svg, draw({ wheels: { rear: rear.config } }), 'and it differs from the old drawing');
  let n = 0;
  for (const sample of ['hydra2-wheelset-32f-32r', 'hydra2-wheelset-28f-32r', 'solix-24h-wheelset-multicolor', 'hydra2-front-28h-only']) {
    const order = loadSample('system', sample), recipe = findSystemBuildRecipe(order).recipe;
    for (const w of systemWheels(recipe, null, order)) {
      const plainG = geometry({ wheels: { [w.position]: w.config } })[w.position];
      for (const img of (await renderWheelImages({ ...w, rimRing: null }, png, 600)).images) {
        const want = wheelSvg({ config: w.config, geom: plainG, colorsHex: { drive: [], rotor: [] }, hubHex: w.hubColorHex, pov: img.pov, sides: img.sides, size: 600 });
        assert.equal(lacing(img.svg), lacing(want), `${sample} ${w.position} ${img.cid}: System lacing is the flag-less one`);
        n++;
      }
    }
  }
  assert.ok(n >= 12);
});

test('guard: the unrotated-lacing helper the proof uses is flag-less and avoids the System phase table', () => {
  const w = STANDARD_WHEELS['std-front-32h-x3'].wheels.front;
  assert.notDeepEqual(unphasedGeometry('front', w), geometry({ wheels: { front: w } }).front, 'front 32h has a System table entry; the helper draws it as a rear wheel');
});
