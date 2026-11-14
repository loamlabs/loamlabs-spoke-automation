// ESTIMATED LENGTHS (Jerry, 2026-11-14): a rim I9 has NOT listed gets the spoke lengths of an I9 Hydra2 chart rim plus the geometry difference between the new rim and that I9 rim
// (_lib/rim-length-estimate.js: effective ERD and rim offset, Hydra2 hub geometry, rounded UP). The 82 variants are data/i9-source/ESTIMATED_RIM_LENGTHS.csv, checked against the rule by
// scripts/generate-i9-chart.mjs. An estimated length is marked in the order note, the internal email, the order sheet and the I9 order list, and never reaches a customer email.
// (This version replaced the flat copy / half-gap rule of PR #17, which is kept as estimateFlatFromChart for the hold-out comparison below.)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { estimateFromChart, estimateFlatFromChart, estimateLongerOfSiteAndMeasured, estimatedMarker, geometryLength, MAX_GAP_MM } from '../_lib/rim-length-estimate.js';
import { CHART_ROWS, RIM_VARIANT_MAP, chartLengthsForRim } from '../_lib/i9-system-chart.js';
import { resolveSystemLengths } from '../_lib/system-lengths.js';
import { buildSystemReport } from '../_lib/system-report.js';
import { buildOrderSheet } from '../_lib/order-sheet.js';
import { chartOrder, recipeOf } from './helpers/chart-order.mjs';
import { runWebhook } from './helpers/webhook-harness.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const INDEX = path.join(here, '..', 'api', 'index.js');
const png = async () => Buffer.from('PNG');
const DT_XM481_29_32 = '51797698609459';   // DT Swiss XM 481 29" 32h: effective ERD 599, offset 0 -> Sector 2.0 TR315 (299 / 302), ERD gap -1: 299 / 302
const STANS_EX3_29_32 = '51797701361971';  // Stan's Flow EX3 29" 32h: effective ERD 602, offset 0: exactly between Sector 2.0 TR315 (600) and Triad TR304 (604), both give 300 / 303; the longer I9 row (Triad) is taken, ERD gap -2
const DT_XRC310_29_28 = '51797704671539';  // DT Swiss XRC 310 29" 28h: effective ERD 602, offset 4 -> Sector 2.0 28h TR314 (303 / 305), ERD gap +2, offset gap +4: 305 / 306
const NO_ESTIMATE = '51797701099827';      // Stan's Arch MK4 27.5" 28h: 37 mm from the nearest H2 28h row, nothing assigned
const FUSE_I9 = '51797702967603';          // We Are One FUSE 29" 32h: I9's own row TR307
const MARK = /estimated from I9/;

const row = (model, hub, erd, drive, nonDrive, rimOffset = 0, partNumber = 'TX') => ({ model, hub, erd, driveColumn: drive, nonDriveColumn: nonDrive, partNumber, section: 's', rimOffset });

/* ------------------------------------------------------------------ 1. the rule */

test('geometry: a positive rim offset (spoke bed toward the non-drive side) shortens the non-drive side and lengthens the drive side; ERD moves both by about half a mm per mm', () => {
  for (const holes of [28, 32]) {
    const L = (erd, offset, side) => geometryLength({ erd, offset, holes, side });
    assert.ok(L(600, 2, 'nonDrive') < L(600, 0, 'nonDrive')); assert.ok(L(600, 2, 'drive') > L(600, 0, 'drive'));
    for (const side of ['drive', 'nonDrive']) { const d = L(602, 0, side) - L(600, 0, side); assert.ok(d > 0.97 && d < 1.0, `${holes}h ${side}: 2 mm of ERD = ${d.toFixed(3)} mm of spoke`); }
    for (const side of ['drive', 'nonDrive']) assert.ok(Math.abs(L(600, 2, side) - L(600, 0, side)) < 0.3, 'the offset moves the formula by a fraction of a mm per mm: this is geometry, not I9\'s table');
  }
});

test('the rule: same ERD and offset = the I9 length itself (no +1 from rounding); +2 mm of ERD = +1 mm; nothing over 4.0 mm of ERD', () => {
  const rows = [row('A', 'H2 32h', 600, 299, 302)];
  const at = (erd, offset = 0) => estimateFromChart({ erd, offset, holes: 32 }, rows);
  assert.deepEqual(at(600).lengths, [299, 302]); assert.equal(at(600).method, 'estimated');
  assert.deepEqual(at(602).lengths, [300, 303]);
  assert.deepEqual(at(598).lengths, [299, 302], '-2 mm of ERD = -0.99 mm of spoke: rounded UP, so the I9 figure stays');
  assert.equal(at(604).method, 'estimated'); assert.equal(at(604.5).method, 'none'); assert.equal(at(604.5).lengths, null); assert.equal(at(500).method, 'none');
  assert.equal(MAX_GAP_MM, 4.0);
});

test('rounding is always UP (Jerry): a small positive correction adds a whole mm, a small negative one subtracts nothing; a correction of a mm or more can go below the I9 length and is flagged "shorter"', () => {
  const rows = [row('A', 'H2 32h', 600, 299, 302)];
  const at = (erd) => estimateFromChart({ erd, offset: 0, holes: 32 }, rows);
  assert.deepEqual(at(600.2).lengths, [300, 303], '+0.1 mm of spoke -> +1 mm (round up always)'); assert.equal(at(600.2).shorter, false);
  assert.deepEqual(at(599.8).lengths, [299, 302], '-0.1 mm of spoke -> unchanged');
  const down = at(597);   // -3 mm of ERD = -1.5 mm of spoke
  assert.deepEqual(down.lengths, [298, 301]); assert.equal(down.shorter, true);
});

test('the I9 rim is chosen by ERD and offset together: the smallest correction wins; only Hydra2 rows with the same hole count and within 4 mm of ERD take part; on a tie the longer lengths', () => {
  const rows = [row('Off0', 'H2 32h', 600, 299, 302, 0), row('Off2', 'H2 32h', 600, 299, 300, 2), row('S28', 'H2 28h', 600, 303, 305, 0), row('Sol', 'SM/G', 600, 300, 298, 0)];
  assert.equal(estimateFromChart({ erd: 600, offset: 2, holes: 32 }, rows).row.model, 'Off2', 'offset 2 matches the offset-2 rim');
  assert.equal(estimateFromChart({ erd: 600, offset: 0, holes: 32 }, rows).row.model, 'Off0');
  assert.equal(estimateFromChart({ erd: 600, offset: 0, holes: 28 }, rows).row.model, 'S28');
  assert.equal(estimateFromChart({ erd: 600, offset: 0, holes: 24 }, rows), null, 'no 24h estimate from Hydra2 rows');
  const far = estimateFromChart({ erd: 600, offset: 0, holes: 32 }, [row('Far', 'H2 32h', 606, 305, 308, 0)]); assert.equal(far.method, 'none', '6 mm away');
  // two rows with exactly the same correction: the longer estimated lengths, flagged as a tie that matters
  const t = estimateFromChart({ erd: 601, offset: 0, holes: 32 }, [row('Lo', 'H2 32h', 600, 299, 300), row('Hi', 'H2 32h', 602, 301, 303)]);
  assert.equal(t.row.model, 'Hi'); assert.equal(t.tie, true); assert.equal(t.tieMatters, true);
  const twins = estimateFromChart({ erd: 600, offset: 0, holes: 32 }, [row('A', 'H2 32h', 600, 299, 302), row('B', 'H2 32h', 600, 299, 302)]);
  assert.equal(twins.tie, true); assert.equal(twins.tieMatters, false, 'identical twin rims are not a real tie');
});

test('the marker names the matched I9 rim, the ERD gap and (when there is one) the offset gap', () => {
  assert.equal(estimatedMarker({ model: 'Sector 2.0 29" 32h', partNumber: 'TR315', gap: -1, offsetGap: 0 }), 'estimated from I9 Sector 2.0 29" 32h TR315 (ERD gap -1 mm): verify');
  assert.equal(estimatedMarker({ model: 'Sector 2.0 29" 28h', partNumber: 'TR314', gap: 2, offsetGap: 4 }), 'estimated from I9 Sector 2.0 29" 28h TR314 (ERD gap +2 mm, offset gap +4 mm): verify');
  assert.equal(estimatedMarker({ model: 'Wanderer 29"', partNumber: 'TR309', gap: 0, offsetGap: 0.5 }), 'estimated from I9 Wanderer 29" TR309 (ERD gap 0 mm, offset gap +0.5 mm): verify');
});

/* ------------------------------------------------------------------ 2. the data */

const parseCsv = (t) => { const rows = []; let r = [], c = '', q = false; for (let i = 0; i < t.length; i++) { const ch = t[i]; if (q) { if (ch === '"') { if (t[i + 1] === '"') { c += '"'; i++; } else q = false; } else c += ch; } else if (ch === '"') q = true; else if (ch === ',') { r.push(c); c = ''; } else if (ch === '\n') { r.push(c.replace(/\r$/, '')); rows.push(r); r = []; c = ''; } else c += ch; } const h = rows.shift(); return rows.filter((x) => x.length > 1).map((x) => Object.fromEntries(h.map((k, i) => [k, x[i]]))); };
const EST = parseCsv(fs.readFileSync(path.join(here, '..', 'data', 'i9-source', 'ESTIMATED_RIM_LENGTHS.csv'), 'utf8'));
const ALLOWED = parseCsv(fs.readFileSync(path.join(here, '..', 'data', 'i9-source', 'I9_SYSTEM_ALLOWED_LIST.csv'), 'utf8'));

test('data: 82 variants (80 non-I9 rims plus the two Stan\'s 29" 32h rims that used to borrow the Wanderer row), every one re-derives from the rule and the chart; none is I9-listed', () => {
  assert.equal(EST.length, 82); assert.equal(new Set(EST.map((e) => e.variant_id)).size, 82);
  const allowedIds = new Set(ALLOWED.map((a) => a.variant_id));
  let shorter = 0;
  for (const e of EST) {
    const est = estimateFromChart({ erd: Number(e.effective_erd), offset: Number(e.rim_offset), holes: Number(e.holes) }, CHART_ROWS);
    assert.ok(est && est.method === 'estimated', e.variant_id);
    assert.deepEqual([est.row.model, est.row.partNumber, est.row.hub, est.gap, est.offsetGap, est.deltaDrive, est.deltaNonDrive, ...est.lengths],
      [e.matched_model, e.matched_part, e.matched_hub, Number(e.erd_gap), Number(e.offset_gap), Number(e.delta_drive), Number(e.delta_non_drive), Number(e.drive_mm), Number(e.non_drive_mm)], e.variant_id);
    assert.ok(/^H2 (28|32)h$/.test(est.row.hub), 'Hydra2 rows only'); assert.ok(Math.abs(est.gap) <= 4, e.variant_id);
    assert.equal(allowedIds.has(e.variant_id), false, 'not an I9-listed variant');
    const hit = chartLengthsForRim(e.variant_id);
    assert.deepEqual([hit.driveColumn, hit.nonDriveColumn, hit.estimated.gap, hit.estimated.offsetGap, hit.estimated.erd], [Number(e.drive_mm), Number(e.non_drive_mm), Number(e.erd_gap), Number(e.offset_gap), Number(e.effective_erd)], e.variant_id);
    assert.equal(Boolean(hit.borrowed), false);
    if (est.shorter) shorter++;
  }
  assert.equal(shorter, 5, 'five variants come out shorter than the I9 rim they are matched to on a side (listed in the review table)');
  for (const [id, m] of Object.entries(RIM_VARIANT_MAP)) if (!m.estimated) { const h = chartLengthsForRim(id); assert.equal(h.estimated, undefined); assert.deepEqual([h.driveColumn, h.nonDriveColumn], [CHART_ROWS[m.row].driveColumn, CHART_ROWS[m.row].nonDriveColumn]); }
  assert.equal(chartLengthsForRim(NO_ESTIMATE), null);
  // the Whisp 28h stays on its own borrowed entry; the rule gives the very same pair (same ERD, same offset, same row)
  const wh = chartLengthsForRim('51901428400435'); const w = estimateFromChart({ erd: 600, offset: 0, holes: 28 }, CHART_ROWS);
  assert.deepEqual([wh.borrowed, wh.driveColumn, wh.nonDriveColumn], [true, 303, 305]); assert.deepEqual(w.lengths, [303, 305]); assert.equal(w.row.partNumber, 'TR314');
});

/** the 24 Hydra2 chart rims, each predicted from the best OTHER row with the same hole count (leave one out) */
function holdOut(poolFilter = () => true, noHush = false) {
  const h2 = CHART_ROWS.filter((r) => /^H2/.test(r.hub));
  const out = { n: 0, flat: { exact: 0, w1: 0, w2: 0, short: 0 }, offsetAware: { exact: 0, w1: 0, w2: 0, short: 0 } };
  for (const t of h2) {
    if (noHush && /Hush/.test(t.model)) continue;
    const pool = h2.filter((r) => r !== t && poolFilter(t, r)), holes = Number(/(\d+)h/.exec(t.hub)[1]);
    const n = estimateFromChart({ erd: t.erd, offset: t.rimOffset, holes }, pool), f = estimateFlatFromChart({ erd: t.erd, holes }, pool);
    out.n++;
    for (const [k, est] of [['offsetAware', n], ['flat', f]]) {
      if (!est || !est.lengths) continue;
      const e = [est.lengths[0] - t.driveColumn, est.lengths[1] - t.nonDriveColumn], m = Math.max(Math.abs(e[0]), Math.abs(e[1]));
      if (m === 0) out[k].exact++; if (m <= 1) out[k].w1++; if (m <= 2) out[k].w2++; if (e[0] < 0 || e[1] < 0) out[k].short++;
    }
  }
  return out;
}

test('HOLD-OUT (the numbers in the report): offset-aware vs the flat rule of PR #17 on the 24 Hydra2 chart rims', () => {
  assert.deepEqual(holdOut(), { n: 24, flat: { exact: 17, w1: 20, w2: 22, short: 4 }, offsetAware: { exact: 18, w1: 21, w2: 22, short: 3 } });
  assert.deepEqual(holdOut(() => true, true), { n: 22, flat: { exact: 17, w1: 20, w2: 22, short: 3 }, offsetAware: { exact: 18, w1: 21, w2: 22, short: 2 } }, 'without the two Hush rows (I9 lists the 28h and 32h Hush on the same hub)');
  // strict: no same-ERD twin allowed. The flat rule is better here (22 of 22 within 1 mm): rounding every correction UP, as asked, leaves the offset-aware figures 1 mm long more often.
  assert.deepEqual(holdOut((t, r) => Math.abs(r.erd - t.erd) >= 0.5, true), { n: 22, flat: { exact: 3, w1: 22, w2: 22, short: 7 }, offsetAware: { exact: 4, w1: 16, w2: 22, short: 1 } });
  // the rims whose best I9 neighbour has another offset (Wanderer 2, the alloy rims at 1, Sector 2.0 at 0): 5 rims
  const h2 = CHART_ROWS.filter((r) => /^H2/.test(r.hub)).filter((t) => !/Hush/.test(t.model));
  const diff = h2.filter((t) => { const holes = Number(/(\d+)h/.exec(t.hub)[1]); const n = estimateFromChart({ erd: t.erd, offset: t.rimOffset, holes }, CHART_ROWS.filter((r) => r !== t && /^H2/.test(r.hub))); return n && n.method === 'estimated' && Math.abs(t.rimOffset - n.row.rimOffset) >= 1; });
  assert.equal(diff.length, 5);
});

test('the offset sign is the one I9\'s own rows show: Wanderer 29" (offset 2) has the same drive length as Sector 2.0 29" 32h (offset 0, same ERD 600) and a SHORTER non-drive length; the rule predicts the Wanderer within 2 mm on both sides', () => {
  const wand = CHART_ROWS.find((r) => r.partNumber === 'TR309'), sec = CHART_ROWS.find((r) => r.partNumber === 'TR315');
  assert.deepEqual([wand.erd, wand.rimOffset, sec.erd, sec.rimOffset], [600, 2, 600, 0]);
  assert.equal(wand.driveColumn, sec.driveColumn); assert.ok(wand.nonDriveColumn < sec.nonDriveColumn);
  const p = estimateFromChart({ erd: 600, offset: 2, holes: 32 }, CHART_ROWS.filter((r) => r !== wand));
  assert.ok(Math.abs(p.lengths[0] - wand.driveColumn) <= 2 && Math.abs(p.lengths[1] - wand.nonDriveColumn) <= 2);
  // the geometry predicts the direction (non-drive shorter) but only a fraction of what I9's table shows (2 mm for 2 mm of offset): this is the open point in the report
  assert.ok(p.deltaNonDrive < 0 && p.deltaNonDrive > -0.3);
});

/* ------------------------------------------------------------------ 3. the mock orders */

const rimOrder = (rim, holes, n, hubPos = 'rear', title = 'Test rim') => chartOrder({ [hubPos]: { rim, holes, rimTitle: title }, orderNumber: n });
const reportOf = (o) => buildSystemReport({ recipe: recipeOf(o), orderData: o, renderPng: png });
const M_XM481 = 'estimated from I9 Sector 2.0 29" 32h TR315 (ERD gap -1 mm): verify';

test('DT Swiss XM 481 29" 32h (Sector 2.0 TR315, ERD gap -1 mm, no offset gap): 299 / 302 as I9 lists the Sector; marked in the note, the internal email, the sheet and the I9 list; no "not calculated"', async () => {
  const o = rimOrder(DT_XM481_29_32, 32, 95001, 'rear', 'DT Swiss XM 481 Alloy Rim (All Mountain) - 29"');
  const r = await reportOf(o); const l = r.lengths.rear;
  assert.equal(l.pending, false); assert.deepEqual([l.left, l.right], [302, 299]);   // rear 32h: rotor = non-drive column, drive = drive column
  assert.match(l.sourceText, /ESTIMATED from I9 System chart 2026, row Sector 2\.0 29" 32h TR315 \(this rim is not in I9's chart\)/);
  assert.equal(l.extra, M_XM481);
  assert.match(r.note, /Rotor side  302 mm:/); assert.match(r.note, /Drive side  299 mm:/);
  assert.ok(r.note.split('\n').includes(`  Lengths ${M_XM481}`));
  assert.ok(!/not calculated/i.test(r.note));
  assert.ok(r.html.includes(M_XM481.replace('29"', '29&quot;')) || r.html.includes(M_XM481), 'the internal email');
  const list = r.i9OrderList.text;
  assert.ok(list.includes(`[length ${M_XM481}]`));
  const rimLine = list.split('\n').find((x) => /^   Rear: .*, 32h/.test(x)); assert.ok(rimLine, list);
  assert.doesNotMatch(rimLine, /I9 code/, 'no I9 code for a rim I9 does not list');
  const sheet = buildOrderSheet({ orderData: o, calculatedAt: '2026-11-14T12:00:00.000Z' });
  const sw = sheet.wheels[0].lengths;
  assert.equal(sw.status, 'calculated'); assert.deepEqual([sw.rotorMm, sw.driveMm], [302, 299]);
  assert.equal(sw.chart.estimated, true); assert.equal(sw.chart.estimatedText, M_XM481); assert.equal(sw.caveat, M_XM481);
  assert.ok(!/not calculated/i.test(JSON.stringify(sw)));
});

test('Stans Flow EX3 29" 32h (effective ERD 602, a tie between Sector 2.0 TR315 and Triad TR304 that gives the same pair): Triad TR304 with the -0.99 mm correction rounded up = 300 / 303; the 32h front uses the same pair; the front source line says ESTIMATED', async () => {
  const hit = chartLengthsForRim(STANS_EX3_29_32);
  assert.deepEqual([hit.row.partNumber, hit.estimated.gap, hit.estimated.offsetGap, hit.driveColumn, hit.nonDriveColumn], ['TR304', -2, 0, 300, 303]);
  assert.deepEqual([hit.row.driveColumn, hit.row.nonDriveColumn], [300, 303], 'the I9 row itself is 300 / 303: the -0.99 mm correction rounds up to nothing');
  const rear = await reportOf(rimOrder(STANS_EX3_29_32, 32, 95002, 'rear', "Stan's Flow EX3 Alloy Rim - 29\""));
  assert.deepEqual([rear.lengths.rear.left, rear.lengths.rear.right], [303, 300]);
  assert.match(rear.note, /Lengths estimated from I9 Triad 29" 32h TR304 \(ERD gap -2 mm\): verify/);
  const front = await reportOf(rimOrder(STANS_EX3_29_32, 32, 95003, 'front', "Stan's Flow EX3 Alloy Rim - 29\""));
  assert.deepEqual([front.lengths.front.left, front.lengths.front.right], [300, 303]);
  assert.match(front.lengths.front.sourceText, /^Source: ESTIMATED from I9 System chart 2026, row Triad 29" 32h TR304 \(this rim is not in I9's chart\), 32h pair/);
});

test('28h estimate with an offset gap (DT Swiss XRC 310 29" 28h, offset 4, matched to Sector 2.0 28h TR314 at offset 0): 305 / 306 on the 28h front; the marker names both gaps', async () => {
  const r = await reportOf(rimOrder(DT_XRC310_29_28, 28, 95004, 'front', 'DT Swiss XRC 310 Carbon Rim - 29"'));
  assert.deepEqual([r.lengths.front.left, r.lengths.front.right], [305, 306]);
  assert.match(r.note, /Lengths estimated from I9 Sector 2\.0 29" 28h TR314 \(ERD gap \+2 mm, offset gap \+4 mm\): verify/);
});

test('a wheel with an I9-listed rim is untouched: no marker anywhere; a mixed order marks only the estimated wheel', async () => {
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

test('whole webhook: the order note and the internal email say estimated; the customer email (flag on) has no lengths and no estimate text', async () => {
  const o = chartOrder({ front: { rim: DT_XRC310_29_28, holes: 28, rimTitle: 'DT Swiss XRC 310 Carbon Rim' }, rear: { rim: STANS_EX3_29_32, holes: 32, rimTitle: "Stan's Flow EX3 Alloy Rim" }, orderNumber: 95008 });
  const r = await runWebhook(INDEX, 'orders/create', o, { env: { SYSTEM_CUSTOMER_EMAIL: 'on' } });
  assert.equal(r.status, 200);
  assert.match(r.note, /Lengths estimated from I9 Sector 2\.0 29" 28h TR314 \(ERD gap \+2 mm, offset gap \+4 mm\): verify/); assert.match(r.note, /Lengths estimated from I9 Triad 29" 32h TR304 \(ERD gap -2 mm\): verify/);
  const internal = r.restEmails.find((e) => /^I9 System Build Report/.test(e.subject)), customer = r.restEmails.find((e) => /^Your custom spoke colors/.test(e.subject));
  assert.ok(internal && /estimated from I9 Sector 2\.0/.test(internal.html));
  assert.ok(customer, 'the customer email is sent (flag on)');
  assert.ok(!/estimated|Left\/Rotor|Spoke lengths|I9 System chart|ESTIMATED| mm\b/.test(customer.html.replace(/<style[\s\S]*?<\/style>/g, '')), 'no lengths, no estimate text for the customer');
});

/* ------------------------------------------------------------------ 4. DT Swiss: measured ERD and site ERD (Jerry, 2026-11-14) */

test('DT Swiss rims Jerry measured (EX 511 29", FR 541 29" and 27.5", FR 571 29"; SON gauge, bare rim): the estimate runs with the measured AND the site ERD and takes the LONGER lengths per side', () => {
  const MEASURED = { 'DT Swiss EX 511 Alloy Rim (Enduro)|29"': 596, 'DT Swiss FR 541 Alloy Rim (Downhill)|29"': 596, 'DT Swiss FR 541 Alloy Rim (Downhill)|27.5"': 558, 'DT Swiss FR 571 Alloy Rim (Downhill)|29"': 592 };
  const dtRows = EST.filter((e) => e.vendor === 'DT Swiss');
  let withMeasured = 0;
  for (const e of dtRows) {
    const key = `${e.product_title}|${e.size}`;
    if (MEASURED[key] == null) {
      assert.equal(e.measured_effective_erd, '', `${key}: not measured`); assert.match(e.note, /DT Swiss: ERD from site \(not measured\)/); assert.doesNotMatch(e.note, /may change/); assert.equal(e.erd_basis, 'site');
      continue;
    }
    withMeasured++;
    const washer = Number(e.effective_erd) - Number(e.stored_erd);                        // 2 x the 1.0 mm washer of these Mandatory-washer rims
    assert.equal(washer, 2, key);
    assert.equal(Number(e.measured_effective_erd), MEASURED[key] + washer, key);
    const both = estimateLongerOfSiteAndMeasured({ erd: Number(e.effective_erd), offset: Number(e.rim_offset), holes: Number(e.holes) }, MEASURED[key] + washer, CHART_ROWS);
    assert.deepEqual(both.lengths, [Number(e.drive_mm), Number(e.non_drive_mm)], key);
    assert.deepEqual(both.measured.lengths, [Number(e.measured_drive_mm), Number(e.measured_non_drive_mm)], key);
    assert.ok(both.lengths[0] >= both.measured.lengths[0] && both.lengths[1] >= both.measured.lengths[1], 'never shorter than the measured-ERD estimate');
    assert.ok(both.lengths[0] >= both.site.lengths[0] && both.lengths[1] >= both.site.lengths[1], 'never shorter than the site-ERD estimate');
    assert.match(e.note, /measured ERD \d+ .* and site ERD \d+ both run, the longer lengths are used/);
    assert.equal(chartLengthsForRim(e.variant_id).estimated.erd, Number(e.effective_erd), 'the stale-ERD guard compares with the SITE ERD');
  }
  assert.equal(withMeasured, 9, 'EX 511 29" x2, FR 541 29" x3, FR 541 27.5" 32h x2, FR 571 29" x2 = the 9 estimated variants of the measured sizes (the FR 541 27.5" 28h has none; the GR 531 is not in the System list)');
  assert.ok(dtRows.length >= 20 && dtRows.every((e) => !/may change/.test(e.note)), 'nothing says "ERD may change" any more');
});

test('in these five sizes the site (stored) ERD is above the measured one, so the site estimate is the longer one in every case: the lengths are those of the site ERD; the measured ones are 1 to 3 mm shorter', () => {
  const cases = [['EX 511 29" 28h', 597, 596, 28, [303, 305], [302, 304]], ['EX 511 29" 32h', 597, 596, 32, [299, 302], [299, 301]], ['FR 541 29" 28h', 599, 596, 28, [304, 306], [302, 304]], ['FR 541 29" 32h', 599, 596, 32, [300, 303], [299, 301]],
    ['FR 541 27.5" 32h', 561, 558, 32, [282, 284], [278, 281]], ['FR 571 29" 32h', 595, 592, 32, [299, 300], [297, 299]]];
  for (const [name, stored, meas, holes, siteL, measL] of cases) {
    const r = estimateLongerOfSiteAndMeasured({ erd: stored + 2, offset: 0, holes }, meas + 2, CHART_ROWS);
    assert.deepEqual(r.site.lengths, siteL, name); assert.deepEqual(r.measured.lengths, measL, name); assert.deepEqual(r.lengths, siteL, name); assert.equal(r.basis, 'site', name);
  }
  // the FR 541 27.5" 28h has no estimate with either ERD (more than 4 mm from every H2 28h row)
  const none = estimateLongerOfSiteAndMeasured({ erd: 563, offset: 0, holes: 28 }, 560, CHART_ROWS); assert.equal(none.lengths, null);
});

test('longer of the two, per side: a measured ERD ABOVE the site ERD wins; two ERDs that each win one side give the larger of each side', () => {
  const rows = [row('A', 'H2 32h', 600, 299, 302, 0)];
  const up = estimateLongerOfSiteAndMeasured({ erd: 600, offset: 0, holes: 32 }, 602, rows);
  assert.deepEqual(up.site.lengths, [299, 302]); assert.deepEqual(up.measured.lengths, [300, 303]); assert.deepEqual(up.lengths, [300, 303]); assert.equal(up.basis, 'measured');
  const dn = estimateLongerOfSiteAndMeasured({ erd: 602, offset: 0, holes: 32 }, 598, rows);
  assert.deepEqual(dn.lengths, [300, 303]); assert.equal(dn.basis, 'site');
  // one side each (different matched rims): the larger of each side
  const two = [row('Lo', 'H2 32h', 600, 299, 300, 0), row('Hi', 'H2 32h', 604, 298, 305, 0)];
  const mixed = estimateLongerOfSiteAndMeasured({ erd: 600, offset: 0, holes: 32 }, 604, two);
  assert.deepEqual(mixed.lengths, [Math.max(mixed.site.lengths[0], mixed.measured.lengths[0]), Math.max(mixed.site.lengths[1], mixed.measured.lengths[1])]);
});
