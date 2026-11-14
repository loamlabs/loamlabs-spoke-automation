// _lib/rim-length-estimate.js
// The rule that gives a rim I9 has NOT listed a spoke length pair: start from a real I9 Hydra2 chart rim and add the geometry difference between the new rim and that I9 rim.
// Jerry's decisions of 2026-11-14 (replaces asking I9 for 90 rows; the offset-aware version replaces the flat copy / half-gap rule of PR #17, kept below as estimateFlatFromChart for the
// hold-out comparison). Pure functions, no I/O: used by scripts/generate-i9-chart.mjs (which checks every row of data/i9-source/ESTIMATED_RIM_LENGTHS.csv against this rule) and by the tests.
//
//   estimated length (per side) = ceil( the I9 rim's length + [spoke length formula(new rim) - spoke length formula(I9 rim)] )
//
//   - The formula is _lib/calculator.js calculateSpokeLength (straight pull, 3 cross) with the Hydra2 hub geometry below. The thread allowance and every other constant are the same
//     for both rims and cancel in the difference, so the result is anchored to I9's own number.
//   - Effective ERD = stored ERD + 2 x washer thickness, unless the washer policy is Not Compatible (api/index.js, same as everywhere else).
//   - Rim offset: positive = the rim's spoke bed is shifted toward the NON-drive side: the non-drive flange is effectively closer by the offset, the drive flange further. This sign is the
//     one that agrees better with I9's own rows (tests/estimated-lengths.test.js checks it against the chart).
//   - Which I9 rim: only Hydra2 rows with the same hole count (28h rims use H2 28h rows, 32h rims H2 32h rows; Solix rows and 2:1 rims never take part), and only rows within 4.0 mm of
//     ERD (nothing is assigned beyond: "lengths not calculated"). Among those, the row with the SMALLEST correction (the larger of the two sides' |difference|, ERD and offset together);
//     on a tie (corrections within 0.05 mm of each other) the one with the LONGER estimated lengths (a spoke too short is worse than one a bit long), flagged.
//   - Rounding is always UP (I9 rounds System spokes up). The result can be shorter than the I9 rim's length only when the correction is a full mm or more; the table lists those.

import { calculateSpokeLength } from './calculator.js';

export const MAX_GAP_MM = 4.0;
export const HYDRA2_HUB_HOLES = { 'H2 28h': 28, 'H2 32h': 32 };
// Hydra2 hub geometry (component library, Hydra2 6-Bolt, the numbers the store uses for the Hydra2 hubs; the System hub spec sheet claude/I9_SYSTEM_HUB_SPECS.md named in the prompt is not on this
// machine). 28h rims are front only: 15x110 Boost, the chart's "drive" column is the disc side. 32h rows are the rear pair (12x148 Boost; I9, Oct 30: same lengths front and rear).
// fd = flange (spoke circle) diameter, f = flange offset from the hub center, both mm.
export const HUB_GEOMETRY = {
  28: { drive: { fd: 59.5, f: 28 }, nonDrive: { fd: 46, f: 41 } },
  32: { drive: { fd: 62, f: 24 }, nonDrive: { fd: 59.5, f: 37 } }
};
export const CROSS = 3;                // base crossing; calculator.js adds 0.5 for a straight-pull hub
export const OFFSET_TOWARD_NON_DRIVE = 1; // +1 = positive rim offset moves the spoke bed toward the non-drive side

const EPS = 1e-9;
const TIE_MM = 0.05; // two corrections that differ by less than 0.05 mm of spoke length are a tie (the formula is not exactly symmetric: +0.496 and -0.497 are the same size for an order)

/** The formula length (mm, without thread allowance) of one side for a rim of effective ERD `erd` and spoke-bed offset `offset`. */
export function geometryLength({ erd, offset = 0, holes, side }) {
  const g = HUB_GEOMETRY[holes] && HUB_GEOMETRY[holes][side];
  if (!g) return NaN;
  const f = side === 'nonDrive' ? g.f - OFFSET_TOWARD_NON_DRIVE * offset : g.f + OFFSET_TOWARD_NON_DRIVE * offset;
  return calculateSpokeLength({ hubType: 'Straight Pull', baseCrossPattern: CROSS, spokeCount: holes, finalErd: erd, hubFlangeDiameter: g.fd, flangeOffset: f, hubSpokeHoleDiameter: 2.6, spOffset: 0 });
}

const up = (x) => Math.ceil(x - EPS);
const r2 = (n) => Math.round(n * 100) / 100;

/**
 * @param {{ erd: number, offset?: number, holes: number }} target   erd = EFFECTIVE ERD of the rim, offset = its spoke-hole offset (mm, default 0)
 * @param {Array<{ erd:number, hub:string, driveColumn:number, nonDriveColumn:number, model:string, partNumber:string, rimOffset?:number }>} chartRows   the I9 chart rows (CHART_ROWS)
 * @returns {null|{ row: object, gap: number, offsetGap: number, deltaDrive: number, deltaNonDrive: number, size: number, tie: boolean, tieMatters: boolean, tiedWith: string[],
 *   plainCopy: [number, number], lengths: [number, number]|null, method: 'estimated'|'none', shorter: boolean }}
 */
export function estimateFromChart(target, chartRows) {
  const holes = target.holes, offset = Number.isFinite(target.offset) ? target.offset : 0;
  const pool = chartRows.filter((r) => HYDRA2_HUB_HOLES[r.hub] === holes);
  if (!pool.length || !Number.isFinite(target.erd)) return null;
  const nearest = Math.min(...pool.map((r) => Math.abs(r.erd - target.erd)));
  const cands = pool.filter((r) => Math.abs(r.erd - target.erd) <= MAX_GAP_MM + EPS).map((r) => {
    const dD = geometryLength({ erd: target.erd, offset, holes, side: 'drive' }) - geometryLength({ erd: r.erd, offset: r.rimOffset || 0, holes, side: 'drive' });
    const dN = geometryLength({ erd: target.erd, offset, holes, side: 'nonDrive' }) - geometryLength({ erd: r.erd, offset: r.rimOffset || 0, holes, side: 'nonDrive' });
    return { r, dD, dN, size: Math.max(Math.abs(dD), Math.abs(dN)), lengths: [up(r.driveColumn + dD), up(r.nonDriveColumn + dN)] };
  });
  if (!cands.length) return { row: pool.slice().sort((a, b) => Math.abs(a.erd - target.erd) - Math.abs(b.erd - target.erd))[0], gap: NaN, offsetGap: NaN, deltaDrive: NaN, deltaNonDrive: NaN, size: NaN, tie: false, tieMatters: false, tiedWith: [], plainCopy: null, lengths: null, method: 'none', shorter: false, nearestErdGap: nearest };
  const best = Math.min(...cands.map((c) => c.size));
  const ties = cands.filter((c) => Math.abs(c.size - best) < TIE_MM).sort((a, b) => (b.lengths[0] + b.lengths[1]) - (a.lengths[0] + a.lengths[1]) || (b.r.driveColumn + b.r.nonDriveColumn) - (a.r.driveColumn + a.r.nonDriveColumn));
  const pick = ties[0], others = ties.slice(1);
  const tieMatters = others.some((t) => t.lengths[0] !== pick.lengths[0] || t.lengths[1] !== pick.lengths[1]);
  return {
    row: pick.r, gap: target.erd - pick.r.erd, offsetGap: offset - (pick.r.rimOffset || 0), deltaDrive: r2(pick.dD), deltaNonDrive: r2(pick.dN), size: r2(pick.size),
    tie: others.length > 0, tieMatters, tiedWith: others.map((t) => `${t.r.model} ${t.r.partNumber}`), plainCopy: [pick.r.driveColumn, pick.r.nonDriveColumn],
    lengths: pick.lengths, method: 'estimated', shorter: pick.lengths[0] < pick.r.driveColumn || pick.lengths[1] < pick.r.nonDriveColumn
  };
}

/**
 * A rim whose ERD was MEASURED in house (Jerry, SON gauge, bare rim; DT Swiss EX 511, FR 541, FR 571) as well as stored on the site: run the estimate with both effective ERDs and take the
 * LONGER lengths per side (a spoke a little long is fine with double-square nipples, too short is a problem). The site's own ERD stays the one the stale-ERD guard compares with.
 * @param {{ erd: number, offset?: number, holes: number }} site   effective ERD from the site
 * @param {number} measuredEffectiveErd   measured ERD (bare rim) + 2 x the washer thickness the site uses for that rim
 * @returns {null|{ primary: object, site: object, measured: object, lengths: [number, number]|null, basis: 'site'|'measured'|'mixed' }}
 */
export function estimateLongerOfSiteAndMeasured(site, measuredEffectiveErd, chartRows) {
  const a = estimateFromChart(site, chartRows), b = estimateFromChart({ ...site, erd: measuredEffectiveErd }, chartRows);
  if (!a) return null;
  if (a.method === 'none' || !b || b.method === 'none') return { primary: a, site: a, measured: b, lengths: a.lengths, basis: 'site' };
  const lengths = [Math.max(a.lengths[0], b.lengths[0]), Math.max(a.lengths[1], b.lengths[1])];
  const sa = a.lengths[0] + a.lengths[1], sb = b.lengths[0] + b.lengths[1];
  const primary = sb > sa ? b : a;   // the estimate that gives the longer pair carries the matched-rim details; a tie stays with the site
  const basis = lengths[0] === a.lengths[0] && lengths[1] === a.lengths[1] ? 'site' : (lengths[0] === b.lengths[0] && lengths[1] === b.lengths[1] ? 'measured' : 'mixed');
  return { primary, site: a, measured: b, lengths, basis };
}

// ---- the flat rule of PR #17 (nearest ERD only; copy up to 1.0 mm of gap, else ceil(length + gap / 2); nothing over 4.0), kept for the hold-out comparison only. Not used for any order.
export const COPY_GAP_MM = 1.0;
export function estimateFlatFromChart(target, chartRows) {
  const pool = chartRows.filter((r) => HYDRA2_HUB_HOLES[r.hub] === target.holes);
  if (!pool.length || !Number.isFinite(target.erd)) return null;
  const dist = (r) => Math.abs(r.erd - target.erd);
  const best = Math.min(...pool.map(dist));
  const ties = pool.filter((r) => Math.abs(dist(r) - best) < EPS);
  const row = ties.slice().sort((a, b) => (b.driveColumn + b.nonDriveColumn) - (a.driveColumn + a.nonDriveColumn))[0];
  const gap = target.erd - row.erd, absGap = Math.abs(gap);
  const adjust = (len) => Math.ceil(len + gap / 2 - EPS);
  const method = absGap > MAX_GAP_MM + EPS ? 'none' : absGap <= COPY_GAP_MM + EPS ? 'copy' : 'adjusted';
  const lengths = method === 'none' ? null : method === 'copy' ? [row.driveColumn, row.nonDriveColumn] : [adjust(row.driveColumn), adjust(row.nonDriveColumn)];
  return { row, gap, method, lengths };
}

const r1 = (n) => Math.round(n * 10) / 10;
const sgn = (n) => (n > 0 ? '+' : '');
/** "estimated from I9 Sector 29" 32h TR256 (ERD gap -2 mm, offset gap +1 mm): verify": the internal marker in the order note, email, sheet and I9 list. */
export function estimatedMarker({ model, partNumber, gap, offsetGap = 0 }) {
  const g = r1(gap), o = r1(offsetGap);
  return `estimated from I9 ${model} ${partNumber} (ERD gap ${sgn(g)}${g} mm${o ? `, offset gap ${sgn(o)}${o} mm` : ''}): verify`;
}
