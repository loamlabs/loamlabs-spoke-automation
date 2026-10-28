// _lib/system-build.js
// I9-SYSTEM: recognizes an Industry Nine System build in a Shopify order and turns its _build recipe + Studio value into the
// per-wheel data the report needs (hub model, counts per side, colors per spoke, wheel geometry config). Pure data, no network.
//
// What a System build writes into the hidden _build line property (dev theme, variant-builder.js getCleanBuildStateForSaving):
//   {
//     step, buildType: 'Front' | 'Rear' | 'Wheel Set', ridingStyle, ridingStyleDisplay,
//     spokeInterface: 'system',                                  // 'standard' for every classic build
//     system: { v: 1, studioOpened: bool,
//               studio: { v: 1, hubColor: { front, rear }, base: { front: { drive, rotor }, rear: {...} },
//                         spokes: { front: { drive: [names], rotor: [names] }, rear: {...} }, accent } },
//     customerSupplied, specs: { brakeStyle, systemHub: 'Solix' | 'Hydra2', frontSpokeCount: '24h', rearSpokeCount, frontHubSpacing,
//                                rearHubSpacing, freehubType, frontWheelSize, rearWheelSize, ... },
//     components: { frontRim, frontHub, frontSpokes, frontRequiredAddons: [fee], rearRim, rearHub, rearSpokes, rearRequiredAddons, rearComponentFreehub, ... },
//     selectedOptionalAddons, buildId, _ui
//   }
//   Components keep variantId, title, variantTitle, sku, price, vendor, selectedOptions (productId, image, tags, pairingKey, handle are stripped).
//   System spokes: { title: 'Industry Nine SYSTEM Spokes', selectedOptions: [{ name: 'Color', value }, { name: 'Length', value: '-' }], selectedColor, i9: true, unitPrice }.
//   Spoke index k in value.spokes[wheel][side] is the index as drawn in the Studio's drive-side view (see _lib/studio-geometry.js).

import { ringKeyForRim } from './rim-rings.js'; // round 12: which photo rim ring a wheel's pictures get

/* ------------------------------------------------------------------ constants vendored from the dev theme (assets/i9-system.js CFG) */

// ONE name-to-hex list for spoke and hub colors (theme CFG.colorHex). Unknown names draw neutral gray, like the Studio.
export const SYSTEM_COLOR_HEX = {
  Black: '#1d1f23', Blue: '#1f62d6', Bronze: '#8d6a3e', Gold: '#dcae2a', Green: '#2f9e48', Lime: '#a5d12b',
  Orange: '#f07a1a', Pink: '#ee5ba3', Purple: '#7b3fb9', Red: '#d0262b', Silver: '#c3c8cf', Turquoise: '#20b2aa'
};
export const NEUTRAL_HEX = '#8a9099'; // the Studio's swatch for a color without a hex

export const SYSTEM_HUB_MODELS = {
  Hydra2: { label: 'Hydra2', ratio: '1:1', match: /hydra/i },
  Solix: { label: 'Solix', ratio: '2:1', match: /solix/i }
};

// I9-SYSTEM: TODO real data. The Studio's sample geometry (theme CFG.sample), used when the hub flange / rim ERD metafields are blank.
// Crossing per side is not in Shopify yet, so it ALWAYS comes from here (exactly as the theme does).
export const SYSTEM_SAMPLE_GEOMETRY = {
  Solix: { erd: 568, rear: { drive: { pcd: 52, cross: 3.5 }, rotor: { pcd: 40, cross: 1.4 } }, front: { drive: { pcd: 40, cross: 1.4 }, rotor: { pcd: 43, cross: 3.5 } } },
  Hydra2: { erd: 590, rear: { drive: { pcd: 54, cross: 3 }, rotor: { pcd: 54, cross: 3 } }, front: { drive: { pcd: 46, cross: 2 }, rotor: { pcd: 46, cross: 2 } } }
};

export const SYSTEM_FEE = {
  name: 'Custom Spoke Color Configuration',
  variantGid: 'gid://shopify/ProductVariant/67791816196403',
  variantId: 67791816196403
};
export const SYSTEM_SPOKE_PRODUCT_TITLE = 'Industry Nine SYSTEM Spokes';

export const SIDES = ['drive', 'rotor'];
export const POSITIONS = ['front', 'rear'];

/* ------------------------------------------------------------------ detection */

// REVIEW: own-property lookups only. A color or hub name like "constructor" / "__proto__" from the customer's _build used to return
// Object.prototype members (a function ended up inside a style attribute, and the hub model label became "undefined").
const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
export function hexFor(name) { return own(SYSTEM_COLOR_HEX, name) ? SYSTEM_COLOR_HEX[name] : NEUTRAL_HEX; }
export function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; }

// REVIEW: bounds for everything the customer's _build can put into the drawing. Out-of-range geometry made the native renderer
// panic (tiny-skia unwrap on a None value at rim_erd = 0.0001, which aborts the whole Node process) and a spoke count like
// "99999999h" allocated arrays until the process died. Values outside these ranges are treated as absent (sample geometry).
export const MAX_SPOKES = 64;                 // I9 sells 24h / 28h / 32h; 64 leaves room without letting the O(n^2) lacing run away
export const ERD_RANGE_MM = [200, 800];       // 12" to 36" rims
export const PCD_RANGE_MM = [15, 150];        // flange diameters
export const MAX_NAME_CHARS = 40;             // color names ("Turquoise" is 9); longer values are cut, which keeps notes and emails bounded
export const MAX_TITLE_CHARS = 200;           // component titles copied from the recipe
export function clip(s, max) { s = String(s == null ? '' : s); return s.length > max ? s.slice(0, max) + '…' : s; }

export function propValue(lineItem, name) {
  const p = Array.isArray(lineItem?.properties) ? lineItem.properties.find((x) => x && x.name === name) : null;
  return p ? p.value : undefined;
}

// The wheel-build placeholder line (same test the webhook uses), or null.
export function findWheelBuildLineItem(orderData) {
  const items = Array.isArray(orderData?.line_items) ? orderData.line_items : [];
  return items.find((item) => propValue(item, '_is_custom_wheel_build') === 'true') || null;
}

// Parses the _build property of a line item; null when missing or not JSON (never throws).
export function parseBuildRecipe(lineItem) {
  const raw = propValue(lineItem, '_build');
  if (!raw) return null;
  try { return typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (e) { return null; }
}

export function isSystemBuildRecipe(recipe) {
  if (!recipe || typeof recipe !== 'object') return false;
  if (recipe.spokeInterface === 'system') return true;
  return POSITIONS.some((pos) => recipe.components && recipe.components[pos + 'Spokes'] && recipe.components[pos + 'Spokes'].i9 === true);
}

// { recipe, lineItem } for a System build order, null for everything else (Standard builds, orders without a build). Never throws.
export function findSystemBuildRecipe(orderData) {
  try {
    const lineItem = findWheelBuildLineItem(orderData);
    if (!lineItem) return null;
    const recipe = parseBuildRecipe(lineItem);
    return isSystemBuildRecipe(recipe) ? { recipe, lineItem } : null;
  } catch (e) { return null; }
}

// The $25 "Custom Spoke Color Configuration" line: by variant id, or by title as a fallback. Inventory is never touched for it.
export function isSystemFeeLineItem(li) {
  if (!li) return false;
  if (Number(li.variant_id) === SYSTEM_FEE.variantId) return true;
  const t = String(li.title || li.name || '');
  return t.includes(SYSTEM_FEE.name);
}
export function isSystemSpokeLineItem(li) {
  return !!li && String(li.title || li.name || '').includes(SYSTEM_SPOKE_PRODUCT_TITLE);
}

/* ------------------------------------------------------------------ recipe -> wheels */

export function systemPositions(recipe) {
  const bt = recipe?.buildType;
  if (bt === 'Front') return ['front'];
  if (bt === 'Rear') return ['rear'];
  if (bt === 'Wheel Set') return ['front', 'rear'];
  // unknown buildType: whatever wheels have a spoke component
  return POSITIONS.filter((pos) => recipe?.components && recipe.components[pos + 'Spokes']);
}

export function hubModelOf(recipe, pos) {
  const name = recipe?.specs?.systemHub;
  if (typeof name === 'string' && own(SYSTEM_HUB_MODELS, name)) return SYSTEM_HUB_MODELS[name];
  const hub = recipe?.components?.[pos + 'Hub'];
  const text = [hub?.wheelModel, hub?.title].filter(Boolean).join(' ');
  for (const m of Object.values(SYSTEM_HUB_MODELS)) if (m.match.test(text)) return m;
  return null;
}

export function spokeCountOf(recipe, pos) {
  const raw = recipe?.specs?.[pos + 'SpokeCount'];
  const n = parseInt(String(raw == null ? '' : raw).replace(/\D/g, ''), 10);
  return isFinite(n) && n > 0 && n <= MAX_SPOKES ? n : 0; // REVIEW: 0 = unknown, the caller falls back to the model's default count
}

// Same split as the theme (i9-system.js sideCounts): 2:1 rear high side = drive, front high side = rotor.
export function sideCounts(model, pos, total) {
  const ratio = model ? model.ratio : '1:1';
  if (!total) total = 32;
  if (ratio === '2:1') {
    const high = Math.round(total * 2 / 3), low = total - high;
    return pos === 'rear' ? { drive: high, rotor: low } : { drive: low, rotor: high };
  }
  return { drive: Math.ceil(total / 2), rotor: Math.floor(total / 2) };
}

export function optionValue(comp, name) {
  const o = Array.isArray(comp?.selectedOptions) ? comp.selectedOptions.find((x) => x && String(x.name).toLowerCase() === name.toLowerCase()) : null;
  return o ? o.value : null;
}
// A positive number from a metafield / recipe field, or null; REVIEW: with an optional [min, max] range (out of range = null).
export function metaNumber(meta, key, range) {
  const v = meta && typeof meta === 'object' ? meta[key] : undefined;
  const n = parseFloat(v);
  if (!isFinite(n) || n <= 0) return null;
  if (range && (n < range[0] || n > range[1])) return null;
  return n;
}

// Metafields for a component (componentData is the webhook's Map variantId -> merged product+variant metafields, or null).
export function metaFor(componentData, comp) {
  if (!componentData || !comp?.variantId) return null;
  const get = typeof componentData.get === 'function' ? (k) => componentData.get(k) : (k) => componentData[k];
  return get(comp.variantId) || null;
}

// The Studio wheel config for one position, built exactly like the theme's wheelConfig(pos): flange diameters (right = drive side)
// and ERD from the metafields when present, else the sample numbers; crossing always from the sample table; spoke split from the model ratio.
export function wheelConfigFor(recipe, pos, componentData) {
  const model = hubModelOf(recipe, pos) || SYSTEM_HUB_MODELS.Hydra2;
  const sample = SYSTEM_SAMPLE_GEOMETRY[model.label] || SYSTEM_SAMPLE_GEOMETRY.Hydra2;
  const total = spokeCountOf(recipe, pos) || (model.label === 'Solix' ? 24 : 32);
  const n = sideCounts(model, pos, total);
  const hubMeta = metaFor(componentData, recipe.components?.[pos + 'Hub']);
  const rimMeta = metaFor(componentData, recipe.components?.[pos + 'Rim']);
  const pcdDrive = metaNumber(hubMeta, 'hub_flange_diameter_right', PCD_RANGE_MM), pcdRotor = metaNumber(hubMeta, 'hub_flange_diameter_left', PCD_RANGE_MM);
  const rimComp = recipe.components?.[pos + 'Rim'];
  const erdMeta = metaNumber(rimMeta, 'rim_erd', ERD_RANGE_MM);
  const erd = erdMeta || metaNumber(rimComp, 'rim_erd', ERD_RANGE_MM); // metafield first, then the copy the theme put in the recipe (customer-controlled: range-checked)
  return {
    hubName: model.label,
    erd: erd || sample.erd,
    rimHoles: total,
    drive: { n: n.drive, pcd: pcdDrive || sample[pos].drive.pcd, cross: sample[pos].drive.cross },
    rotor: { n: n.rotor, pcd: pcdRotor || sample[pos].rotor.pcd, cross: sample[pos].rotor.cross },
    source: { erd: erdMeta ? 'metafield' : (erd ? 'recipe' : 'sample'), pcdDrive: pcdDrive ? 'metafield' : 'sample', pcdRotor: pcdRotor ? 'metafield' : 'sample', cross: 'sample' }
  };
}

function filled(n, v) { const a = []; for (let i = 0; i < n; i++) a.push(v); return a; }

// Spoke colors per side for one wheel, with the Studio's own repair rules (snapFromValue): a missing or wrong-length array is filled
// with that side's base color; the base falls back to the Step 3 spoke color, then Black.
export function spokeColorsFor(recipe, pos, cfg) {
  const warnings = [];
  const value = recipe?.system?.studio;
  const comp = recipe?.components?.[pos + 'Spokes'];
  const fallbackBase = clip(comp?.selectedColor || optionValue(comp, 'Color') || 'Black', MAX_NAME_CHARS);
  const out = { drive: [], rotor: [], base: {}, fromStudio: !!(value && value.spokes && value.spokes[pos]) };
  SIDES.forEach((side) => {
    const n = cfg[side].n;
    let base = value?.base?.[pos]?.[side];
    base = base ? clip(base, MAX_NAME_CHARS) : fallbackBase;
    out.base[side] = base;
    const arr = value?.spokes?.[pos]?.[side];
    if (Array.isArray(arr) && arr.length === n) out[side] = arr.map((c) => (c == null ? base : clip(c, MAX_NAME_CHARS)));
    else {
      if (Array.isArray(arr)) warnings.push(`${cap(pos)} ${side} side: Studio spoke map has ${arr.length} entries but the wheel has ${n} ${side}-side spokes; drawn as all ${base}.`);
      out[side] = filled(n, base);
    }
  });
  if (!out.fromStudio) warnings.push(`${cap(pos)} wheel: no Studio value in the recipe (Studio never opened); all spokes shown in the base color ${fallbackBase}.`);
  out.warnings = warnings;
  return out;
}

// [{ color, n }] by count (desc) then name.
export function countColors(names) {
  const m = new Map();
  (names || []).forEach((c) => m.set(c, (m.get(c) || 0) + 1));
  return [...m.entries()].map(([color, n]) => ({ color, n })).sort((a, b) => b.n - a.n || a.color.localeCompare(b.color));
}

export function rimTitleOf(comp) {
  if (!comp) return 'n/a';
  const size = optionValue(comp, 'Size');
  return clip(size ? `${comp.title} - ${size}` : String(comp.title || 'n/a'), MAX_TITLE_CHARS);
}

// Since round 8 of the theme (2026-10) a wheel's System spokes are ONE bundle line per wheel (quantity 1, the variant is the wheel's most-used color, the line
// property _spoke_bundle = "1", and "Spoke Colors" lists the wheel's counts: "Red ×22, Orange ×6", or just "Black" for a solid wheel). Orders placed before that
// have one line per color with quantity = number of spokes and neither property. A bundle line's quantity says nothing about spokes, so its counts come from the
// "Spoke Colors" line property; a solid wheel's single color stands for the wheel's whole spoke count (wheelTotal).
export function isSpokeBundleLineItem(li) {
  return isSystemSpokeLineItem(li) && String(propValue(li, '_spoke_bundle') ?? '').trim() === '1';
}
// "Red ×22, Orange ×6" -> { Red: 22, Orange: 6 }; "Black" -> { Black: wheelTotal }; null when there is no usable text.
export function parseSpokeColorsProperty(text, wheelTotal) {
  if (typeof text !== 'string' || !text.trim()) return null;
  const out = Object.create(null);
  for (const part of text.split(',')) {
    const t = part.trim();
    if (!t) continue;
    const m = /^(.*\S)\s+[\u00d7x]\s*(\d+)$/i.exec(t);
    const color = clip(m ? m[1].trim() : t, MAX_NAME_CHARS);
    out[color] = (out[color] || 0) + (m ? Number(m[2]) : (Number(wheelTotal) || 0));
  }
  return Object.keys(out).length ? out : null;
}

// Spoke lines in the ORDER, to cross-check the Studio counts: { color: spokes }. One bundle line per wheel (new format, counts from its "Spoke Colors" property;
// wheelTotal = the wheel's spoke count, used for a solid wheel's one color) or one line per color (old format, quantity = spokes); both can be in the same order.
export function cartSpokeCounts(orderData, pos, wheelTotal) {
  const out = Object.create(null); // REVIEW: keyed by color names from the order; a prototype-less object keeps "constructor" / "__proto__" honest
  const items = Array.isArray(orderData?.line_items) ? orderData.line_items : [];
  items.filter(isSystemSpokeLineItem).forEach((li) => {
    const wheel = String(propValue(li, 'Wheel') || '').toLowerCase();
    if (wheel && wheel !== pos) return;
    if (isSpokeBundleLineItem(li)) {
      const parsed = parseSpokeColorsProperty(propValue(li, 'Spoke Colors'), wheelTotal);
      if (parsed) for (const c of Object.keys(parsed)) out[c] = (out[c] || 0) + parsed[c];
      return; // no "Spoke Colors" text: nothing to compare for this line (its quantity is 1 whatever the wheel)
    }
    const color = clip(String(li.variant_title || '').split('/')[0].trim() || 'unknown', MAX_NAME_CHARS);
    out[color] = (out[color] || 0) + (Number(li.quantity) || 0);
  });
  return out;
}
export function feeLinesFor(orderData, pos) {
  const items = Array.isArray(orderData?.line_items) ? orderData.line_items : [];
  return items.filter((li) => isSystemFeeLineItem(li) && String(propValue(li, 'Wheel') || '').toLowerCase() === pos);
}

/**
 * All System wheels of the order, front then rear.
 * @returns {Array<{
 *   position: 'front'|'rear', label: 'Front'|'Rear', hubModel: string, hubTitle: string, hubVariantTitle: string|null,
 *   hubColor: string, hubColorHex: string, freehub: string|null, rimTitle: string, spokeCountLabel: string, total: number,
 *   config: object, colors: { drive: string[], rotor: string[], base: object }, counts: { drive: Array, rotor: Array, all: Array },
 *   isMultiColor: boolean, warnings: string[], geometryInput: object, feeLines: number, cartCounts: object
 * }>}
 */
export function systemWheels(recipe, componentData, orderData) {
  return systemPositions(recipe).map((pos) => {
    const comps = recipe.components || {};
    const hub = comps[pos + 'Hub'], rim = comps[pos + 'Rim'];
    const model = hubModelOf(recipe, pos);
    const cfg = wheelConfigFor(recipe, pos, componentData);
    const colors = spokeColorsFor(recipe, pos, cfg);
    const warnings = colors.warnings.slice();
    const rawCount = recipe?.specs?.[pos + 'SpokeCount'];
    if (rawCount != null && rawCount !== '' && !spokeCountOf(recipe, pos)) warnings.push(`${cap(pos)} wheel: spoke count "${clip(rawCount, 20)}" in the recipe is not usable (1 to ${MAX_SPOKES}); drawn as ${cfg.rimHoles}h.`);
    // the hub color the customer bought (the hub variant) wins over the Studio's copy of it; a difference is reported
    const boughtHubColor = optionValue(hub, 'Color') ? clip(optionValue(hub, 'Color'), MAX_NAME_CHARS) : null;
    const studioHubColor = recipe?.system?.studio?.hubColor?.[pos] ? clip(recipe.system.studio.hubColor[pos], MAX_NAME_CHARS) : null;
    const hubColor = boughtHubColor || studioHubColor || 'Black';
    if (boughtHubColor && studioHubColor && boughtHubColor !== studioHubColor) warnings.push(`${cap(pos)} hub: ordered ${boughtHubColor} but the Studio value says ${studioHubColor}; drawn ${boughtHubColor}.`);
    if (!model) warnings.push(`${cap(pos)} hub: could not tell Solix from Hydra2 (specs.systemHub / hub title); Hydra2 geometry assumed.`);
    const counts = { drive: countColors(colors.drive), rotor: countColors(colors.rotor), all: countColors([...colors.drive, ...colors.rotor]) };
    const cartCounts = cartSpokeCounts(orderData, pos, cfg.rimHoles);
    if (Object.keys(cartCounts).length) {
      const mismatch = counts.all.filter((c) => (cartCounts[c.color] || 0) !== c.n).map((c) => `${c.color} (Studio ${c.n}, cart ${cartCounts[c.color] || 0})`);
      const extra = Object.keys(cartCounts).filter((c) => !counts.all.some((x) => x.color === c)).map((c) => `${c} (cart ${cartCounts[c]}, Studio 0)`);
      if (mismatch.length || extra.length) warnings.push(`${cap(pos)} wheel: cart spoke lines do not match the Studio colors: ${[...mismatch, ...extra].join(', ')}.`);
    }
    const isMultiColor = counts.all.length > 1;
    const feeLines = orderData ? feeLinesFor(orderData, pos).length : 0;
    if (orderData && isMultiColor && feeLines === 0) warnings.push(`${cap(pos)} wheel uses ${counts.all.length} colors but the order has no "${SYSTEM_FEE.name}" line for it.`);
    if (orderData && !isMultiColor && feeLines > 0) warnings.push(`${cap(pos)} wheel is one color but the order has a "${SYSTEM_FEE.name}" line for it.`);
    const hubMeta = metaFor(componentData, hub);
    const ratioLabel = cfg.drive.n === cfg.rotor.n ? '' : ' 2:1';
    return {
      position: pos, label: cap(pos),
      hubModel: model ? model.label : 'System',
      hubTitle: clip(hub?.title || 'n/a', MAX_TITLE_CHARS), hubVariantTitle: hub?.variantTitle ? clip(hub.variantTitle, MAX_TITLE_CHARS) : null,
      hubColor, hubColorHex: hexFor(hubColor),
      freehub: pos === 'rear' ? ((hub?.spec_freehub || recipe?.specs?.freehubType) ? clip(hub?.spec_freehub || recipe?.specs?.freehubType, MAX_NAME_CHARS) : null) : null,
      rimTitle: rimTitleOf(rim), rimRing: ringKeyForRim(rim), // round 12: which photo ring the pictures get
      spokeCountLabel: `${cfg.rimHoles}h${ratioLabel} (${cfg.drive.n} drive / ${cfg.rotor.n} rotor)`,
      total: cfg.rimHoles,
      config: cfg, colors, counts, isMultiColor, warnings, feeLines, cartCounts,
      // I9-SYSTEM: LENGTH-CALC HOOK input (left = rotor side, right = drive side, as in _lib/calculator.js). Nulls where Shopify has no value yet.
      geometryInput: {
        position: pos, hubModel: model ? model.label : null,
        rimVariantId: rim && rim.variantId != null ? String(rim.variantId).replace(/^.*\//, '') : null, // round 10: the key into the I9 chart map
        holes: cfg.rimHoles, orderNumber: orderData && orderData.order_number != null ? orderData.order_number : null, // round 10: hole count check and the log line
        erd: metaNumber(metaFor(componentData, rim), 'rim_erd'),
        spokeHoleDiameter: metaNumber(hubMeta, 'hub_spoke_hole_diameter'),
        flangeDiameter: { left: metaNumber(hubMeta, 'hub_flange_diameter_left'), right: metaNumber(hubMeta, 'hub_flange_diameter_right') },
        flangeOffset: { left: metaNumber(hubMeta, 'hub_flange_offset_left'), right: metaNumber(hubMeta, 'hub_flange_offset_right') },
        cross: { left: cfg.rotor.cross, right: cfg.drive.cross },
        spokes: { left: cfg.rotor.n, right: cfg.drive.n }
      }
    };
  });
}
