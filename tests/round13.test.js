// Round 13: spokeScale option (thinner spokes; 85% default on photo rings). The valve stem tests moved to round14.test.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chartOrder, recipeOf } from './helpers/chart-order.mjs';
import { systemWheels, hexFor } from '../_lib/system-build.js';
import { geometry } from '../_lib/studio-geometry.js';
import { wheelSvg, RING_SPOKE_SCALE, EDGE_COLOR } from '../_lib/wheel-svg.js';
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
const haloWidths = (svg) => [...svg.matchAll(new RegExp(`<line [^>]*stroke="${EDGE_COLOR}" stroke-width="([\\d.]+)"`, 'g'))].map((m) => +m[1]);
const colorWidths = (svg) => [...svg.matchAll(/<line [^>]*stroke="#(?!8e939a)[0-9a-f]{6}" stroke-width="([\d.]+)"/gi)].map((m) => +m[1]);

test('spokeScale: ring pictures default to 85% (RING_SPOKE_SCALE), the plain-rim picture to 100%; explicit values win, junk is ignored; the minimum width scales with it', async () => {
  assert.equal(RING_SPOKE_SCALE, 0.85);
  const w = wheelOf('front', 28, I9_TITLE), OLD = 3 * 600 / 522;
  for (const [key, def] of [['i9', 0.85], ['wao', 0.85], [null, 1]]) {
    const base = await draw(w, key);
    assert.ok(Math.abs(colorWidths(base)[0] - OLD * def) < 0.015, `default width at 600 px, ring ${key}: ${colorWidths(base)[0]}`);
    assert.equal(await draw(w, key, { spokeScale: def }), base, 'explicit default = absent');
    assert.equal(await draw(w, key, { spokeScale: 'x' }), base, 'junk = absent');
    assert.equal(await draw(w, key, { spokeScale: -2 }), base, 'negative = absent');
    assert.ok(Math.abs(colorWidths(await draw(w, key, { spokeScale: 1 }))[0] - OLD) < 0.01, 'spokeScale 1 = the old width, also on a ring');
    for (const s of [0.85, 0.7]) {
      const svg = await draw(w, key, { spokeScale: s });
      assert.equal(new Set(colorWidths(svg)).size, 1);
      assert.ok(Math.abs(colorWidths(svg)[0] - OLD * s) < 0.015, `600 px: ${s}`);
      const e = colorWidths(svg)[0] > 2.5 ? 1 : 0.5; // the existing rule: 1 px edge each side, 0.5 px once the spoke is 2.5 px or thinner
      assert.ok(Math.abs(haloWidths(svg)[0] - (colorWidths(svg)[0] + 2 * e)) < 0.01, 'edge width');
      const small = await draw(w, key, { spokeScale: s, size: 240 });
      assert.ok(Math.abs(colorWidths(small)[0] - 2 * s) < 0.01, `240 px: floor 2 * ${s}`);
    }
  }
});
