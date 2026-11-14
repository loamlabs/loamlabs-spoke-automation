// _lib/rim-length-estimate.js
// The rule that gives a rim I9 has NOT listed a spoke length pair: take the I9 Hydra2 chart rim with the closest ERD (same hole count) and copy its lengths, or adjust them
// when the ERD gap is bigger. Jerry's decision of 2026-11-14 (replaces asking I9 for 90 rows). Pure functions, no I/O: used by scripts/generate-i9-chart.mjs (which checks every
// row of data/i9-source/ESTIMATED_RIM_LENGTHS.csv against this rule) and by the tests. Only Hydra2 rows are candidates (28h rims use the H2 28h rows, 32h rims the H2 32h rows);
// Solix rows and 2:1 rims never take part.
//
//   effective ERD   = stored ERD + 2 x washer thickness, unless the washer policy is Not Compatible (api/index.js, same as everywhere else)
//   nearest ERD     = smallest |rim ERD - chart ERD|; the rim offset is NOT part of the choice (it is shown for both rims)
//   tie             = two chart rows equally near: the one with the LONGER lengths (a spoke too short is worse than one a bit long); flagged
//   gap <= 1.0 mm   -> COPY the chart lengths
//   1.0 < gap <= 4  -> ADJUSTED: ceil(chart length + gap / 2), gap = rim ERD - chart ERD (signed; 1 mm of rim ERD is about 0.5 mm of spoke length; a larger rim = longer spoke)
//   gap > 4.0 mm    -> nothing is assigned ("lengths not calculated")

export const COPY_GAP_MM = 1.0;
export const MAX_GAP_MM = 4.0;
export const HYDRA2_HUB_HOLES = { 'H2 28h': 28, 'H2 32h': 32 };

const EPS = 1e-9;

/**
 * @param {{ erd: number, holes: number }} target   erd = EFFECTIVE ERD of the rim
 * @param {Array<{ erd:number, hub:string, driveColumn:number, nonDriveColumn:number, model:string, partNumber:string, rimOffset?:number }>} chartRows   the I9 chart rows (CHART_ROWS)
 * @returns {null|{ row: object, gap: number, absGap: number, tie: boolean, tieMatters: boolean, tiedWith: string[], copy: [number, number], adjusted: [number, number], method: 'copy'|'adjusted'|'none', lengths: [number, number]|null }}
 */
export function estimateFromChart(target, chartRows) {
  const pool = chartRows.filter((r) => HYDRA2_HUB_HOLES[r.hub] === target.holes);
  if (!pool.length || !Number.isFinite(target.erd)) return null;
  const dist = (r) => Math.abs(r.erd - target.erd);
  const best = Math.min(...pool.map(dist));
  const ties = pool.filter((r) => Math.abs(dist(r) - best) < EPS);
  const row = ties.slice().sort((a, b) => (b.driveColumn + b.nonDriveColumn) - (a.driveColumn + a.nonDriveColumn))[0];
  const gap = target.erd - row.erd;
  const adjust = (len) => Math.ceil(len + gap / 2 - EPS);
  const absGap = Math.abs(gap);
  const method = absGap > MAX_GAP_MM + EPS ? 'none' : absGap <= COPY_GAP_MM + EPS ? 'copy' : 'adjusted';
  const copy = [row.driveColumn, row.nonDriveColumn], adjusted = [adjust(row.driveColumn), adjust(row.nonDriveColumn)];
  const others = ties.filter((t) => t !== row);
  // tie = another chart row is exactly as near. It only matters (tieMatters) when that row has different lengths: I9's twin rims (same ERD, same lengths) are not a real choice.
  const tieMatters = others.some((t) => t.driveColumn !== row.driveColumn || t.nonDriveColumn !== row.nonDriveColumn);
  return { row, gap, absGap, tie: others.length > 0, tieMatters, tiedWith: others.map((t) => `${t.model} ${t.partNumber}`), copy, adjusted, method, lengths: method === 'none' ? null : method === 'copy' ? copy : adjusted };
}

const r1 = (n) => Math.round(n * 10) / 10;
/** "estimated from I9 Sector 29" 32h TR256 (ERD gap -2 mm, adjusted): verify": the internal marker in the order note, email, sheet and I9 list. */
export function estimatedMarker({ model, partNumber, gap, method }) {
  const g = r1(gap);
  return `estimated from I9 ${model} ${partNumber} (ERD gap ${g > 0 ? '+' : ''}${g} mm, ${method === 'adjusted' ? 'adjusted' : 'copied'}): verify`;
}
