// Industry Nine Revive 2.0 Alloy Rim (Gravel), 29" / 24h 2:1 (variant 67984929227059, draft product 15486035657011): maps to I9's own chart row "Revive 24h" TR253 (System 2026 sheet:
// ERD 602.0, offset 0.0, Solix 24h (I9's label "SM/G"), 300 / 298). Same job shape as the Revive 700c row (tests/revive-700c.test.js): one new row in the allowed-list master, one new map entry; nothing else moves.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chartOrder, recipeOf } from './helpers/chart-order.mjs';
import { CHART_ROWS, RIM_VARIANT_MAP, chartLengthsForRim } from '../_lib/i9-system-chart.js';
import { resolveSystemLengths } from '../_lib/system-lengths.js';
import { buildSystemReport } from '../_lib/system-report.js';
import { systemWheels } from '../_lib/system-build.js';
import { buildOrderSheet } from '../_lib/order-sheet.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ALU = '67984929227059';
const CARBON_29 = '67792754475315', CARBON_700C = '67980774637875';
const TITLE = 'Industry Nine Revive 2.0 Alloy Rim (Gravel)';
const png = async () => Buffer.from('PNG');
// what the store holds for the draft variant (read Nov 14): ERD 602.0, washer policy Optional, thickness 0.0, offset 0.0
const metaFor = (erd = '602.0') => new Map([[`gid://shopify/ProductVariant/${ALU}`, { rim_erd: erd, rim_washer_policy: 'Optional', nipple_washer_thickness: '0.0', rim_spoke_hole_offset: '0.0' }]]);
const rimWarnings = (list) => list.filter((w) => !/no Studio value in the recipe/.test(w)); // the synthetic order has no Studio value
function aluOrder(pos, n) {
  const order = chartOrder({ [pos]: { rim: ALU, holes: 24, rimTitle: TITLE }, orderNumber: n });
  const recipe = recipeOf(order);
  recipe.components[`${pos}Rim`] = { ...recipe.components[`${pos}Rim`], vendor: 'Industry Nine', variantTitle: '29" / 24h 2:1 / Black', selectedOptions: [{ name: 'Size', value: '29"' }, { name: 'Spoke Count', value: '24h 2:1' }, { name: 'Color', value: 'Black' }] };
  order.line_items.find((l) => (l.properties || []).some((p) => p.name === '_build')).properties.find((p) => p.name === '_build').value = JSON.stringify(recipe);
  return order;
}
const reportOf = (o, erd) => buildSystemReport({ recipe: recipeOf(o), orderData: o, componentData: metaFor(erd), renderPng: png });

test('the chart maps the alloy Revive variant to I9\'s own row Revive 24h TR253 (ERD 602, offset 0, Solix 24h, I9 label "SM/G", 300 / 298); not borrowed', () => {
  const hit = chartLengthsForRim(ALU);
  assert.ok(hit);
  assert.deepEqual([hit.row.section, hit.row.model, hit.row.partNumber, hit.row.erd, hit.row.rimOffset, hit.row.hub, hit.driveColumn, hit.nonDriveColumn], ['Solix Aluminum Rims', 'Revive 24h', 'TR253', 602, 0, 'SM/G', 300, 298]);
  assert.equal(Boolean(hit.borrowed), false, 'an I9-listed combination');
  assert.match(hit.variantTitle, /Industry Nine Revive 2\.0 Alloy Rim \(Gravel\) 29" \/ 24h 2:1 \/ Black/);
  assert.equal(chartLengthsForRim(`gid://shopify/ProductVariant/${ALU}`).row.partNumber, 'TR253');
  assert.equal(CHART_ROWS[RIM_VARIANT_MAP[ALU].row].partNumber, 'TR253');
});

test('the CSV master has the new id once, allowed, with the numbers of the TR253 row; the carbon Revive ids still map to TR313 (302 / 298)', () => {
  const csv = fs.readFileSync(path.join(here, '..', 'data', 'i9-source', 'I9_SYSTEM_ALLOWED_LIST.csv'), 'utf8').split(/\r?\n/);
  const row = csv.filter((l) => l.startsWith(`${ALU},`));
  assert.equal(row.length, 1);
  assert.ok(row[0].includes(',"29"" / 24h 2:1 / Black",true,Revive 24h TR253 SM/G erd 602 off 0,300,298,'));
  for (const id of [CARBON_29, CARBON_700C]) { const c = chartLengthsForRim(id); assert.deepEqual([c.row.partNumber, c.row.erd, c.driveColumn, c.nonDriveColumn], ['TR313', 602.5, 302, 298], id); }
  assert.equal(Object.values(RIM_VARIANT_MAP).filter((e) => !e.estimated).length, 29, 'exactly one entry was added (the estimated rims of 2026-11-14 are counted separately)');
});

test('worked example, Solix 24h REAR with this rim: rotor side 298 mm (8 spokes), drive side 300 mm (16 spokes), source line TR253, no warning, no "check ERD" flag', async () => {
  const o = aluOrder('rear', 97001);
  const r = await reportOf(o);
  const l = r.lengths.rear;
  assert.equal(l.pending, false);
  assert.deepEqual([l.left, l.right], [298, 300]);       // left = rotor side, right = drive side
  assert.match(l.sourceText, /I9 System chart 2026, row Revive 24h TR253/);
  assert.equal(l.extra, null);
  assert.deepEqual(rimWarnings(r.warnings), []); assert.deepEqual(r.imageErrors, []);
  assert.match(r.note, /Rotor side {2}298 mm: {2}8 Black/); assert.match(r.note, /Drive side {2}300 mm: {2}16 Black/);
  assert.ok(!r.note.includes('Lengths not calculated'));
  const g = systemWheels(recipeOf(o), metaFor(), o)[0].geometryInput;
  assert.equal(g.erd, 602); assert.equal(g.holes, 24);
  const res = resolveSystemLengths(g); assert.equal(res.reason, null); assert.equal(res.lengths.note, undefined);
});

test('FRONT Solix wheel with this rim: the same two numbers on the mirrored sides (rotor 300, drive 298), with the usual "inferred" front-Solix note; and the ERD flag stays quiet at 602', async () => {
  const r = await reportOf(aluOrder('front', 97002));
  const l = r.lengths.front;
  assert.deepEqual([l.left, l.right], [300, 298]);
  assert.match(l.extra, /front side mapping inferred from geometry, verify against I9/);
  assert.doesNotMatch(l.extra, /check ERD|store ERD/);
  // effective ERD: washer policy Optional with thickness 0.0 adds nothing (final ERD = 602.0 + 2 x 0.0), equal to the chart row's 602
  assert.equal(602.0 + 2 * 0.0, CHART_ROWS[RIM_VARIANT_MAP[ALU].row].erd);
});

test('the flag does fire if the store ERD drifts more than 0.5 mm from the chart row (a stored 603 prints "check ERD"), as for every chart rim', async () => {
  const r = await reportOf(aluOrder('rear', 97003), '603.0');
  assert.match(r.lengths.rear.extra, /store ERD 603 vs I9 chart 602/); assert.match(r.lengths.rear.extra, /confirm with I9/);
});

test('the report, the I9 order list and the order sheet name the rim with its I9 code and produce no NOT CALCULATED', async () => {
  const o = aluOrder('rear', 97004);
  const r = await reportOf(o);
  assert.equal(r.wheels[0].rimTitle, `${TITLE} - 29"`);
  const list = r.i9OrderList.text; const rimLine = list.split('\n').find((x) => /Revive 2\.0 Alloy/.test(x));
  assert.ok(rimLine, list); assert.match(rimLine, /I9 code TR253/); assert.doesNotMatch(rimLine, /probably not sold|borrowed|customer-supplied/i);
  assert.equal(/length not calculated|NOT CALCULATED/i.test(list), false);
  const sheet = buildOrderSheet({ orderData: o, componentData: metaFor(), calculatedAt: '2026-11-14T12:00:00.000Z' });
  assert.equal(sheet.wheels[0].lengths.status, 'calculated'); assert.deepEqual([sheet.wheels[0].lengths.rotorMm, sheet.wheels[0].lengths.driveMm], [298, 300]);
  assert.equal(sheet.wheels[0].lengths.chart.partNumber, 'TR253');
  assert.deepEqual(rimWarnings(sheet.warnings), []);
});

test('a hub that does not match the row (a 28h Hydra2 wheel with this 24h Solix rim) is still NOT CALCULATED with the plain reason', async () => {
  const o = chartOrder({ rear: { rim: ALU, holes: 32, hub: 'Hydra2', rimTitle: TITLE }, orderNumber: 97005 });
  const r = await buildSystemReport({ recipe: recipeOf(o), orderData: o, componentData: metaFor(), renderPng: png });
  assert.equal(r.lengths.rear.pending, true); assert.match(r.lengths.rear.text, /does not match the hub in I9's chart row/);
});
