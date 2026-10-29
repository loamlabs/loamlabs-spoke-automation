// Round 14: the Presta-style valve (flat-topped stem + wider flat nut, one color, sizes as fractions of the picture) on photo rings; valveColor; no spoke touches it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chartOrder, recipeOf } from './helpers/chart-order.mjs';
import { systemWheels, hexFor } from '../_lib/system-build.js';
import { geometry } from '../_lib/studio-geometry.js';
import { wheelSvg, mixHex, EDGE_COLOR, VALVE_COLOR_DEFAULT, VALVE_THICKNESS, VALVE_HEIGHT, NUT_WIDTH, NUT_HEIGHT, VALVE_EDGE } from '../_lib/wheel-svg.js';
import { loadRing, ringLayout } from '../_lib/rim-rings.js';

const WAO_TITLE = 'We Are One FUSE Carbon Rim (Enduro)', I9_TITLE = 'Industry Nine Sector Alloy Rim (Trail)';
const wheelOf = (pos, holes, rimTitle) => {
  const order = chartOrder({ [pos]: { rim: '51797702967603', holes, rimTitle }, orderNumber: 91600 + holes });
  return systemWheels(recipeOf(order), null, order)[0];
};
const draw = async (w, key, o = {}) => wheelSvg({
  config: w.config, geom: geometry({ wheels: { [w.position]: w.config } })[w.position], colorsHex: { drive: w.colors.drive.map(hexFor), rotor: w.colors.rotor.map(hexFor) },
  hubHex: w.hubColorHex, pov: 'drive', sides: ['drive', 'rotor'], size: 600, ring: key ? await loadRing(key, w.position) : null, ...o
});
// the valve path: M sx0 top H sx1 V nutTop H nx1 V base H nx0 V nutTop H sx0 Z
const valveOf = (svg) => {
  const tag = /<path data-valve="([^"]+)" d="([^"]+)" fill="([^"]+)"([^>]*)\/>/.exec(svg);
  if (!tag) return null;
  const m = /^M([\d.-]+) ([\d.-]+)H([\d.-]+)V([\d.-]+)H([\d.-]+)V([\d.-]+)H([\d.-]+)V([\d.-]+)H([\d.-]+)Z$/.exec(tag[2]);
  assert.ok(m, 'valve path has the stem + nut outline: ' + tag[2]);
  const [sx0, top, sx1, nutTop, nx1, base, nx0] = m.slice(1, 8).map(Number);
  assert.equal(+m[8], nutTop); assert.equal(+m[9], sx0);
  return { color: tag[1], fill: tag[3], extra: tag[4], d: tag[2], sx0, sx1, top, nutTop, nx0, nx1, base };
};
const dist = (px, py, x0, y0, x1, y1) => Math.hypot(Math.max(x0 - px, 0, px - x1), Math.max(y0 - py, 0, py - y1));

test('valve on a photo ring: exact fractions of the picture, flat top, nut centered on the stem with its bottom on the rim\'s inner edge, no pixel minimum (600 and 240 px, both rings)', async () => {
  assert.deepEqual([VALVE_THICKNESS, VALVE_HEIGHT, NUT_WIDTH, NUT_HEIGHT, VALVE_COLOR_DEFAULT], [0.0068, 0.0483, 0.0164, 0.0041, '#2b2b2b']);
  for (const key of ['wao', 'i9']) {
    const w = wheelOf('front', 28, key === 'wao' ? WAO_TITLE : I9_TITLE);
    for (const S of [600, 240, 1000]) {
      const svg = await draw(w, key, { size: S }), v = valveOf(svg), c = S / 2;
      const ring = await loadRing(key, 'front'), base = ringLayout(S, 0.464 * S, ring).end(180, 0)[1];
      const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 0.011, `${key} ${S}px ${msg}: ${a} vs ${b}`);
      near(v.sx1 - v.sx0, S * 0.0068, 'stem thickness'); near((v.sx0 + v.sx1) / 2, c, 'stem centered');
      near(v.base - v.top, S * 0.0483, 'height, nut included'); near(v.nx1 - v.nx0, S * 0.0164, 'nut width'); near((v.nx0 + v.nx1) / 2, c, 'nut centered');
      near(v.base - v.nutTop, S * 0.0041, 'nut height'); near(v.base, base, 'nut bottom on the inner edge');
      assert.ok(!/[ACQSTZ]\d|rx=|<rect x="[^"]+" y="[^"]+" width="[^"]+" height="[^"]+" rx/.test(v.d.replace(/Z$/, '')), 'square corners, no curves');
      assert.equal(v.color, '#2b2b2b'); assert.equal(v.fill, '#2b2b2b'); assert.equal(v.extra, '', 'dark default valve: no edge');
    }
    // the valve comes after the ring and before the hub
    const svg = await draw(w, key), at = (re) => svg.search(re);
    assert.ok(at(/<image /) < at(/<path data-valve/) && at(/<path data-valve/) < at(/fill="url\(#hubshine\)"/));
    assert.equal((svg.match(/data-valve/g) || []).length, 1);
  }
});

test('valveColor: any #rrggbb is used for stem and nut; light colors (silver, white, gold) get a thin darker edge of their own shade; dark and mid colors do not; junk falls back to the default', async () => {
  const w = wheelOf('rear', 32, I9_TITLE);
  const dflt = await draw(w, 'i9');
  for (const bad of [undefined, null, '', 'red', '#12345', '#gggggg', 42, '#2b2b2b']) assert.equal(await draw(w, 'i9', { valveColor: bad }), dflt, 'junk / default: ' + String(bad));
  for (const [hex, light] of [['#cc0000', false], ['#2a6fd0', false], ['#000000', false], ['#c0c0c0', true], ['#ffffff', true], ['#d4af37', true], ['#E8E8E8', true]]) {
    const v = valveOf(await draw(w, 'i9', { valveColor: hex }));
    assert.equal(v.fill, hex.toLowerCase());
    if (light) {
      assert.match(v.extra, new RegExp(`stroke="${mixHex(hex.toLowerCase(), '#000000', 0.5)}" stroke-width="${VALVE_EDGE}"`), `light ${hex} has a darker edge`);
      assert.notEqual(mixHex(hex.toLowerCase(), '#000000', 0.5), hex.toLowerCase());
    } else assert.equal(v.extra, '', `${hex} has no edge`);
    // the outline (geometry) does not depend on the color
    assert.equal(v.d, valveOf(dflt).d);
  }
  assert.equal(VALVE_EDGE, 0.6); // round 15 (was 0.3)
});

test('the plain-rim fallback keeps its old stem (gradient rect, 0.018 of the picture); no valve path; spokeScale and valveColor do not touch it', async () => {
  const w = wheelOf('rear', 32, I9_TITLE);
  const plain = await draw(w, null);
  assert.match(plain, /fill="url\(#stem\)" stroke="#6b7076" stroke-width="1"/);
  assert.ok(!/data-valve/.test(plain));
  assert.equal(await draw(w, null, { valveColor: '#cc0000' }), plain, 'valveColor does nothing without a ring');
});

test('no spoke touches the stem or the nut: gap from every spoke edge (halo included) to each, 24 / 28 / 32 / 36 holes, both rings, both views, front and rear, 240 and 600 px', async () => {
  let spokes = 0, minStem = Infinity, minNut = Infinity, atStem = '', atNut = '';
  for (const [pos, holes] of [['front', 24], ['rear', 24], ['front', 28], ['rear', 28], ['front', 32], ['rear', 32], ['front', 36], ['rear', 36]]) {
    for (const key of ['wao', 'i9']) {
      const w = wheelOf(pos, holes, key === 'wao' ? WAO_TITLE : I9_TITLE);
      for (const pov of ['drive', 'rotor']) {
        for (const size of [240, 600]) {
          const svg = await draw(w, key, { pov, size }), v = valveOf(svg);
          const lines = [...svg.matchAll(new RegExp(`<line x1="([\\d.-]+)" y1="([\\d.-]+)" x2="([\\d.-]+)" y2="([\\d.-]+)" stroke="${EDGE_COLOR}" stroke-width="([\\d.]+)"`, 'g'))];
          assert.ok(lines.length > 0);
          for (const m of lines) {
            const [x1, y1, x2, y2, halo] = m.slice(1).map(Number);
            let ds = Infinity, dn = Infinity;
            for (let t = 0; t <= 1; t += 0.002) {
              const px = x1 + (x2 - x1) * t, py = y1 + (y2 - y1) * t;
              ds = Math.min(ds, dist(px, py, v.sx0, v.top, v.sx1, v.base));
              dn = Math.min(dn, dist(px, py, v.nx0, v.nutTop, v.nx1, v.base));
            }
            const gs = ds - halo / 2, gn = dn - halo / 2, where = `${key} ${pos} ${holes}h ${pov} ${size}px`;
            spokes++;
            if (gs < minStem) { minStem = gs; atStem = where; }
            if (gn < minNut) { minNut = gn; atNut = where; }
            assert.ok(gs > 0, `${where}: a spoke edge touches the stem (gap ${gs.toFixed(2)} px)`);
            assert.ok(gn > 0, `${where}: a spoke edge touches the nut (gap ${gn.toFixed(2)} px)`);
          }
        }
      }
    }
  }
  console.log(`valve gap: ${spokes} spokes checked; smallest gap to the stem ${minStem.toFixed(2)} px (${atStem}), to the nut ${minNut.toFixed(2)} px (${atNut})`);
  assert.ok(spokes > 1500);
});

test('internal email summary line: "System spokes are one bundle per wheel; no length-variant inventory is deducted." (same wording as the order note); the old sentence is gone', async () => {
  const { buildSystemReport } = await import('../_lib/system-report.js');
  const order = chartOrder({ front: { rim: '51797702934835', holes: 28, rimTitle: I9_TITLE }, rear: { rim: '51797702967603', holes: 32, rimTitle: I9_TITLE }, orderNumber: 91650 });
  const rep = await buildSystemReport({ recipe: recipeOf(order), orderData: order, renderPng: async () => Buffer.from('PNG') });
  const text = rep.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  assert.ok(text.includes('System spokes are one bundle per wheel; no length-variant inventory is deducted.'));
  assert.ok(!/No Length Variant inventory was deducted/.test(rep.html + rep.note));
  assert.ok(rep.note.includes('System spokes are one bundle per wheel; no length-variant inventory is deducted.'));
});
