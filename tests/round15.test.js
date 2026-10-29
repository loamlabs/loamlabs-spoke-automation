// Round 15: the valve color of each wheel comes from the build's valve stem component (components.frontValveStem / rearValveStem, option "Color").
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chartOrder, recipeOf } from './helpers/chart-order.mjs';
import { loadSample } from './helpers/webhook-harness.mjs';
import { systemWheels, hexFor } from '../_lib/system-build.js';
import { findStandardStudioRecipe, standardWheels } from '../_lib/standard-build.js';
import { buildSystemReport, renderWheelImages } from '../_lib/system-report.js';
import { buildStandardAdditions } from '../_lib/standard-report.js';
import { geometry } from '../_lib/studio-geometry.js';
import { wheelSvg, mixHex, VALVE_EDGE } from '../_lib/wheel-svg.js';
import { loadRing } from '../_lib/rim-rings.js';
import { svgToPng } from '../_lib/wheel-png.js';
import { VALVE_COLOR_MAP } from '../_lib/valve-color-map.js';
import { valveColorFor, valveColorInfo, valveFieldsFor, valveColorTextOf, unknownValveColorText, VALVE_DEFAULT_HEX } from '../_lib/valve-colors.js';

const MAP_JSON = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'loamlabs-system-builder', 'agent-prompts', 'valve-colors', 'valve_color_map.json');
const png = async () => Buffer.from('PNG');
const WAO_TITLE = 'We Are One FUSE Carbon Rim (Enduro)', I9_TITLE = 'Industry Nine Sector Alloy Rim (Trail)';
const COLORS = Object.keys(VALVE_COLOR_MAP).filter((k) => k !== 'default');
const valve = (color, title = "Peaty's Tubeless Valve", len = '42mm') => ({ variantId: 'gid://shopify/ProductVariant/7001', title, vendor: "Peaty's", variantTitle: `${color} / ${len}`, selectedOptions: [{ name: 'Color', value: color }, { name: 'Length', value: len }] });
const brightness = (hex) => { const n = parseInt(hex.slice(1), 16); return (0.299 * (n >> 16 & 255) + 0.587 * (n >> 8 & 255) + 0.114 * (n & 255)) / 255; };

// a System wheel set with the given valve components (undefined = none)
const sysOrder = (rimTitle = WAO_TITLE) => chartOrder({ front: { rim: '51797702934835', holes: 28, rimTitle }, rear: { rim: '51797702967603', holes: 32, rimTitle }, orderNumber: 91700 });
const sysWheels = (front, rear, rimTitle) => {
  const order = sysOrder(rimTitle), recipe = recipeOf(order);
  if (front !== undefined) recipe.components.frontValveStem = front;
  if (rear !== undefined) recipe.components.rearValveStem = rear;
  return { order, recipe, wheels: systemWheels(recipe, null, order) };
};
const stdWheels = (front, rear) => {
  const order = loadSample('standard', 'std-steel-wheelset-solid'), recipe = findStandardStudioRecipe(order).recipe;
  if (front !== undefined) recipe.components.frontValveStem = front;
  if (rear !== undefined) recipe.components.rearValveStem = rear;
  return { order, recipe, wheels: standardWheels(recipe, new Map(Object.entries(order._sample.metafields)), order) };
};
const withLogs = async (fn) => { const lines = [], orig = console.log; console.log = (...a) => { lines.push(a.join(' ')); }; try { return { result: await fn(), lines }; } finally { console.log = orig; } };

/* ----------------------------------------------------------------- the map and the lookup */

test('map: the generated module equals Agent C\'s valve_color_map.json (30 colors + default), keys lower-cased and trimmed', () => {
  assert.equal(COLORS.length, 30);
  assert.equal(VALVE_DEFAULT_HEX, '#2b2b2b');
  assert.ok(COLORS.every((k) => k === k.toLowerCase().trim() && /^#[0-9a-f]{6}$/.test(VALVE_COLOR_MAP[k].hex)));
  if (fs.existsSync(MAP_JSON)) {
    const j = JSON.parse(fs.readFileSync(MAP_JSON, 'utf8'));
    assert.deepEqual(Object.keys(VALVE_COLOR_MAP).sort(), Object.keys(j).sort());
    for (const k of COLORS) {
      assert.equal(VALVE_COLOR_MAP[k].hex, j[k].hex.toLowerCase(), k);
      assert.equal(VALVE_COLOR_MAP[k].light, j[k].light === true, k);
      assert.equal(VALVE_COLOR_MAP[k].approximate, j[k].approximate === true, k);
    }
    assert.equal(VALVE_COLOR_MAP.default.hex, j.default.hex.toLowerCase());
  }
});

test('valveColorFor: all 30 values, case / space insensitive; unknown, missing or odd input is the default dark and never throws', () => {
  for (const k of COLORS) {
    assert.equal(valveColorFor(k), VALVE_COLOR_MAP[k].hex, k);
    assert.equal(valveColorFor(k.toUpperCase()), VALVE_COLOR_MAP[k].hex, 'upper ' + k);
    assert.equal(valveColorFor(`  ${k.replace(/\b./g, (c) => c.toUpperCase())}\t`), VALVE_COLOR_MAP[k].hex, 'title case + padding ' + k);
    assert.equal(valveColorInfo(k).known, true);
  }
  assert.equal(valveColorFor('Sasquatch (Yeti)'), '#14a6b0');
  assert.equal(valveColorFor('Sterling   Silver'), VALVE_COLOR_MAP['sterling silver'].hex, 'inner whitespace collapsed');
  for (const bad of [undefined, null, '', '   ', 'Chartreuse', 'default', 'DEFAULT', 'constructor', '__proto__', 'toString', 'hasOwnProperty', 42, 0, NaN, {}, [], ['Red'], () => 1, Symbol('x'), true, 'Red / 42mm']) {
    let got; assert.doesNotThrow(() => { got = valveColorFor(bad); }, String(typeof bad));
    assert.equal(got, '#2b2b2b', 'default for ' + String(typeof bad === 'symbol' ? 'symbol' : bad));
    assert.equal(valveColorInfo(bad).known, false);
  }
  assert.equal(valveColorInfo('silver').light, true);
  assert.equal(valveColorInfo('sterling silver').light, true);
  assert.equal(valveColorInfo('gold').light, false, 'gold is not flagged light in the map (the brightness rule catches it)');
});

test('valveFieldsFor / valveColorTextOf: Color option (any case of the name); none, odd or unknown components never throw', () => {
  assert.equal(valveColorTextOf(valve('Red')), 'Red');
  assert.equal(valveColorTextOf({ selectedOptions: [{ name: ' color ', value: 'Gold' }] }), 'Gold');
  for (const bad of [null, undefined, 0, 'x', [], {}, { selectedOptions: 'x' }, { selectedOptions: [null, 3, {}] }, { selectedOptions: [{ name: 'Color', value: 7 }] }]) assert.equal(valveColorTextOf(bad), null);
  assert.deepEqual(valveFieldsFor(null), { valveColor: '#2b2b2b', valveLight: false, valveColorText: null, valveColorUnknown: false });
  assert.deepEqual(valveFieldsFor(valve('Red')), { valveColor: '#c8202f', valveLight: false, valveColorText: 'Red', valveColorUnknown: false });
  assert.deepEqual(valveFieldsFor(valve('Silver')), { valveColor: '#b8bcc2', valveLight: true, valveColorText: 'Silver', valveColorUnknown: false });
  assert.deepEqual(valveFieldsFor(valve('Chartreuse')), { valveColor: '#2b2b2b', valveLight: false, valveColorText: 'Chartreuse', valveColorUnknown: true });
  assert.equal(valveFieldsFor({ title: 'Valve', variantTitle: 'Red / 42mm' }).valveColorUnknown, true, 'a valve with no Color option is not guessed from the variant title');
  assert.equal(unknownValveColorText('Chartreuse'), 'unknown valve color: Chartreuse');
  assert.equal(unknownValveColorText(null), 'unknown valve color: (none)');
  assert.equal(unknownValveColorText('a\nb\r\nc'.repeat(30)).includes('\n'), false, 'log-safe');
  assert.ok(unknownValveColorText('x'.repeat(500)).length < 90);
});

/* ----------------------------------------------------------------- where the color comes from, per wheel */

for (const [kind, make] of [['System', sysWheels], ['Standard', stdWheels]]) {
  test(`${kind} orders: each wheel's valve color comes from its own valve stem component (front and rear can differ)`, () => {
    const { wheels } = make(valve('Red'), valve('Turquoise'));
    assert.deepEqual(wheels.map((w) => [w.position, w.valveColor, w.valveColorText]), [['front', '#c8202f', 'Red'], ['rear', '#14a6b0', 'Turquoise']]);
    assert.ok(wheels.every((w) => !w.valveColorUnknown));
    // the same valve for both
    assert.deepEqual(make(valve('Gold'), valve('Gold')).wheels.map((w) => w.valveColor), ['#c9a227', '#c9a227']);
    // swapped: front and rear are not mixed up
    assert.deepEqual(make(valve('Turquoise'), valve('Red')).wheels.map((w) => w.valveColor), ['#14a6b0', '#c8202f']);
  });

  test(`${kind} orders: no valve stem on one or both wheels is the default dark valve (nothing logged as unknown); only the front or only the rear`, () => {
    for (const [f, r, expF, expR] of [[null, null, '#2b2b2b', '#2b2b2b'], [undefined, undefined, '#2b2b2b', '#2b2b2b'], [valve('Red'), null, '#c8202f', '#2b2b2b'], [null, valve('Gold'), '#2b2b2b', '#c9a227'], [valve('Silver'), undefined, '#b8bcc2', '#2b2b2b']]) {
      const { wheels } = make(f, r);
      assert.deepEqual(wheels.map((w) => w.valveColor), [expF, expR]);
      assert.ok(wheels.every((w) => !w.valveColorUnknown), 'a wheel without a valve is not an unknown color');
    }
  });

  test(`${kind} orders: a valve whose Color is not in the map, or has no Color option, is the default dark valve and is flagged unknown`, () => {
    const { wheels } = make(valve('Chartreuse'), { title: 'Mystery valve', variantTitle: 'Red / 42mm', selectedOptions: [] });
    assert.deepEqual(wheels.map((w) => [w.valveColor, w.valveColorUnknown, w.valveColorText]), [['#2b2b2b', true, 'Chartreuse'], ['#2b2b2b', true, null]]);
  });
}

test('included / free valves: a valve stem that is only in the build (no physical order line) is used as it is', () => {
  // the build is all the backend looks at; the order's own line items are not consulted for valves, so a build-only valve (preset builds) colors the wheel
  const { order, recipe, wheels } = sysWheels(valve('Navy', 'Reserve Fillmore Valve Stem', '50mm'), valve('Navy', 'Reserve Fillmore Valve Stem', '50mm'));
  assert.ok(!order.line_items.some((l) => /valve/i.test(l.title)), 'no valve line item in this order');
  assert.ok(recipe.components.frontValveStem && recipe.components.rearValveStem);
  assert.deepEqual(wheels.map((w) => w.valveColor), ['#1e2f5a', '#1e2f5a']);
});

/* ----------------------------------------------------------------- the pictures */

test('reports: each wheel\'s pictures carry its own valve color (System and Standard), the plain-rim fallback has no valve path, an unknown color logs one line and draws the default', async () => {
  const { order, recipe } = sysWheels(valve('Red'), valve('Turquoise'));
  const rep = await buildSystemReport({ recipe, orderData: order, renderPng: png });
  const colorsIn = (pos) => [...new Set(rep.images.filter((i) => i.position === pos).map((i) => /data-valve="([^"]+)"/.exec(i.svg)[1]))];
  assert.deepEqual(colorsIn('front'), ['#c8202f']); assert.deepEqual(colorsIn('rear'), ['#14a6b0']);
  assert.ok(rep.images.every((i) => (i.svg.match(/data-valve/g) || []).length === 1));

  const std = stdWheels(valve('Gold'), valve('Silver'));
  const add = await buildStandardAdditions({ recipe: std.recipe, orderData: std.order, componentData: new Map(Object.entries(std.order._sample.metafields)), renderPng: png });
  const stdImgs = add && add.images ? add.images : [];
  if (stdImgs.length) {
    const c = (pos) => [...new Set(stdImgs.filter((i) => i.position === pos).map((i) => /data-valve="([^"]+)"/.exec(i.svg)[1]))];
    assert.deepEqual([c('front'), c('rear')], [['#c9a227'], ['#b8bcc2']]);
  }

  const plain = await buildSystemReport({ recipe, orderData: order, renderPng: png, rimRings: false });
  assert.ok(plain.images.every((i) => !/data-valve/.test(i.svg)), 'plain rim: old stem, no valve color');

  const { lines } = await withLogs(async () => buildSystemReport({ recipe: sysWheels(valve('Chartreuse'), valve('Red')).recipe, orderData: order, renderPng: png }));
  const unknown = lines.filter((l) => /unknown valve color/.test(l));
  assert.equal(unknown.length, 1, 'one line for the one unknown wheel: ' + JSON.stringify(lines));
  assert.match(unknown[0], /unknown valve color: Chartreuse/);
  const { lines: quiet } = await withLogs(async () => buildSystemReport({ recipe: sysWheels(valve('Red'), null).recipe, orderData: order, renderPng: png }));
  assert.ok(!quiet.some((l) => /unknown valve color/.test(l)), 'no line for known colors or a missing valve');
});

test('real renderer: a colored valve renders in a real PNG (pixels of the stem are the chosen color)', async () => {
  const { wheels } = sysWheels(valve('Red'), valve('Turquoise'));
  for (const w of wheels) {
    const r = await renderWheelImages(w, svgToPng, 600);
    assert.equal(r.errors.length, 0);
    assert.ok(r.images.length > 0 && r.images.every((i) => i.png.length > 20000));
    assert.ok(r.images.every((i) => i.svg.includes(`data-valve="${w.position === 'front' ? '#c8202f' : '#14a6b0'}"`)));
  }
});

/* ----------------------------------------------------------------- task 2: the light edge */

test('light valves get a 0.6 px darker edge (silver, sterling silver, and any color brighter than 50%); dark and mid colors get none; all 30 map colors', async () => {
  assert.equal(VALVE_EDGE, 0.6);
  const { wheels } = sysWheels(null, null);
  const w = wheels[0], ring = await loadRing('wao', 'front');
  const geom = geometry({ wheels: { [w.position]: w.config } })[w.position];
  const draw = (hex, light) => wheelSvg({ config: w.config, geom, colorsHex: { drive: w.colors.drive.map(hexFor), rotor: w.colors.rotor.map(hexFor) }, hubHex: w.hubColorHex, pov: 'drive', sides: ['drive', 'rotor'], size: 240, ring, valveColor: hex, valveLight: light });
  let withEdge = [], without = [];
  for (const k of COLORS) {
    const e = VALVE_COLOR_MAP[k], svg = draw(e.hex, e.light), tag = /<path data-valve="[^"]+"[^>]*\/>/.exec(svg)[0];
    const expected = e.light === true || brightness(e.hex) > 0.5;
    assert.equal(/stroke=/.test(tag), expected, `${k} ${e.hex} brightness ${brightness(e.hex).toFixed(2)}`);
    if (expected) {
      assert.match(tag, new RegExp(`stroke="${mixHex(e.hex, '#000000', 0.5)}" stroke-width="0\\.6"`));
      withEdge.push(k);
    } else without.push(k);
  }
  for (const k of ['silver', 'sterling silver', 'gold', 'matte mango']) assert.ok(withEdge.includes(k), k + ' has the edge');
  for (const k of ['black', 'navy', 'red', 'purple', 'eggplant']) assert.ok(without.includes(k), k + ' has no edge');
  // the flag alone is enough, even for a dark color
  assert.match(draw('#2b2b2b', true), /<path data-valve="#2b2b2b"[^>]*stroke-width="0\.6"/);
  console.log('edge 0.6 px:', withEdge.join(', '), '| no edge:', without.join(', '));
});
