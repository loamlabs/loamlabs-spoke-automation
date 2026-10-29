// Round 13 phase 1: spokeScale option (thinner spokes) and the thinner, very dark valve stem on photo rings.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chartOrder, recipeOf } from './helpers/chart-order.mjs';
import { systemWheels, hexFor } from '../_lib/system-build.js';
import { geometry } from '../_lib/studio-geometry.js';
import { wheelSvg, STEM_DARK, STEM_WIDTH_RING, EDGE_COLOR } from '../_lib/wheel-svg.js';
import { loadRing } from '../_lib/rim-rings.js';

const WAO_TITLE = 'We Are One FUSE Carbon Rim (Enduro)', I9_TITLE = 'Industry Nine Sector Alloy Rim (Trail)';
const wheelOf = (pos, holes, rimTitle) => {
  const order = chartOrder({ [pos]: { rim: '51797702967603', holes, rimTitle }, orderNumber: 91500 + holes });
  return systemWheels(recipeOf(order), null, order)[0];
};
const draw = async (w, key, o = {}) => wheelSvg({
  config: w.config, geom: geometry({ wheels: { [w.position]: w.config } })[w.position], colorsHex: { drive: w.colors.drive.map(hexFor), rotor: w.colors.rotor.map(hexFor) },
  hubHex: w.hubColorHex, pov: 'drive', sides: ['drive', 'rotor'], size: 600, ring: key ? await loadRing(key, w.position) : null, ...o
});
const stemOf = (svg) => {
  const m = /<rect x="([\d.-]+)" y="([\d.-]+)" width="([\d.-]+)" height="([\d.-]+)"[^>]*fill="(?!#ffffff)([^"]+)"/.exec(svg.replace('<rect width="600" height="600" fill="#ffffff"/>', ''));
  return { x: +m[1], y: +m[2], w: +m[3], h: +m[4], fill: m[5] };
};
const haloWidths = (svg) => [...svg.matchAll(new RegExp(`<line [^>]*stroke="${EDGE_COLOR}" stroke-width="([\\d.]+)"`, 'g'))].map((m) => +m[1]);
const colorWidths = (svg) => [...svg.matchAll(/<line [^>]*stroke="#(?!8e939a)[0-9a-f]{6}" stroke-width="([\d.]+)"/gi)].map((m) => +m[1]);

test('spokeScale: default (absent, 1, junk) is unchanged; 0.85 / 0.7 thin every spoke and its edge, minimum width scales with it', async () => {
  const w = wheelOf('front', 28, I9_TITLE);
  for (const key of ['i9', null]) {
    const base = await draw(w, key);
    assert.equal(await draw(w, key, { spokeScale: 1 }), base, 'spokeScale 1 = absent');
    assert.equal(await draw(w, key, { spokeScale: 'x' }), base, 'junk = absent');
    assert.equal(await draw(w, key, { spokeScale: -2 }), base, 'negative = absent');
    const th = colorWidths(base)[0];
    assert.ok(Math.abs(th - 3 * 600 / 522) < 0.01, 'current spoke width at 600 px is 3.45');
    for (const s of [0.85, 0.7]) {
      const svg = await draw(w, key, { spokeScale: s });
      assert.equal(new Set(colorWidths(svg)).size, 1);
      assert.ok(Math.abs(colorWidths(svg)[0] - th * s) < 0.015, `600 px: ${s}`);
      const e = colorWidths(svg)[0] > 2.5 ? 1 : 0.5; // the existing rule: 1 px edge each side, 0.5 px once the spoke is 2.5 px or thinner
      assert.ok(Math.abs(haloWidths(svg)[0] - (colorWidths(svg)[0] + 2 * e)) < 0.01, 'edge width');
      const small = await draw(w, key, { spokeScale: s, size: 240 });
      assert.ok(Math.abs(colorWidths(small)[0] - 2 * s) < 0.01, `240 px: floor 2 * ${s}`);
    }
  }
});

test('stem on a photo ring: thinner, flat very dark gray; the plain-rim stem is unchanged (gradient, 0.018 of the picture)', async () => {
  for (const key of ['wao', 'i9']) {
    const w = wheelOf('rear', 32, key === 'wao' ? WAO_TITLE : I9_TITLE);
    const st = stemOf(await draw(w, key));
    assert.equal(st.fill, STEM_DARK);
    assert.equal(STEM_DARK, '#2b2b2b');
    assert.ok(Math.abs(st.w - 600 * STEM_WIDTH_RING) < 0.01);
    assert.ok(st.w < 600 * 0.018 * 0.7, 'at least 30% thinner than the old stem');
    const small = stemOf(await draw(w, key, { size: 240 }));
    assert.ok(small.w >= 2, 'never below 2 px');
  }
  const plain = await draw(wheelOf('rear', 32, I9_TITLE), null);
  assert.match(plain, /fill="url\(#stem\)" stroke="#6b7076"/);
  assert.ok(Math.abs(stemOf(plain.replace('fill="url(#stem)"', 'fill="#999999"')).w - 600 * 0.018) < 0.01);
});

// distance from a point to the stem rectangle, minus nothing: 0 when inside
const distToRect = (px, py, r) => Math.hypot(Math.max(r.x - px, 0, px - (r.x + r.w)), Math.max(r.y - py, 0, py - (r.y + r.h)));

test('the stem touches no spoke: gap between the stem and every spoke edge (halo included) is positive, 24 / 28 / 32 / 36 holes, both rings, both views, front and rear', async () => {
  let spokes = 0, minGap = Infinity, minAt = '';
  for (const [pos, holes] of [['front', 24], ['rear', 24], ['front', 28], ['rear', 28], ['front', 32], ['rear', 32], ['front', 36], ['rear', 36]]) {
    for (const key of ['wao', 'i9']) {
      const w = wheelOf(pos, holes, key === 'wao' ? WAO_TITLE : I9_TITLE);
      for (const pov of ['drive', 'rotor']) {
        for (const size of [240, 600]) {
          const svg = await draw(w, key, { pov, size });
          const st = stemOf(svg), k = size / 600;
          const lines = [...svg.matchAll(new RegExp(`<line x1="([\\d.-]+)" y1="([\\d.-]+)" x2="([\\d.-]+)" y2="([\\d.-]+)" stroke="${EDGE_COLOR}" stroke-width="([\\d.]+)"`, 'g'))];
          assert.ok(lines.length > 0);
          for (const m of lines) {
            const [x1, y1, x2, y2, halo] = m.slice(1).map(Number);
            let d = Infinity;
            for (let t = 0; t <= 1; t += 0.002) d = Math.min(d, distToRect(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, st));
            const gap = d - halo / 2;
            spokes++;
            if (gap < minGap) { minGap = gap; minAt = `${key} ${pos} ${holes}h ${pov} ${size}px`; }
            assert.ok(gap > 0, `${key} ${pos} ${holes}h ${pov} ${size}px: a spoke edge touches the stem (gap ${gap.toFixed(2)} px)`);
          }
        }
      }
    }
  }
  console.log(`stem gap: ${spokes} spokes checked, smallest gap ${minGap.toFixed(2)} px (${minAt})`);
  assert.ok(spokes > 1500);
});
