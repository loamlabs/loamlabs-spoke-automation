// Generates _lib/i9-system-chart.js from I9's own spoke length chart and Jerry's allowed-rim list (round 10). The numbers are never typed by hand:
//   node scripts/generate-i9-chart.mjs [dir-with-the-two-csv-files]
// Default dir: data/i9-source/ in this repo. THIS COPY IS THE MASTER: change the CSV files here (committed byte for byte, see .gitattributes), run this script,
// commit the CSVs and _lib/i9-system-chart.js together. The copy in loamlabs-system-builder/agent-prompts/i9-length-chart is only a working copy: copy a changed
// file from there into data/i9-source/ first. Inputs:
//   i9_system_length_chart.csv     31 rows from I9's "System- 2026" tab (section, wheel_model, rim_part_number, erd_mm, rim_offset_mm, hub, drive/non-drive length)
//   I9_SYSTEM_ALLOWED_LIST.csv     the rim variants allowed in the System builder; chart_row_for_lengths names the chart row (part number, hub, ERD, offset)
//   ESTIMATED_RIM_LENGTHS.csv      non-I9 rim variants and the I9 Hydra2 row their lengths are estimated from (geometry difference to that rim, offset included); every row is re-derived with the rule in
//                                  _lib/rim-length-estimate.js and the script stops if the file disagrees with the rule or the chart. Such a variant is marked `estimated` in the map.
// The map rim variant id -> chart row is derived from the allowed list (part number + hub + model prefix pick the row); the chart numbers quoted in the
// allowed list must equal the chart's, otherwise this script stops. EXTRA_VARIANTS adds variants that are not in the allowed-list file yet.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { estimateFromChart } from '../_lib/rim-length-estimate.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.resolve(process.argv[2] || path.join(root, 'data', 'i9-source'));
const CHART_FILE = 'i9_system_length_chart.csv', ALLOWED_FILE = 'I9_SYSTEM_ALLOWED_LIST.csv';
const ESTIMATED_FILE = 'ESTIMATED_RIM_LENGTHS.csv'; // rims I9 has not listed: lengths from the nearest I9 Hydra2 rim (rule in _lib/rim-length-estimate.js), Jerry 2026-11-14
const CHART_DATE = '2026-10-28';

// Variants Jerry asked for in the round 10 prompt that the allowed-list file does not contain yet.
const EXTRA_VARIANTS = [
  { variantId: '67819688788275', title: 'Industry Nine Coup Carbon Rim 26" / 32h', part: 'TR175', hub: 'H2 32h', modelPrefix: 'Coup 26', comment: 'Industry Nine Coup Carbon 26" 32h = chart "Coup 26" (Hydra2 Carbon section) TR175, ERD 536, H2 32h, 268/270 (Jerry, round 10 prompt)' },
];
// Facts from the round 10 prompt about single variants.
const VARIANT_NOTES = {
  '51901428400435': { borrowed: true, comment: 'WAO Whisp 29" 28h borrows the chart row Sector 2.0 29" 28h TR314 (ERD 600, H2 28h, 303/305): same ERD and hole count, NOT an I9-listed Whisp combination' },
  '53871010939187': { storeErd: 652, comment: 'WAO Hush 24h 2:1 = chart Hush 24h TR316 (ERD 655, SM, 328/325); the store says ERD 652: confirm with I9 when ordering parts' }
};

function parseCsv(text) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (c !== '\r') cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  const head = rows.shift();
  return rows.filter((r) => r.length > 1 || r[0]).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] === undefined ? '' : r[i]])));
}
const read = (f) => {
  const file = path.join(dir, f);
  if (!fs.existsSync(file)) { console.error(`I9 source file not found: ${file}\nThe two CSV files live in data/i9-source/ in this repo (see the header of this script).`); process.exit(1); }
  return fs.readFileSync(file);
};
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const norm = (s) => String(s).replace(/"/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

const chartBuf = read(CHART_FILE), allowedBuf = read(ALLOWED_FILE);
const chart = parseCsv(chartBuf.toString('utf8')).map((r) => ({
  section: r.section, model: r.wheel_model, partNumber: r.rim_part_number, erd: Number(r.erd_mm), rimOffset: Number(r.rim_offset_mm), hub: r.hub,
  driveColumn: Number(r.drive_side_length_mm), nonDriveColumn: Number(r.non_drive_length_mm)
}));
if (chart.length !== 31) throw new Error(`expected 31 chart rows, found ${chart.length}`);
for (const r of chart) if (![r.erd, r.driveColumn, r.nonDriveColumn].every(Number.isFinite)) throw new Error('bad number in chart row ' + JSON.stringify(r));

function findRow({ part, hub, modelPrefix }) {
  const hits = chart.map((r, i) => ({ r, i })).filter(({ r }) => r.partNumber === part && r.hub === hub && norm(r.model).startsWith(norm(modelPrefix)));
  if (hits.length === 0) throw new Error(`no chart row for ${modelPrefix} ${part} ${hub}`);
  const first = hits[0].r;
  for (const h of hits) if (h.r.driveColumn !== first.driveColumn || h.r.nonDriveColumn !== first.nonDriveColumn || h.r.erd !== first.erd) throw new Error(`ambiguous chart row for ${modelPrefix} ${part} ${hub}`);
  return hits[0].i;
}

const map = {};
for (const a of parseCsv(allowedBuf.toString('utf8'))) {
  const id = a['variant_id'];
  const text = a['chart_row_for_lengths'];
  const m = /^(.*?)\s+(TR\d+)\s+(H2 28h|H2 32h|SM\/G|SG|SM)\s+erd\s+([\d.]+)\s+off\s+(\d+)/.exec(text);
  if (String(a['set_custom.i9_system_allowed']).toLowerCase() !== 'true' || !m) continue; // explicit FALSE rows and rows without a chart row stay out of the map
  const idx = findRow({ part: m[2], hub: m[3], modelPrefix: m[1] });
  const row = chart[idx];
  if (row.erd !== Number(m[4]) || row.rimOffset !== Number(m[5])) throw new Error(`variant ${id}: ERD/offset in the allowed list differ from the chart (${text})`);
  if (Number(a['chart_drive_mm']) !== row.driveColumn || Number(a['chart_non_drive_mm']) !== row.nonDriveColumn) throw new Error(`variant ${id}: the chart numbers in the allowed list differ from the chart (${text})`);
  map[id] = { row: idx, title: `${a['product_title']} ${a['variant_title']}`, ...(VARIANT_NOTES[id] || {}) };
}
for (const e of EXTRA_VARIANTS) {
  if (map[e.variantId]) throw new Error('extra variant already in the allowed list: ' + e.variantId);
  map[e.variantId] = { row: findRow(e), title: e.title, comment: e.comment, ...(VARIANT_NOTES[e.variantId] || {}) };
}
const estimatedBuf = read(ESTIMATED_FILE);
const estimatedRows = parseCsv(estimatedBuf.toString('utf8'));
for (const e of estimatedRows) {
  const id = e['variant_id'];
  if (!/^\d+$/.test(id)) throw new Error('estimated list: bad variant id ' + id);
  if (map[id]) throw new Error('estimated list: variant already has an I9 chart row of its own (allowed list, extras or borrowed): ' + id);
  const holes = Number(e['holes']), erd = Number(e['effective_erd']), offset = Number(e['rim_offset']);
  const est = estimateFromChart({ erd, offset, holes }, chart);
  if (!est || est.method === 'none') throw new Error(`estimated list: variant ${id} has no estimate by the rule (ERD gap over 4 mm or no row)`);
  const idx = chart.findIndex((r) => r.model === e['matched_model'] && r.partNumber === e['matched_part'] && r.hub === e['matched_hub']);
  if (idx < 0 || chart[idx] !== est.row) throw new Error(`estimated list: variant ${id}: the rule picks ${est.row.model} ${est.row.partNumber} ${est.row.hub}, the file says ${e['matched_model']} ${e['matched_part']} ${e['matched_hub']}`);
  if (Number(e['erd_gap']) !== est.gap || Number(e['offset_gap']) !== est.offsetGap || Number(e['delta_drive']) !== est.deltaDrive || Number(e['delta_non_drive']) !== est.deltaNonDrive || Number(e['drive_mm']) !== est.lengths[0] || Number(e['non_drive_mm']) !== est.lengths[1]) throw new Error(`estimated list: variant ${id}: gap, correction or lengths differ from the rule (${JSON.stringify({ gap: est.gap, offsetGap: est.offsetGap, dD: est.deltaDrive, dN: est.deltaNonDrive, lengths: est.lengths })})`);
  if (Number(e['matched_erd']) !== est.row.erd || Number(e['matched_offset']) !== est.row.rimOffset) throw new Error(`estimated list: variant ${id}: matched ERD or offset differs from the chart`);
  map[id] = { row: idx, title: `${e['product_title']} ${e['size']} / ${holes}h`, estimated: { erd, offset, gap: est.gap, offsetGap: est.offsetGap, drive: est.lengths[0], nonDrive: est.lengths[1] } };
}
const ids = Object.keys(map).sort((a, b) => (a < b ? -1 : 1));

const js = (v) => JSON.stringify(v);
const lines = [];
lines.push(`// _lib/i9-system-chart.js`);
lines.push(`// GENERATED by scripts/generate-i9-chart.mjs from ${CHART_FILE} and ${ALLOWED_FILE} (project folder agent-prompts/i9-length-chart). Do not edit by hand.`);
lines.push(`// Industry Nine's own spoke length chart for SYSTEM wheels ("System- 2026" tab, ${CHART_DATE}): a LOOKUP, not a formula. It later becomes the acceptance check`);
lines.push(`// for a real calculator. Columns are as I9 prints them: driveColumn = "drive side", nonDriveColumn = "non-drive side"; which wheel side each belongs to for a`);
lines.push(`// front or a rear hub is decided in _lib/system-lengths.js (side mapping), not here.`);
lines.push('');
lines.push(`export const CHART_SOURCE = ${js({ chartFile: CHART_FILE, allowedListFile: ALLOWED_FILE, date: CHART_DATE, label: 'I9 System chart 2026', chartSha256: sha(chartBuf), allowedListSha256: sha(allowedBuf), estimatedListFile: ESTIMATED_FILE, estimatedListSha256: sha(estimatedBuf) })};`);
lines.push('');
lines.push(`// ${chart.length} chart rows, in file order.`);
lines.push(`export const CHART_ROWS = [`);
chart.forEach((r, i) => lines.push(`  ${js(r)}${i < chart.length - 1 ? ',' : ''} // ${i}`));
lines.push(`];`);
lines.push('');
lines.push(`// Rim variant id (digits) -> chart row index. ${ids.length} variants: Jerry's allowed list plus the Coup Carbon 26" 32h, and ${estimatedRows.length} rims I9 has not listed (\`estimated\`: lengths from the nearest I9 Hydra2 rim, ESTIMATED_RIM_LENGTHS.csv). storeErd = the ERD the store holds when it differs from the chart.`);
lines.push(`export const RIM_VARIANT_MAP = {`);
ids.forEach((id, k) => {
  const e = map[id];
  if (e.comment) lines.push(`  // ${e.comment}`);
  const { comment, ...rest } = e; // eslint-disable-line no-unused-vars
  lines.push(`  ${js(id)}: ${js(rest)}${k < ids.length - 1 ? ',' : ''}`);
});
lines.push(`};`);
lines.push('');
lines.push(`/**`);
lines.push(` * The chart numbers for a rim variant: no hub logic, no side mapping.`);
lines.push(` * @param {string|number} rimVariantId  digits, or a gid://shopify/ProductVariant/<digits>`);
lines.push(` * @returns {null|{ source: 'i9-chart', row: object, driveColumn: number, nonDriveColumn: number, variantTitle: string, borrowed?: boolean, storeErd?: number, estimated?: { erd: number, offset: number, gap: number, offsetGap: number } }}`);
lines.push(` */`);
lines.push(`export function chartLengthsForRim(rimVariantId) {`);
lines.push(`  const id = String(rimVariantId == null ? '' : rimVariantId).replace(/^.*\\//, '');`);
lines.push(`  if (!Object.prototype.hasOwnProperty.call(RIM_VARIANT_MAP, id)) return null;`);
lines.push(`  const e = RIM_VARIANT_MAP[id], row = CHART_ROWS[e.row];`);
lines.push(`  return { source: 'i9-chart', row, driveColumn: e.estimated ? e.estimated.drive : row.driveColumn, nonDriveColumn: e.estimated ? e.estimated.nonDrive : row.nonDriveColumn, variantTitle: e.title, ...(e.estimated ? { estimated: { erd: e.estimated.erd, offset: e.estimated.offset, gap: e.estimated.gap, offsetGap: e.estimated.offsetGap } } : {}), ...(e.borrowed ? { borrowed: true } : {}), ...(e.borrowedFrom ? { borrowedFrom: e.borrowedFrom } : {}), ...(e.storeErd ? { storeErd: e.storeErd } : {}) };`);
lines.push(`}`);
lines.push('');
fs.writeFileSync(path.join(root, '_lib', 'i9-system-chart.js'), lines.join('\n'));
console.log(`wrote _lib/i9-system-chart.js: ${chart.length} chart rows, ${ids.length} rim variants`);
