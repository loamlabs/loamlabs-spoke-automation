// _lib/standard-build.js
// Standard-order version of _lib/system-build.js: recognizes a Standard build that carries the theme's `standardStudio` key, and turns it (plus the
// existing Standard component data) into per-wheel data in the SAME shape systemWheels() produces, so the System image, email and note code is reused.
// Pure data, no network, never throws for bad data (problems become warnings). Everything in `standardStudio` comes from the customer's browser, so it
// is bounded and validated like the System recipe (see the REVIEW notes in system-build.js).
//
// The contract (theme branch agent-b-standard-studio), inside the hidden _build property:
//   _build.spokeInterface = 'standard'   (unchanged)
//   _build.standardStudio = {
//     v: 1, studioOpened: bool,
//     studio: { v:1, hubColor, base, spokes, accent } | null,        // the Studio's own value; per wheel: studio.spokes[pos].{drive,rotor}[k] = color name
//     wheels: { front?: { drive:{n,pcd,cross}, rotor:{n,pcd,cross}, sideLabels:{drive,rotor} }, rear?: {...} },   // exactly what the customer saw; cross 0..4, 0 = radial
//     colors: { '<Color name>': '#hex', ... },                       // every color used, spokes and hubs
//     paint: { blank: 'White Berd', wheels: { front?: { paintColors: ['Blue Berd', ...] }, rear?: {...} } }   // colors that must be painted; [] for steel
//   }
//   Spoke index k is the index as drawn in the Studio's drive-side view (same as System). drive = right side (front) / drive side (rear); rotor = left / non-drive.
//   A wheel with no Studio value is solid in the color of its chosen spoke variant. A build WITHOUT the key is a normal (old) Standard order.

import {
  POSITIONS, SIDES, NEUTRAL_HEX, MAX_SPOKES, ERD_RANGE_MM, PCD_RANGE_MM, MAX_NAME_CHARS, MAX_TITLE_CHARS,
  cap, clip, countColors, rimTitleOf, propValue, optionValue, metaNumber, metaFor, spokeCountOf,
  findWheelBuildLineItem, parseBuildRecipe, isSystemBuildRecipe, SYSTEM_FEE
} from './system-build.js';

import { ringKeyForRim } from './rim-rings.js'; // round 12: which photo rim ring a wheel's pictures get
import { valveFieldsFor } from './valve-colors.js'; // round 15: the valve stem color the customer chose

export const STANDARD_FEE_NAME = SYSTEM_FEE.name;                // the existing fee product, "Custom Spoke Color Configuration"
export const STANDARD_FEE_VARIANTS = { mixed: 'Mixed colors', painted: 'Berd painted color', multi: 'Berd multi-color' };
export const DEFAULT_BLANK = 'White Berd';
export const DEFAULT_ERD_MM = 568;                               // the Studio's own default when a wheel has no usable ERD (the contract carries no ERD)
export const DEFAULT_SIDE_LABELS = { front: { drive: 'Right side', rotor: 'Left side' }, rear: { drive: 'Drive side', rotor: 'Non-drive side' } };
export const MAX_LABEL_CHARS = 30;
const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const own = (obj, key) => obj != null && typeof obj === 'object' && Object.prototype.hasOwnProperty.call(obj, key);

/* ------------------------------------------------------------------ detection */

export function isStandardStudioRecipe(recipe) {
  if (!recipe || typeof recipe !== 'object' || isSystemBuildRecipe(recipe)) return false;
  const s = recipe.standardStudio;
  return !!s && typeof s === 'object' && !Array.isArray(s);
}

// { recipe, lineItem } for a Standard build that carries the standardStudio key; null for System builds, old Standard builds and orders without a build. Never throws.
export function findStandardStudioRecipe(orderData) {
  try {
    const lineItem = findWheelBuildLineItem(orderData);
    if (!lineItem) return null;
    const recipe = parseBuildRecipe(lineItem);
    return isStandardStudioRecipe(recipe) ? { recipe, lineItem } : null;
  } catch (e) { return null; }
}

// The wheels of the build that have a SPOKE PRODUCT (parts-only wheels, "Your Own" spokes and an absent spoke component do not count).
export function standardPositions(recipe) {
  const bt = recipe?.buildType;
  const wanted = bt === 'Front' ? ['front'] : bt === 'Rear' ? ['rear'] : bt === 'Wheel Set' ? ['front', 'rear'] : POSITIONS;
  return wanted.filter((pos) => {
    const sp = recipe?.components?.[pos + 'Spokes'];
    if (!sp || typeof sp !== 'object' || sp.isVirtual) return false;
    if (!(sp.variantId || sp.title)) return false;
    return !/your own/i.test(`${sp.title || ''} ${sp.vendor || ''}`);
  });
}

/* ------------------------------------------------------------------ small helpers */

export function hexOfStandard(recipe, name) {
  const map = recipe?.standardStudio?.colors;
  const h = own(map, name) ? map[name] : null;
  return typeof h === 'string' && HEX_RE.test(h.trim()) ? h.trim() : NEUTRAL_HEX; // validated: it ends up in style attributes and SVG
}

const LEGACY_COLOR = /^custom configuration$/i; // a Color value that is being deleted in Shopify; ignored everywhere
export function chosenSpokeColor(recipe, pos) {
  const comp = recipe?.components?.[pos + 'Spokes'];
  const c = optionValue(comp, 'Color') || comp?.selectedColor || null;
  return c && !LEGACY_COLOR.test(String(c)) ? clip(c, MAX_NAME_CHARS) : null;
}

function cleanLabel(v, d) { v = v == null ? '' : String(v).replace(/\s+/g, ' ').trim(); return v ? clip(v, MAX_LABEL_CHARS) : d; }
function whole(v) { const n = typeof v === 'number' ? v : parseFloat(v); return isFinite(n) && Math.floor(n) === n ? n : null; }

// Wheel config for the images from standardStudio.wheels[pos] ("exactly what the customer saw"). Returns { cfg, sideLabels, warnings } where cfg is
// null when the contract has no usable geometry for the wheel (the images are then skipped and the report says why).
export function standardWheelConfig(recipe, pos, componentData) {
  const warnings = [];
  const spec = recipe?.standardStudio?.wheels?.[pos];
  const labels = {
    drive: cleanLabel(spec?.sideLabels?.drive, DEFAULT_SIDE_LABELS[pos].drive),
    rotor: cleanLabel(spec?.sideLabels?.rotor, DEFAULT_SIDE_LABELS[pos].rotor)
  };
  if (!spec || typeof spec !== 'object') return { cfg: null, sideLabels: labels, warnings: [`${cap(pos)} wheel: standardStudio.wheels.${pos} is missing; no wheel images.`] };
  const side = {};
  for (const s of SIDES) {
    const e = spec[s];
    const n = whole(e?.n), pcd = metaNumber(e, 'pcd', PCD_RANGE_MM);
    let cross = typeof e?.cross === 'number' ? e.cross : parseFloat(e?.cross);
    if (!isFinite(cross) || cross < 0 || cross > 6) { if (e?.cross != null) warnings.push(`${cap(pos)} ${s} side: crossing "${clip(e.cross, 10)}" is not usable (0 to 6); drawn as 3-cross.`); cross = 3; }
    if (n == null || n < 1 || n > MAX_SPOKES / 2) return { cfg: null, sideLabels: labels, warnings: [...warnings, `${cap(pos)} wheel: ${s} side spoke count "${clip(e?.n, 10)}" is not usable (1 to ${MAX_SPOKES / 2}); no wheel images.`] };
    if (!pcd) warnings.push(`${cap(pos)} ${s} side: flange diameter "${clip(e?.pcd, 10)}" is not usable (${PCD_RANGE_MM[0]} to ${PCD_RANGE_MM[1]} mm); drawn as 58 mm.`);
    side[s] = { n, pcd: pcd || 58, cross };
  }
  const rimMeta = metaFor(componentData, recipe.components?.[pos + 'Rim']);
  // the contract's own ERD ("exactly what the customer saw") first, then the rim metafield, the recipe's copy, the Studio default
  const erdSpec = metaNumber(spec, 'erd', ERD_RANGE_MM);
  const erdMeta = metaNumber(rimMeta, 'rim_erd', ERD_RANGE_MM), erdComp = metaNumber(recipe.components?.[pos + 'Rim'], 'rim_erd', ERD_RANGE_MM);
  const erd = erdSpec || erdMeta || erdComp || DEFAULT_ERD_MM;
  const total = side.drive.n + side.rotor.n;
  const spec_ = spokeCountOf(recipe, pos);
  if (spec_ && spec_ !== total) warnings.push(`${cap(pos)} wheel: the Studio wheel has ${total} spokes but the build says ${spec_}h; drawn as the Studio wheel.`);
  return {
    cfg: { erd, rimHoles: total, drive: side.drive, rotor: side.rotor, source: { erd: erdSpec ? 'contract' : erdMeta ? 'metafield' : (erdComp ? 'recipe' : 'default') } },
    sideLabels: labels, warnings
  };
}

// Spoke colors per side with the Studio's own repair rules (snapFromValue): a missing or wrong-length array is filled with that side's base color;
// the base falls back to the chosen spoke variant's color. A wheel with no Studio value is solid in its chosen color.
export function standardSpokeColors(recipe, pos, cfg) {
  const warnings = [];
  const value = recipe?.standardStudio?.studio;
  const chosen = chosenSpokeColor(recipe, pos);
  const out = { drive: [], rotor: [], base: {}, fromStudio: false };
  const studioHas = !!(value && typeof value === 'object' && value.spokes && typeof value.spokes === 'object' && value.spokes[pos]);
  out.fromStudio = studioHas;
  let fallback = chosen;
  if (!fallback) {
    const b = value?.base?.[pos]?.drive;
    fallback = b && !LEGACY_COLOR.test(String(b)) ? clip(b, MAX_NAME_CHARS) : null;
    if (!fallback) { fallback = 'Black'; warnings.push(`${cap(pos)} wheel: no spoke color in the build data; shown as Black.`); }
  }
  for (const side of SIDES) {
    const n = cfg[side].n;
    let base = studioHas ? value?.base?.[pos]?.[side] : null;
    base = base && !LEGACY_COLOR.test(String(base)) ? clip(base, MAX_NAME_CHARS) : fallback;
    out.base[side] = base;
    const arr = studioHas ? value.spokes[pos][side] : null;
    if (Array.isArray(arr) && arr.length === n) out[side] = arr.map((c) => (c == null || LEGACY_COLOR.test(String(c)) ? base : clip(c, MAX_NAME_CHARS)));
    else {
      if (studioHas && Array.isArray(arr)) warnings.push(`${cap(pos)} ${side} side: the saved spoke map has ${arr.length} entries but the wheel has ${n} ${side}-side spokes; drawn as all ${base}.`);
      out[side] = Array.from({ length: n }, () => (studioHas ? base : fallback));
    }
  }
  return { ...out, warnings };
}

export function paintColorsOf(recipe, pos) {
  const arr = recipe?.standardStudio?.paint?.wheels?.[pos]?.paintColors;
  return Array.isArray(arr) ? arr.filter((c) => typeof c === 'string' && c).map((c) => clip(c, MAX_NAME_CHARS)) : null; // null = the key is missing
}
export function blankColorOf(recipe) {
  const b = recipe?.standardStudio?.paint?.blank;
  return typeof b === 'string' && b.trim() ? clip(b.trim(), MAX_NAME_CHARS) : DEFAULT_BLANK;
}

/* ------------------------------------------------------------------ fee rule (the theme's rule, used to cross-check the order) */

// Which fee variant the theme's rule charges for one wheel, or null for no fee. Steel-type product: more than one color = Mixed colors.
// Berd-type (has painted colors): 0 painted colors used: Black and White both = Mixed colors, else none; exactly 1 = Berd painted color; 2+ = Berd multi-color.
export function expectedFeeVariant({ berdType, paintColors, colorNames }) {
  const used = [...new Set(colorNames)];
  if (!berdType) return used.length > 1 ? STANDARD_FEE_VARIANTS.mixed : null;
  const painted = used.filter((c) => (paintColors || []).includes(c)).length;
  if (painted === 0) return used.length > 1 ? STANDARD_FEE_VARIANTS.mixed : null;
  return painted === 1 ? STANDARD_FEE_VARIANTS.painted : STANDARD_FEE_VARIANTS.multi;
}

const isFeeLine = (li) => !!li && (Number(li.variant_id) === SYSTEM_FEE.variantId || String(li.title || li.name || '').includes(STANDARD_FEE_NAME));
function feeLinesOf(orderData, pos) {
  const items = Array.isArray(orderData?.line_items) ? orderData.line_items : [];
  return items.filter((li) => isFeeLine(li) && String(propValue(li, 'Wheel') || '').toLowerCase() === pos);
}
// Spoke lines of the wheel in the order: { color: quantity } (null when no line of the wheel's spoke product is found, so nothing is compared)
function cartSpokeCountsStandard(orderData, recipe, pos, knownColors) {
  const comp = recipe?.components?.[pos + 'Spokes'];
  const title = String(comp?.title || '').trim().toLowerCase();
  if (!title) return null;
  const out = Object.create(null);
  let any = false;
  for (const li of Array.isArray(orderData?.line_items) ? orderData.line_items : []) {
    if (String(li?.title || li?.name || '').trim().toLowerCase() !== title) continue;
    const wheel = String(propValue(li, 'Wheel') || '').toLowerCase();
    if (wheel && wheel !== pos) continue;
    const parts = String(li.variant_title || '').split('/').map((x) => x.trim()).filter(Boolean);
    const color = clip(parts.find((p) => knownColors.includes(p)) || parts[0] || 'unknown', MAX_NAME_CHARS);
    out[color] = (out[color] || 0) + (Number(li.quantity) || 0);
    any = true;
  }
  return any ? out : null;
}

/* ------------------------------------------------------------------ recipe -> wheels */

/**
 * The Standard wheels of the order that have a spoke product, front then rear, in the shape systemWheels() returns (plus sideLabels, hexOf, paint info).
 * @returns {Array<object>}
 */
export function standardWheels(recipe, componentData, orderData) {
  const blank = blankColorOf(recipe);
  return standardPositions(recipe).map((pos) => {
    const comps = recipe.components || {};
    const hub = comps[pos + 'Hub'], rim = comps[pos + 'Rim'], spokes = comps[pos + 'Spokes'];
    const wc = standardWheelConfig(recipe, pos, componentData);
    const warnings = wc.warnings.slice();
    // a wheel without usable geometry still gets its color tables: counts come from the build's spoke count, split evenly
    const cfg = wc.cfg || (() => {
      const total = spokeCountOf(recipe, pos) || 32;
      const a = Math.ceil(total / 2), b = Math.floor(total / 2);
      return { erd: DEFAULT_ERD_MM, rimHoles: total, drive: { n: a, pcd: 58, cross: 3 }, rotor: { n: b, pcd: 58, cross: 3 }, source: { erd: 'default' }, unusable: true };
    })();
    const colors = standardSpokeColors(recipe, pos, cfg);
    warnings.push(...colors.warnings);
    const counts = { drive: countColors(colors.drive), rotor: countColors(colors.rotor), all: countColors([...colors.drive, ...colors.rotor]) };
    const studioHub = recipe.standardStudio?.studio?.hubColor;
    const studioHubName = typeof studioHub === 'string' ? studioHub : (studioHub && typeof studioHub === 'object' ? studioHub[pos] : null);
    const boughtHub = optionValue(hub, 'Color');
    const hubColor = clip(studioHubName || boughtHub || 'Black', MAX_NAME_CHARS);
    if (studioHubName && boughtHub && studioHubName !== boughtHub) warnings.push(`${cap(pos)} hub: the saved hub color is ${clip(studioHubName, MAX_NAME_CHARS)} but the hub ordered is ${clip(boughtHub, MAX_NAME_CHARS)}; drawn ${hubColor}.`);
    const paintColors = paintColorsOf(recipe, pos);
    const berdType = /berd/i.test(String(spokes?.vendor || '')) || (paintColors || []).length > 0;
    if (paintColors == null && berdType) warnings.push(`${cap(pos)} wheel: the order has no paint information (standardStudio.paint.wheels.${pos}.paintColors is missing), so no spokes are listed for painting. Check the colors by hand.`);
    const knownColors = counts.all.map((c) => c.color);
    const cartCounts = orderData ? cartSpokeCountsStandard(orderData, recipe, pos, knownColors) : null;
    if (cartCounts) {
      const mismatch = counts.all.filter((c) => (cartCounts[c.color] || 0) !== c.n).map((c) => `${c.color} (saved colors ${c.n}, cart ${cartCounts[c.color] || 0})`);
      const extra = Object.keys(cartCounts).filter((c) => !counts.all.some((x) => x.color === c)).map((c) => `${c} (cart ${cartCounts[c]}, saved colors 0)`);
      if (mismatch.length || extra.length) warnings.push(`${cap(pos)} wheel: the cart spoke lines do not match the saved colors: ${[...mismatch, ...extra].join(', ')}.`);
    }
    const isMultiColor = counts.all.length > 1;
    const expectedFee = expectedFeeVariant({ berdType, paintColors: paintColors || [], colorNames: knownColors });
    const feeLines = orderData ? feeLinesOf(orderData, pos) : [];
    if (orderData) {
      if (expectedFee && feeLines.length === 0) warnings.push(`${cap(pos)} wheel: the fee rule expects a "${STANDARD_FEE_NAME}" line (${expectedFee}) but the order has none.`);
      else if (!expectedFee && feeLines.length > 0) warnings.push(`${cap(pos)} wheel: the order has a "${STANDARD_FEE_NAME}" line (${clip(feeLines[0].variant_title, 40)}) but the fee rule expects none.`);
      else if (expectedFee && feeLines.length > 0 && !feeLines.some((li) => String(li.variant_title || '').includes(expectedFee))) warnings.push(`${cap(pos)} wheel: the fee line is "${clip(feeLines[0].variant_title, 40)}" but the fee rule expects "${expectedFee}".`);
      if (feeLines.length > 1) warnings.push(`${cap(pos)} wheel: the order has ${feeLines.length} fee lines for this wheel (one expected).`);
    }
    const total = cfg.rimHoles;
    return {
      standard: true, position: pos, label: cap(pos),
      hubModel: null,
      hubTitle: clip(hub?.title || 'n/a', MAX_TITLE_CHARS), hubVariantTitle: hub?.variantTitle ? clip(hub.variantTitle, MAX_TITLE_CHARS) : null,
      hubColor, hubColorHex: hexOfStandard(recipe, hubColor), hexOf: (name) => hexOfStandard(recipe, name),
      freehub: pos === 'rear' ? ((hub?.spec_freehub || recipe?.specs?.freehubType) ? clip(hub?.spec_freehub || recipe?.specs?.freehubType, MAX_NAME_CHARS) : null) : null,
      rimTitle: rimTitleOf(rim), rimRing: ringKeyForRim(rim), // round 12: which photo ring the pictures get
      ...valveFieldsFor(comps[pos + 'ValveStem']), // round 15: valveColor / valveLight / valveColorText / valveColorUnknown, from the build's valve stem component
      spokeProduct: clip(spokes?.title || 'n/a', MAX_TITLE_CHARS), vendor: clip(spokes?.vendor || '', MAX_NAME_CHARS),
      spokeCountLabel: `${total}h`,
      total, config: wc.cfg ? cfg : null, drawConfig: cfg, sideLabels: wc.sideLabels,
      colors, counts, isMultiColor, warnings,
      feeLines: feeLines.length, cartCounts: cartCounts || {}, expectedFee, berdType,
      paintColors: paintColors || [], blank
    };
  });
}
