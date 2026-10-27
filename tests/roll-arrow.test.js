// Round 4: every wheel image carries the Studio's rolling-forward arrow (System and Standard, internal and customer emails use the same images).
// Direction = the side facing the viewer: clockwise looking at the drive side, counter-clockwise looking at the rotor side (spoke-studio.js: ccw = pov === 'rotor').
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import { loadSample } from './helpers/webhook-harness.mjs';
import { findSystemBuildRecipe, systemWheels, hexFor } from '../_lib/system-build.js';
import { findStandardStudioRecipe, standardWheels } from '../_lib/standard-build.js';
import { renderWheelImages, buildSystemReport, buildCustomerEmail } from '../_lib/system-report.js';
import { wheelSvg } from '../_lib/wheel-svg.js';
import { geometry } from '../_lib/studio-geometry.js';

const png = async () => Buffer.from('PNG');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SYSTEM_SAMPLES = fs.readdirSync(path.join(root, 'samples', 'system')).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''));
const STD_SAMPLES = fs.readdirSync(path.join(root, 'samples', 'standard')).filter((f) => /^std-.*\.json$/.test(f)).map((f) => f.replace(/\.json$/, ''));

function wheelsOf(kind, name) {
  const order = loadSample(kind, name);
  if (kind === 'system') return systemWheels(findSystemBuildRecipe(order).recipe, null, order);
  return standardWheels(findStandardStudioRecipe(order).recipe, new Map(Object.entries(order._sample.metafields)), order);
}

// Reads the arrow back out of the drawn SVG, from the numbers only (not from the data-roll label).
function arrowOf(svg) {
  const groups = [...svg.matchAll(/<g data-roll="(cw|ccw)">(.*?)<\/g>/g)];
  const box = Number(/<svg [^>]*width="([\d.]+)"/.exec(svg)[1]);
  if (groups.length !== 1) return { count: groups.length, box };
  const [, label, inner] = groups[0];
  const path = /<path d="M([-\d.]+) ([-\d.]+) A([-\d.]+) ([-\d.]+) 0 0 ([01]) ([-\d.]+) ([-\d.]+)" [^>]*stroke-width="([\d.]+)"/.exec(inner);
  const poly = /<polygon points="([^"]+)"/.exec(inner)[1].split(' ').map((p) => p.split(',').map(Number));
  const [sx, sy, , r, sweep, ex, ey, sw] = path.slice(1).map(Number);
  const [tip, base1, base2] = poly;
  const c = box / 2;
  // direction of travel at the arc end, in screen coordinates: the tip lies ahead of the arc end. Clockwise on screen = the top moves right.
  const tipRight = tip[0] > ex;
  return { count: 1, label, box, c, start: [sx, sy], end: [ex, ey], r, sweep, sw, tip, base1, base2, direction: tipRight ? 'cw' : 'ccw' };
}

function inside(a) { // every point the arrow paints (arc stroke extent and the head), as a distance from the wheel centre and as coordinates
  const pts = [a.tip, a.base1, a.base2];
  const arcR = [a.r - a.sw / 2, a.r + a.sw / 2];
  const ok = pts.every(([x, y]) => x >= 0 && x <= a.box && y >= 0 && y <= a.box) && a.c - a.r - a.sw / 2 >= 0 && a.c + a.r + a.sw / 2 <= a.box * 2;
  return { ok, minDist: Math.min(...pts.map(([x, y]) => Math.hypot(x - a.c, y - a.c)), ...arcR), maxY: Math.max(a.start[1], a.end[1], ...pts.map((p) => p[1])) };
}

async function allImages() {
  const out = [];
  for (const [kind, names] of [['system', SYSTEM_SAMPLES], ['standard', STD_SAMPLES]]) {
    for (const name of names) {
      for (const w of wheelsOf(kind, name)) {
        const r = await renderWheelImages(w, png, 600);
        assert.equal(r.errors.length, 0, `${name} ${w.position}: ${r.errors}`);
        out.push({ kind, name, w, images: r.images });
      }
    }
  }
  return out;
}

test('every image of every System and Standard sample wheel has exactly one arrow, solid colour, no opacity', async () => {
  const all = await allImages();
  let n = 0;
  for (const { kind, name, w, images } of all) {
    for (const img of images) {
      assert.equal(arrowOf(img.svg).count, 1, `${kind}/${name} ${w.position} ${img.cid}: exactly one arrow`);
      assert.equal((img.svg.match(/<polygon/g) || []).length, 1);
      assert.equal(/opacity|rgba\(/i.test(img.svg), false, `${name} ${img.cid}: no opacity / alpha`);
      assert.equal(/url\(/.test(/<g data-roll.*?<\/g>/.exec(img.svg)[0]), false, `${name} ${img.cid}: the arrow is a plain solid fill and stroke (no gradient)`);
      n++;
    }
  }
  assert.ok(n >= 55, `checked ${n} images`);
});

test('direction: the all-spokes image and the first single-side image turn the same way, the second single-side image the opposite way; front and rear, System and Standard', async () => {
  const all = await allImages();
  let multi = 0, solid = 0;
  for (const { kind, name, w, images } of all) {
    const dirs = images.map((i) => arrowOf(i.svg).direction);
    const high = w.position === 'front' ? 'rotor' : 'drive'; // front: the rotor side is shown first, rear: the drive side
    const want = high === 'drive' ? 'cw' : 'ccw';
    // the geometric reading agrees with the label and with the view side
    for (const i of images) assert.equal(arrowOf(i.svg).label, arrowOf(i.svg).direction);
    if (images.length === 3) {
      assert.deepEqual(images.map((i) => i.cid), [`${w.position}-all-spokes`, `${w.position}-${high}-only`, `${w.position}-${high === 'drive' ? 'rotor' : 'drive'}-only`]);
      assert.equal(dirs[0], want, `${kind}/${name} ${w.position}: all-spokes direction`);
      assert.equal(dirs[1], dirs[0], `${kind}/${name} ${w.position}: first single-side image = all-spokes direction`);
      assert.notEqual(dirs[2], dirs[1], `${kind}/${name} ${w.position}: second single-side image is the opposite`);
      multi++;
    } else {
      assert.equal(images.length, 1);
      assert.equal(dirs[0], want, `${kind}/${name} ${w.position}: a solid wheel's image = the all-spokes direction of a custom wheel`);
      solid++;
    }
  }
  assert.ok(multi >= 12 && solid >= 4, `multi ${multi} solid ${solid}`);
});

test('the arrow follows the Studio: clockwise for a drive-side view, counter-clockwise for a rotor-side view, and the two are mirror images', () => {
  const [w] = wheelsOf('standard', 'std-berd-rear-24h-2cross-custom');
  const g = geometry({ autoValvePhase: true, wheels: { [w.position]: w.config } })[w.position];
  const draw = (pov) => wheelSvg({ config: w.config, geom: g, colorsHex: { drive: [], rotor: [] }, hubHex: '#222222', pov, sides: ['drive', 'rotor'], size: 600 });
  const d = arrowOf(draw('drive')), r = arrowOf(draw('rotor'));
  assert.equal(d.direction, 'cw');
  assert.equal(r.direction, 'ccw');
  assert.equal(d.sweep, 1);
  assert.equal(r.sweep, 0);
  for (const k of [0, 1]) assert.ok(Math.abs(d.start[k] - (k === 0 ? 600 - r.start[0] : r.start[1])) < 0.011, 'mirror image (start)');
  assert.ok(Math.abs(d.tip[0] - (600 - r.tip[0])) < 0.011 && Math.abs(d.tip[1] - r.tip[1]) < 0.011, 'mirror image (head)');
  // the arrow can be left out
  assert.equal(arrowOf(wheelSvg({ config: w.config, geom: g, colorsHex: { drive: [], rotor: [] }, hubHex: '#222222', pov: 'drive', size: 600, arrow: false })).count, 0);
});

test('the arrow stays inside the image, outside the rim, above the hub (never over the valve, hub or spokes), at several image sizes', async () => {
  const all = await allImages();
  for (const { name, w, images } of all) {
    for (const img of images) {
      const a = arrowOf(img.svg), box = a.box, ro = box * 0.464;
      const m = inside(a);
      assert.ok(m.ok, `${name} ${img.cid}: arrow leaves the image`);
      assert.ok(a.c - a.r - a.sw / 2 >= 0.5, `${name} ${img.cid}: top of the arc has no room ${a.c - a.r - a.sw / 2}`);
      assert.ok(m.minDist > ro, `${name} ${img.cid}: arrow touches the rim (${m.minDist.toFixed(2)} <= ${ro.toFixed(2)})`);
      assert.ok(m.maxY < a.c - ro * 0.5, `${name} ${img.cid}: arrow comes down into the wheel`);
    }
  }
  const [w] = wheelsOf('standard', 'std-berd-rear-24h-2cross-custom');
  const g = geometry({ autoValvePhase: true, wheels: { [w.position]: w.config } })[w.position];
  for (const size of [300, 450, 600, 800, 1000]) {
    for (const pov of ['drive', 'rotor']) {
      const a = arrowOf(wheelSvg({ config: w.config, geom: g, colorsHex: { drive: [], rotor: [] }, hubHex: '#222222', pov, sides: ['drive', 'rotor'], size }));
      assert.ok(inside(a).ok && a.c - a.r - a.sw / 2 >= 0, `size ${size} ${pov}`);
      assert.ok(inside(a).minDist > size * 0.464);
    }
  }
});

test('spokes, rim, valve and hub are unchanged: the SVG without the arrow is exactly what commit 692c311 drew (System and Standard, every image)', async (t) => {
  let tmp;
  try {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wheelsvg-r3-'));
    fs.writeFileSync(path.join(tmp, 'wheel-svg.js'), execFileSync('git', ['show', '692c311:_lib/wheel-svg.js'], { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }));
    fs.writeFileSync(path.join(tmp, 'package.json'), '{"type":"module"}');
  } catch (e) { t.skip('commit 692c311 is not available in this checkout'); return; }
  try {
    const old = await import(pathToFileURL(path.join(tmp, 'wheel-svg.js')).href);
    let n = 0;
    for (const { name, w, images } of await allImages()) {
      const geom = geometry(w.standard === true ? { autoValvePhase: true, wheels: { [w.position]: w.config } } : { wheels: { [w.position]: w.config } })[w.position];
      const colorsHex = { drive: w.colors.drive.map((c) => (w.hexOf || hexFor)(c)), rotor: w.colors.rotor.map((c) => (w.hexOf || hexFor)(c)) };
      for (const img of images) {
        const stripped = img.svg.replace(/<g data-roll="(cw|ccw)">.*?<\/g>/, '');
        const before = old.wheelSvg({ config: w.config, geom, colorsHex, hubHex: w.hubColorHex, pov: img.pov, sides: img.sides, size: 600 });
        assert.equal(stripped, before, `${name} ${img.cid}`);
        assert.equal(wheelSvg({ config: w.config, geom, colorsHex, hubHex: w.hubColorHex, pov: img.pov, sides: img.sides, size: 600, arrow: false }), before);
        n++;
      }
    }
    assert.ok(n >= 55);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('captions, ids, order and the emails\' rows are unchanged: the image list is still all spokes, high side, low side; the customer email has the same images', async () => {
  const order = loadSample('system', 'solix-24h-wheelset-multicolor');
  const rep = await buildSystemReport({ recipe: findSystemBuildRecipe(order).recipe, orderData: order, renderPng: png });
  assert.deepEqual(rep.images.map((i) => i.cid), ['front-all-spokes', 'front-rotor-only', 'front-drive-only', 'rear-all-spokes', 'rear-drive-only', 'rear-rotor-only']);
  assert.deepEqual(rep.images.map((i) => i.caption), ['Front wheel, all spokes (rotor side view)', 'Front wheel, rotor side spokes only', 'Front wheel, drive side spokes only', 'Rear wheel, all spokes (drive side view)', 'Rear wheel, drive side spokes only', 'Rear wheel, rotor side spokes only']);
  const cust = buildCustomerEmail({ wheels: rep.wheels, images: rep.images, orderData: order });
  for (const img of rep.images) assert.ok(cust.html.includes(`cid:${img.cid}`));
  assert.equal(/arrow|rolling forward/i.test(rep.html + cust.html), false, 'no words about the arrow');
});
