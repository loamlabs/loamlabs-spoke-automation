// HUB-KIT-NOTE: what the order note and the builder email say about the hub of a Standard build once hubs are ONE master product per model
// (spacing, color and spoke count live on the variant, so the product title alone no longer says which hub was ordered).
//   (a) hubVariantText: the variant title ("32h / Blue / 12x148mm (Boost)") printed next to the product title.
//   (b) Kits: the hub variant lists the kits it needs (adapter, end caps, spacer) in the variant metafield custom.required_addon_variants (a list of product variant references; the
//       Admin API gives a JSON list of variant GIDs). Each kit is its own add-on product variant that the builder adds as a line at its own price. The note and the email say
//       "Kit needed: <product title> (<variant title>) <SKU>", plus "(in this order)" when the kit variant is a line of the order. A price is never printed.
//   (c) Warnings for the builder email only (never an error, never the note, never the subject): a kit named by the hub variant that is not a line of the order, a kit variant that
//       cannot be looked up, a kit list that cannot be read, and a recipe that names a hub variant which is not a line of the order.
// Pure functions except attachKitLines, which calls the lookup it is given (ONE batched request per order, only when a hub variant has the metafield). Display only: no length,
// stock or recipient logic reads anything from here.
//   (d) EXTRALITE-ESTIMATE: a hub variant whose geometry is ESTIMATED from the maker's drawing (the 22 Extralite variants of data/extralite-source/ESTIMATED_EXTRALITE_HUB_GEOMETRY.csv,
//       via _lib/estimated-extralite-hubs.js) carries inputs.hubEstimate, a "CHECK BEFORE BUILDING" line: printed in the order note and the builder email (a row in the wheel's key inputs
//       and a "Hub note" at the top). Lengths do not change. Orders with any other hub get no such key, so they are byte-identical to before.
import { ESTIMATED_HUB_VARIANTS, ESTIMATED_HUB_SENTENCE } from './estimated-extralite-hubs.js';

const clip = (v, n) => String(v === undefined || v === null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);
const idOf = (v) => { const m = /(\d+)\s*$/.exec(String(v === undefined || v === null ? '' : v)); return m ? m[1] : null; };
const VARIANT_GID = /^gid:\/\/shopify\/ProductVariant\/(\d+)$/;

/** "32h / Blue / 12x148mm (Boost)" for a hub component of the recipe; '' when the recipe has no variant title, it says "Default Title", or it only repeats the product title. */
export function hubVariantText(hub) {
  const t = clip(hub && hub.variantTitle, 120);
  if (!t || /^default title$/i.test(t) || t.toLowerCase() === clip(hub && hub.title, 200).toLowerCase()) return '';
  return t;
}

/** The product title with the variant title, as one text: "Spank HEX Rear Hub - 6-Bolt (32h / Blue / 12x148mm (Boost))". */
export function hubDisplayText(title, variantText) { return variantText ? `${title} (${variantText})` : String(title); }

/**
 * @param {string|Array|null|undefined} raw  the value of custom.required_addon_variants (JSON text of a list of variant GIDs; a single GID text is accepted too)
 * @returns {{ ids: string[], problem: string|null }}  problem is set when the metafield has a value that cannot be read as a list of variant GIDs
 */
export function kitIdsOf(raw) {
  if (raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '')) return { ids: [], problem: null };
  let data = raw;
  if (typeof raw === 'string') {
    const t = raw.trim();
    if (VARIANT_GID.test(t)) data = [t];
    else { try { data = JSON.parse(t); } catch { return { ids: [], problem: 'the kit list (required_addon_variants) on the hub variant is not valid json' }; } }
  }
  if (typeof data === 'string' && VARIANT_GID.test(data)) data = [data];
  if (!Array.isArray(data)) return { ids: [], problem: 'the kit list (required_addon_variants) on the hub variant is not a list' };
  const ids = [];
  for (const x of data) {
    if (typeof x !== 'string' || !VARIANT_GID.test(x.trim())) return { ids: [], problem: 'the kit list (required_addon_variants) on the hub variant has an entry that is not a product variant id' };
    if (!ids.includes(x.trim())) ids.push(x.trim());
  }
  return { ids, problem: null };
}

/** EXTRALITE-ESTIMATE: the CHECK BEFORE BUILDING line when this hub variant (a gid or the digits) is one of the estimated Extralite hub variants; null for every other hub. */
export function estimatedHubLine(variantId) {
  const id = idOf(variantId);
  if (!id || !Object.prototype.hasOwnProperty.call(ESTIMATED_HUB_VARIANTS, id)) return null;
  return `CHECK BEFORE BUILDING: ${ESTIMATED_HUB_SENTENCE}. Check the spoke length against the hub in hand before ordering spokes for the first order of this model.`;
}

/** What runCalculationEngine adds to a wheel's inputs. Only keys with a value (so an order without any of it is byte-identical to before). */
export function hubInputsExtras(hub, kitRaw) {
  const out = {};
  const v = hubVariantText(hub); if (v) out.hubVariant = v;
  const est = estimatedHubLine(hub && hub.variantId); if (est) out.hubEstimate = est;
  const k = kitIdsOf(kitRaw);
  if (k.ids.length) out.kitVariantIds = k.ids;
  if (k.problem) out.kitProblem = k.problem;
  return out;
}

/** "Boost 15x110 conversion kit (Black) HUB2214 (in this order)"; the variant part is left out for "Default Title", the SKU when there is none. Unresolved: "variant 123 (not found)". */
export function kitLineText(kit, { withNotFound = true } = {}) {
  if (!kit.resolved) return withNotFound ? `variant ${idOf(kit.id)} (not found)` : '';
  const v = kit.variant && !/^default title$/i.test(kit.variant) ? ` (${kit.variant})` : '';
  return `${kit.product}${v}${kit.sku ? ' ' + kit.sku : ''}${kit.inOrder ? ' (in this order)' : ''}`;
}

/**
 * Looks the kit variants of both wheels up in ONE request and puts inputs.kitNeeded ([{ id, resolved, product, variant, sku, inOrder }]) on each wheel that has a kit list.
 * @param {object} report  the calculation report (front / rear)
 * @param {object} orderData  the order (line_items[].variant_id says which kits are in the order)
 * @param {(ids: string[]) => Promise<Array<object|null>>} lookup  returns the Shopify nodes of those ids ({ id, title, sku, product: { title } } or null), in any order
 */
export async function attachKitLines(report, orderData, lookup) {
  const wheels = ['front', 'rear'].map((p) => report && report[p]).filter((w) => w && w.calculationSuccessful && w.inputs && Array.isArray(w.inputs.kitVariantIds) && w.inputs.kitVariantIds.length);
  if (!wheels.length) return report;
  const ids = [...new Set(wheels.flatMap((w) => w.inputs.kitVariantIds))];
  let nodes = [];
  try { const got = await lookup(ids); nodes = Array.isArray(got) ? got : []; } catch (error) { console.error('HUB-KIT-NOTE: the kit variants could not be looked up:', error && error.message ? error.message : error); }
  const byId = new Map(nodes.filter((n) => n && n.id).map((n) => [String(n.id), n]));
  const lines = new Set((Array.isArray(orderData && orderData.line_items) ? orderData.line_items : []).map((li) => idOf(li && li.variant_id)).filter(Boolean));
  for (const w of wheels) {
    w.inputs.kitNeeded = w.inputs.kitVariantIds.map((id) => {
      const n = byId.get(id);
      const base = { id, inOrder: lines.has(idOf(id)) };
      return n ? { ...base, resolved: true, product: clip(n.product && n.product.title, 160) || 'Kit', variant: clip(n.title, 120), sku: clip(n.sku, 60) } : { ...base, resolved: false };
    });
  }
  return report;
}

/**
 * Warnings (plain sentences) for the builder email. Never an error, never changes the subject.
 *  - a kit list that cannot be read; a kit variant that cannot be looked up
 *  - a kit named by the hub variant that is not a line of the order (only judged when other components of the same recipe ARE lines: a one-line preconfigured order has no component lines)
 *  - the recipe names a hub whose variant is not among the order's line items, while other components of the same recipe ARE line items
 *    (a one-line preconfigured order has no component lines at all, so it is left alone; so is a customer-supplied hub)
 */
export function hubWarnings(report, orderData, recipe) {
  const out = [];
  const lines = Array.isArray(orderData && orderData.line_items) ? orderData.line_items : [];
  const lineIds = new Set(lines.map((li) => idOf(li && li.variant_id)).filter(Boolean));
  const comps = (recipe && recipe.components && typeof recipe.components === 'object') ? recipe.components : {};
  const compId = (c) => idOf(c && c.variantId);
  const hubKeys = ['frontHub', 'rearHub'];
  const others = new Set();
  for (const [k, c] of Object.entries(comps)) { if (hubKeys.includes(k)) continue; const id = compId(c); if (id && c && typeof c === 'object' && !Array.isArray(c)) others.add(id); }
  const componentLinesPresent = [...others].some((id) => lineIds.has(id));
  for (const pos of ['front', 'rear']) {
    const w = report && report[pos];
    const label = pos === 'front' ? 'Front' : 'Rear';
    if (!w || !w.calculationSuccessful || !w.inputs) continue;
    if (w.inputs.hubEstimate) out.push(`${label} hub: ${w.inputs.hubEstimate}`); // EXTRALITE-ESTIMATE
    if (w.inputs.kitProblem) out.push(`${label} hub: ${w.inputs.kitProblem}. Check by hand whether a kit has to be bought.`);
    for (const k of Array.isArray(w.inputs.kitNeeded) ? w.inputs.kitNeeded : []) {
      if (!k.resolved) out.push(`${label} hub: the kit variant ${idOf(k.id)} named by the hub could not be looked up (deleted or not readable). Check by hand which kit is needed.`);
      else if (componentLinesPresent && !k.inOrder) out.push(`${label} hub: the kit "${kitLineText(k)}" is named by the hub variant but is not a line of this order. Check whether the kit was bought.`);
    }
  }
  if (componentLinesPresent) {
    for (const k of hubKeys) {
      const c = comps[k]; if (!c) continue;
      const pos = k === 'frontHub' ? 'front' : 'rear';
      if ((recipe.customerSupplied && recipe.customerSupplied[pos] && recipe.customerSupplied[pos].hub) || c.vendor === 'Your Own Component' || /your own/i.test(String(c.title || ''))) continue;
      const id = compId(c); if (!id) continue;
      if (!lineIds.has(id)) out.push(`The build names the ${pos} hub "${hubDisplayText(clip(c.title, 160), hubVariantText(c))}" but that hub variant is not a line of this order. Check whether the hub was bought.`);
    }
  }
  return out;
}

/** A yellow notice at the top of the builder email (the existing .alert colors); nothing when there is nothing to say. */
export function addHubWarningNotice(html, texts, escapeText) {
  const list = (Array.isArray(texts) ? texts : []).filter(Boolean);
  if (!list.length) return html;
  const notice = `<p style="color:#9F6000;background-color:#FEEFB3;padding:10px;border-radius:3px"><strong>Hub note:</strong> ${list.map(escapeText).join(' ')}</p>`;
  return String(html).replace('<div class="container">', () => '<div class="container">' + notice);
}
