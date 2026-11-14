// ESTIMATED LENGTHS (Jerry, 2026-11-14): a rim I9 has not listed gets the spoke lengths of the I9 Hydra2 rim with the closest ERD (same hole count): copied when the ERD gap is 1.0 mm or less,
// adjusted (ceil(length + gap / 2)) up to 4.0 mm, nothing beyond. The rule is _lib/rim-length-estimate.js; the 80 variants are data/i9-source/ESTIMATED_RIM_LENGTHS.csv, checked against the rule
// by scripts/generate-i9-chart.mjs. An estimated length is marked in the order note, the internal email, the order sheet and the I9 order list, and never reaches a customer email.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { estimateFromChart, estimatedMarker, COPY_GAP_MM, MAX_GAP_MM } from '../_lib/rim-length-estimate.js';
import { CHART_ROWS, RIM_VARIANT_MAP, chartLengthsForRim } from '../_lib/i9-system-chart.js';
import { resolveSystemLengths } from '../_lib/system-lengths.js';
import { buildSystemReport } from '../_lib/system-report.js';
import { buildOrderSheet } from '../_lib/order-sheet.js';
import { chartOrder, recipeOf } from './helpers/chart-order.mjs';
import { runWebhook } from './helpers/webhook-harness.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const INDEX = path.join(here, '..', 'api', 'index.js');
const png = async () => Buffer.from('PNG');
const DT_XM481_29_32 = '51797698609459';   // DT Swiss XM 481 29" 32h: effective ERD 599 -> copy of Sector 2.0 TR315 (299 / 302)
const STANS_EX3_29_32 = '51797701361971';  // Stan's Flow EX3 29" 32h: effective ERD 602 -> adjusted from Triad TR304 (299 / 302)
const DT_XRC310_29_28 = '51797704671539';  // DT Swiss XRC 310 29" 28h: effective ERD 602 -> adjusted from Triad 28h TR303 (304 / 306)
const NO_ESTIMATE = '51797701099827';      // Stan's Arch MK4 27.5" 28h: 37 mm from the nearest H2 28h row, nothing assigned
const FUSE_I9 = '51797702967603';          // We Are One FUSE 29" 32h: I9's own row TR307
const MARK = /estimated from I9/;

const row = (model, hub, erd, drive, nonDrive, partNumber = 'TX') => ({ model, hub, erd, driveColumn: drive, nonDriveColumn: nonDrive, partNumber, section: 's', rimOffset: 0 });

/* ------------------------------------------------------------------ 1. the rule */

test('the rule: copy up to 1.0 mm, adjusted over 1.0 up to 4.0, nothing beyond; the thresholds are the ones Jerry set', () => {
  assert.equal(COPY_GAP_MM, 1.0); assert.equal(MAX_GAP_MM, 4.0);
  const rows = [row('A', 'H2 32h', 600, 299, 302)];
  const at = (erd) => estimateFromChart({ erd, holes: 32 }, rows);
  assert.equal(at(600).method, 'copy'); assert.deepEqual(at(600).lengths, [299, 302]);
  assert.equal(at(601).method, 'copy'); assert.deepEqual(at(601).lengths, [299, 302]);                  // gap exactly 1.0: copy
  assert.equal(at(601.5).method, 'adjusted');
  assert.equal(at(602).method, 'adjusted'); assert.deepEqual(at(602).lengths, [300, 303]);               // +2 mm ERD: +1 mm of spoke
  assert.equal(at(604).method, 'adjusted'); assert.deepEqual(at(604).lengths, [301, 304]);               // gap exactly 4.0: still assigned
  assert.equal(at(604.5).method, 'none'); assert.equal(at(604.5).lengths, null);
  assert.equal(at(500).method, 'none');
});

test('adjusted: gap / 2 added to the I9 length and rounded UP to the next whole mm (a smaller rim: the shortening is rounded up too, never beyond the exact figure)', () => {
  const rows = [row('A', 'H2 32h', 600, 299, 302)];
  const at = (erd) => estimateFromChart({ erd, holes: 32 }, rows).lengths;
  assert.deepEqual(at(603), [301, 304]);        // +3 -> +1.5 -> +2
  assert.deepEqual(at(602.5), [301, 304]);      // +2.5 -> +1.25 -> +2
  assert.deepEqual(at(598), [298, 301]);        // -2 -> -1
  assert.deepEqual(at(597), [298, 301]);        // -3 -> -1.5 -> -1 (ceil of 297.5 is 298): never shorter than the exact figure
  assert.deepEqual(at(596.5), [298, 301]);      // -3.5 -> -1.75 -> -1
});

test('only Hydra2 rows with the SAME hole count are candidates: 28h rims use H2 28h rows, 32h rims H2 32h rows, Solix rows never', () => {
  const rows = [row('S28', 'H2 28h', 598, 302, 303), row('S32', 'H2 32h', 600, 299, 302), row('Sol', 'SM/G', 598, 300, 298)];
  assert.equal(estimateFromChart({ erd: 598, holes: 28 }, rows).row.model, 'S28');
  assert.equal(estimateFromChart({ erd: 598, holes: 32 }, rows).row.model, 'S32');
  assert.equal(estimateFromChart({ erd: 598, holes: 24 }, rows), null, 'no 24h estimate from Hydra2 rows');
  assert.equal(estimateFromChart({ erd: 560, holes: 28 }, rows).method, 'none', '28h rim 38 mm away from the only 28h row');
});

test('a tie: two rows equally near -> the one with the LONGER lengths, flagged; identical twin rows are not a real tie', () => {
  const rows = [row('Short', 'H2 32h', 600, 299, 300), row('Long', 'H2 32h', 600, 299, 302), row('Twin', 'H2 32h', 600, 299, 302)];
  const e = estimateFromChart({ erd: 600, holes: 32 }, rows);
  assert.equal(e.row.model, 'Long'); assert.equal(e.tie, true); assert.equal(e.tieMatters, true); assert.deepEqual(e.lengths, [299, 302]);
  const twins = estimateFromChart({ erd: 600, holes: 32 }, [row('A', 'H2 32h', 600, 299, 302), row('B', 'H2 32h', 600, 299, 302)]);
  assert.equal(twins.tie, true); assert.equal(twins.tieMatters, false);
  const mid = estimateFromChart({ erd: 601, holes: 32 }, [row('Lo', 'H2 32h', 600, 299, 300), row('Hi', 'H2 32h', 602, 301, 303)]);
  assert.equal(mid.row.model, 'Hi', 'equally near (1 mm each): the longer pair'); assert.equal(mid.tieMatters, true);
});

test('the marker text names the matched I9 rim and the ERD gap', () => {
  assert.equal(estimatedMarker({ model: 'Triad 29" 32h', partNumber: 'TR304', gap: -2, method: 'adjusted' }), 'estimated from I9 Triad 29" 32h TR304 (ERD gap -2 mm, adjusted): verify');
  assert.equal(estimatedMarker({ model: 'Sector 2.0 29" 32h', partNumber: 'TR315', gap: 0, method: 'copy' }), 'estimated from I9 Sector 2.0 29" 32h TR315 (ERD gap 0 mm, copied): verify');
});

/* ------------------------------------------------------------------ 2. the data */

const parseCsv = (t) => { const rows = []; let r = [], c = '', q = false; for (let i = 0; i < t.length; i++) { const ch = t[i]; if (q) { if (ch === '"') { if (t[i + 1] === '"') { c += '"'; i++; } else q = false; } else c += ch; } else if (ch === '"') q = true; else if (ch === ',') { r.push(c); c = ''; } else if (ch === '\n') { r.push(c.replace(/\r$/, '')); rows.push(r); r = []; c = ''; } else c += ch; } const h = rows.shift(); return rows.filter((x) => x.length > 1).map((x) => Object.fromEntries(h.map((k, i) => [k, x[i]]))); };
const EST = parseCsv(fs.readFileSync(path.join(here, '..', 'data', 'i9-source', 'ESTIMATED_RIM_LENGTHS.csv'), 'utf8'));
const ALLOWED = parseCsv(fs.readFileSync(path.join(here, '..', 'data', 'i9-source', 'I9_SYSTEM_ALLOWED_LIST.csv'), 'utf8'));

test('data: 80 variants (68 copied, 12 adjusted), every one re-derives from the rule and the chart, none overlaps an I9-listed or borrowed variant', () => {
  assert.equal(EST.length, 80); assert.equal(new Set(EST.map((e) => e.variant_id)).size, 80);
  assert.equal(EST.filter((e) => e.method === 'copy').length, 68); assert.equal(EST.filter((e) => e.method === 'adjusted').length, 12);
  const allowedIds = new Set(ALLOWED.map((a) => a.variant_id));
  for (const e of EST) {
    const est = estimateFromChart({ erd: Number(e.effective_erd), holes: Number(e.holes) }, CHART_ROWS);
    assert.ok(est && est.method !== 'none', e.variant_id);
    assert.deepEqual([est.row.model, est.row.partNumber, est.row.hub, est.method, est.gap, ...est.lengths], [e.matched_model, e.matched_part, e.matched_hub, e.method, Number(e.erd_gap), Number(e.drive_mm), Number(e.non_drive_mm)], e.variant_id);
    assert.ok(/^H2 (28|32)h$/.test(est.row.hub), 'Hydra2 rows only');
    assert.ok(est.absGap <= 4, e.variant_id);
    assert.equal(allowedIds.has(e.variant_id), false, 'not an I9-listed variant');
    const hit = chartLengthsForRim(e.variant_id);
    assert.deepEqual([hit.driveColumn, hit.nonDriveColumn, hit.estimated.method, hit.estimated.gap, hit.estimated.erd], [Number(e.drive_mm), Number(e.non_drive_mm), e.method, Number(e.erd_gap), Number(e.effective_erd)], e.variant_id);
    assert.equal(Boolean(hit.borrowed), false);
  }
  // the 29 I9-listed and borrowed entries carry no estimate and still give the chart pair
  for (const [id, m] of Object.entries(RIM_VARIANT_MAP)) if (!m.estimated) { const h = chartLengthsForRim(id); assert.equal(h.estimated, undefined); assert.deepEqual([h.driveColumn, h.nonDriveColumn], [CHART_ROWS[m.row].driveColumn, CHART_ROWS[m.row].nonDriveColumn]); }
  // the 14 rims left out: every one of them is 28h and more than 4 mm from the nearest H2 28h row
  assert.equal(chartLengthsForRim(NO_ESTIMATE), null);
});

test('HOLD-OUT: each of the 24 Hydra2 chart rims predicted from the nearest OTHER row with the same hole count (the numbers in the report: 17 exact, 20 within 1 mm, 22 within 2 mm)', () => {
  const h2 = CHART_ROWS.filter((r) => /^H2/.test(r.hub));
  assert.equal(h2.length, 24);
  const errs = h2.map((t) => { const est = estimateFromChart({ erd: t.erd, holes: Number(/(\d+)h/.exec(t.hub)[1]) }, h2.filter((r) => r !== t)); const p = est.lengths; return Math.max(Math.abs(p[0] - t.driveColumn), Math.abs(p[1] - t.nonDriveColumn)); });
  assert.equal(errs.filter((e) => e === 0).length, 17); assert.equal(errs.filter((e) => e <= 1).length, 20); assert.equal(errs.filter((e) => e <= 2).length, 22);
  assert.equal(Math.max(...errs.filter((e, i) => !/Hush/.test(h2[i].model))), 2, 'worst 2 mm without the two Hush rows (I9 lists 28h and 32h Hush on the same hub)');
});

/* ------------------------------------------------------------------ 3. the mock orders */

const rimOrder = (rim, holes, n, hubPos = 'rear', title = 'Test rim') => chartOrder({ [hubPos]: { rim, holes, rimTitle: title }, orderNumber: n });
const reportOf = (o) => buildSystemReport({ recipe: recipeOf(o), orderData: o, renderPng: png });

test('DT Swiss XM 481 29" 32h (copy of Sector 2.0 TR315, ERD gap -1): lengths 299 / 302, marked in the note, the internal email, the sheet and the I9 list; no "not calculated"', async () => {
  const o = rimOrder(DT_XM481_29_32, 32, 95001, 'rear', 'DT Swiss XM 481 Alloy Rim (All Mountain) - 29"');
  const r = await reportOf(o); const l = r.lengths.rear;
  assert.equal(l.pending, false); assert.deepEqual([l.left, l.right], [302, 299]);   // rear 32h: rotor = non-drive column, drive = drive column
  assert.match(l.sourceText, /ESTIMATED from I9 System chart 2026, row Sector 2\.0 29" 32h TR315 \(this rim is not in I9's chart\)/);
  assert.match(l.extra, /estimated from I9 Sector 2\.0 29" 32h TR315 \(ERD gap -1 mm, copied\): verify/);
  assert.match(r.note, /Rotor side  302 mm:/); assert.match(r.note, /Drive side  299 mm:/);
  assert.match(r.note, /^  Lengths estimated from I9 Sector 2\.0 29" 32h TR315 \(ERD gap -1 mm, copied\): verify$/m);
  assert.ok(!/not calculated/i.test(r.note));
  assert.match(r.html, /estimated from I9 Sector 2\.0 29&quot; 32h TR315|estimated from I9 Sector 2\.0 29" 32h TR315/);          // the internal email
  const list = r.i9OrderList.text;
  assert.match(list, /\[length estimated from I9 Sector 2\.0 29" 32h TR315 \(ERD gap -1 mm, copied\): verify\]/);
  const rimLine = list.split('\n').find((x) => /^   Rear: .*, 32h/.test(x)); assert.ok(rimLine, list);
  assert.doesNotMatch(rimLine, /I9 code/, 'no I9 code for a rim I9 does not list');
  const sheet = buildOrderSheet({ orderData: o, calculatedAt: '2026-11-14T12:00:00.000Z' });
  const sw = sheet.wheels[0].lengths;
  assert.equal(sw.status, 'calculated'); assert.deepEqual([sw.rotorMm, sw.driveMm], [302, 299]);
  assert.equal(sw.chart.estimated, true); assert.match(sw.chart.estimatedText, MARK); assert.match(sw.caveat, MARK);
  assert.ok(!/not calculated/i.test(JSON.stringify(sheet.wheels[0].lengths)));
});

test('Stan\'s Flow EX3 29" 32h (adjusted from Triad TR304, gap -2): 299 / 302 as the I9 row gives 300 / 303 minus one; marked everywhere; the front uses the same two figures', async () => {
  const hit = chartLengthsForRim(STANS_EX3_29_32);
  assert.deepEqual([hit.row.partNumber, hit.row.erd, hit.estimated.method, hit.estimated.gap, hit.driveColumn, hit.nonDriveColumn], ['TR304', 604, 'adjusted', -2, 299, 302]);
  assert.deepEqual([hit.row.driveColumn, hit.row.nonDriveColumn], [300, 303], 'the I9 row itself is 300 / 303; the estimate is one mm shorter on both sides');
  const rear = await reportOf(rimOrder(STANS_EX3_29_32, 32, 95002, 'rear', "Stan's Flow EX3 Alloy Rim - 29\""));
  assert.deepEqual([rear.lengths.rear.left, rear.lengths.rear.right], [302, 299]);
  assert.match(rear.note, /Lengths estimated from I9 Triad 29" 32h TR304 \(ERD gap -2 mm, adjusted\): verify/);
  const front = await reportOf(rimOrder(STANS_EX3_29_32, 32, 95003, 'front', "Stan's Flow EX3 Alloy Rim - 29\""));
  assert.deepEqual([front.lengths.front.left, front.lengths.front.right], [299, 302]);   // 32h front = the rear pair (I9, Oct 30), disc / non-disc side
  assert.match(front.note, /Lengths estimated from I9 Triad 29" 32h TR304/);
  assert.match(front.lengths.front.sourceText, /^Source: ESTIMATED from I9 System chart 2026, row Triad 29" 32h TR304 \(this rim is not in I9's chart\), 32h pair/);
});

test('28h estimate (DT Swiss XRC 310 29" 28h, adjusted from Triad 28h TR303): 304 / 306 on the 28h front, marked', async () => {
  const r = await reportOf(rimOrder(DT_XRC310_29_28, 28, 95004, 'front', 'DT Swiss XRC 310 Carbon Rim - 29"'));
  assert.deepEqual([r.lengths.front.left, r.lengths.front.right], [304, 306]);
  assert.match(r.note, /Lengths estimated from I9 Triad 29" 28h TR303 \(ERD gap -2 mm, adjusted\): verify/);
});

test('a wheel with an I9-listed rim is untouched: no marker anywhere, the note byte for byte as before; a mixed order marks only the estimated wheel', async () => {
  const listed = await reportOf(chartOrder({ front: { rim: FUSE_I9, holes: 32 }, rear: { rim: FUSE_I9, holes: 32 }, orderNumber: 95005 }));
  assert.ok(!MARK.test(listed.note) && !MARK.test(listed.html) && !MARK.test(listed.i9OrderList.text) && !/ESTIMATED/.test(JSON.stringify(listed.lengths)));
  assert.match(listed.i9OrderList.text, /I9 code TR307/);
  const mixed = await reportOf(chartOrder({ front: { rim: FUSE_I9, holes: 32 }, rear: { rim: STANS_EX3_29_32, holes: 32 }, orderNumber: 95006 }));
  const blocks = mixed.note.trim().split('\n\n');
  assert.ok(!MARK.test(blocks[0]) && /Lengths estimated/.test(blocks[1]), 'only the rear wheel says estimated');
  assert.equal((mixed.i9OrderList.text.match(/\[length estimated/g) || []).length, 2, 'both sides of the estimated wheel in blocks B or C');
});

test('a rim with no estimate (28h, 37 mm from the nearest row) is still "not calculated" with the old sentence', async () => {
  const r = await reportOf(rimOrder(NO_ESTIMATE, 28, 95007, 'front'));
  assert.equal(r.lengths.front.pending, true); assert.match(r.note, /Lengths not calculated: this rim is not in I9's chart/);
});

test('the store ERD moved since the estimate (DT Swiss ERDs may change): a "check ERD" line says the estimate is out of date', () => {
  const g = (erd) => ({ position: 'rear', hubModel: 'Hydra2', holes: 32, erd, rimVariantId: DT_XM481_29_32, spokes: { left: 16, right: 16 }, cross: { left: 3, right: 3 } });
  const same = resolveSystemLengths(g(599)).lengths; assert.equal(same.note.includes('out of date'), false); assert.match(same.confidence, /estimated/);
  const moved = resolveSystemLengths(g(603)).lengths;
  assert.match(moved.note, /store ERD 603 differs from 599, the ERD this estimate was made from: the estimated lengths are out of date/); assert.match(moved.confidence, /check ERD/);
  assert.doesNotMatch(moved.note, /I9 chart 600/, 'no comparison against the matched I9 rim, which is a different rim');
});

test('whole webhook: the order note and the internal email say estimated; the customer email (flag on) has no lengths and no estimate text; inventory and the other emails as for any System order', async () => {
  const o = chartOrder({ front: { rim: DT_XRC310_29_28, holes: 28, rimTitle: 'DT Swiss XRC 310 Carbon Rim' }, rear: { rim: STANS_EX3_29_32, holes: 32, rimTitle: "Stan's Flow EX3 Alloy Rim" }, orderNumber: 95008 });
  const r = await runWebhook(INDEX, 'orders/create', o, { env: { SYSTEM_CUSTOMER_EMAIL: 'on' } });
  assert.equal(r.status, 200);
  assert.match(r.note, /Lengths estimated from I9 Triad 29" 28h TR303 \(ERD gap -2 mm, adjusted\): verify/); assert.match(r.note, /Lengths estimated from I9 Triad 29" 32h TR304/);
  const internal = r.restEmails.find((e) => /^I9 System Build Report/.test(e.subject)), customer = r.restEmails.find((e) => /^Your custom spoke colors/.test(e.subject));
  assert.ok(internal && /estimated from I9 Triad/.test(internal.html));
  assert.ok(customer, 'the customer email is sent (flag on)');
  assert.ok(!/estimated|Left\/Rotor|Spoke lengths|I9 System chart|ESTIMATED| mm\b/.test(customer.html.replace(/<style[\s\S]*?<\/style>/g, '')), 'no lengths, no estimate text for the customer');
});
