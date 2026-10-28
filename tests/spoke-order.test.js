// Round 5: the over/under order of the spokes inside each side, as the Studio draws it (assets/spoke-studio.js, FINAL_CROSS_TOP = 'trailing', theme commit dd908ad):
// on each side the leading spokes (geometry sweep +1: the rim hole is clockwise of the hub hole in the drive-side view) are drawn first, the trailing spokes (sweep -1) on top.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSample } from './helpers/webhook-harness.mjs';
import { findSystemBuildRecipe, systemWheels, hexFor } from '../_lib/system-build.js';
import { findStandardStudioRecipe, standardWheels } from '../_lib/standard-build.js';
import { renderWheelImages, buildSystemReport, buildCustomerEmail } from '../_lib/system-report.js';
import { wheelSvg, FINAL_CROSS_TOP } from '../_lib/wheel-svg.js';
import { geometry } from '../_lib/studio-geometry.js';
import { spokeGroups, orderIgnored, wheelSvgAt, angDiff } from './helpers/svg-spokes.mjs';

const png = async () => Buffer.from('PNG');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SYSTEM_SAMPLES = fs.readdirSync(path.join(root, 'samples', 'system')).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''));
const STD_SAMPLES = fs.readdirSync(path.join(root, 'samples', 'standard')).filter((f) => /^std-.*\.json$/.test(f)).map((f) => f.replace(/\.json$/, ''));

function wheelsOf(kind, name) {
  const order = loadSample(kind, name);
  if (kind === 'system') return systemWheels(findSystemBuildRecipe(order).recipe, null, order);
  return standardWheels(findStandardStudioRecipe(order).recipe, new Map(Object.entries(order._sample.metafields)), order);
}
const geomOf = (w) => geometry(w.standard === true ? { autoValvePhase: true, wheels: { [w.position]: w.config } } : { wheels: { [w.position]: w.config } })[w.position];

async function allImages() {
  const out = [];
  for (const [kind, names] of [['system', SYSTEM_SAMPLES], ['standard', STD_SAMPLES]]) {
    for (const name of names) {
      for (const w of wheelsOf(kind, name)) {
        const r = await renderWheelImages(w, png, 600);
        assert.equal(r.errors.length, 0, `${name} ${w.position}: ${r.errors}`);
        out.push({ kind, name, w, geom: geomOf(w), images: r.images });
      }
    }
  }
  return out;
}

// the geometry spoke each drawn spoke is: matched by the hub hole angle (in the mirrored rotor view the angle is 360 - hub)
function geometrySpoke(side, pov, geomSide, pair) {
  let best = null;
  geomSide.forEach((p, k) => {
    const hub = pov === 'drive' ? p.hub : (360 - p.hub) % 360;
    const d = angDiff(hub, pair.hub);
    if (!best || d < best.d) best = { d, k, p };
  });
  assert.ok(best.d < 0.5, `${side}: no hub hole within 0.5 degrees of the drawn spoke (${best.d})`);
  return best;
}

test('the shipped rule is the Studio\'s: trailing on top', () => {
  assert.equal(FINAL_CROSS_TOP, 'trailing');
});

test('every image of every System and Standard sample wheel: on each side the trailing spokes are drawn after (above) the leading spokes, each group in spoke-number order', async () => {
  let images = 0, mixed = 0, reordered = 0;
  for (const { kind, name, w, geom, images: imgs } of await allImages()) {
    for (const img of imgs) {
      for (const { side, pairs } of spokeGroups(img.svg)) {
        const seq = pairs.map((p) => geometrySpoke(side, img.pov, geom[side], p));
        assert.equal(seq.length, geom[side].length, `${kind}/${name} ${img.cid} ${side}: every spoke drawn once`);
        assert.equal(new Set(seq.map((s) => s.k)).size, seq.length, 'each spoke exactly once');
        const lastLeading = Math.max(-1, ...seq.map((s, i) => (s.p.sweep === 1 ? i : -1)));
        const firstTrailing = seq.findIndex((s) => s.p.sweep === -1);
        if (firstTrailing >= 0) assert.ok(lastLeading < firstTrailing, `${kind}/${name} ${img.cid} ${side}: a leading spoke is drawn after a trailing one`);
        for (const sw of [1, -1]) { const ks = seq.filter((s) => s.p.sweep === sw).map((s) => s.k); assert.deepEqual(ks, ks.slice().sort((a, b) => a - b), 'stable inside a group'); }
        if (seq.some((s) => s.p.sweep === 1) && seq.some((s) => s.p.sweep === -1)) mixed++;
        if (seq.some((s, i) => s.k !== i)) reordered++;
      }
      images++;
    }
  }
  assert.ok(images >= 55, `checked ${images} images`);
  assert.ok(mixed >= 60, `side groups with both leading and trailing spokes: ${mixed}`);
  assert.ok(reordered >= 60, `side groups whose order really changed: ${reordered}`);
});

test('the sweep means what the Studio says: leading = the rim hole is clockwise of the hub hole in the drive-side view (checked on the laced wheels), and the rule is the same in the rotor view', async () => {
  let n = 0;
  for (const { name, w, geom } of await allImages()) {
    if (w.config.drive.cross === 0 || w.config.rotor.cross === 0) continue; // radial: hub and rim hole are at the same angle, the sweep alternates
    for (const side of ['drive', 'rotor']) {
      for (const p of geom[side]) {
        const d = ((p.rim - p.hub + 540) % 360) - 180; // signed, clockwise positive, as drawn in the drive-side view
        assert.equal(Math.sign(d), p.sweep, `${name} ${w.position} ${side}: sweep ${p.sweep} but the rim hole is ${d.toFixed(1)} degrees clockwise of the hub hole`);
        n++;
      }
    }
  }
  assert.ok(n > 300);
});

test('a front all-spokes image (rotor view): far side first, near side last; inside each side leading then trailing; the order does not depend on the view', async () => {
  const all = await allImages();
  for (const { name, w, geom, images } of all) {
    const allImg = images.find((i) => i.cid === `${w.position}-all-spokes`);
    const groups = spokeGroups(allImg.svg);
    assert.deepEqual(groups.map((g) => g.side), allImg.pov === 'drive' ? ['rotor', 'drive'] : ['drive', 'rotor'], `${name} ${w.position}: the viewed side is drawn last, so the far side stays behind the near side`);
  }
  // the same wheel drawn from the other side: same rule (sweep), whatever the view
  const [rear] = wheelsOf('standard', 'std-berd-rear-24h-2cross-custom');
  const g = geomOf(rear);
  for (const pov of ['drive', 'rotor']) {
    const svg = wheelSvg({ config: rear.config, geom: g, colorsHex: { drive: [], rotor: [] }, hubHex: '#222222', pov, sides: ['drive', 'rotor'], size: 600 });
    for (const { side, pairs } of spokeGroups(svg)) {
      const sw = pairs.map((p) => geometrySpoke(side, pov, g[side], p).p.sweep);
      assert.deepEqual(sw, sw.slice().sort((a, b) => b - a), `${pov} view ${side}: +1 then -1`);
    }
  }
});

test('nothing else changed: with the paint order ignored, every image equals what commit 1f61be7 drew (same spokes, same geometry, same arrow, rim, hub, valve, colors)', async (t) => {
  const old = await wheelSvgAt('1f61be7');
  if (!old) { t.skip('commit 1f61be7 is not available in this checkout'); return; }
  try {
    let n = 0, changed = 0;
    for (const { name, w, geom, images } of await allImages()) {
      const colorsHex = { drive: w.colors.drive.map((c) => (w.hexOf || hexFor)(c)), rotor: w.colors.rotor.map((c) => (w.hexOf || hexFor)(c)) };
      for (const img of images) {
        const before = old.wheelSvg({ config: w.config, geom, colorsHex, hubHex: w.hubColorHex, pov: img.pov, sides: img.sides, size: 600 });
        if (img.svg !== before) changed++;
        assert.equal(orderIgnored(img.svg), orderIgnored(before), `${name} ${img.cid}`);
        n++;
      }
    }
    assert.ok(n >= 55);
    assert.ok(changed >= 50, `images whose order changed: ${changed} of ${n}`);
  } finally { old.cleanup(); }
});

test('no opacity / alpha anywhere, one arrow per image, captions, ids and the image order of the emails unchanged', async () => {
  for (const { name, images } of await allImages()) {
    for (const img of images) {
      assert.equal(/opacity|rgba\(/i.test(img.svg), false, `${name} ${img.cid}`);
      assert.equal((img.svg.match(/<g data-roll="(cw|ccw)">/g) || []).length, 1);
    }
  }
  const order = loadSample('system', 'solix-24h-wheelset-multicolor');
  const rep = await buildSystemReport({ recipe: findSystemBuildRecipe(order).recipe, orderData: order, renderPng: png });
  assert.deepEqual(rep.images.map((i) => i.cid), ['front-all-spokes', 'front-rotor-only', 'front-drive-only', 'rear-all-spokes', 'rear-drive-only', 'rear-rotor-only']);
  assert.deepEqual(rep.images.map((i) => i.caption), ['Front wheel, all spokes (rotor side view)', 'Front wheel, rotor side spokes only', 'Front wheel, drive side spokes only', 'Rear wheel, all spokes (drive side view)', 'Rear wheel, drive side spokes only', 'Rear wheel, rotor side spokes only']);
  const cust = buildCustomerEmail({ wheels: rep.wheels, images: rep.images, orderData: order });
  for (const img of rep.images) assert.ok(cust.html.includes(`cid:${img.cid}`));
});
