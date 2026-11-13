// Revive 2.0 700c / 24h 2:1 (variant 67980774637875) is the twin of the 29" / 24h 2:1 variant (67792754475315): same rim, same ERD 602.5, same I9 chart row (TR313, Solix 24h). The 700c / 28h variant
// (67980775063859) is NOT in the System builder and must NOT be mapped.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chartOrder, recipeOf } from './helpers/chart-order.mjs';
import { CHART_ROWS, RIM_VARIANT_MAP, chartLengthsForRim } from '../_lib/i9-system-chart.js';
import { resolveSystemLengths, systemLengthsNotCalculatedText } from '../_lib/system-lengths.js';
import { buildSystemReport } from '../_lib/system-report.js';
import { systemWheels } from '../_lib/system-build.js';
import { buildOrderSheet } from '../_lib/order-sheet.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const TWIN_29 = '67792754475315', REVIVE_700C_24H = '67980774637875', REVIVE_700C_28H = '67980775063859';
const WANDERER = ['67796583547187', '51901420699955']; // the pattern: two variant ids, one chart row
const png = async () => Buffer.from('PNG');
const TITLE = 'We Are One REVIVE 2.0 Carbon Rim (Gravel)';

// a Solix 24h rear wheel with the Revive rim; the recipe carries what the theme sends for the chosen variant (size option and variant title)
function reviveOrder(variantId, size, n) {
  const order = chartOrder({ rear: { rim: variantId, holes: 24, rimTitle: TITLE }, orderNumber: n });
  const recipe = recipeOf(order);
  recipe.components.rearRim = { ...recipe.components.rearRim, vendor: 'We Are One', variantTitle: `${size} / 24h 2:1 / Black`, selectedOptions: [{ name: 'Size', value: size }, { name: 'Spoke Count', value: '24h 2:1' }, { name: 'Color', value: 'Black' }] };
  const line = order.line_items.find((l) => (l.properties || []).some((p) => p.name === '_build'));
  line.properties.find((p) => p.name === '_build').value = JSON.stringify(recipe);
  return order;
}
const metaFor = (variantId) => new Map([[`gid://shopify/ProductVariant/${variantId}`, { rim_erd: '602.5' }]]); // the store holds ERD 602.5 for both
// the synthetic order of chart-order.mjs has no Studio value, so every report of it carries that one warning; anything else would be about the rim
const rimWarnings = (list) => list.filter((w) => !/no Studio value in the recipe/.test(w));
const reportOf = (order, variantId) => buildSystemReport({ recipe: recipeOf(order), orderData: order, componentData: metaFor(variantId), renderPng: png });

test('the chart and the allowed list map the 700c 24h 2:1 id to the SAME row as the 29" twin (like the two Wanderer ids)', () => {
  const a = chartLengthsForRim(TWIN_29), b = chartLengthsForRim(REVIVE_700C_24H);
  assert.ok(a && b);
  assert.equal(RIM_VARIANT_MAP[REVIVE_700C_24H].row, RIM_VARIANT_MAP[TWIN_29].row);
  assert.equal(b.row, a.row);
  assert.deepEqual([b.row.partNumber, b.row.erd, b.row.hub, b.driveColumn, b.nonDriveColumn], ['TR313', 602.5, 'SG', 302, 298]);
  assert.equal(Boolean(b.borrowed), false, 'an I9-listed combination, not a borrowed row');
  assert.match(b.variantTitle, /700c \/ 24h 2:1/); assert.match(a.variantTitle, /29" \/ 24h 2:1/);
  assert.equal(RIM_VARIANT_MAP[WANDERER[0]].row, RIM_VARIANT_MAP[WANDERER[1]].row, 'the pattern copied');
  assert.equal(CHART_ROWS[RIM_VARIANT_MAP[REVIVE_700C_24H].row].partNumber, 'TR313');
  // a gid works too, like every other id
  assert.ok(chartLengthsForRim(`gid://shopify/ProductVariant/${REVIVE_700C_24H}`));
});

test('the CSV in data/i9-source has the new id once, allowed, with the numbers of the twin; the 700c 28h id is in neither the CSV nor the map', () => {
  const csv = fs.readFileSync(path.join(here, '..', 'data', 'i9-source', 'I9_SYSTEM_ALLOWED_LIST.csv'), 'utf8').split(/\r?\n/);
  const row = (id) => csv.filter((l) => l.startsWith(`${id},`));
  assert.equal(row(REVIVE_700C_24H).length, 1);
  assert.match(row(REVIVE_700C_24H)[0], /,700c \/ 24h 2:1 \/ Black,true,Revive 24h TR313 SG erd 602\.5 off 0,302,298,/);
  assert.equal(row(REVIVE_700C_28H).length, 0, 'the 700c 28h variant is not in the allowed list');
  assert.equal(chartLengthsForRim(REVIVE_700C_28H), null);
  assert.equal(Object.prototype.hasOwnProperty.call(RIM_VARIANT_MAP, REVIVE_700C_28H), false);
});

test('a System order with the 700c variant gets the same rim row, ERD and spoke lengths as an order with the 29" twin, and no warning', async () => {
  const twin = reviveOrder(TWIN_29, '29"', 96001), seven = reviveOrder(REVIVE_700C_24H, '700c', 96002);
  const rt = await reportOf(twin, TWIN_29), r7 = await reportOf(seven, REVIVE_700C_24H);
  const lt = rt.lengths.rear, l7 = r7.lengths.rear;
  assert.equal(lt.pending, false); assert.equal(l7.pending, false);
  assert.deepEqual([l7.left, l7.right, l7.sourceText, l7.chart, l7.confidence], [lt.left, lt.right, lt.sourceText, lt.chart, lt.confidence]);
  assert.equal(l7.chart.partNumber, 'TR313'); assert.equal(l7.chart.erd, 602.5); assert.match(l7.sourceText, /TR313/);
  // the same through the library, with and without the store's ERD (no "check ERD" flag: the store holds 602.5 for both)
  const w = (o, id) => systemWheels(recipeOf(o), metaFor(id), o)[0].geometryInput;
  const a = resolveSystemLengths(w(twin, TWIN_29)), b = resolveSystemLengths(w(seven, REVIVE_700C_24H));
  assert.deepEqual(b.lengths, a.lengths); assert.equal(b.reason, null); assert.equal(b.lengths.note, undefined);
  assert.equal(w(seven, REVIVE_700C_24H).erd, 602.5);
  // no warnings of any kind on either report, and the same note lengths
  assert.deepEqual(r7.warnings, rt.warnings); assert.deepEqual(rimWarnings(r7.warnings), []);
  assert.equal(r7.note.replace(/700c/g, '29"'), rt.note.replace(/29"/g, '29"'), 'the order note differs only in the size label');
});

test('read-only check: the spoke report, the note and the I9 order list name the rim with its 700c label (not 29") and produce no warning', async () => {
  const order = reviveOrder(REVIVE_700C_24H, '700c', 96003);
  const report = await reportOf(order, REVIVE_700C_24H);
  const wheel = report.wheels[0];
  assert.equal(wheel.rimTitle, `${TITLE} - 700c`);
  assert.ok(report.html.includes(`${TITLE} - 700c`), 'the internal email names the rim with 700c');
  assert.equal(report.html.includes(`${TITLE} - 29&quot;`) || report.html.includes(`${TITLE} - 29"`), false);
  assert.deepEqual(rimWarnings(report.warnings), []); assert.deepEqual(report.imageErrors, []);
  const list = report.i9OrderList.text;
  assert.match(list, /E\. RIMS/); const rimLine = list.split('\n').find((l) => /REVIVE 2\.0/.test(l));
  assert.ok(rimLine, list); assert.match(rimLine, /700c/); assert.match(rimLine, /I9 code TR313/); assert.equal(/probably not sold|not on I9|customer-supplied|borrowed/i.test(rimLine), false, rimLine);
  assert.equal(/length not calculated|NOT CALCULATED/i.test(list), false);
  // the order sheet (dashboard) says the same
  const sheet = buildOrderSheet({ orderData: order, componentData: metaFor(REVIVE_700C_24H), calculatedAt: '2026-11-13T12:00:00.000Z' });
  assert.equal(sheet.wheels[0].rimTitle, `${TITLE} - 700c`); assert.equal(sheet.wheels[0].lengths.status, 'calculated'); assert.equal(sheet.wheels[0].lengths.chart.partNumber, 'TR313');
  assert.deepEqual(rimWarnings(sheet.warnings), []);
});

test('an order with the 700c 28h id (not in the System builder, not mapped) is NOT CALCULATED with the plain reason, as for any unlisted rim', async () => {
  const order = reviveOrder(REVIVE_700C_28H, '700c', 96004);
  const report = await reportOf(order, REVIVE_700C_28H);
  assert.equal(report.lengths.rear.pending, true); assert.match(report.lengths.rear.text, /NOT CALCULATED/);
  const g = systemWheels(recipeOf(order), null, order)[0].geometryInput;
  assert.equal(resolveSystemLengths(g).lengths, null); assert.match(resolveSystemLengths(g).reason, /not in the I9 chart map/);
  assert.match(systemLengthsNotCalculatedText(g), /not in I9's spoke length chart/);
});
