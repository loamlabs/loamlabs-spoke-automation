// _lib/own-parts.js
// OWN-PARTS: customer-supplied rims and hubs on an Industry Nine SYSTEM build (contract: agent-prompts/I9_OWN_PARTS_ORDER_CONTRACT.md, version 1).
// Pure data, no network, never throws for bad data (problems become warnings). Everything comes from the customer's browser (_build) and the cart lines, so it is only used for WORDING and
// cross-checks: a flag never skips a calculation or a stock step. Lengths for an approved own rim / own I9 hub are the normal chart lookup (the approved part is the build's component).
// (small local helpers instead of importing from system-build.js, which imports this file)
const propValue = (li, name) => { const p = Array.isArray(li && li.properties) ? li.properties.find((x) => x && x.name === name) : null; return p ? p.value : undefined; };
const clip = (s, max) => { s = String(s == null ? '' : s); return s.length > max ? s.slice(0, max) + '…' : s; };

export const OWN_FEE_SET = 51568864887091;     // Assembly Service $120, a wheel in a wheel set
export const OWN_FEE_SINGLE = 51786323165491;  // Assembly Service $100, a single wheel
const own = (o, k) => o != null && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k);
const digits = (v) => String(v == null ? '' : v).replace(/^.*\//, '').trim();
const lc = (v) => String(v == null ? '' : v).trim().toLowerCase();
const isGenericOwn = (c) => !!c && /your own/i.test(String(c.title || ''));

const lines = (orderData) => (Array.isArray(orderData && orderData.line_items) ? orderData.line_items : []);
const ownLine = (orderData, kind, pos) => lines(orderData).find((li) => li && new RegExp(`^\\s*your own ${kind}\\b`, 'i').test(String(li.title || li.name || '')) && lc(propValue(li, 'Wheel')) === pos) || null;
const ownFeeLines = (orderData, pos) => lines(orderData).filter((li) => li && (Number(li.variant_id) === OWN_FEE_SET || Number(li.variant_id) === OWN_FEE_SINGLE) && lc(propValue(li, 'Wheel')) === pos);

function describe(comp) {
  if (!comp) return null;
  const t = [comp.title, comp.variantTitle].filter((x) => typeof x === 'string' && x.trim()).join(' ');
  return t ? clip(t, 90) : null;
}

/**
 * What the customer supplies on one wheel of a System build.
 * @returns {null | { rim: boolean, hub: boolean, rimText: string|null, hubText: string|null, rimApproved: boolean, hubApproved: boolean, warnings: string[] }} null when the wheel has no own parts
 */
export function suppliedPartsOf(recipe, orderData, pos, buildLine) {
  const comps = (recipe && recipe.components) || {};
  const flags = recipe && recipe.customerSupplied && recipe.customerSupplied[pos];
  const rimComp = comps[pos + 'Rim'], hubComp = comps[pos + 'Hub'];
  const rim = !!((rimComp && rimComp.supplied === true) || (flags && flags.rim === true));
  const hub = !!((hubComp && hubComp.supplied === true) || (flags && flags.hub === true));
  if (!rim && !hub) return null;
  const warnings = [];
  const label = pos[0].toUpperCase() + pos.slice(1);
  const out = { rim, hub, rimText: null, hubText: null, rimApproved: false, hubApproved: false, warnings };
  for (const [kind, on, comp] of [['rim', rim, rimComp], ['hub', hub, hubComp]]) {
    if (!on) continue;
    const Kind = kind === 'rim' ? 'Rim' : 'Hub';
    const line = ownLine(orderData, kind, pos);
    const named = line ? clip(String(propValue(line, `Customer ${Kind}`) || '').trim(), 90) : '';
    const approved = !!comp && !isGenericOwn(comp) && digits(comp.variantId) !== '';
    out[kind + 'Approved'] = approved;
    out[kind + 'Text'] = named || describe(comp) || `${kind} (not described on the order)`;
    // the line's id property must agree with the component (the component wins for lengths)
    const idProp = line ? digits(propValue(line, `_Own_${Kind}_Variant_ID`)) : '';
    if (approved && idProp && idProp !== digits(comp.variantId)) warnings.push(`${label} wheel: the customer ${kind} line says variant ${idProp} but the build uses ${digits(comp.variantId)}; the build's part was used.`);
    if (!line) warnings.push(`${label} wheel: marked as customer ${kind} but the order has no "Your Own ${Kind}" line for it.`);
    if (!approved) warnings.push(`${label} wheel: the customer ${kind} is not an approved part (no approved ${kind} in the build).`);
  }
  if (orderData) {
    const fees = ownFeeLines(orderData, pos);
    if (fees.length === 0) warnings.push(`${label} wheel: it has customer parts but the order has no own-parts Assembly Service fee line ($120 in a set, $100 for a single wheel) for it.`);
    else if (fees.length > 1) warnings.push(`${label} wheel: the order has ${fees.length} own-parts Assembly Service fee lines for this wheel (one expected).`);
    const bl = buildLine || lines(orderData).find((li) => li && Array.isArray(li.properties) && li.properties.some((p) => p && p.name === '_build'));
    if (bl && String(propValue(bl, '_Customer_Parts_Confirmed') || '').toLowerCase() !== 'true') warnings.push(`${label} wheel: it has customer parts but the order is missing _Customer_Parts_Confirmed (the confirmation popup may have been skipped).`);
  }
  return out;
}

/** "front rim ENVE M630 29" 28h (approved list), hub ... (approved list)" for one wheel; '' when nothing is supplied. */
export function suppliedWheelText(s, label) {
  if (!s) return '';
  const part = (kind, text, approved) => `${kind} ${text}${approved ? ' (approved list)' : ' (NOT on the approved list)'}`;
  const parts = [];
  if (s.rim) parts.push(part('rim', s.rimText, s.rimApproved));
  if (s.hub) parts.push(part('hub', s.hubText, s.hubApproved));
  return `${label.toLowerCase()} ${parts.join(', ')}`;
}

/** The order-level sentence for the top of the note and the email: "front rim X (approved list); rear: ours". null when no wheel has customer parts. */
export function suppliedSummary(wheels) {
  const ws = (wheels || []).filter((w) => w && w.position);
  if (!ws.some((w) => w.supplied)) return null;
  return ws.map((w) => (w.supplied ? suppliedWheelText(w.supplied, w.label) : `${w.label.toLowerCase()}: ours`)).join('; ');
}
export const PARTS_MUST_ARRIVE = 'Parts must arrive before the build starts.';

/** Plain reasons for "NOT CALCULATED" when the rim is the customer's own. */
export function suppliedRimNotCalculated(rimText) {
  return `The customer-supplied rim (${rimText || 'not described'}) is not in I9's spoke length chart. Ask I9 for the spoke lengths for this rim before ordering spokes.`;
}
