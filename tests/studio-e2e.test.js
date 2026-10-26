// I9-SYSTEM: end-to-end check between the REAL Studio and the email images.
// tests/fixtures/studio-e2e-capture.json was recorded by scripts/studio-e2e/capture.mjs: the theme's own spoke-studio.js was driven with real
// clicks (pattern buttons and individual spoke paints) and, for each wheel, the saved value plus the position of every drawn spoke in three views
// were written down. Here the saved value goes through OUR pipeline (recipe -> buildSystemReport -> the SVG of each image) and every spoke is
// compared: same hub hole, same RIM HOLE, same color. Re-record after a Studio change with: node scripts/studio-e2e/capture.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSample } from './helpers/webhook-harness.mjs';
import { findSystemBuildRecipe, SYSTEM_COLOR_HEX } from '../_lib/system-build.js';
import { buildSystemReport } from '../_lib/system-report.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const capture = JSON.parse(fs.readFileSync(path.join(here, 'fixtures', 'studio-e2e-capture.json'), 'utf8'));
const png = async () => Buffer.from('x');
const HEX_TO_NAME = Object.fromEntries(Object.entries(SYSTEM_COLOR_HEX).map(([n, h]) => [h.toLowerCase(), n]));

const angleOf = (x, y, c) => ((Math.atan2(x - c, -(y - c)) * 180 / Math.PI) + 360) % 360;
const angDiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

// spokes of an SVG as the image draws them: { side: [{ hub, rim, ratio, color }] } in the view's own frame
function spokesOfSvg(svg) {
  const box = Number(/<svg[^>]* width="([\d.]+)"/.exec(svg)[1]), c = box / 2, out = {};
  for (const g of svg.matchAll(/<g data-side="(drive|rotor)">([\s\S]*?)<\/g>/g)) {
    const lines = [...g[2].matchAll(/<line x1="([-\d.]+)" y1="([-\d.]+)" x2="([-\d.]+)" y2="([-\d.]+)" stroke="([^"]+)"/g)].map((m) => ({ x1: +m[1], y1: +m[2], x2: +m[3], y2: +m[4], stroke: m[5] }));
    out[g[1]] = [];
    for (let k = 0; k < lines.length; k += 2) { // edge line, then the color line
      const l = lines[k + 1];
      out[g[1]].push({ k: k / 2, hub: angleOf(l.x1, l.y1, c), rim: angleOf(l.x2, l.y2, c), ratio: Math.hypot(l.x1 - c, l.y1 - c) / Math.hypot(l.x2 - c, l.y2 - c), color: l.stroke });
    }
  }
  return out;
}
const hubColorOfSvg = (svg) => /<radialGradient id="hubshine"[\s\S]*?<stop offset="1" stop-color="(#[0-9a-f]{6})"/i.exec(svg)[1];

// Compares one Studio view with one email image; returns a list of mismatch descriptions (empty = identical)
function compareView(label, studio, svg, holes) {
  const mine = spokesOfSvg(svg), bad = [];
  const studioSides = Object.keys(studio.spokes).sort(), mineSides = Object.keys(mine).sort();
  if (studioSides.join() !== mineSides.join()) return [`${label}: sides drawn differ (Studio ${studioSides}, image ${mineSides})`];
  for (const side of studioSides) {
    if (studio.spokes[side].length !== mine[side].length) { bad.push(`${label} ${side}: ${studio.spokes[side].length} spokes in the Studio, ${mine[side].length} in the image`); continue; }
    studio.spokes[side].forEach((s, k) => {
      const m = mine[side][k], hole = (a) => (((Math.round(a * holes / 360 - 0.5)) % holes) + holes) % holes;
      if (hole(s.rim) !== hole(m.rim)) bad.push(`${label} ${side} k=${k}: rim hole ${hole(s.rim)} in the Studio, ${hole(m.rim)} in the image`);
      if (angDiff(s.rim, m.rim) > 0.05) bad.push(`${label} ${side} k=${k}: rim angle ${s.rim} vs ${m.rim.toFixed(3)}`);
      if (angDiff(s.hub, m.hub) > 0.4) bad.push(`${label} ${side} k=${k}: hub hole angle ${s.hub} vs ${m.hub.toFixed(3)}`);
      if (Math.abs(s.ratio - m.ratio) > 0.004) bad.push(`${label} ${side} k=${k}: hub radius ratio ${s.ratio} vs ${m.ratio.toFixed(4)}`);
      if (s.color.toLowerCase() !== m.color.toLowerCase()) bad.push(`${label} ${side} k=${k}: color ${s.color} vs ${m.color}`);
    });
  }
  if (studio.hubColor.toLowerCase() !== hubColorOfSvg(svg).toLowerCase()) bad.push(`${label}: hub color ${studio.hubColor} vs ${hubColorOfSvg(svg)}`);
  return bad;
}

// The Studio's saved value goes into the sample order's recipe (the same place the real builder writes it), then through the real report code.
async function imagesFor(result, mutate) {
  const order = loadSample('system', result.sample), prop = order.line_items[0].properties.find((p) => p.name === '_build');
  const recipe = JSON.parse(prop.value), pos = result.position, v = JSON.parse(JSON.stringify(result.value));
  if (mutate) mutate(v);
  recipe.system.studio.spokes[pos] = v.spokes[pos];
  recipe.system.studio.base[pos] = v.base[pos];
  recipe.system.studio.hubColor[pos] = v.hubColor[pos];
  const report = await buildSystemReport({ recipe, orderData: { order_number: 1 }, renderPng: png });
  const byCid = Object.fromEntries(report.images.map((i) => [i.cid, i.svg]));
  return { byCid, report };
}

test('the capture is from the current theme and covers Solix 24h front and rear plus Hydra2 front 28h / 32h and rear 32h', () => {
  assert.ok(capture.themeCommit && capture.studioJsSha1);
  const ids = capture.results.map((r) => r.id);
  for (const want of ['solix24-front-pattern-2x1-or-2x2', 'solix24-front-pattern-every-3rd-or-4th', 'solix24-front-every-spoke-painted', 'solix24-rear-pattern-2x1-or-2x2', 'solix24-rear-pattern-every-3rd-or-4th',
    'solix24-rear-every-spoke-painted', 'hydra2-front32-pattern-2x1-or-2x2', 'hydra2-rear32-every-spoke-painted', 'hydra2-front28-every-spoke-painted']) assert.ok(ids.includes(want), want);
  // the Studio value really carries the pattern that was painted (harness sanity): its colors are exactly what the Studio drew
  for (const r of capture.results) for (const side of ['drive', 'rotor']) r.value.spokes[r.position][side].forEach((name, k) => assert.equal(HEX_TO_NAME[r.views.all.spokes[side][k].color.toLowerCase()], name, `${r.id} ${side} k=${k}`));
});

for (const r of capture.results) {
  test(`Studio vs email image, every spoke on the same hub hole, rim hole and color: ${r.id}`, async () => {
    const { byCid, report } = await imagesFor(r);
    assert.deepEqual(report.imageErrors, []);
    const pos = r.position, high = r.highSide, low = r.lowSide;
    assert.equal(r.views.highOnly.spokes[high].length + r.views.lowOnly.spokes[low].length, r.total);
    const problems = [
      ...compareView(`${pos} ${high}-side spokes only`, r.views.highOnly, byCid[`${pos}-${high}-only`], r.total),
      ...compareView(`${pos} ${low}-side spokes only`, r.views.lowOnly, byCid[`${pos}-${low}-only`], r.total),
      ...compareView(`${pos} all spokes (${high} view)`, r.views.all, byCid[`${pos}-all-spokes`], r.total)
    ];
    assert.deepEqual(problems, [], problems.slice(0, 6).join('\n'));
  });
}

test('the comparison is not vacuous: shifting the saved colors by one spoke, or swapping two sides, is detected', async () => {
  const r = capture.results.find((x) => x.id === 'solix24-rear-every-spoke-painted');
  const shifted = await imagesFor(r, (v) => { const a = v.spokes[r.position].drive; a.push(a.shift()); });
  const bad = compareView('shifted', r.views.highOnly, shifted.byCid[`${r.position}-${r.highSide}-only`], r.total);
  assert.ok(bad.length >= 10, `a one-spoke shift must be caught, got ${bad.length} mismatches`);
  const swapped = await imagesFor(r, (v) => { const s = v.spokes[r.position]; [s.drive, s.rotor] = [s.rotor.concat(s.rotor).slice(0, s.drive.length), s.drive.slice(0, s.rotor.length)]; });
  assert.ok(compareView('swapped', r.views.highOnly, swapped.byCid[`${r.position}-${r.highSide}-only`], r.total).length > 0);
});
