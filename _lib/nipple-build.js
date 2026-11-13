// _lib/nipple-build.js
// NIPPLE-REPORT: nipple colors in the order report of a Standard build that carries the theme's `standardStudio` key (Release 15). Pure data, no network, never throws for bad
// data (problems become warnings). Everything here comes from the customer's browser (the _build property), so it is bounded and validated like the spoke colors.
//
// The contract (theme Release 15, inside _build.standardStudio.studio; confirmed by Agent B's real-cart runs, agent-prompts/data/release15/crn_*.json):
//   studio.nipples = { front?: { drive: [color names], rotor: [color names] }, rear?: {...} }   one color name per spoke index, same indexing as studio.spokes
//   studio.nbase   = { front?: { drive, rotor }, ... }                                          the nipple base color per side
//   studio.naccent = 'Silver'                                                                    the accent color
//   The keys are only present for a wheel that has MIXED nipples; a wheel with one nipple color (or no nipples) has none of them (the theme drops them), and its nipples are the
//   cart nipple line's color (_build.components.<pos>Nipples). Hex values come from _build.standardStudio.colors (name -> '#hex'), else the Studio's table (studio-nipples.js).
//
// The cart: the nipple line is the nipple variant in the wheel's BASE color; accent-color nipples are NOT a cart line and their stock is NOT deducted. A wheel with 2+ nipple colors
// also carries one "Custom Nipple Color Configuration" fee line ($15, variant 67928782668083, option "Mixed nipple colors") with property Wheel = Front | Rear.
// Like the "Custom Spoke Color Configuration" fee line it is not a component, not in the spoke-length input and not in any inventory step: the webhook reads components only from
// _build, and the only place a fee line is looked at is the cross-check in standardWheels, which this module extends to the nipple fee.

import { SIDES, MAX_NAME_CHARS, cap, clip, countColors, propValue, optionValue, feeCoverage } from './system-build.js';
import { nippleTableHex, isHex6 } from './studio-nipples.js';

export const NIPPLE_FEE = { name: 'Custom Nipple Color Configuration', variantId: 67928782668083, variantTitle: 'Mixed nipple colors', price: 15 };
const own = (obj, key) => obj != null && typeof obj === 'object' && Object.prototype.hasOwnProperty.call(obj, key);
const NEUTRAL = '#8a9099';

/* ------------------------------------------------------------------ the fee line */

// The $15 nipple fee line: by variant id, or by title as a fallback (the cart title may carry the variant after a "|", a Shopify order line has it in variant_title).
export function isNippleFeeLine(li) {
  if (!li) return false;
  if (Number(li.variant_id) === NIPPLE_FEE.variantId) return true;
  return String(li.title || li.name || '').includes(NIPPLE_FEE.name);
}
export function nippleFeeLinesOf(orderData, pos) {
  const items = Array.isArray(orderData?.line_items) ? orderData.line_items : [];
  return items.filter((li) => isNippleFeeLine(li) && String(propValue(li, 'Wheel') || '').toLowerCase() === pos);
}
// The same fee check pooled over the whole order, for the Standard report: a merged line (Wheel = Front/Rear, quantity 2: the cart merges identical lines of the two wheels) covers
// both wheels, quantity 1 only one of them. mixedByPos: { front?: boolean, rear?: boolean } = the wheels of the order, true = mixed nipple colors.
// Returns { units: { front?: n, rear?: n }, shared: { lines, quantity } } (see feeCoverage in system-build.js).
export function nippleFeeCoverage(orderData, mixedByPos) { return feeCoverage(orderData, mixedByPos, isNippleFeeLine); }
// The fee warnings of one wheel from its pooled units; the same words as the per-wheel check in nippleInfoFor, plus a clearer one when a shared line is too small.
// mixedCount = how many wheels of the order have mixed nipples; colorCount = the number of colors of this wheel's nipples (the same words as the per-wheel check).
export function nippleFeeWarnings(pos, mixed, units, shared, mixedCount, colorCount) {
  if (mixed) {
    if (units === 0) {
      if (shared.quantity > 0 && mixedCount > shared.quantity) return [`${cap(pos)} wheel: the nipples use ${colorCount} colors, but the "${NIPPLE_FEE.name}" line on the order is one shared Front/Rear line with quantity ${shared.quantity}, which covers only ${shared.quantity} of the ${mixedCount} wheels with mixed nipples. The ${cap(pos)} wheel's fee is not verified.`];
      return [`${cap(pos)} wheel: the nipples use ${colorCount} colors, so the order should have a "${NIPPLE_FEE.name}" line ($${NIPPLE_FEE.price}) for it, but has none.`];
    }
    if (units > 1) return [`${cap(pos)} wheel: the order has ${units} "${NIPPLE_FEE.name}" lines for this wheel (one expected).`];
    return [];
  }
  return units > 0 ? [`${cap(pos)} wheel: the order has a "${NIPPLE_FEE.name}" line but the nipples are one color.`] : [];
}

/* ------------------------------------------------------------------ colors */

// The hex the customer saw for a nipple color: the build's own color map first ("exactly what the customer saw"), else the Studio's table, else neutral gray.
// Validated: it ends up in SVG and style attributes.
export function nippleHexOf(recipe, name) {
  const map = recipe?.standardStudio?.colors;
  const h = own(map, name) ? map[name] : null;
  if (typeof h === 'string' && isHex6(h)) return h.trim();
  return nippleTableHex(name) || NEUTRAL;
}

const LEGACY = /^custom configuration$/i;
// The nipple component of the cart: { product, material, color } ("Sapim Brass Nipples" -> "Brass"). Colors are read from the selected option.
export function cartNippleOf(recipe, pos) {
  const comp = recipe?.components?.[pos + 'Nipples'];
  if (!comp || typeof comp !== 'object' || comp.isVirtual) return null;
  const title = clip(comp.title || '', 120);
  if (!title) return null;
  const color = optionValue(comp, 'Color') || (typeof comp.variantTitle === 'string' ? comp.variantTitle.split('/')[0].trim() : null) || null;
  const material = title.replace(/^\s*sapim\s+/i, '').replace(/\s*(spoke\s+)?nipples?\s*$/i, '').trim() || title;
  return { product: title, material: clip(material, 40), color: color && !LEGACY.test(String(color)) ? clip(color, MAX_NAME_CHARS) : null };
}

/* ------------------------------------------------------------------ per wheel */

/**
 * The nipple colors of one wheel: { nipples, warnings }. nipples is null unless the wheel has MIXED nipples (2 or more colors); a wheel with one nipple color or none says nothing new.
 * Warnings (internal only) cross-check the fee line like the spoke fee: mixed nipples want exactly one nipple fee line for the wheel, one color wants none.
 * @param {object} recipe  the parsed _build
 * @param {string} pos     'front' | 'rear'
 * @param {{drive:{n:number}, rotor:{n:number}}} cfg  the wheel's drawn config (spoke count per side)
 * @param {object} [orderData]
 */
// opts.deferFee: the Standard report checks the nipple fee itself, pooled over both wheels (nippleFeeCoverage + nippleFeeWarnings), so this call leaves the fee out.
export function nippleInfoFor(recipe, pos, cfg, orderData, opts = {}) {
  const warnings = [];
  const value = recipe?.standardStudio?.studio;
  const saved = value && typeof value === 'object' && value.nipples && typeof value.nipples === 'object' ? value.nipples[pos] : null;
  const cart = cartNippleOf(recipe, pos);
  let nipples = null;
  if (saved && typeof saved === 'object') {
    const cartColor = cart && cart.color;
    const side = {}, base = {};
    for (const s of SIDES) {
      const nb = value.nbase?.[pos]?.[s];
      base[s] = typeof nb === 'string' && nb && !LEGACY.test(nb) ? clip(nb, MAX_NAME_CHARS) : (cartColor || 'Black');
      const arr = saved[s], n = cfg[s].n;
      if (Array.isArray(arr) && arr.length === n) side[s] = arr.map((c) => (typeof c !== 'string' || !c || LEGACY.test(c) ? base[s] : clip(c, MAX_NAME_CHARS)));
      else {
        if (Array.isArray(arr)) warnings.push(`${cap(pos)} ${s} side: the saved nipple map has ${arr.length} entries but the wheel has ${n} ${s}-side spokes; nipples drawn as all ${base[s]}.`);
        side[s] = Array.from({ length: n }, () => base[s]);
      }
    }
    const counts = { drive: countColors(side.drive), rotor: countColors(side.rotor), all: countColors([...side.drive, ...side.rotor]) };
    if (counts.all.length > 1) {
      const hexOf = (name) => nippleHexOf(recipe, name);
      nipples = {
        position: pos, drive: side.drive, rotor: side.rotor, base, counts, total: side.drive.length + side.rotor.length,
        product: cart ? cart.product : 'Nipples', material: cart ? cart.material : 'Nipples', cartColor: cartColor || null,
        hexOf, hex: { drive: side.drive.map(hexOf), rotor: side.rotor.map(hexOf) },
        // what to pull by hand: every color with its count; only the cart line's color is deducted by the order
        pull: counts.all.map((c) => ({ color: c.color, n: c.n, inCart: !!cartColor && c.color === cartColor })),
        // the cart line deducts a full wheel of its color, so every nipple of another color means that many cart-line-color nipples were deducted but not used: put them back
        putBack: cartColor ? { color: cartColor, n: counts.all.filter((c) => c.color !== cartColor).reduce((s, c) => s + c.n, 0) } : null,
        feeLines: 0, expectedFee: true
      };
      if (cartColor && !counts.all.some((c) => c.color === cartColor)) warnings.push(`${cap(pos)} wheel: the cart nipple line is ${cartColor} but no nipple on the wheel is ${cartColor}.`);
    }
  }
  if (orderData && !opts.deferFee) {
    const fee = nippleFeeLinesOf(orderData, pos);
    if (nipples) {
      nipples.feeLines = fee.length;
      if (fee.length === 0) warnings.push(`${cap(pos)} wheel: the nipples use ${nipples.counts.all.length} colors, so the order should have a "${NIPPLE_FEE.name}" line ($${NIPPLE_FEE.price}) for it, but has none.`);
      else if (fee.length > 1) warnings.push(`${cap(pos)} wheel: the order has ${fee.length} "${NIPPLE_FEE.name}" lines for this wheel (one expected).`);
    } else if (fee.length > 0) {
      warnings.push(`${cap(pos)} wheel: the order has a "${NIPPLE_FEE.name}" line but the nipples are one color.`);
    }
  }
  return { nipples, warnings };
}

/* ------------------------------------------------------------------ wording (shared by the internal email, the order note and the customer email) */

// "Front wheel: Brass Black ×28 (the cart line's color), Brass Silver ×4 (NOT in the cart line: pull from stock)"
export function pullLineParts(n, times = '×') {
  const items = n.pull.map((p) => `${n.material} ${p.color} ${times}${p.n}${p.inCart ? " (the cart line's color)" : ' (NOT in the cart line: pull from stock)'}`);
  // "... Put 4 Brass Black back." : the cart line deducted a full wheel of its color, the accent nipples came from other stock
  const back = n.putBack && n.putBack.n > 0 ? ` Put ${n.putBack.n} ${n.material} ${n.putBack.color} back.` : '';
  return { where: `${cap(n.position)} wheel`, rest: items.join(', ') + (back ? '.' + back : '') };
}
export function nippleSideText(n, side, times = '×') { return n.counts[side].map((c) => `${c.color} ${times}${c.n}`).join(', '); }
