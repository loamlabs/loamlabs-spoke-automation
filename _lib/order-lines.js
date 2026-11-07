// EMAIL-LINES: two extra lines in the key inputs of the builder email and the order note: "Freehub body: SRAM XD" (rear wheel) and "Rule: <preconfigured rule name>".
// Printed only when the value exists, so every order without them is byte-identical to before. Pure functions, no network.
import { cartNippleOf } from './nipple-build.js'; // NIPPLES-ROW

// The bodies in the store (XD, XD-R, HG, HG-R, MS) by name. Anything else is printed as the store has it.
const FREEHUB_NAMES = { XD: 'SRAM XD', 'XD-R': 'SRAM XD-R', HG: 'Shimano HG', 'HG-R': 'Shimano HG-R', MS: 'Shimano MicroSpline' };

/** "SRAM XD" for components.rearComponentFreehub.variantTitle "XD"; the raw title for a body not in the list; null when there is none. */
export function freehubBodyName(buildRecipe) {
  const c = buildRecipe && buildRecipe.components && buildRecipe.components.rearComponentFreehub;
  const t = c && typeof c.variantTitle === 'string' ? c.variantTitle.trim() : '';
  if (!t) return null;
  return FREEHUB_NAMES[t.toUpperCase()] || t;
}

/** The _Preconfigured_Rule line property of the wheel line, or null. */
export function ruleNameOf(lineProperties) {
  const p = Array.isArray(lineProperties) ? lineProperties.find((x) => x && x.name === '_Preconfigured_Rule') : null;
  const v = p && typeof p.value === 'string' ? p.value.trim() : '';
  return v || null;
}

/** Put the two values on the wheels' inputs (rear gets the freehub body, both get the rule). Wheels that did not calculate have no inputs and are skipped. */
export function attachOrderLines(report, buildRecipe, lineProperties) {
  const freehub = freehubBodyName(buildRecipe), rule = ruleNameOf(lineProperties);
  if (!report) return report;
  for (const pos of ['front', 'rear']) {
    const w = report[pos];
    if (!w || !w.calculationSuccessful || !w.inputs) continue;
    if (pos === 'rear' && freehub) w.inputs.freehubBody = freehub;
    if (rule) w.inputs.ruleName = rule;
  }
  return report;
}

export const escapeText = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// NIPPLES-ROW: "Nipples: Sapim Brass Nipples (Silver)" in the key inputs of a wheel of a Standard studio build (the theme's standardStudio key) whose nipples are ONE color.
// A wheel with mixed colors already has its own nipple section and pull list (wheel.nipples), so it gets no row; builds without the studio key are untouched.
export function attachNippleRows(report, buildRecipe, studioWheels) {
  if (!report || !Array.isArray(studioWheels)) return report;
  for (const sw of studioWheels) {
    if (!sw || sw.nipples) continue;
    const wheel = report[sw.position];
    if (!wheel || !wheel.calculationSuccessful || !wheel.inputs) continue;
    const cart = cartNippleOf(buildRecipe, sw.position);
    if (!cart) continue;
    wheel.inputs.nipplesRow = cart.color ? `${cart.product} (${cart.color})` : cart.product;
  }
  return report;
}

// ORDER-CHECK-FLAGS (1): the report covers ONE wheel build. When the order has more (a second build line, or a build line with quantity above 1) the webhook calculates and deducts
// the first build once and says nothing about the rest; this returns the sentence that now goes into the note's WARNINGS, the top of the builder email and the subject.
export function extraBuildNotice(orderData, buildLine) {
  const lines = (Array.isArray(orderData && orderData.line_items) ? orderData.line_items : []).filter((li) => Array.isArray(li && li.properties)
    && li.properties.some((p) => p && p.name === '_is_custom_wheel_build' && p.value === 'true') && li.properties.some((p) => p && p.name === '_build'));
  const parts = [];
  if (lines.length > 1) parts.push(`This order has ${lines.length} wheel build lines. Only the FIRST was calculated and only its spokes were deducted; calculate and deduct the other ${lines.length - 1} by hand`);
  const q = Number(buildLine && buildLine.quantity);
  if (Number.isFinite(q) && q > 1) parts.push(`The wheel build line has quantity ${q}. The report and the spoke deduction cover ONE wheelset; deduct the spokes for the other ${q - 1} by hand`);
  return parts.length ? `${parts.join('. ')}.` : null;
}

// ORDER-CHECK-FLAGS (2): a red notice at the top of the builder email (same look as the "order note could not be written" notice).
export function addAttentionNotice(html, texts) {
  const list = (Array.isArray(texts) ? texts : []).filter(Boolean);
  if (!list.length) return html;
  const notice = `<p style="color:#D8000C;background-color:#FFD2D2;padding:10px;border-radius:3px"><strong>Check this order by hand:</strong> ${list.map(escapeText).join(' ')}</p>`;
  return String(html).replace('<div class="container">', () => '<div class="container">' + notice);
}

// ORDER-CHECK-FLAGS (3): the subject says ACTION REQUIRED when a calculated wheel's stock was not deducted (stockFlag = anySideNotDeducted) or when the report carries an attention text.
// A wheel that could not be calculated (CALC FAILED) still does NOT flag the subject: that is the earlier, tested decision (tests/not-deducted-flag.test.js); its red box in the email and the note say so.
export function reportNeedsAction(report, stockFlag) {
  return !!(stockFlag || (report && Array.isArray(report.attention) && report.attention.length));
}
