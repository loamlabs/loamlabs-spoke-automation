// PER-SPOKE: builder spoke products are moving from one flat price per wheel to a price per spoke. The new variants carry the Length option value "Each" (Black Berd / Each) and the
// spoke cart line carries quantity = the wheel's spoke count (a merged Front/Rear line = front + rear). The OLD model stays valid until the new variants exist: flat "-" variants,
// quantity 1 per wheel (2 on a merged Front/Rear line), and the older per-colour length lines (quantity = spokes of that colour).
// Pure functions, no network. The engine never uses a spoke line's quantity for lengths or stock; this file is only for the cross-check and the "wrong quantity" notice.
import { propValue, spokeCountOf } from './system-build.js';

const lc = (s) => String(s == null ? '' : s).trim().toLowerCase();
const POSITIONS = ['front', 'rear'];

/** The variant parts of a line: "Black Berd / Each" -> ['Black Berd', 'Each']. */
export const variantPartsOf = (li) => String((li && li.variant_title) || '').split('/').map((x) => x.trim()).filter(Boolean);

/** True when the line is a per-spoke variant (Length option "Each"). */
export const isPerSpokeLine = (li) => variantPartsOf(li).some((p) => lc(p) === 'each');

/** True when the line is the old flat builder variant (Length option "-"). */
export const isFlatLine = (li) => variantPartsOf(li).some((p) => p === '-');

/** Which wheels a line names in its Wheel property: ['front'], ['rear'], ['front','rear'] (a merged line) or [] (no property). */
export function wheelsOfLine(li) {
  const raw = lc(propValue(li, 'Wheel'));
  return POSITIONS.filter((p) => new RegExp(`\\b${p}\\b`).test(raw));
}

const titleOf = (li) => lc((li && (li.title || li.name)) || '');

/**
 * The wrong-quantity notices of an order: one sentence per spoke line of a per-spoke product whose quantity is not the wheel's spoke count in the `_build` recipe.
 * Lines are grouped by the wheels they name: a Front line must hold the front count, a Rear line the rear count, a merged Front/Rear line the sum of the wheels that use that spoke
 * product; several lines of one wheel (one per colour) are added up. A line without a Wheel property counts for every wheel that uses the product.
 * @returns {string[]} empty when every per-spoke line is right (and for every order without per-spoke lines)
 */
export function perSpokeNotices(orderData, recipe) {
  const items = Array.isArray(orderData && orderData.line_items) ? orderData.line_items : [];
  const comps = (recipe && recipe.components) || {};
  const lines = items.filter(isPerSpokeLine);
  if (!lines.length) return [];
  const orderNo = (orderData && (orderData.order_number || orderData.name)) || '';
  const notices = [];
  const groups = new Map(); // key = title|wheelsKey -> { title, wheels, lines: [] }
  for (const li of lines) {
    const title = titleOf(li);
    const named = wheelsOfLine(li);
    // the wheels of this line that use this spoke product in the recipe
    const users = POSITIONS.filter((p) => comps[p + 'Spokes'] && lc(comps[p + 'Spokes'].title) === title);
    if (!users.length) continue; // not a spoke line of this build: not ours to judge
    const wheels = named.length ? named.filter((p) => users.includes(p)) : users;
    if (!wheels.length) continue;
    const key = `${title}|${wheels.join('+')}`;
    if (!groups.has(key)) groups.set(key, { title: (li.title || li.name || '').trim(), wheels, lines: [] });
    groups.get(key).lines.push(li);
  }
  for (const g of groups.values()) {
    const expected = g.wheels.reduce((sum, p) => sum + (spokeCountOf(recipe, p) || 0), 0);
    if (!expected) continue; // the recipe has no spoke count: nothing to compare against
    const q = g.lines.reduce((sum, li) => sum + (Math.floor(Number(li.quantity)) || 0), 0);
    if (q === expected) continue;
    const colours = [...new Set(g.lines.map((li) => variantPartsOf(li)[0] || 'unknown'))].join(', ');
    const where = g.wheels.length === 2 ? 'Front and rear wheels' : `${g.wheels[0][0].toUpperCase()}${g.wheels[0].slice(1)} wheel`;
    notices.push(`Spokes were sold at a per-spoke price with the wrong quantity${orderNo ? ` (order #${String(orderNo).replace(/^#/, '')})` : ''}: ${g.title} (${colours}), ${where.toLowerCase()}, quantity ${q}, expected ${expected} (the spoke count of the wheel${g.wheels.length === 2 ? 's' : ''} in the build). The customer was charged for ${q} spoke${q === 1 ? '' : 's'} instead of ${expected}; check the order before building`);
  }
  return notices;
}
