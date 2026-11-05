// NIPPLE-REPORT: the backend's vendored nipple drawing (_lib/studio-nipples.js + the nipple layer of _lib/wheel-svg.js) must equal what the theme's Spoke Color Studio draws.
// The theme's Studio is read from a git REF of the theme repo (default: commit 9fdb48f, Agent A's nipple layer; see tests/helpers/theme-studio.mjs for LOAM_THEME_DIR / LOAM_THEME_REF).
// When the theme is not there the live tests FAIL on purpose (set LOAM_THEME_DIR=skip to run only the fixture-free checks), so a drift can never pass unnoticed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { geometry } from '../_lib/studio-geometry.js';
import { wheelSvg } from '../_lib/wheel-svg.js';
import { NIPPLE, NIPPLE_COLORS, NIPPLE_MATCH, REPORT_NIPPLE_SCALE } from '../_lib/studio-nipples.js';
import { themeSource, loadStudio } from './helpers/theme-studio.mjs';

const skipLive = process.env.LOAM_THEME_DIR === 'skip';
const plain = (o) => JSON.parse(JSON.stringify(o));

test('the vendored nipple numbers, colors and match table equal the theme Studio (LoamStudio.nipple, nippleColors, nippleMatch)', (t) => {
  if (skipLive) { t.skip('LOAM_THEME_DIR=skip'); return; }
  const src = themeSource(), Studio = loadStudio(src);
  assert.deepEqual(plain(NIPPLE), plain(Studio.nipple), `nipple numbers drifted from the theme (${src.origin})`);
  assert.deepEqual(plain(NIPPLE_COLORS), plain(Studio.nippleColors), `nipple colors drifted from the theme (${src.origin})`);
  assert.deepEqual(plain(NIPPLE_MATCH), plain(Studio.nippleMatch), `nipple match table drifted from the theme (${src.origin})`);
  assert.equal(NIPPLE.taper, 0, 'the vendored drawing is the plain rectangle (taper 0, head 0); the theme numbers say so too');
  assert.equal(NIPPLE.head, 0);
});

const SPOKE_COLORS = [{ name: 'Black', hex: '#1d1f23' }, { name: 'Silver', hex: '#c3c8cf' }];
const NIP_COLORS = [{ name: 'Black', hex: '#1d1f23' }, { name: 'Silver', hex: '#c3c8cf' }, { name: 'Blue', hex: '#244d90' }, { name: 'Gold', hex: '#b27e0e' }, { name: 'Red', hex: '#a42639' }];
const hexOfNip = (n) => NIP_COLORS.find((c) => c.name === n).hex;

// the same wheel through the theme's preview() and through wheelSvg: the nipple shapes (one <rect> per nipple) must be character for character the same
function themeNipples(Studio, wheel, value, size) {
  const cfg = { spokeColors: SPOKE_COLORS, hubColors: [{ name: 'Black', hex: '#1d1f23' }], wheels: { [wheel.pos]: { erd: wheel.erd, rimHoles: wheel.n * 2, drive: { n: wheel.n, pcd: wheel.pcdD, cross: wheel.cross }, rotor: { n: wheel.n, pcd: wheel.pcdR, cross: wheel.cross }, nippleColors: NIP_COLORS, nippleColor: 'Black' } } };
  const el = { innerHTML: '' };
  Studio.preview(el, { config: cfg, wheel: wheel.pos, size, value, pov: wheel.pov });
  const m = /<svg class="lls-nipples"[^>]*>([\s\S]*?)<\/svg>/.exec(el.innerHTML);
  return { cfg, shapes: m ? m[1] : '' };
}
function ourNipples(wheel, value, size, nippleScale = 1) { // scale 1 = the Studio's own size (the report draws 1.5, see the test below)
  const config = { erd: wheel.erd, drive: { n: wheel.n, pcd: wheel.pcdD, cross: wheel.cross }, rotor: { n: wheel.n, pcd: wheel.pcdR, cross: wheel.cross } };
  const geom = geometry({ wheels: { [wheel.pos]: { ...config, rimHoles: wheel.n * 2 } } })[wheel.pos];
  const nipples = { drive: value.nipples[wheel.pos].drive.map(hexOfNip), rotor: value.nipples[wheel.pos].rotor.map(hexOfNip) };
  const svg = wheelSvg({ config, geom, colorsHex: { drive: Array(wheel.n).fill('#1d1f23'), rotor: Array(wheel.n).fill('#1d1f23') }, hubHex: '#1d1f23', pov: wheel.pov || 'drive', size, nipples, nippleScale, arrow: false });
  const m = /<g data-nipples="\d+">([\s\S]*?)<\/g>/.exec(svg);
  return { svg, shapes: m ? m[1] : '' };
}

const WHEELS = [
  { pos: 'rear', n: 16, erd: 600, pcdD: 50, pcdR: 50, cross: 3 },
  { pos: 'front', n: 14, erd: 599, pcdD: 44, pcdR: 44, cross: 3 },
  { pos: 'rear', n: 12, erd: 560, pcdD: 54, pcdR: 40, cross: 2 },
  { pos: 'rear', n: 16, erd: 600, pcdD: 50, pcdR: 50, cross: 3, pov: 'rotor' }
];
function mixedValue(Studio, wheel) {
  const cfgValue = Studio.defaults({ spokeColors: SPOKE_COLORS, hubColors: [{ name: 'Black', hex: '#1d1f23' }], wheels: { [wheel.pos]: { erd: wheel.erd, rimHoles: wheel.n * 2, drive: { n: wheel.n, pcd: wheel.pcdD, cross: wheel.cross }, rotor: { n: wheel.n, pcd: wheel.pcdR, cross: wheel.cross }, nippleColors: NIP_COLORS, nippleColor: 'Black' } } });
  const names = NIP_COLORS.map((c) => c.name);
  for (const side of ['drive', 'rotor']) cfgValue.nipples[wheel.pos][side] = cfgValue.nipples[wheel.pos][side].map((_, k) => names[(k * (side === 'drive' ? 1 : 2)) % names.length]);
  return cfgValue;
}

test('the nipple shapes of wheelSvg equal the theme preview() shapes for 4 wheels (front and rear, 12 to 16 holes per side, both views), every nipple color, at 300 px', (t) => {
  if (skipLive) { t.skip('LOAM_THEME_DIR=skip'); return; }
  const src = themeSource(), Studio = loadStudio(src);
  for (const wheel of WHEELS) {
    const value = mixedValue(Studio, wheel);
    const theirs = themeNipples(Studio, wheel, value, 300), ours = ourNipples(wheel, value, 300);
    assert.ok(theirs.shapes.length > 0, `the theme (${src.origin}) drew no nipples for ${JSON.stringify(wheel)}`);
    assert.equal((theirs.shapes.match(/<rect/g) || []).length, wheel.n * 2, 'one rect per nipple');
    assert.equal(ours.shapes, theirs.shapes, `nipple shapes drifted from the theme (${src.origin}) for ${JSON.stringify(wheel)}`);
  }
});

test('the 140 px rule is the theme\'s: no nipples at 139 px, nipples at 140 px, in the theme and in wheelSvg', (t) => {
  if (skipLive) { t.skip('LOAM_THEME_DIR=skip'); return; }
  const src = themeSource(), Studio = loadStudio(src), wheel = WHEELS[0], value = mixedValue(Studio, wheel);
  for (const [size, drawn] of [[96, false], [139, false], [140, true], [240, true]]) {
    assert.equal(themeNipples(Studio, wheel, value, size).shapes.length > 0, drawn, `theme at ${size} px (${src.origin})`);
    assert.equal(ourNipples(wheel, value, size).shapes.length > 0, drawn, `wheelSvg at ${size} px`);
  }
  assert.equal(NIPPLE.minBox, 140);
});

test('report pictures: nipples are 1.5 times wider and longer than the Studio size, rim-side end unchanged; the Studio size (scale 1) and the default are what the tests above pin', (t) => {
  if (skipLive) { t.skip('LOAM_THEME_DIR=skip'); return; }
  assert.equal(REPORT_NIPPLE_SCALE, 1.5);
  const src = themeSource(), Studio = loadStudio(src), wheel = WHEELS[0], value = mixedValue(Studio, wheel);
  const rects = (shapes) => [...shapes.matchAll(/<rect x="([-\d.]+)" y="([-\d.]+)" width="([-\d.]+)" height="([-\d.]+)" transform="rotate\(([-\d.]+) ([-\d.]+) ([-\d.]+)\)"/g)].map((m) => m.slice(1).map(Number));
  const studio = rects(themeNipples(Studio, wheel, value, 300).shapes), big = rects(ourNipples(wheel, value, 300, REPORT_NIPPLE_SCALE).shapes);
  assert.equal(studio.length, wheel.n * 2, 'the theme drew one nipple per spoke (and the pattern read them all)');
  assert.equal(big.length, studio.length);
  studio.forEach((a, i) => {
    const b = big[i];
    assert.ok(Math.abs(b[2] / a[2] - 1.5) < 0.02, 'length 1.5x');
    assert.ok(Math.abs(b[3] / a[3] - 1.5) < 0.03, 'width 1.5x');
    assert.equal(b[4], a[4], 'same angle');
    // the rim-side end (rotation origin + length along the spoke) stays where the Studio has it
    const end = (r) => { const rad = r[4] * Math.PI / 180; return [r[5] + r[2] * Math.cos(rad), r[6] + r[2] * Math.sin(rad)]; };
    assert.ok(Math.hypot(end(a)[0] - end(b)[0], end(a)[1] - end(b)[1]) < 0.05, 'rim-side end unchanged');
  });
  // wheelSvg's default is the report size; without nipple colors nothing is drawn at all
  const deflt = ourNipples(wheel, value, 300, null);
  assert.equal(deflt.shapes, ourNipples(wheel, value, 300, REPORT_NIPPLE_SCALE).shapes);
});
