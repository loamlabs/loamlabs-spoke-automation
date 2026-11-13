// _lib/order-sheet.js
// ORDER-SHEET: the "order sheet" of a builder order as ONE plain JSON object: wheels, lengths per side with their source, the numbered per-spoke list, the high / low tension
// lists, warnings and ORDER-CHECK flags, customer-supplied parts, the I9 order list (System only) and everything needed to redraw the spoke maps. No images in here.
//
//   const sheet = buildOrderSheet({ orderData, componentData, buildReport });
//
// PURE: no network, no Shopify write, no email, no inventory, no clock except `calculatedAt` (inject it in tests). It reads the order the way the webhook does (the hidden `_build`
// line property) and reuses the SAME functions the email and the order note use, so the lengths and the counts on the sheet are the ones in the email.
// Standard (non-System) lengths come from the calculation engine of api/index.js; the caller passes its result as `buildReport` (this file does not import the webhook).
// PRIVACY: the sheet is built from a whitelist of fields. No customer name, email, address or phone, and no order note, ever (tests/order-sheet.test.js fails if one appears).
// The numbers come from _lib/spoke-numbering.js (the only place that knows the rule).

import { findSystemBuildRecipe, findWheelBuildLineItem, parseBuildRecipe, systemWheels, hexFor } from './system-build.js';
import { findStandardStudioRecipe, standardWheels } from './standard-build.js';
import { standardLengthsOf } from './standard-report.js';
import { lengthsFor, imageSpecsFor, highSideOf, lowSideOf } from './system-report.js';
import { calculateSystemSpokeLengths } from './system-lengths.js';
import { suppliedSummary, PARTS_MUST_ARRIVE } from './own-parts.js';
import { extraBuildNotice } from './order-lines.js';
import { buildI9OrderList } from './i9-order-list.js';
import { geometry } from './studio-geometry.js';
import { NUMBERING, numberSpokes } from './spoke-numbering.js';

export const ORDER_SHEET_VERSION = 1;

export class OrderSheetError extends Error {
  constructor(code, message) { super(message); this.name = 'OrderSheetError'; this.code = code; }
}

const SIDES = ['drive', 'rotor'];
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');
const str = (v, max = 200) => (v == null ? null : String(v).slice(0, max));
const rows = (list) => (Array.isArray(list) ? list.map((c) => ({ color: str(c.color, 60), n: Number(c.n) || 0 })) : []);

// the length lookup result of one wheel -> the sheet's lengths object (left = rotor side, right = drive side everywhere in this code base)
function lengthsOfSheet(l) {
  if (!l || l.pending || !(Number(l.left) > 0) || !(Number(l.right) > 0)) {
    return { status: 'not-calculated', rotorMm: null, driveMm: null, text: str(l && l.text, 500) || 'Spoke lengths: not calculated', sourceText: null, chart: null, caveat: null, sideLabels: null, internalText: null };
  }
  return {
    status: 'calculated', rotorMm: Number(l.left), driveMm: Number(l.right), text: str(l.text, 500), sourceText: str(l.sourceText, 400),
    chart: l.chart ? { section: str(l.chart.section, 80), model: str(l.chart.model, 80), partNumber: str(l.chart.partNumber, 30), erd: l.chart.erd != null ? Number(l.chart.erd) : null, hub: str(l.chart.hub, 40) } : null,
    caveat: str(l.extra, 500), sideLabels: l.sideLabels && l.sideLabels.left && l.sideLabels.right ? { rotor: str(l.sideLabels.left, 40), drive: str(l.sideLabels.right, 40) } : null,
    internalText: str(l.internalText, 500)
  };
}

// numbered spokes, lists, redraw data and image descriptors of one wheel; problems become warnings, never exceptions
function drawingPart(w) {
  const out = { spokes: [], lists: { drive: [], rotor: [] }, highSide: null, lowSide: null, redraw: null, images: [], warnings: [] };
  const config = w.config || null;
  if (!config) { out.warnings.push(`${w.label} wheel: no wheel geometry in the build data, so no spoke numbers and no spoke map.`); return out; }
  let geom;
  try {
    const cfg = w.standard === true ? { autoValvePhase: true, wheels: { [w.position]: config } } : { wheels: { [w.position]: config } }; // the same call the pictures use
    geom = geometry(cfg)[w.position];
  } catch (e) { out.warnings.push(`${w.label} wheel: geometry error (${str(e && e.message, 100)}), so no spoke numbers and no spoke map.`); return out; }
  const equal = geom.drive.length === geom.rotor.length;
  if (equal) { out.highSide = highSideOf(w.position); out.lowSide = lowSideOf(w.position); }
  const list = numberSpokes({ position: w.position, geom, colors: w.colors });
  out.spokes = list.map((s) => ({ number: s.number, text: s.text, side: s.side, k: s.k, color: s.color, high: s.high }));
  for (const side of SIDES) out.lists[side] = list.filter((s) => s.side === side).map((s) => ({ number: s.number, text: s.text, color: s.color }));
  out.redraw = {
    config: JSON.parse(JSON.stringify(config)), colors: { drive: [...w.colors.drive], rotor: [...w.colors.rotor] },
    colorsHex: { drive: w.colors.drive.map((c) => (w.hexOf || hexFor)(c)), rotor: w.colors.rotor.map((c) => (w.hexOf || hexFor)(c)) },
    hubColor: str(w.hubColor, 60), hubColorHex: w.hubColorHex || null, valveColor: w.valveColor || null, valveLight: w.valveLight === undefined ? null : w.valveLight,
    rimRing: w.rimRing === undefined ? null : w.rimRing, nipplesHex: w.nipples && w.nipples.hex ? JSON.parse(JSON.stringify(w.nipples.hex)) : null,
    autoValvePhase: w.standard === true
  };
  out.images = imageSpecsFor(w.position, !w.isMultiColor, w.sideLabels || null).map((spec) => ({
    wheel: w.position, view: spec.cid.endsWith('-all-spokes') ? 'all' : (spec.sides[0] === highSideOf(w.position) ? 'high' : 'low'), caption: spec.caption, sides: spec.sides, pov: spec.pov
  }));
  return out;
}

function wheelEntry(w, lengths, extra = {}) {
  const part = drawingPart(w);
  const equalSides = part.highSide != null;
  return {
    position: w.position, label: w.label,
    hubModel: str(w.hubModel, 60), hubTitle: str(w.hubTitle, 160), hubVariantTitle: str(w.hubVariantTitle, 160), hubColor: str(w.hubColor, 60), freehub: str(w.freehub, 60),
    rimTitle: str(w.rimTitle, 200), spokeCountLabel: str(w.spokeCountLabel, 80), total: Number(w.total) || null, ratio: equalSides ? '1:1' : '2:1',
    highSide: part.highSide, lowSide: part.lowSide,
    sides: {
      drive: { count: w.config ? w.config.drive.n : null, lengthMm: lengths.driveMm, counts: rows(w.counts && w.counts.drive) },
      rotor: { count: w.config ? w.config.rotor.n : null, lengthMm: lengths.rotorMm, counts: rows(w.counts && w.counts.rotor) }
    },
    lengths, counts: rows(w.counts && w.counts.all), isMultiColor: !!w.isMultiColor,
    spokes: part.spokes, lists: part.lists, images: part.images, redraw: part.redraw,
    supplied: w.supplied ? { rim: !!w.supplied.rim, hub: !!w.supplied.hub, rimText: str(w.supplied.rimText, 120), hubText: str(w.supplied.hubText, 120), rimApproved: !!w.supplied.rimApproved, hubApproved: !!w.supplied.hubApproved } : null,
    warnings: [...(w.warnings || []), ...part.warnings].map((t) => str(t, 600)),
    ...extra
  };
}

/**
 * @param {{ orderData: object, componentData?: Map|null, buildReport?: object|null, calculatedAt?: string, lengthCalculator?: Function }} o
 *   buildReport = the result of runCalculationEngine() (api/index.js) for a Standard order; without it a Standard order's lengths are "not calculated".
 * @returns {object} the sheet (see the top of this file); throws OrderSheetError('NOT_A_BUILDER_ORDER') when the order has no wheel build
 */
export function buildOrderSheet(o) {
  const orderData = (o && o.orderData) || {};
  const componentData = (o && o.componentData) || null;
  const calculatedAt = (o && o.calculatedAt) || new Date().toISOString();
  const lengthCalculator = (o && o.lengthCalculator) || calculateSystemSpokeLengths;
  const buildLine = findWheelBuildLineItem(orderData);
  const sys = findSystemBuildRecipe(orderData);
  const std = sys ? null : findStandardStudioRecipe(orderData);
  const classicRecipe = !sys && !std && buildLine ? parseBuildRecipe(buildLine) : null;
  const recipe = sys ? sys.recipe : (std ? std.recipe : classicRecipe);
  if (!recipe || typeof recipe !== 'object') throw new OrderSheetError('NOT_A_BUILDER_ORDER', 'The order has no wheel build (no _is_custom_wheel_build line with a _build).');

  const orderNumber = orderData.order_number != null ? orderData.order_number : (orderData.name ? String(orderData.name).replace(/^#/, '') : null);
  const sheet = {
    sheetVersion: ORDER_SHEET_VERSION,
    kind: sys ? 'system' : 'standard', studio: !!(sys || std),
    orderNumber: orderNumber != null ? String(orderNumber) : null, orderName: orderNumber != null ? `#${orderNumber}` : null,
    orderCreatedAt: typeof orderData.created_at === 'string' ? orderData.created_at : null, orderCancelled: !!orderData.cancelled_at,
    buildId: str(recipe.buildId, 80),
    calculation: { mode: 'recalculated', at: calculatedAt, text: `recalculated on ${calculatedAt.slice(0, 10)}, may differ from what was sent` },
    numbering: { version: NUMBERING.version, status: NUMBERING.status, label: NUMBERING.label, rule: NUMBERING.rule },
    numberingVersion: NUMBERING.version, calculatedAt,
    wheels: [], warnings: [], orderChecks: [], customerSupplied: null, i9OrderList: null
  };
  const check = extraBuildNotice(orderData, buildLine);
  if (check) sheet.orderChecks.push(check);

  if (sys) {
    const wheels = systemWheels(recipe, componentData, orderData);
    const lengthsByPos = {};
    for (const w of wheels) lengthsByPos[w.position] = lengthsFor(w, lengthCalculator);
    sheet.wheels = wheels.map((w) => wheelEntry(w, lengthsOfSheet(lengthsByPos[w.position])));
    const supplied = suppliedSummary(wheels);
    if (supplied) sheet.customerSupplied = { text: supplied, reminder: PARTS_MUST_ARRIVE };
    try {
      const i9 = buildI9OrderList({ wheels, lengthsByPos, orderNumber: orderNumber != null ? orderNumber : 'n/a', recipe });
      sheet.i9OrderList = { text: i9.text, linkUrl: i9.linkUrl || null, linkAdds: i9.linkAdds || null, thomasText: i9.thomasText || null, snapshotDate: i9.snapshotDate || null };
    } catch (e) { sheet.i9OrderList = { error: str(e && e.message, 200) }; }
  } else if (std) {
    const wheels = standardWheels(recipe, componentData, orderData);
    const report = o && o.buildReport ? o.buildReport : null;
    sheet.wheels = wheels.map((w) => {
      const l = standardLengthsOf(report, w.position);
      const lengths = l.left && l.right
        ? { status: 'calculated', rotorMm: l.left, driveMm: l.right, text: `Spoke lengths: Left ${l.left} mm, Right ${l.right} mm`, sourceText: 'Source: spoke calculator (rim, hub and spoke data from the store)', chart: null, caveat: null, sideLabels: null, internalText: null }
        : lengthsOfSheet({ pending: true, text: report ? (report[w.position] && report[w.position].error ? `Spoke lengths: NOT CALCULATED. ${report[w.position].error}` : 'Spoke lengths: not calculated') : 'Spoke lengths: not calculated (no calculation was run for this sheet)' });
      return wheelEntry(w, lengths, { spokeProduct: str(w.spokeProduct, 160), vendor: str(w.vendor, 60), sideWords: w.sideLabels ? { drive: str(w.sideLabels.drive, 40), rotor: str(w.sideLabels.rotor, 40) } : null, paint: { berd: !!w.berdType, paintColors: (w.paintColors || []).map((c) => str(c, 60)), blank: str(w.blank, 60) } });
    });
    if (report && Array.isArray(report.errors)) sheet.warnings.push(...report.errors.map((t) => str(t, 600)));
  } else {
    // a Standard build without the Studio key: lengths and parts only (no per-spoke colors exist)
    const report = (o && o.buildReport) || null;
    for (const pos of ['front', 'rear']) {
      const r = report && report[pos];
      if (!r) continue;
      const l = standardLengthsOf(report, pos);
      const lengths = l.left && l.right
        ? { status: 'calculated', rotorMm: l.left, driveMm: l.right, text: `Spoke lengths: Left ${l.left} mm, Right ${l.right} mm`, sourceText: 'Source: spoke calculator (rim, hub and spoke data from the store)', chart: null, caveat: null, sideLabels: null, internalText: null }
        : lengthsOfSheet({ pending: true, text: `Spoke lengths: NOT CALCULATED. ${r.error || ''}`.trim() });
      const inp = r.inputs || {};
      sheet.wheels.push({
        position: pos, label: cap(pos), hubModel: null, hubTitle: str(inp.hub, 160), hubVariantTitle: null, hubColor: null, freehub: null, rimTitle: str(inp.rim, 200),
        spokeCountLabel: null, total: null, ratio: null, highSide: null, lowSide: null,
        sides: { drive: { count: null, lengthMm: lengths.driveMm, counts: [] }, rotor: { count: null, lengthMm: lengths.rotorMm, counts: [] } },
        lengths, counts: [], isMultiColor: false, spokes: [], lists: { drive: [], rotor: [] }, images: [], redraw: null, supplied: null,
        spokeProduct: str(inp.spokes, 160), warnings: r.alert ? [str(r.alert, 400)] : []
      });
    }
    if (!sheet.wheels.length) sheet.warnings.push('No wheel was calculated for this order, so there are no lengths on the sheet.');
    if (report && Array.isArray(report.errors)) sheet.warnings.push(...report.errors.map((t) => str(t, 600)));
  }
  sheet.warnings.push(...sheet.wheels.flatMap((w) => w.warnings));
  return sheet;
}
