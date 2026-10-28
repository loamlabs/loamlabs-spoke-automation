// _lib/system-report.js
// I9-SYSTEM: the report for a System build order: the internal engineering email (HTML with inline wheel images), the plain-text order
// note, the optional customer email, and the Resend sends with inline attachments. Nothing here touches inventory. Every image problem is
// caught and reported in the internal email text; the report is always produced.
//
//   const report = await buildSystemReport({ recipe, orderData, componentData });   // { subject, html, note, wheels, images, imageErrors, warnings }
//   await sendSystemEmail({ report, to, apiKey });                                   // inline images via content ids (cid:), falls back to text-only
//   const customer = buildCustomerEmail({ wheels: report.wheels, images: report.images, orderData });   // built for every System build (null only when the build has no wheels)
//   await sendCustomerEmailIfEnabled({ customer, orderData });                       // only when env SYSTEM_CUSTOMER_EMAIL === 'on' (System and keyed Standard orders alike)

import { systemWheels, hexFor, SYSTEM_FEE } from './system-build.js';
import { geometry } from './studio-geometry.js';
import { wheelSvg } from './wheel-svg.js';
import { svgToPng } from './wheel-png.js';
import { calculateSystemSpokeLengths, SYSTEM_LENGTHS_PENDING_TEXT } from './system-lengths.js';
import { SYSTEM_REPORT_MARKER } from './system-dedupe.js';
import { resendTimeoutMs } from './http-timeout.js';

export const IMAGE_WIDTH_PX = 600;
const TIMES = '×';          // plain text (order note)
const TIMES_HTML = '&times;';    // email HTML (entity: safe whatever charset the client assumes)

export const CUSTOMER_FROM = 'LoamLabs <info@loamlabsusa.com>';
export const CUSTOMER_REPLY_TO = 'info@loamlabsusa.com';
export const CUSTOMER_EMAIL_FLAG = 'SYSTEM_CUSTOMER_EMAIL'; // sending to customers is OFF unless this env var equals exactly "on" (one switch for System and keyed Standard orders)

function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; }
function countsText(list, times = TIMES) { return list.map((c) => `${c.color} ${times}${c.n}`).join(', '); }

/* ------------------------------------------------------------------ images */

// The three images of a multi-color wheel, all spokes at full color and opacity. High-tension side: front = rotor, rear = drive.
//   a) all spokes, viewed from the high-tension side   b) high-tension side spokes only   c) low-tension side spokes only
// Order in the email: a, b, c; front wheel first, then rear. (All spokes comes first so the first picture a customer sees is the complete wheel.)
// A wheel that is ONE solid color gets only a): a single all-spokes image (same view, same caption style), no side-only images.
export function highSideOf(position) { return position === 'front' ? 'rotor' : 'drive'; }
export function lowSideOf(position) { return position === 'front' ? 'drive' : 'rotor'; }
// labels (optional, Standard wheels): { drive: 'Right side', rotor: 'Left side' }; the captions then say "right side" / "left side" instead of "drive side" / "rotor side".
export function imageSpecsFor(position, solid = false, labels = null) {
  const P = cap(position), high = highSideOf(position), low = lowSideOf(position);
  const word = (s) => (labels && labels[s] ? String(labels[s]).toLowerCase() : `${s} side`);
  const all = { cid: `${position}-all-spokes`, caption: `${P} wheel, all spokes (${word(high)} view)`, sides: ['drive', 'rotor'], pov: high };
  if (solid) return [all];
  return [
    all,
    { cid: `${position}-${high}-only`, caption: `${P} wheel, ${word(high)} spokes only`, sides: [high], pov: high },
    { cid: `${position}-${low}-only`, caption: `${P} wheel, ${word(low)} spokes only`, sides: [low], pov: low }
  ];
}

// Renders the images of a wheel: three for a multi-color wheel, one (all spokes) for a solid-color wheel. Each failure becomes an imageErrors line; nothing throws.
export async function renderWheelImages(wheel, renderPng, width) {
  const images = [], errors = [];
  if (!wheel.config) { errors.push(`${wheel.label} wheel: image failed: no wheel geometry in the build data`); return { images, errors }; }
  let geom;
  try {
    // Standard wheels are ALWAYS drawn with the Studio's autoValvePhase (valve between the two most parallel spokes), exactly as the Standard builder opens the Studio;
    // System wheels never (they keep the hand-measured phases). The flag is the strict boolean the Studio expects.
    const cfg = wheel.standard === true ? { autoValvePhase: true, wheels: { [wheel.position]: wheel.config } } : { wheels: { [wheel.position]: wheel.config } };
    geom = geometry(cfg)[wheel.position];
  } catch (e) {
    errors.push(`${wheel.label} wheel: image failed: geometry error: ${e.message}`);
    return { images, errors };
  }
  const hexOf = wheel.hexOf || hexFor;
  const colorsHex = { drive: wheel.colors.drive.map((c) => hexOf(c)), rotor: wheel.colors.rotor.map((c) => hexOf(c)) };
  for (const spec of imageSpecsFor(wheel.position, !wheel.isMultiColor, wheel.sideLabels || null)) {
    try {
      const svg = wheelSvg({ config: wheel.config, geom, colorsHex, hubHex: wheel.hubColorHex, pov: spec.pov, sides: spec.sides, size: width });
      const png = await renderPng(svg, { width });
      if (!png || !png.length) throw new Error('renderer returned no bytes');
      images.push({ cid: spec.cid, filename: `${spec.cid}.png`, caption: spec.caption, png, svg, position: wheel.position, pov: spec.pov, sides: spec.sides });
    } catch (e) {
      errors.push(`${spec.caption}: image failed: ${e && e.message ? e.message : String(e)}`);
    }
  }
  return { images, errors };
}

function lengthsFor(wheel, lengthCalculator) {
  try {
    const r = lengthCalculator(wheel.geometryInput);
    if (r && typeof r === 'object' && isFinite(r.left) && isFinite(r.right)) {
      return { pending: false, text: `Spoke lengths (System): Left/Rotor ${r.left} mm, Right/Drive ${r.right} mm${r.note ? ` (${r.note})` : ''}` };
    }
    return { pending: true, text: SYSTEM_LENGTHS_PENDING_TEXT };
  } catch (e) {
    return { pending: true, text: `${SYSTEM_LENGTHS_PENDING_TEXT}; calculator error: ${e.message}` };
  }
}

/* ------------------------------------------------------------------ email HTML */

// The same look as the Standard report (style block copied from api/index.js sendEmailReport). Used by the internal and the customer email.
const STYLE = `
                body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #333; line-height: 1.6; }
                .container { max-width: 600px; margin: 20px auto; padding: 20px; border: 1px solid #ddd; border-radius: 5px; }
                h1, h2, h3, h4 { color: #111; }
                a { color: #007bff; text-decoration: none; }
                .summary-box { background-color: #f4f4f7; padding: 15px; border-radius: 5px; margin-bottom: 20px; }
                .summary-box h3 { margin-top: 0; }
                .summary-box p { margin: 5px 0; font-size: 1.1em; }
                .wheel-section { margin-top: 20px; border-top: 1px solid #eee; padding-top: 20px; }
                .data-table { border-collapse: collapse; width: 100%; margin-bottom: 15px; }
                .data-table td { padding: 8px; border: 1px solid #ddd; }
                .data-table td:first-child { font-weight: bold; background-color: #f9f9f9; width: 150px; }
                .alert { color: #9F6000; background-color: #FEEFB3; padding: 10px; border-radius: 3px; }
                .failed { color: #D8000C; background-color: #FFD2D2; padding: 10px; border-radius: 3px; }
                .wheel-img { display: block; width: 100%; max-width: ${IMAGE_WIDTH_PX}px; height: auto; border: 1px solid #ddd; border-radius: 4px; background: #fff; }
                .caption { font-size: 0.95em; color: #555; margin: 4px 0 16px; }
                .swatch { display: inline-block; width: 11px; height: 11px; border-radius: 50%; border: 1px solid rgba(0,0,0,.4); vertical-align: -1px; margin-right: 4px; }
`;

export function colorRow(label, list, hexOf = hexFor) {
  const cells = list.map((c) => `<span class="swatch" style="background:${hexOf(c.color)}"></span>${esc(c.color)} ${TIMES_HTML}${c.n}`).join(', ');
  return `<tr><td>${esc(label)}</td><td>${cells}</td></tr>`;
}

// One wheel section. internal: lengths, fee check, warnings, image-failure lines. customer: component details, color tables and images only.
function wheelHtml(w, images, imageErrors, opts) {
  const internal = !!(opts && opts.internal), lengths = opts && opts.lengths;
  const imgs = images.filter((i) => i.position === w.position);
  const errs = imageErrors.filter((e) => e.startsWith(`${w.label} wheel`));
  // A solid-color wheel shows its "all <color>" line and then its one all-spokes image; a multi-color wheel shows its three images.
  const solidLine = w.isMultiColor ? '' : `<p><strong>${esc(w.label)} wheel: all ${esc(w.counts.all[0] ? w.counts.all[0].color : 'n/a')}</strong></p>`;
  let visual = solidLine + imgs.map((i) => `<img class="wheel-img" src="cid:${i.cid}" width="${IMAGE_WIDTH_PX}" alt="${esc(i.caption)}"><p class="caption">${esc(i.caption)}</p>`).join('');
  if (internal) visual += errs.map((e) => `<p class="failed">${esc(e)}</p>`).join('');
  const warnings = internal ? w.warnings.map((t) => `<p class="alert"><strong>NOTE:</strong> ${esc(t)}</p>`).join('') : '';
  const feeRow = internal ? `<tr><td>Custom color fee</td><td>${w.isMultiColor ? (w.feeLines ? `${w.feeLines} ${TIMES_HTML} ${esc(SYSTEM_FEE.name)} line on the order` : 'expected, none found on the order') : 'not applicable (one color)'}</td></tr>` : '';
  return `
        <div class="wheel-section">
            <h3>${w.label.toUpperCase()} WHEEL</h3>
            <table class="data-table">
                <tr><td>Rim</td><td>${esc(w.rimTitle)}</td></tr>
                <tr><td>Hub</td><td>${esc(w.hubTitle)}${w.hubVariantTitle ? ` (${esc(w.hubVariantTitle)})` : ''}</td></tr>
                <tr><td>Hub color</td><td><span class="swatch" style="background:${w.hubColorHex}"></span>${esc(w.hubColor)}</td></tr>
                ${w.position === 'rear' ? `<tr><td>Freehub</td><td>${esc(w.freehub || 'n/a')}</td></tr>` : ''}${!internal && w.standard && w.spokeProduct ? `<tr><td>Spokes</td><td>${esc(w.spokeProduct)}</td></tr>` : ''}
                <tr><td>Spoke count</td><td>${esc(w.spokeCountLabel)}</td></tr>
                ${feeRow}
            </table>
            <h4>Spoke Colors</h4>
            <table class="data-table">
                ${colorRow(`${(w.sideLabels && w.sideLabels.drive) || 'Drive side'} (${w.colors.drive.length})`, w.counts.drive, w.hexOf)}
                ${colorRow(`${(w.sideLabels && w.sideLabels.rotor) || 'Rotor side'} (${w.colors.rotor.length})`, w.counts.rotor, w.hexOf)}
                ${colorRow(`Whole wheel (${w.total})`, w.counts.all, w.hexOf)}
            </table>
            ${visual}
            ${internal ? `<p><em>${esc(lengths.text)}</em></p>` : ''}
            ${warnings}
        </div>`;
}

// The order note (Shopify order, packing slip). Text only: the length line lives here, never images or customer wording.
function noteText(wheels, lengthsByPos, imageErrors) {
  let note = `${SYSTEM_REPORT_MARKER} (Industry Nine SYSTEM spokes)\n`; // the marker doubles as the "already processed" record (see _lib/system-dedupe.js)
  note += '--------------------------------------------------\n';
  note += 'No Length Variant inventory was deducted (System spokes have no length yet).\n';
  wheels.forEach((w) => {
    const l = lengthsByPos[w.position];
    note += `\n${w.label.toUpperCase()} WHEEL (${w.hubModel}, ${w.spokeCountLabel})\n`;
    note += `  Rim: ${w.rimTitle}\n`;
    note += `  Hub: ${w.hubTitle}${w.hubVariantTitle ? ` (${w.hubVariantTitle})` : ''}\n`;
    note += `  Hub color: ${w.hubColor}\n`;
    if (w.position === 'rear') note += `  Freehub: ${w.freehub || 'n/a'}\n`;
    note += `  Drive side (${w.config.drive.n}): ${countsText(w.counts.drive)}\n`;
    note += `  Rotor side (${w.config.rotor.n}): ${countsText(w.counts.rotor)}\n`;
    note += `  Whole wheel (${w.total}): ${countsText(w.counts.all)}${w.isMultiColor ? '' : ' (one color)'}\n`;
    note += `  ${l.text}\n`;
    w.warnings.forEach((t) => { note += `  NOTE: ${t}\n`; });
  });
  if (imageErrors.length) note += `\nIMAGES:\n- ${imageErrors.join('\n- ')}\n`;
  return note;
}

function orderNumberOf(orderData) { return orderData.order_number != null ? orderData.order_number : (orderData.name || 'n/a'); }

/**
 * Builds the whole internal report. Never throws for data problems (they become warnings); only a broken recipe shape would.
 * @param {{ recipe: object, orderData?: object, componentData?: Map|null, lengthCalculator?: Function, renderPng?: Function, imageWidth?: number }} o
 */
export async function buildSystemReport(o) {
  const recipe = o.recipe, orderData = o.orderData || {};
  const lengthCalculator = o.lengthCalculator || calculateSystemSpokeLengths; // I9-SYSTEM: LENGTH-CALC HOOK
  const renderPng = o.renderPng || svgToPng, width = o.imageWidth || IMAGE_WIDTH_PX;
  const wheels = systemWheels(recipe, o.componentData || null, orderData);
  const images = [], imageErrors = [], lengthsByPos = {};
  for (const w of wheels) {
    lengthsByPos[w.position] = lengthsFor(w, lengthCalculator);
    const r = await renderWheelImages(w, renderPng, width);
    images.push(...r.images); imageErrors.push(...r.errors);
  }
  const orderNumber = orderNumberOf(orderData);
  const orderAdminUrl = orderData.id ? `https://${process.env.SHOPIFY_STORE_DOMAIN}/admin/orders/${orderData.id}` : null;
  const hubModels = [...new Set(wheels.map((w) => w.hubModel))].join(' / ');
  const multi = wheels.filter((w) => w.isMultiColor).length;
  const summary = wheels.map((w) => `<p><strong>${esc(w.label)} wheel (${esc(w.hubModel)}, ${esc(w.spokeCountLabel)}):</strong> ${w.counts.all.map((c) => `${esc(c.color)} ${TIMES_HTML}${c.n}`).join(', ')}${w.isMultiColor ? '' : ' (one color)'}</p>`).join('');
  const html = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <style>${STYLE}</style>
        </head>
        <body>
            <div class="container">
                <h2>I9 System Build Report for Order #${esc(orderNumber)}</h2>
                <p>Build ID: ${esc(recipe.buildId || 'n/a')}${orderAdminUrl ? ` | <a href="${orderAdminUrl}"><strong>View Order in Shopify &rarr;</strong></a>` : ''}</p>

                <div class="summary-box">
                    <h3>Industry Nine SYSTEM build (${esc(hubModels)})</h3>
                    ${summary}
                    <p>Wheels with custom colors: ${multi} of ${wheels.length}. No Length Variant inventory was deducted.</p>
                    <p><em>${esc(SYSTEM_LENGTHS_PENDING_TEXT.split(':')[0])}: ${Object.values(lengthsByPos).every((l) => l.pending) ? 'not calculated (method pending)' : 'see each wheel'}</em></p>
                </div>

                ${wheels.map((w) => wheelHtml(w, images, imageErrors, { internal: true, lengths: lengthsByPos[w.position] })).join('')}
                <p class="caption">Images: every spoke is drawn at full color; geometry and lacing are the Spoke Color Studio's own.</p>
            </div>
        </body>
        </html>
    `;
  return {
    subject: `I9 System Build Report for Order #${orderNumber} (spoke colors)`,
    html,
    note: noteText(wheels, lengthsByPos, imageErrors),
    wheels, images, imageErrors,
    warnings: wheels.flatMap((w) => w.warnings),
    lengths: lengthsByPos
  };
}

/* ------------------------------------------------------------------ order note could not be written */

// Round 9: puts a notice at the top of an internal report email when the order note could not be written (Shopify refused it or the call failed), with the reason.
// Inline styles so it looks the same in any report layout. The first <div class="container"> gets it; html without one is returned unchanged.
export function addNoteFailureNotice(html, reason) {
  const notice = `<p style="color:#D8000C;background-color:#FFD2D2;padding:10px;border-radius:3px"><strong>The order note could not be written:</strong> ${esc(reason)}. The report below is complete; copy what you need into the order by hand.</p>`;
  return String(html).replace('<div class="container">', () => '<div class="container">' + notice);
}

/* ------------------------------------------------------------------ plain failure email */

// Used when buildSystemReport itself throws: no images, no calculation, just what the builder needs to handle the order by hand: the order number,
// a link to the order, the error text, and the raw line items with their properties (long values such as _build are cut at 1500 characters).
export function buildFailureEmail({ orderData, error, kind = 'system' }) {
  const isStandard = kind === 'standard';
  const o = orderData || {};
  const orderNumber = orderNumberOf(o);
  const adminUrl = o.id ? `https://${process.env.SHOPIFY_STORE_DOMAIN}/admin/orders/${o.id}` : null;
  const clip = (v) => { const t = typeof v === 'string' ? v : JSON.stringify(v); return t && t.length > 1500 ? `${t.slice(0, 1500)} ... [cut, ${t.length} characters]` : t; };
  const items = (Array.isArray(o.line_items) ? o.line_items : []).map((li) => {
    const props = (Array.isArray(li && li.properties) ? li.properties : []).map((p) => `<li><code>${esc(p && p.name)}</code>: ${esc(clip(p && p.value))}</li>`).join('');
    return `<li><strong>${esc(li && li.title)}</strong>${li && li.variant_title ? ` (${esc(li.variant_title)})` : ''} &times; ${esc(li && li.quantity)}${li && li.price != null ? ` at $${esc(li.price)}` : ''}${li && li.sku ? `, SKU ${esc(li.sku)}` : ''}${props ? `<ul>${props}</ul>` : ''}</li>`;
  }).join('');
  const message = error && error.message ? error.message : String(error);
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${STYLE}</style></head><body><div class="container">
    <h2>${isStandard ? 'Spoke Calculation' : 'I9 System Build Report'} for Order #${esc(orderNumber)}: REPORT FAILED</h2>
    <p>The automatic ${isStandard ? 'spoke' : 'System'} report could not be built or delivered for this order, so the normal email, images and order note may be missing. Handle it by hand from the line items below.${adminUrl ? ` <a href="${adminUrl}"><strong>View Order in Shopify &rarr;</strong></a>` : ''}</p>
    <p class="failed">Error: ${esc(message)}</p>
    <h3>Raw line items</h3><ul>${items || '<li>(no line items)</li>'}</ul>
  </div></body></html>`;
  return { subject: `${isStandard ? 'Spoke Calculation' : 'I9 System Build Report'} for Order #${orderNumber}: REPORT FAILED (raw order data)`.replace(/[\r\n]+/g, ' '), html, images: [] };
}

/* ------------------------------------------------------------------ customer email */

// Where the customer email goes: the order's email, else the customer's. null when there is no usable address.
export function customerRecipient(orderData) {
  const cands = [orderData && orderData.email, orderData && orderData.customer && orderData.customer.email];
  for (const c of cands) { const v = typeof c === 'string' ? c.trim() : ''; if (v && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return v; }
  return null;
}
export function customerFirstName(orderData) {
  const o = orderData || {};
  const cands = [o.customer && o.customer.first_name, o.billing_address && o.billing_address.first_name, o.shipping_address && o.shipping_address.first_name];
  for (const c of cands) { const v = typeof c === 'string' ? c.trim() : ''; if (v) return v; }
  return null;
}

/**
 * The customer version of the report: greeting, one sentence, per wheel the component details, the color tables and the same images.
 * No lengths, no warnings, no fee/mismatch/geometry-source text, no build id, no inventory text. Built for EVERY System build, solid-color wheels included (each solid wheel shows its one all-spokes image); null only when the build has no wheels.
 * Returns { subject, html, fallbackHtml, images, wheels } - fallbackHtml is the same email without images (used if Resend rejects the attachments).
 */
export function buildCustomerEmail({ wheels, images, orderData }) {
  if (!wheels || !wheels.length) return null; // every System build gets the customer email (when the flag is on), whatever the colors
  const orderData_ = orderData || {};
  const orderNumber = orderNumberOf(orderData_);
  const first = customerFirstName(orderData_);
  const page = (imgs) => `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <style>${STYLE}</style>
        </head>
        <body>
            <div class="container">
                <h2>Your custom spoke colors, order #${esc(orderNumber)}</h2>
                <p>${first ? `Hi ${esc(first)},` : 'Hi,'}</p>
                <p>Here are the spoke colors for your wheels.</p>
                ${wheels.map((w) => wheelHtml(w, imgs, [], { internal: false })).join('')}
            </div>
        </body>
        </html>
    `;
  return {
    subject: `Your custom spoke colors, order #${orderNumber}`,
    html: page(images || []),
    fallbackHtml: page([]).replace(/<p class="caption">[\s\S]*?<\/p>/g, ''),
    images: images || [],
    wheels
  };
}

/* ------------------------------------------------------------------ Resend sends with inline images */

// Sends through the Resend REST API so the attachments can carry content_id (inline images, src="cid:..."). Gmail and Apple Mail show
// cid images; data: URIs would not show in Gmail. If the send with images fails, the same email goes out text-only (the internal report
// gets a line per image saying why; a report with `fallbackHtml`, the customer email, uses that instead and shows no technical text).
// Returns { id, inline: boolean }. Throws only when both sends fail.
export async function sendSystemEmail(o) {
  const apiKey = o.apiKey || process.env.RESEND_API_KEY;
  const to = o.to || process.env.BUILDER_EMAIL_ADDRESS;
  const from = o.from || 'Spoke Calculator <calculator@loamlabsusa.com>';
  const replyTo = o.replyTo || 'LoamLabs Support <info@loamlabsusa.com>';
  const fetchImpl = o.fetchImpl || globalThis.fetch;
  if (!apiKey) throw new Error('RESEND_API_KEY is not set');
  if (!to) throw new Error('recipient address is not set');
  const report = o.report;

  const post = async (body) => {
    const res = await fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(o.timeoutMs || resendTimeoutMs()) // a hung send fails like any other error: images -> text-only -> the caller's fallback
    });
    let json = null;
    try { json = await res.json(); } catch (e) { /* no body */ }
    if (!res.ok) throw new Error(`Resend ${res.status}: ${json && (json.message || json.error) ? (json.message || JSON.stringify(json.error)) : 'send failed'}`);
    return json;
  };
  // REVIEW: a subject can never carry a line break (header injection), whatever the order number / name looked like.
  const base = { from, to: [to], reply_to: replyTo, subject: String(report.subject).replace(/[\r\n]+/g, ' ') };

  if (report.images.length) {
    try {
      const data = await post({
        ...base, html: report.html,
        attachments: report.images.map((i) => ({ filename: i.filename, content: i.png.toString('base64'), content_type: 'image/png', content_id: i.cid }))
      });
      return { id: data && data.id, inline: true };
    } catch (e) {
      console.error('I9-SYSTEM: email with inline images failed, retrying text-only:', e.message);
      let html;
      if (report.fallbackHtml) html = report.fallbackHtml;
      else {
        const lines = report.images.map((i) => `${i.caption}: image failed: email attachment rejected (${e.message})`);
        const failedHtml = `<div class="container"><p class="failed">${lines.map(esc).join('<br>')}</p></div>`;
        html = report.html.replace(/<img[^>]*src="cid:[^"]*"[^>]*>/g, '').replace(/<\/body>/i, `${failedHtml}</body>`);
      }
      const data = await post({ ...base, html });
      return { id: data && data.id, inline: false, error: e.message };
    }
  }
  const data = await post({ ...base, html: report.html });
  return { id: data && data.id, inline: false };
}

/**
 * Sends the customer version to the ORDER's customer, only when env SYSTEM_CUSTOMER_EMAIL is exactly "on" (default off). Never throws.
 * Returns { sent: boolean, reason?: string, id?: string, to?: string }. Logs exactly one line when it does not send.
 */
export async function sendCustomerEmailIfEnabled({ customer, orderData, env = process.env, send = sendSystemEmail, log = console.log }) {
  try {
    if (!customer) return { sent: false, reason: 'the build has no wheels' };
    if (env[CUSTOMER_EMAIL_FLAG] !== 'on') {
      log(`I9-SYSTEM: customer spoke-color email not sent (${CUSTOMER_EMAIL_FLAG} is not "on").`);
      return { sent: false, reason: 'flag off' };
    }
    const to = customerRecipient(orderData);
    if (!to) {
      log('I9-SYSTEM: customer spoke-color email not sent (the order has no customer email address).');
      return { sent: false, reason: 'no recipient' };
    }
    const r = await send({ report: customer, to, from: CUSTOMER_FROM, replyTo: CUSTOMER_REPLY_TO });
    log(`✅ I9-SYSTEM: customer spoke-color email sent (${r.inline ? 'inline images' : 'text only'}). Resend ID: ${r.id}`);
    return { sent: true, id: r.id, to, inline: r.inline };
  } catch (error) {
    console.error('🚨 I9-SYSTEM: failed to send the customer spoke-color email:', error);
    return { sent: false, reason: 'error', error: error.message };
  }
}
