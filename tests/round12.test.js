// Round 12: the photo rim ring in the build report pictures (_lib/rim-rings.js, _lib/wheel-svg.js option "ring"), drawn as Agent A's contract says
// (agent-prompts/AGENT_A_RIM_PHOTOS_REPORT.md, "The rimImage contract"). Without a ring the pictures stay byte-identical to commit cd0537c.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { chartOrder, recipeOf } from './helpers/chart-order.mjs';
import { loadSample } from './helpers/webhook-harness.mjs';
import { spokeGroups, wheelSvgAt, angDiff } from './helpers/svg-spokes.mjs';
import { systemWheels, hexFor } from '../_lib/system-build.js';
import { findStandardStudioRecipe, standardWheels } from '../_lib/standard-build.js';
import { geometry } from '../_lib/studio-geometry.js';
import { wheelSvg } from '../_lib/wheel-svg.js';
import { svgToPng } from '../_lib/wheel-png.js';
import { renderWheelImages, buildSystemReport } from '../_lib/system-report.js';
import { RING_GEOMETRY, RING_SOURCE } from '../_lib/rim-ring-data.js';
import { RING_PNG_BASE64 } from '../_lib/rim-ring-images.js';
import { ringKeyForRim, ringGeometry, loadRing, ringLayout } from '../_lib/rim-rings.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const CONTRACT = path.resolve(root, '..', 'loamlabs-system-builder', 'agent-prompts', 'scs-rim-images', 'rim_photos_contract.json');
const png = async () => Buffer.from('PNG');
const BOX = 600;
const RAD = Math.PI / 180;
const WAO_TITLE = 'We Are One FUSE Carbon Rim (Enduro)', I9_TITLE = 'Industry Nine Sector Alloy Rim (Trail)';

const wheelOf = (pos, holes, rimTitle) => {
  const order = chartOrder({ [pos]: { rim: '51797702967603', holes, rimTitle }, orderNumber: 91400 + holes });
  return systemWheels(recipeOf(order), null, order)[0];
};
const geomOf = (w) => geometry({ wheels: { [w.position]: w.config } })[w.position];
const colorsOf = (w) => ({ drive: w.colors.drive.map(hexFor), rotor: w.colors.rotor.map(hexFor) });
const drawWith = async (w, key, pov, sides = ['drive', 'rotor']) => wheelSvg({ config: w.config, geom: geomOf(w), colorsHex: colorsOf(w), hubHex: w.hubColorHex, pov, sides, size: BOX, ring: await loadRing(key, w.position) });

/* ------------------------------------------------------------------ data */

test('data: the ring geometry equals Agent A\'s contract (re-read when the project folder is there) and the base64 images are the PNG files in _lib/assets', () => {
  if (fs.existsSync(CONTRACT)) {
    const c = JSON.parse(fs.readFileSync(CONTRACT, 'utf8'));
    for (const [mine, theirs] of [['wao', 'wao_front'], ['i9_front', 'i9_front'], ['i9_rear', 'i9_rear']]) {
      const { src, ...rest } = c[theirs]; // eslint-disable-line no-unused-vars
      assert.deepEqual(RING_GEOMETRY[mine], rest, mine);
    }
  }
  assert.equal(RING_GEOMETRY.wao.rotationDeg, 0);
  assert.equal(RING_GEOMETRY.wao.valveAngleDeg, 1.77);
  for (const k of ['wao', 'i9']) {
    const file = fs.readFileSync(path.join(root, '_lib', 'assets', RING_SOURCE.files[k]));
    assert.equal(crypto.createHash('sha256').update(file).digest('hex'), RING_SOURCE.pngSha256[k], k + ' sha');
    assert.ok(Buffer.from(RING_PNG_BASE64[k], 'base64').equals(file), k + ' base64 = file');
    assert.equal(file.readUInt32BE(16), 1024); assert.equal(file.readUInt32BE(20), 1024);
  }
});

/* ------------------------------------------------------------------ no ring: byte-identical */

test('without a ring the picture is exactly what commit cd0537c drew (all spokes, side only, both views, 24 / 28 / 32 holes)', async (t) => {
  const old = await wheelSvgAt('cd0537c');
  if (!old) { t.skip('commit cd0537c is not available in this checkout'); return; }
  try {
    let n = 0;
    for (const [pos, holes] of [['front', 24], ['front', 28], ['rear', 32]]) {
      const w = wheelOf(pos, holes, WAO_TITLE);
      for (const [pov, sides] of [['drive', ['drive', 'rotor']], ['rotor', ['drive', 'rotor']], ['drive', ['drive']], ['rotor', ['rotor']]]) {
        const input = { config: w.config, geom: geomOf(w), colorsHex: colorsOf(w), hubHex: w.hubColorHex, pov, sides, size: BOX };
        assert.equal(wheelSvg(input), old.wheelSvg(input), `${pos} ${holes}h ${pov} ${sides}`);
        assert.ok(!/<image/.test(wheelSvg(input)));
        n++;
      }
    }
    assert.equal(n, 12);
  } finally { old.cleanup(); }
});

/* ------------------------------------------------------------------ ring choice */

test('ring choice (the cart rule): "We Are One" title -> WAO; otherwise vendor Industry Nine -> I9; otherwise WAO; no rim -> WAO', () => {
  assert.equal(ringKeyForRim({ title: 'We Are One FUSE Carbon Rim (Enduro)', vendor: 'Industry Nine' }), 'wao', 'System rebrands the vendor: the title wins');
  assert.equal(ringKeyForRim({ title: 'We Are One Union', vendor: 'We Are One' }), 'wao');
  assert.equal(ringKeyForRim({ title: 'Industry Nine Sector Alloy Rim (Trail)', vendor: 'Industry Nine' }), 'i9');
  assert.equal(ringKeyForRim({ title: 'Grade 300 Deal Alloy Rim', vendor: 'Industry Nine' }), 'i9');
  assert.equal(ringKeyForRim({ title: 'Reserve 30|SL', vendor: 'Reserve' }), 'wao');
  assert.equal(ringKeyForRim({ title: 'Some rim', vendor: '' }), 'wao');
  assert.equal(ringKeyForRim({ title: 'Some rim' }), 'wao');
  assert.equal(ringKeyForRim(null), 'wao');
  assert.equal(ringKeyForRim(undefined), 'wao');
  assert.equal(ringKeyForRim({ title: '  we are one SECTOR', vendor: 'Industry Nine' }), 'wao');
});

test('ring choice through the order parsing: System (title) and Standard (title / vendor), both positions; I9 turned by its contract rotation, WAO 0', async () => {
  for (const [title, key] of [[WAO_TITLE, 'wao'], [I9_TITLE, 'i9']]) {
    const order = chartOrder({ front: { rim: '51797702934835', holes: 28, rimTitle: title }, rear: { rim: '51797702967603', holes: 32, rimTitle: title }, orderNumber: 91450 });
    const [f, r] = systemWheels(recipeOf(order), null, order);
    assert.deepEqual([f.rimRing, r.rimRing], [key, key], 'System ' + key);
    const gf = ringGeometry(f.rimRing, 'front'), gr = ringGeometry(r.rimRing, 'rear');
    assert.deepEqual([gf.rotationDeg, gr.rotationDeg], key === 'i9' ? [RING_GEOMETRY.i9_front.rotationDeg, RING_GEOMETRY.i9_rear.rotationDeg] : [0, 0]);
    const rep = await buildSystemReport({ recipe: recipeOf(order), orderData: order, renderPng: png });
    const turn = (pos) => /<image data-ring="(\w+)"[^>]* transform="rotate\(([-\d.]+) /.exec(rep.images.find((i) => i.cid === `${pos}-all-spokes`).svg);
    const tf = turn('front'), tr = turn('rear');
    assert.equal(tf[1], key); assert.equal(tr[1], key);
    if (key === 'i9') assert.deepEqual([+tf[2], +tr[2]], [RING_GEOMETRY.i9_front.valveAngleDeg + RING_GEOMETRY.i9_front.rotationDeg, RING_GEOMETRY.i9_rear.valveAngleDeg + RING_GEOMETRY.i9_rear.rotationDeg], 'I9: valveAngleDeg + rotation (from the data)');
    else assert.deepEqual([+tf[2], +tr[2]], [1.77, 1.77], 'WAO: valveAngleDeg 1.77 + rotation 0');
  }
  // Standard: the rim component's title / vendor
  const order = loadSample('standard', 'std-steel-front-32h-3cross-two-colors');
  const rec = findStandardStudioRecipe(order).recipe;
  const mk = (rim) => standardWheels({ ...rec, components: { ...rec.components, frontRim: { ...rec.components.frontRim, ...rim } } }, new Map(Object.entries(order._sample.metafields)), order)[0].rimRing;
  assert.equal(mk({}), 'wao');
  assert.equal(mk({ title: 'Industry Nine Sector Alloy Rim', vendor: 'Industry Nine' }), 'i9');
  assert.equal(mk({ title: 'Reserve 30|SL', vendor: 'Reserve' }), 'wao');
  assert.equal(mk({ title: 'We Are One Union', vendor: 'Industry Nine' }), 'wao');
});

/* ------------------------------------------------------------------ geometry */

test('analytic: every spoke end lies on the ring\'s inner ellipse (plus the tuck), in the direction of its rim hole, 24 / 28 / 32 holes, both sides, both views, both rings', async () => {
  let checked = 0;
  for (const [pos, holes] of [['front', 24], ['rear', 24], ['front', 28], ['rear', 28], ['front', 32], ['rear', 32]]) {
    for (const key of ['wao', 'i9']) {
      const w = wheelOf(pos, holes, key === 'wao' ? WAO_TITLE : I9_TITLE), g = geomOf(w), ring = ringGeometry(key, pos);
      // the ellipse, worked out here from the contract numbers (not by the module under test)
      const c = BOX / 2, ro = 0.464 * BOX, s = ro / ((ring.outerRx + ring.outerRy) / 2), rot = (ring.valveAngleDeg + ring.rotationDeg) * RAD;
      const ex = c + Math.cos(rot) * (ring.innerCx - ring.outerCx) * s - Math.sin(rot) * (ring.innerCy - ring.outerCy) * s;
      const ey = c + Math.sin(rot) * (ring.innerCx - ring.outerCx) * s + Math.cos(rot) * (ring.innerCy - ring.outerCy) * s;
      const rx = ring.innerRx * s, ry = ring.innerRy * s, axis = (ring.innerAngleDeg + ring.rotationDeg + ring.valveAngleDeg) * RAD, tuck = Math.min(2.5, Math.max(1.5, BOX * 0.0046));
      for (const pov of ['drive', 'rotor']) {
        const svg = await drawWith(w, key, pov);
        for (const { side, pairs } of spokeGroups(svg)) {
          assert.equal(pairs.length, g[side].length, `${key} ${pos} ${holes}h ${side} spokes drawn`);
          const wanted = g[side].map((p) => (pov === 'drive' ? p.rim : (360 - p.rim) % 360)).sort((a, b) => a - b);
          const got = [];
          for (const p of pairs) {
            const dx = p.x2 - ex, dy = p.y2 - ey, d = Math.hypot(dx, dy), q = [ex + dx / d * (d - tuck), ey + dy / d * (d - tuck)]; // the end point without the tuck
            const X = (q[0] - ex) * Math.cos(axis) + (q[1] - ey) * Math.sin(axis), Y = -(q[0] - ex) * Math.sin(axis) + (q[1] - ey) * Math.cos(axis);
            assert.ok(Math.abs((X / rx) ** 2 + (Y / ry) ** 2 - 1) < 1e-3, `${key} ${pos} ${holes}h ${pov} ${side}: end (${p.x2}, ${p.y2}) is on the inner ellipse (residual ${((X / rx) ** 2 + (Y / ry) ** 2 - 1).toExponential(2)})`);
            got.push(((Math.atan2(dx, -dy) * 180 / Math.PI) + 360) % 360);
            checked++;
          }
          got.sort((a, b) => a - b);
          got.forEach((a, i) => assert.ok(angDiff(a, wanted[i]) < 0.1, `${key} ${pos} ${holes}h ${pov} ${side}: spoke direction ${a.toFixed(2)} vs rim hole ${wanted[i].toFixed(2)}`));
        }
      }
    }
  }
  assert.ok(checked > 600, 'many spokes checked: ' + checked);
});

test('layers and placement: spokes, ring, valve stem, hub; the ring is one image with one rotate() and no mirroring; no stroked rim circle; hub radius from the mean inner radius', async () => {
  for (const key of ['wao', 'i9']) {
    const w = wheelOf('rear', 28, key === 'wao' ? WAO_TITLE : I9_TITLE);
    for (const pov of ['drive', 'rotor']) {
      const svg = await drawWith(w, key, pov);
      const at = (re) => svg.search(re);
      assert.ok(at(/<g data-side="drive">/) < at(/<image /) && at(/<g data-side="rotor">/) < at(/<image /), 'both spoke groups before the ring');
      assert.ok(at(/<image /) < at(/<rect x="[^"]+" y="[^"]+" width="[^"]+" height="[^"]+" rx=[^>]*fill="#2b2b2b"/), 'ring before the stem (round 13: a flat very dark stem on rings)');
      assert.ok(at(/fill="#2b2b2b"/) < at(/fill="url\(#hubshine\)"/), 'stem before the hub');
      assert.equal((svg.match(/<image /g) || []).length, 1);
      assert.ok(!/stroke="#3b4148"/.test(svg), 'no stroked rim circle');
      const tag = /<image [^>]*>/.exec(svg)[0];
      assert.ok(/transform="rotate\([-\d.]+ 300\.00 300\.00\)"/.test(tag) && !/scale|matrix/.test(tag), 'one rotation about the wheel center, no mirroring: ' + tag.slice(0, 40));
      assert.ok(/^<image data-ring="(wao|i9)" href="data:image\/png;base64,/.test(tag));
      // the image box
      const ring = ringGeometry(key, 'rear'), s = 0.464 * BOX / ((ring.outerRx + ring.outerRy) / 2);
      assert.ok(Math.abs(+/ width="([\d.]+)"/.exec(tag)[1] - 1024 * s) < 0.01 && Math.abs(+/ x="([-\d.]+)"/.exec(tag)[1] - (300 - ring.outerCx * s)) < 0.01 && Math.abs(+/ y="([-\d.]+)"/.exec(tag)[1] - (300 - ring.outerCy * s)) < 0.01);
      // the stem's base is on the inner edge at the bottom
      const L = ringLayout(BOX, 0.464 * BOX, ring), stemY = +/<rect x="[^"]+" y="([-\d.]+)"[^>]*fill="#2b2b2b"/.exec(svg)[1];
      assert.ok(Math.abs(stemY + BOX * 0.05 - L.end(180, 0)[1]) < 0.02);
      // hub hole radius = pcd / 2 * mean inner radius / (erd / 2)
      const pairs = spokeGroups(svg).find((g) => g.side === 'drive').pairs, hubR = Math.hypot(pairs[0].x1 - 300, pairs[0].y1 - 300);
      assert.ok(Math.abs(hubR - (w.config.drive.pcd / 2) * L.meanInner / (w.config.erd / 2)) < 0.02, `hub radius ${hubR}`);
    }
  }
});

test('the ring is the same in both views: drive and rotor pictures carry the same <image> tag (never mirrored)', async () => {
  const w = wheelOf('front', 32, I9_TITLE);
  const tagOf = async (pov) => /<image [^>]*>/.exec(await drawWith(w, 'i9', pov))[0];
  assert.equal(await tagOf('drive'), await tagOf('rotor'));
});

/* ------------------------------------------------------------------ rendering (resvg) */

function ringPixels(rendered, box) { // how many of 16 points on the ring band are not white
  const { pixels, width } = rendered, c = box / 2, mid = 0.464 * box - 0.014 * box;
  let dark = 0;
  for (let i = 0; i < 16; i++) {
    const a = (i * 22.5 + 7) * RAD, x = Math.round(c + mid * Math.sin(a)), y = Math.round(c - mid * Math.cos(a)), o = (y * width + x) * 4;
    if (Math.min(pixels[o], pixels[o + 1], pixels[o + 2]) < 200) dark++;
  }
  return dark;
}

test('resvg draws both rings from the embedded PNG data URI (the ring band is not blank), and a WebP is not used', async () => {
  const { Resvg } = createRequire(import.meta.url)('@resvg/resvg-js');
  for (const key of ['wao', 'i9']) {
    const w = wheelOf('front', 28, key === 'wao' ? WAO_TITLE : I9_TITLE);
    const svg = await drawWith(w, key, 'drive');
    assert.ok(!/image\/webp/.test(svg));
    const rendered = new Resvg(svg, { fitTo: { mode: 'width', value: BOX }, background: '#ffffff' }).render();
    assert.ok(ringPixels(rendered, BOX) >= 14, `${key}: ring band drawn (${ringPixels(rendered, BOX)} of 16 points)`);
    const plain = new Resvg(wheelSvg({ config: w.config, geom: geomOf(w), colorsHex: colorsOf(w), hubHex: w.hubColorHex, pov: 'drive', size: BOX }), { fitTo: { mode: 'width', value: BOX }, background: '#ffffff' }).render();
    assert.ok(Buffer.from(rendered.asPng()).length > Buffer.from(plain.asPng()).length, 'the ring picture holds more detail than the plain rim');
  }
});

test('reports draw the ring in every image of System and Standard wheels; rimRings:false and rimRing:null draw the plain rim; a renderer that cannot draw the ring falls back to the plain rim', async () => {
  const w = wheelOf('front', 28, WAO_TITLE);
  const a = await renderWheelImages(w, png, BOX);
  assert.equal(a.errors.length, 0);
  assert.ok(a.images.every((i) => /<image data-ring="wao"/.test(i.svg)));
  const b = await renderWheelImages({ ...w, rimRing: null }, png, BOX);
  assert.ok(b.images.every((i) => !/<image/.test(i.svg)));
  const std = standardWheels(findStandardStudioRecipe(loadSample('standard', 'std-steel-front-32h-3cross-two-colors')).recipe, new Map(Object.entries(loadSample('standard', 'std-steel-front-32h-3cross-two-colors')._sample.metafields)), loadSample('standard', 'std-steel-front-32h-3cross-two-colors'))[0];
  const c = await renderWheelImages(std, png, BOX);
  assert.equal(c.errors.length, 0);
  assert.ok(c.images.length >= 1 && c.images.every((i) => /<image data-ring="wao"/.test(i.svg)));
  // a renderer that throws for a picture with a ring: the plain picture is made instead, no error line
  const real = console.log; console.log = () => {};
  try {
    const d = await renderWheelImages(w, async (svg) => { if (/<image/.test(svg)) throw new Error('no image support'); return Buffer.from('PNG'); }, BOX);
    assert.equal(d.errors.length, 0);
    assert.ok(d.images.length === a.images.length && d.images.every((i) => !/<image/.test(i.svg)));
  } finally { console.log = real; }
});

test('the real renderer draws a full report picture with the ring (PNG, non-trivial size) for System and Standard, front and rear', async () => {
  const samples = [wheelOf('front', 24, WAO_TITLE), wheelOf('rear', 32, I9_TITLE)];
  for (const w of samples) {
    const r = await renderWheelImages(w, svgToPng, BOX);
    assert.equal(r.errors.length, 0);
    for (const img of r.images) { assert.ok(img.png.length > 60000, `${img.cid} ${img.png.length} bytes`); assert.equal(img.png.readUInt32BE(16), BOX); }
  }
});
