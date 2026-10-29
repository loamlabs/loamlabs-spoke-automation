// Round 10: System spoke lengths from I9's own chart (a lookup, no formula). The numbers come from _lib/i9-system-chart.js (generated from the CSV files by
// scripts/generate-i9-chart.mjs). These tests go through the real order parsing (systemWheels -> calculateSystemSpokeLengths -> note and emails).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { chartOrder, recipeOf } from './helpers/chart-order.mjs';
import { runWebhook, loadSample } from './helpers/webhook-harness.mjs';
import { CHART_ROWS, CHART_SOURCE, RIM_VARIANT_MAP, chartLengthsForRim } from '../_lib/i9-system-chart.js';
import { calculateSystemSpokeLengths, resolveSystemLengths, SYSTEM_LENGTHS_PENDING_TEXT } from '../_lib/system-lengths.js';
import { buildSystemReport, buildCustomerEmail } from '../_lib/system-report.js';
import { systemWheels } from '../_lib/system-build.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const CSV_DIR = path.resolve(here, '..', '..', 'loamlabs-system-builder', 'agent-prompts', 'i9-length-chart');
const HAVE_CSV = fs.existsSync(path.join(CSV_DIR, 'i9_system_length_chart.csv')) && fs.existsSync(path.join(CSV_DIR, 'I9_SYSTEM_ALLOWED_LIST.csv'));
const INDEX = path.resolve(here, '..', 'api', 'index.js');
const png = async () => Buffer.from('PNG');
const sha = (v) => crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');

function parseCsv(text) { // small CSV reader (quotes, doubled quotes)
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true; else if (c === ',') { row.push(cell); cell = ''; } else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; } else if (c !== '\r') cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  const head = rows.shift();
  return rows.filter((r) => r.length > 1).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}
const lengthsOf = async (order) => {
  const report = await buildSystemReport({ recipe: recipeOf(order), orderData: order, renderPng: png });
  return { report, lengths: report.lengths };
};
// the library result for one wheel of a built order
const wheelResult = (order, pos) => resolveSystemLengths(systemWheels(recipeOf(order), null, order).find((w) => w.position === pos).geometryInput);

/* ------------------------------------------------------------------ 1. the data file */

test('data: 31 chart rows and the map are in the generated file; they equal the CSV files (re-read when the project folder is there), else the stored checksum', () => {
  assert.equal(CHART_ROWS.length, 31);
  assert.equal(CHART_SOURCE.date, '2026-10-28');
  assert.equal(Object.keys(RIM_VARIANT_MAP).length, 25);
  if (HAVE_CSV) {
    const csv = parseCsv(fs.readFileSync(path.join(CSV_DIR, 'i9_system_length_chart.csv'), 'utf8'));
    assert.equal(csv.length, 31);
    csv.forEach((r, i) => {
      const x = CHART_ROWS[i];
      assert.deepEqual([x.section, x.model, x.partNumber, x.erd, x.rimOffset, x.hub, x.driveColumn, x.nonDriveColumn],
        [r.section, r.wheel_model, r.rim_part_number, Number(r.erd_mm), Number(r.rim_offset_mm), r.hub, Number(r.drive_side_length_mm), Number(r.non_drive_length_mm)], `row ${i}`);
    });
    assert.equal(CHART_SOURCE.chartSha256, crypto.createHash('sha256').update(fs.readFileSync(path.join(CSV_DIR, 'i9_system_length_chart.csv'))).digest('hex'), 'the generated file is from this CSV');
    assert.equal(CHART_SOURCE.allowedListSha256, crypto.createHash('sha256').update(fs.readFileSync(path.join(CSV_DIR, 'I9_SYSTEM_ALLOWED_LIST.csv'))).digest('hex'), 'and this allowed list');
  } else {
    assert.equal(sha(CHART_ROWS), 'd60f092ac9c20cc2ffdab8c842c51f08ffbf6e1f14d04b7c2ea258dec0760ac4');
    assert.equal(sha(RIM_VARIANT_MAP), '7c4286b34c330e1edcdb0d7d5b534d3bc7edefccc507cfefbe0c64c9962398b2');
  }
});

test('data: every allowed-list variant that names a chart row is mapped to exactly the chart pair quoted in the allowed list (and the Coup Carbon 26" 32h is added)', { skip: !HAVE_CSV && 'project folder with the CSV files not available' }, () => {
  const allowed = parseCsv(fs.readFileSync(path.join(CSV_DIR, 'I9_SYSTEM_ALLOWED_LIST.csv'), 'utf8'));
  let n = 0;
  for (const a of allowed) {
    if (String(a['set_custom.i9_system_allowed']).toLowerCase() !== 'true') { assert.equal(chartLengthsForRim(a.variant_id), null, `${a.variant_id} (not allowed) must not be mapped`); continue; }
    const hit = chartLengthsForRim(a.variant_id);
    assert.ok(hit, `variant ${a.variant_id} (${a.variant_title}) is mapped`);
    assert.equal(hit.driveColumn, Number(a.chart_drive_mm), a.variant_id); assert.equal(hit.nonDriveColumn, Number(a.chart_non_drive_mm), a.variant_id);
    n++;
  }
  assert.equal(n, 24);
  const coup = chartLengthsForRim('67819688788275');
  assert.deepEqual([coup.row.partNumber, coup.row.erd, coup.row.hub, coup.driveColumn, coup.nonDriveColumn], ['TR175', 536, 'H2 32h', 268, 270]);
  assert.equal(chartLengthsForRim('51901428400435').borrowed, true, 'the Whisp 28h borrows the Sector 2.0 row');
  assert.equal(chartLengthsForRim('51901428400435').row.partNumber, 'TR314');
});

/* ------------------------------------------------------------------ 2. every mapped variant, through the order path */

test('every mapped rim variant returns exactly its chart pair through the real order path (rear for 32h and Solix, front for 28h), on the right sides', async () => {
  for (const [id, e] of Object.entries(RIM_VARIANT_MAP)) {
    const row = CHART_ROWS[e.row], holes = /^H2/.test(row.hub) ? Number(/(\d+)h/.exec(row.hub)[1]) : 24;
    const hub = /^H2/.test(row.hub) ? 'Hydra2' : 'Solix';
    const pos = hub === 'Hydra2' && holes === 28 ? 'front' : 'rear';
    const { lengths } = await lengthsOf(chartOrder({ [pos]: { rim: id, holes, hub } }));
    const r = wheelResult(chartOrder({ [pos]: { rim: id, holes, hub } }), pos).lengths;
    assert.ok(r, `${id} ${row.model}`);
    const expected = pos === 'front' ? { left: row.driveColumn, right: row.nonDriveColumn } : { left: row.nonDriveColumn, right: row.driveColumn };
    assert.deepEqual({ left: r.left, right: r.right }, expected, `${id} ${row.model} ${row.partNumber} (${pos})`);
    assert.equal(r.source, 'i9-chart'); assert.equal(r.chart.partNumber, row.partNumber); assert.equal(r.chart.model, row.model);
    assert.ok(lengths[pos] && lengths[pos].pending === false, `${id}: the report shows numbers`);
  }
});

/* ------------------------------------------------------------------ 3. the named fixtures and the note / email lines */

test('Hydra2 28h front + 32h rear on a 29" Sector alloy: front 302/303 (rotor/right), rear 300/299 (rotor/drive); note and internal email carry the numbers and the source line', async () => {
  const order = chartOrder({ front: { rim: '53530701136179', holes: 28 }, rear: { rim: '53530701168947', holes: 32 }, orderNumber: 91101 });
  const { report } = await lengthsOf(order);
  assert.deepEqual([report.lengths.front.pending, report.lengths.rear.pending], [false, false]);
  assert.ok(report.note.includes('Spoke lengths (System): Left/Rotor 302 mm, Right/Drive 303 mm'), report.note);
  assert.ok(report.note.includes('Spoke lengths (System): Left/Rotor 300 mm, Right/Drive 299 mm'), report.note);
  assert.ok(report.note.includes('source: I9 System chart 2026, row Sector 29" 28h TR255'));
  assert.ok(report.note.includes('source: I9 System chart 2026, row Sector 29" 32h TR256'));
  assert.ok(!/NOT CALCULATED/.test(report.note));
  assert.ok(report.html.includes('source: I9 System chart 2026, row Sector 29&quot; 32h TR256'));
  const front = wheelResult(order, 'front').lengths, rear = wheelResult(order, 'rear').lengths;
  assert.equal(front.confidence, 'chart'); assert.equal(rear.confidence, 'chart'); assert.equal(front.note, undefined);
});

test('Fuse 29" carbon 32h/32h: the rear gets 303 (rotor) / 300 (drive); the FRONT 32h gets no number and says why', async () => {
  const order = chartOrder({ front: { rim: '51797702967603', holes: 32 }, rear: { rim: '51797702967603', holes: 32 }, orderNumber: 91102 });
  const f = wheelResult(order, 'front'), r = wheelResult(order, 'rear');
  assert.equal(f.lengths, null); assert.match(f.reason, /Hydra2 32h FRONT hub/);
  assert.deepEqual([r.lengths.left, r.lengths.right], [303, 300]);
  const { report } = await lengthsOf(order);
  const FRONT_TEXT = "Spoke lengths for System hubs: NOT CALCULATED. I9 has not published 32h front numbers yet, so check the front lengths with I9 before ordering spokes. (The rear numbers are rear-hub numbers and do not apply to the front.)";
  assert.equal(report.lengths.front.pending, true); assert.equal(report.lengths.front.text, FRONT_TEXT);
  assert.equal(report.lengths.rear.pending, false);
  assert.ok(report.note.includes(`  ${FRONT_TEXT}\n`), 'the front says NOT CALCULATED and why, with no numbers and no "method pending"');
  assert.ok(!report.note.includes('method pending'));
});

test('Solix 24h Whisp, front and rear: the same pair 300/297 mirrored between the sides, the longer on the 16-spoke side; the front is marked inferred', async () => {
  const order = chartOrder({ front: { rim: '67796530037043', holes: 24 }, rear: { rim: '67796530037043', holes: 24 }, orderNumber: 91103 });
  const wheels = systemWheels(recipeOf(order), null, order);
  const front = wheelResult(order, 'front').lengths, rear = wheelResult(order, 'rear').lengths;
  assert.deepEqual([rear.left, rear.right], [297, 300], 'rear: drive (right) is the 16-spoke side and gets the longer number');
  assert.deepEqual([front.left, front.right], [300, 297], 'front: rotor (left) is the 16-spoke side and gets the longer number');
  for (const [w, r] of [[wheels.find((x) => x.position === 'front'), front], [wheels.find((x) => x.position === 'rear'), rear]]) {
    const longerSide = r.left > r.right ? 'rotor' : 'drive';
    assert.equal(w.config[longerSide].n, 16, `${w.position}: the longer number is on the side the Studio config gives 16 spokes`);
    assert.equal(w.config[longerSide === 'rotor' ? 'drive' : 'rotor'].n, 8);
  }
  assert.equal(front.confidence, 'inferred'); assert.match(front.note, /front side mapping inferred from geometry, verify against I9/);
  assert.equal(rear.confidence, 'chart'); assert.equal(rear.note, undefined);
  const { report } = await lengthsOf(order);
  assert.ok(report.note.includes('(front side mapping inferred from geometry, verify against I9)'));
  assert.ok(report.note.includes('source: I9 System chart 2026, row Whisp 24h TR312'));
});

test('Hush 24h on Solix: chart 328/325 with the ERD note, from the known store ERD and also when the order carries ERD 652; not flagged when the order carries 655', async () => {
  const order = chartOrder({ rear: { rim: '53871010939187', holes: 24 }, orderNumber: 91104 });
  const base = wheelResult(order, 'rear').lengths;
  assert.deepEqual([base.left, base.right], [325, 328]); assert.equal(base.confidence, 'check ERD');
  assert.match(base.note, /Hush: store ERD 652 vs I9 chart 655, confirm with I9 when ordering parts/);
  const input = { ...systemWheels(recipeOf(order), null, order)[0].geometryInput };
  assert.equal(resolveSystemLengths({ ...input, erd: 652 }).lengths.confidence, 'check ERD');
  assert.equal(resolveSystemLengths({ ...input, erd: 655 }).lengths.confidence, 'chart', 'ERD of the order equals the chart: nothing to check');
  assert.equal(resolveSystemLengths({ ...input, erd: 655.4 }).lengths.confidence, 'chart', 'within 0.5 mm');
  const { report } = await lengthsOf(order);
  assert.ok(report.note.includes('Hush: store ERD 652 vs I9 chart 655, confirm with I9 when ordering parts'));
});

test('generic ERD check: any mapped rim whose order ERD differs from the chart by more than 0.5 mm is marked check ERD', () => {
  const order = chartOrder({ rear: { rim: '51797702967603', holes: 32 } });
  const input = systemWheels(recipeOf(order), null, order)[0].geometryInput;
  const r = resolveSystemLengths({ ...input, erd: 602 }).lengths;
  assert.equal(r.confidence, 'check ERD'); assert.match(r.note, /store ERD 602 vs I9 chart 604, confirm with I9 when ordering parts/);
  assert.equal(resolveSystemLengths({ ...input, erd: 604.5 }).lengths.confidence, 'chart');
  assert.equal(resolveSystemLengths({ ...input, erd: 604.6 }).lengths.confidence, 'check ERD');
});

test('Coup Carbon 26" 32h (variant 67819688788275): rear 270 (rotor) / 268 (drive)', () => {
  const r = wheelResult(chartOrder({ rear: { rim: '67819688788275', holes: 32 } }), 'rear').lengths;
  assert.deepEqual([r.left, r.right, r.chart.partNumber, r.chart.erd], [270, 268, 'TR175', 536]);
});

test('Hydra2 28h REAR: the chart row is returned but marked inferred (the chart does not say front or rear for 28h); Whisp 28h says it borrows the Sector 2.0 row', () => {
  const r = wheelResult(chartOrder({ rear: { rim: '51901428400435', holes: 28 } }), 'rear').lengths;
  assert.deepEqual([r.left, r.right], [305, 303]); assert.equal(r.confidence, 'inferred');
  assert.match(r.note, /does not say front or rear for 28h/); assert.match(r.note, /not an I9-listed combination/);
  assert.equal(r.chart.model, 'Sector 2.0 29" 28h');
});

/* ------------------------------------------------------------------ 4. null cases */

test('null cases: unmapped rim, 32h Hydra2 front, hub that does not match the chart row, unknown hub: each null with its own reason, logged with the order number', () => {
  const logs = []; const real = console.log; console.log = (...a) => logs.push(a.join(' '));
  try {
    const cases = [
      ['rim variant not in the map', chartOrder({ rear: { rim: '53530694779187', holes: 28 }, orderNumber: 91201 }), 'rear', /not in the I9 chart map/],      // Triad alloy 27.5" 28h: explicitly not allowed
      ['unknown variant id', chartOrder({ rear: { rim: '12345', holes: 32 }, orderNumber: 91202 }), 'rear', /not in the I9 chart map/],
      ['Hydra2 32h front', chartOrder({ front: { rim: '51797702967603', holes: 32 }, orderNumber: 91203 }), 'front', /32h FRONT hub/],
      ['28h rim with a Solix hub', chartOrder({ rear: { rim: '51797702934835', holes: 28, hub: 'Solix' }, orderNumber: 91204 }), 'rear', /does not match the chart row/],
      ['24h Solix rim with a Hydra2 hub', chartOrder({ rear: { rim: '67796530037043', holes: 24, hub: 'Hydra2' }, orderNumber: 91205 }), 'rear', /does not match the chart row/],
      ['32h rim row with a 28h wheel', chartOrder({ rear: { rim: '51797702967603', holes: 28 }, orderNumber: 91206 }), 'rear', /does not match the chart row/]
    ];
    for (const [name, order, pos, re] of cases) {
      const input = systemWheels(recipeOf(order), null, order).find((w) => w.position === pos).geometryInput;
      const res = resolveSystemLengths(input);
      assert.equal(res.lengths, null, name); assert.match(res.reason, re, name);
      assert.equal(calculateSystemSpokeLengths(input), null, name);
      assert.ok(logs.some((l) => l.includes(`ORDER #${order.order_number}: spoke lengths not calculated`) && re.test(l)), `${name}: one log line with the order number and the reason`);
    }
    const noModel = { ...systemWheels(recipeOf(chartOrder({ rear: { rim: '51797702967603', holes: 32 } })), null, chartOrder({ rear: { rim: '51797702967603', holes: 32 } }))[0].geometryInput, hubModel: null };
    assert.match(resolveSystemLengths(noModel).reason, /hub model unknown/);
  } finally { console.log = real; }
});

test('a miss says NOT CALCULATED and why in the note, no source line, and the internal email summary says NOT CALCULATED', async () => {
  const { report } = await lengthsOf(chartOrder({ rear: { rim: '12345', holes: 32 }, orderNumber: 91207 }));
  assert.ok(report.note.includes("  Spoke lengths for System hubs: NOT CALCULATED. This rim is not in I9's spoke length chart, so check the lengths with I9 before ordering spokes.\n"));
  assert.ok(!/I9 System chart 2026/.test(report.note) && !/I9 System chart 2026/.test(report.html));
  assert.ok(report.html.includes('NOT CALCULATED, see each wheel for the reason'));
  assert.ok(!report.html.includes('method pending') && !report.note.includes('method pending'));
});

/* ------------------------------------------------------------------ 5. customer email, Standard, whole webhook */

test('the customer email never contains lengths or the chart source (hit and miss)', async () => {
  for (const order of [chartOrder({ rear: { rim: '51797702967603', holes: 32 } }), chartOrder({ rear: { rim: '12345', holes: 32 } })]) {
    const report = await buildSystemReport({ recipe: recipeOf(order), orderData: order, renderPng: png });
    const cust = buildCustomerEmail({ wheels: report.wheels, images: report.images, orderData: order });
    for (const text of [cust.html, cust.fallbackHtml, cust.subject]) {
      assert.ok(!/Spoke lengths|I9 System chart|\b30[03] mm|\b30[03]\s*mm|Left\/Rotor|Right\/Drive|source:/i.test(text));
      assert.ok(!/\b(300|303)\b/.test(text.replace(/#[0-9a-f]{3,6}|\d+px|width="\d+"|\d+\.\d+/gi, '')), 'no length numbers');
    }
  }
});

test('whole webhook, System order with a chart hit: the order note has the numbers and the source line, the internal email too, the customer email (flag on) has none', async () => {
  const order = chartOrder({ front: { rim: '53530701136179', holes: 28 }, rear: { rim: '53530701168947', holes: 32 }, orderNumber: 91301 });
  const r = await runWebhook(INDEX, 'orders/create', order, { env: { SYSTEM_CUSTOMER_EMAIL: 'on' } });
  assert.equal(r.status, 200);
  assert.ok(r.note.includes('Spoke lengths (System): Left/Rotor 302 mm, Right/Drive 303 mm') && r.note.includes('source: I9 System chart 2026, row Sector 29" 32h TR256'));
  const internal = r.restEmails.find((e) => /^I9 System Build Report/.test(e.subject)), customer = r.restEmails.find((e) => /^Your custom spoke colors/.test(e.subject));
  assert.ok(internal.html.includes('Left/Rotor 300 mm, Right/Drive 299 mm'));
  assert.ok(customer && !/Left\/Rotor|Spoke lengths|I9 System chart/.test(customer.html));
});

test('Standard orders are unchanged: no chart line, no System wording in their note', async () => {
  const r = await runWebhook(INDEX, 'orders/create', loadSample('standard', 'steel-jbend-wheelset'));
  assert.equal(r.status, 200);
  assert.ok(!/I9 System chart|Spoke lengths \(System\)/.test(r.note || ''));
});

test('side mapping evidence: the chart supports it (all 24 Hydra2 rows have the first column shorter; all 7 Solix rows have it longer)', () => {
  const h2 = CHART_ROWS.filter((r) => /^H2/.test(r.hub)), solix = CHART_ROWS.filter((r) => /^S/.test(r.hub));
  assert.equal(h2.length + solix.length, 31);
  assert.ok(h2.every((r) => r.driveColumn < r.nonDriveColumn), 'Hydra2: first column shorter');
  assert.ok(solix.every((r) => r.driveColumn > r.nonDriveColumn), 'Solix: first column longer (= the 16-spoke side)');
});
