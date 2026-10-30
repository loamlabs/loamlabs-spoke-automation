// _lib/system-lengths.js
// I9-SYSTEM: LENGTH-CALC HOOK
//
// Spoke lengths for Industry Nine SYSTEM hubs are NOT calculated yet: the System spoke seats differently from a J-bend or a classic
// straight-pull spoke and the allowance / seating constants must come from I9's engineer. Until then this function returns null and the
// report prints "Spoke lengths for System hubs: not calculated (method pending)". When it returns numbers, _lib/system-report.js shows
// them in the email and in the order note with no other code change.
//
// ROUND 10: for rims that are in I9's own spoke length chart (_lib/i9-system-chart.js, generated from the CSV files) the hook now returns the chart's
// numbers: a LOOKUP, no formula. Everything else still returns null ("not calculated") with a logged reason. The lookup (chart numbers + source) and the
// future calculator stay separable: resolveSystemLengths() below is the one function a real calculator would replace or sit next to; the chart stays as
// the acceptance check.
//
// Do not guess a formula here. When the method arrives:
//   1. fill in the constants below (they are the unknowns, grep "I9-SYSTEM: TODO"),
//   2. implement the body (the classic reference is calculateSpokeLength in _lib/calculator.js),
//   3. keep the signature: calculateSystemSpokeLengths(wheel) -> null | { left, right, note? }   (tests/system-lengths.test.js guards it).

import { chartLengthsForRim, CHART_SOURCE } from './i9-system-chart.js';

/**
 * Input: one wheel. Left = rotor (non-drive) side, right = drive side, the same convention as _lib/calculator.js.
 * Values come from the hub variant / product metafields (custom.hub_flange_diameter_left/right, custom.hub_flange_offset_left/right,
 * custom.hub_spoke_hole_diameter), the rim (custom.rim_erd), the Studio wheel config (spokes per side, crossing per side).
 * Any value Shopify does not have yet is null.
 *
 * @typedef {Object} SystemWheelGeometry
 * @property {'front'|'rear'} position
 * @property {string|null} hubModel                      'Solix' | 'Hydra2'
 * @property {number|null} erd                           rim ERD, mm
 * @property {number|null} spokeHoleDiameter             hub spoke hole diameter, mm
 * @property {{left:number|null, right:number|null}} flangeDiameter   flange (spoke circle) diameter per side, mm
 * @property {{left:number|null, right:number|null}} flangeOffset     center-to-flange distance per side, mm
 * @property {{left:number, right:number}} cross                      crossing per side (3.5 = the Studio's 2:1 drawing value, not an engineering input yet)
 * @property {{left:number, right:number}} spokes                     spokes per side
 * @property {string|null} [rimVariantId]                           (round 10) digits of the rim variant id, the key into the I9 chart map
 * @property {number|null} [holes]                                  (round 10) rim hole count
 * @property {string|number|null} [orderNumber]                     (round 10) for the log line only
 */

/**
 * Result: lengths in mm per side, already rounded the way the spokes are sold, plus an optional note for the report.
 * @typedef {Object} SystemSpokeLengths
 * @property {number} left
 * @property {number} right
 * @property {string} [note]
 * @property {'i9-chart'} [source]                                  (round 10) where the numbers come from
 * @property {string} [confidence]                                  (round 10) 'chart' | 'inferred' | 'check ERD' | 'inferred + check ERD'
 * @property {{section:string, model:string, partNumber:string, erd:number, hub:string}} [chart]   the chart row used
 * @property {string} [sourceText]                                  "source: I9 System chart 2026, row <model> <part number>" (internal report only)
 */

// I9-SYSTEM: TODO allowance mm            (System spoke seating allowance, from I9)
export const SYSTEM_SPOKE_ALLOWANCE_MM = null;
// I9-SYSTEM: TODO rounding rule           ('even' = round up to the next even mm like steel, or whatever I9 sells)
export const SYSTEM_SPOKE_ROUNDING = null;
// I9-SYSTEM: TODO effective-cross rule    (the classic straight-pull code adds 0.5 to the cross; unknown for System)
export const SYSTEM_EFFECTIVE_CROSS_ADJUST = null;

export const SYSTEM_LENGTHS_PENDING_TEXT = 'Spoke lengths for System hubs: not calculated (method pending)';

// Which chart column belongs to which wheel side (left = rotor/non-drive side, right = drive/right side, as everywhere in this file).
// The chart prints "drive side" and "non-drive side" only. Rear hub: drive = the cassette (right) side. Front hubs, from Jerry's analysis (round 10 report):
//   Hydra2 28h front (Boost): the geometry puts the rotor side about 2 mm shorter than the right side and the chart's first column is the shorter, so
//     column 1 ("drive side") = rotor/left, column 2 = right.
//   Solix (24h, 16 + 8 spokes) is the same pair front and rear but MIRRORED between the sides: the longer number goes on the 16-spoke side. Rear: that is the
//     right/drive side = column 1. Front: the Studio draws the 16-spoke (cross 3.5) side on the left/rotor side, so column 1 = left, column 2 = right.
// So: every FRONT hub has column 1 = left (rotor), column 2 = right; every REAR hub has column 1 = right (drive), column 2 = left (rotor).
const COLUMN_SIDES = { front: { first: 'left', second: 'right' }, rear: { first: 'right', second: 'left' } };

// chart hub label -> what the order must have: hub model label (system-build.js SYSTEM_HUB_MODELS) and hole count.
// The payload does not say Solix M, G or SG, so SM/G, SG and SM can only be checked as "a Solix hub with 24 holes".
const CHART_HUBS = { 'H2 28h': { model: 'Hydra2', holes: 28 }, 'H2 32h': { model: 'Hydra2', holes: 32 }, 'SM/G': { model: 'Solix', holes: 24 }, SG: { model: 'Solix', holes: 24 }, SM: { model: 'Solix', holes: 24 } };

const ERD_TOLERANCE_MM = 0.5;
const SOURCE_LABEL = CHART_SOURCE.label;
const r1 = (n) => Math.round(n * 10) / 10;

/**
 * The decision, with the reason when there is no number. Pure (no logging).
 * @param {SystemWheelGeometry} wheel
 * @returns {{ lengths: SystemSpokeLengths|null, reason: string|null }}
 */
export function resolveSystemLengths(wheel) {
  const w = wheel || {};
  const hit = chartLengthsForRim(w.rimVariantId);
  if (!hit) return { lengths: null, reason: 'rim variant is not in the I9 chart map', plain: "This rim is not in I9's spoke length chart, so check the lengths with I9 before ordering spokes." };   // (b)
  const row = hit.row, need = CHART_HUBS[row.hub];
  const holes = Number.isFinite(w.holes) && w.holes > 0 ? w.holes : ((w.spokes && Number(w.spokes.left) + Number(w.spokes.right)) || null);
  if (!need) return { lengths: null, reason: `chart row hub "${row.hub}" is not known`, plain: "The chart row for this rim lists a hub we do not recognize, so check the lengths with I9 before ordering spokes." };
  if (!w.hubModel) return { lengths: null, reason: 'hub model unknown (Solix or Hydra2 not recognized)', plain: "The hub model (Solix or Hydra2) was not recognized on this wheel, so check the lengths with I9 before ordering spokes." };   // (c)
  if (w.hubModel !== need.model || holes !== need.holes) {                                                                  // (c)
    return { lengths: null, reason: `hub ${w.hubModel} ${holes}h does not match the chart row (${row.model} ${row.partNumber} is ${row.hub})`,
      plain: `The hub on this wheel (${w.hubModel} ${holes}h) does not match the hub in I9's chart row for this rim (${row.hub}), so check the lengths with I9 before ordering spokes.` };
  }
  if (w.position !== 'front' && w.position !== 'rear') return { lengths: null, reason: 'wheel position unknown', plain: "The wheel position (front or rear) was not recognized, so check the lengths with I9 before ordering spokes." };
  // Hydra2 32h FRONT (was "not calculated" until Thomas Ward, I9, wrote on 2026-10-30 that the chart lengths apply to the various hubshells / axle widths and that
  // 32/32 System can use the same lengths front and rear): the same two chart numbers as the 32h rear for that rim, any front axle spacing. Which side gets which:
  // the front columns are shorter = left/disc side, longer = right/non-disc side (same COLUMN_SIDES.front as the 28h front), which is also what the hub says
  // (front flange 27.5 mm from center on the disc side, 40.5 mm on the non-disc side: more offset = longer spoke); every Hydra2 32h chart row has drive <= non-drive.
  const front32 = w.position === 'front' && need.model === 'Hydra2' && need.holes === 32;
  const cols = COLUMN_SIDES[w.position];
  const side = { [cols.first]: hit.driveColumn, [cols.second]: hit.nonDriveColumn };
  const flags = [], notes = [];
  if (w.position === 'front' && need.model === 'Solix') {
    flags.push('inferred'); notes.push('front side mapping inferred from geometry, verify against I9');
  }
  if (w.position === 'rear' && need.model === 'Hydra2' && need.holes === 28) {
    flags.push('inferred'); notes.push('the chart does not say front or rear for 28h; used as rear, verify against I9');
  }
  // the ERD the order carries (rim metafield), else the one the store is known to hold for this variant
  const storeErd = Number.isFinite(w.erd) ? w.erd : (hit.storeErd || null);
  if (storeErd != null && Math.abs(storeErd - row.erd) > ERD_TOLERANCE_MM) {
    flags.push('check ERD');
    const label = /^Hush/i.test(row.model) ? 'Hush' : row.model;
    notes.push(`${label}: store ERD ${r1(storeErd)} vs I9 chart ${r1(row.erd)}, confirm with I9 when ordering parts`);
  }
  if (hit.borrowed) notes.push('this rim is not an I9-listed combination; the numbers are the chart row with the same ERD and hole count');
  const lengths = {
    left: side.left, right: side.right, source: 'i9-chart', confidence: flags.length ? flags.join(' + ') : 'chart',
    chart: { section: row.section, model: row.model, partNumber: row.partNumber, erd: row.erd, hub: row.hub },
    sourceText: `source: ${SOURCE_LABEL}, row ${row.model} ${row.partNumber}`
  };
  if (notes.length) lengths.note = notes.join('; ');
  if (front32) {
    // plain side words on the front so the sides cannot be misread; the source line names I9's statement; the internal-email-only line carries the geometry caveat
    lengths.sideLabels = { left: 'Disc side', right: 'Non-disc side' };
    lengths.sourceText = `Source: ${SOURCE_LABEL}, row ${row.model} ${row.partNumber}, 32h pair (Thomas Ward, I9, 2026-10-30: same lengths front and rear)`;
    lengths.internalText = "Front uses the rear 32h pair per I9. Jerry's geometry check differs by up to about 4 mm on one side; if the first real front build looks off, tell Claude.";
  }
  return { lengths, reason: null };
}

// Front-note wording round: the order note and internal email say WHY a wheel has no numbers, in plain words (the reason used to be in the log only).
export const SYSTEM_LENGTHS_NOT_CALCULATED_PREFIX = 'Spoke lengths for System hubs: NOT CALCULATED.';
export function systemLengthsNotCalculatedText(wheel) {
  const { lengths, plain } = resolveSystemLengths(wheel);
  return lengths ? null : `${SYSTEM_LENGTHS_NOT_CALCULATED_PREFIX} ${plain}`;
}

/**
 * @param {SystemWheelGeometry} wheel
 * @returns {SystemSpokeLengths|null}  null = not calculated (the order note keeps "not calculated (method pending)"); the reason is logged with the order number
 */
export function calculateSystemSpokeLengths(wheel) {
  const { lengths, reason } = resolveSystemLengths(wheel);
  if (!lengths) {
    const n = wheel && wheel.orderNumber != null ? wheel.orderNumber : '?';
    console.log(`I9-SYSTEM: ORDER #${n}: spoke lengths not calculated (${(wheel && wheel.position) || '?'} wheel): ${reason}`);
  }
  return lengths;
}
