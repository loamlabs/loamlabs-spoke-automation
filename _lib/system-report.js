// _lib/system-report.js
// I9-SYSTEM: the engineering report for a System build order: email HTML (with inline wheel images), the plain-text order note, and the
// Resend send with inline attachments. Nothing here touches inventory. Every image problem is caught and reported in the email text;
// the report is always produced.
//
//   const report = await buildSystemReport({ recipe, orderData, componentData });   // { subject, html, note, wheels, images, imageErrors, warnings }
//   await sendSystemEmail({ report, orderData, to, apiKey });                        // inline images via content ids (cid:), falls back to text-only

import { systemWheels, hexFor, SYSTEM_FEE } from './system-build.js';
import { geometry } from './studio-geometry.js';
import { wheelSvg, FAR_SIDE_OPACITY } from './wheel-svg.js';
import { svgToPng } from './wheel-png.js';
import { calculateSystemSpokeLengths, SYSTEM_LENGTHS_PENDING_TEXT } from './system-lengths.js';

export const IMAGE_WIDTH_PX = 600;
const TIMES = '×';          // plain text (order note)
const TIMES_HTML = '&times;';    // email HTML (entity: safe whatever charset the client assumes)

function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; }
function countsText(list, times = TIMES) { return list.map((c) => `${c.color} ${times}${c.n}`).join(', '); }

// Image order: front wheel rotor view then drive view; rear wheel drive view then rotor view.
export function viewsFor(position) { return position === 'front' ? ['rotor', 'drive'] : ['drive', 'rotor']; }

// Renders the two views of a multi-color wheel. Each failure becomes an imageErrors line; nothing throws.
async function renderWheelImages(wheel, renderPng, width) {
  const images = [], errors = [];
  let geom;
  try {
    geom = geometry({ wheels: { [wheel.position]: wheel.config } })[wheel.position];
  } catch (e) {
    errors.push(`${wheel.label} wheel: image failed: geometry error: ${e.message}`);
    return { images, errors };
  }
  const colorsHex = { drive: wheel.colors.drive.map(hexFor), rotor: wheel.colors.rotor.map(hexFor) };
  for (const pov of viewsFor(wheel.position)) {
    const caption = `${wheel.label} wheel, ${cap(pov)} side view`;
    const cid = `${wheel.position}-${pov}-view`;
    try {
      const svg = wheelSvg({ config: wheel.config, geom, colorsHex, hubHex: wheel.hubColorHex, pov, size: width });
      const png = await renderPng(svg, { width });
      if (!png || !png.length) throw new Error('renderer returned no bytes');
      images.push({ cid, filename: `${cid}.png`, caption, png, svg, position: wheel.position, pov });
    } catch (e) {
      errors.push(`${caption}: image failed: ${e && e.message ? e.message : String(e)}`);
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

/* ------------------------------------------------------------------ email */

// The same look as the Standard report (style block copied from api/index.js sendEmailReport).
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

function colorRow(label, list) {
  const cells = list.map((c) => `<span class="swatch" style="background:${hexFor(c.color)}"></span>${esc(c.color)} ${TIMES_HTML}${c.n}`).join(', ');
  return `<tr><td>${esc(label)}</td><td>${cells}</td></tr>`;
}

function wheelHtml(w, images, imageErrors, lengths) {
  const imgs = images.filter((i) => i.position === w.position);
  const errs = imageErrors.filter((e) => e.startsWith(`${w.label} wheel`));
  let visual;
  if (!w.isMultiColor) {
    visual = `<p><strong>${esc(w.label)} wheel: all ${esc(w.counts.all[0] ? w.counts.all[0].color : 'n/a')}</strong> (one color, no image)</p>`;
  } else {
    visual = imgs.map((i) => `<img class="wheel-img" src="cid:${i.cid}" width="${IMAGE_WIDTH_PX}" alt="${esc(i.caption)}"><p class="caption">${esc(i.caption)}</p>`).join('');
    visual += errs.map((e) => `<p class="failed">${esc(e)}</p>`).join('');
  }
  const warnings = w.warnings.map((t) => `<p class="alert"><strong>NOTE:</strong> ${esc(t)}</p>`).join('');
  return `
        <div class="wheel-section">
            <h3>${w.label.toUpperCase()} WHEEL</h3>
            <table class="data-table">
                <tr><td>Rim</td><td>${esc(w.rimTitle)}</td></tr>
                <tr><td>Hub</td><td>${esc(w.hubTitle)}${w.hubVariantTitle ? ` (${esc(w.hubVariantTitle)})` : ''}</td></tr>
                <tr><td>Hub color</td><td><span class="swatch" style="background:${w.hubColorHex}"></span>${esc(w.hubColor)}</td></tr>
                ${w.position === 'rear' ? `<tr><td>Freehub</td><td>${esc(w.freehub || 'n/a')}</td></tr>` : ''}
                <tr><td>Spoke count</td><td>${esc(w.spokeCountLabel)}</td></tr>
                <tr><td>Custom color fee</td><td>${w.isMultiColor ? (w.feeLines ? `${w.feeLines} ${TIMES_HTML} ${esc(SYSTEM_FEE.name)} line on the order` : 'expected, none found on the order') : 'not applicable (one color)'}</td></tr>
            </table>
            <h4>Spoke Colors</h4>
            <table class="data-table">
                ${colorRow(`Drive side (${w.config.drive.n})`, w.counts.drive)}
                ${colorRow(`Rotor side (${w.config.rotor.n})`, w.counts.rotor)}
                ${colorRow(`Whole wheel (${w.total})`, w.counts.all)}
            </table>
            ${visual}
            <p><em>${esc(lengths.text)}</em></p>
            ${warnings}
        </div>`;
}

function noteText(wheels, lengthsByPos, imageErrors) {
  let note = 'AUTOMATED SYSTEM BUILD REPORT (Industry Nine SYSTEM spokes)\n';
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

/**
 * Builds the whole report. Never throws for data problems (they become warnings); only a broken recipe shape would.
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
    if (!w.isMultiColor) continue;
    const r = await renderWheelImages(w, renderPng, width);
    images.push(...r.images); imageErrors.push(...r.errors);
  }
  const orderNumber = orderData.order_number != null ? orderData.order_number : (orderData.name || 'n/a');
  const orderAdminUrl = orderData.id ? `https://${process.env.SHOPIFY_STORE_DOMAIN}/admin/orders/${orderData.id}` : null;
  const hubModels = [...new Set(wheels.map((w) => w.hubModel))].join(' / ');
  const multi = wheels.filter((w) => w.isMultiColor).length;
  const summary = wheels.map((w) => `<p><strong>${esc(w.label)} wheel (${esc(w.hubModel)}, ${esc(w.spokeCountLabel)}):</strong> ${esc(countsText(w.counts.all, TIMES_HTML)).replace(/&amp;times;/g, '&times;')}${w.isMultiColor ? '' : ' (one color)'}</p>`).join('');
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

                ${wheels.map((w) => wheelHtml(w, images, imageErrors, lengthsByPos[w.position])).join('')}
                <p class="caption">Images: the viewed side is drawn at full strength, the far side at ${Math.round(FAR_SIDE_OPACITY * 100)}% opacity. Geometry and lacing are the Spoke Color Studio's own.</p>
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

/* ------------------------------------------------------------------ Resend send with inline images */

// Sends through the Resend REST API so the attachments can carry content_id (inline images, src="cid:..."). Gmail and Apple Mail show
// cid images; data: URIs would not show in Gmail. If the send with images fails, the same email goes out text-only with a line per image.
// Returns { id, inline: boolean }. Throws only when both sends fail.
export async function sendSystemEmail(o) {
  const apiKey = o.apiKey || process.env.RESEND_API_KEY;
  const to = o.to || process.env.BUILDER_EMAIL_ADDRESS;
  const from = o.from || 'Spoke Calculator <calculator@loamlabsusa.com>';
  const replyTo = o.replyTo || 'LoamLabs Support <info@loamlabsusa.com>';
  const fetchImpl = o.fetchImpl || globalThis.fetch;
  if (!apiKey) throw new Error('RESEND_API_KEY is not set');
  if (!to) throw new Error('BUILDER_EMAIL_ADDRESS is not set');
  const report = o.report;

  const post = async (body) => {
    const res = await fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    let json = null;
    try { json = await res.json(); } catch (e) { /* no body */ }
    if (!res.ok) throw new Error(`Resend ${res.status}: ${json && (json.message || json.error) ? (json.message || JSON.stringify(json.error)) : 'send failed'}`);
    return json;
  };
  const base = { from, to: [to], reply_to: replyTo, subject: report.subject };

  if (report.images.length) {
    try {
      const data = await post({
        ...base, html: report.html,
        attachments: report.images.map((i) => ({ filename: i.filename, content: i.png.toString('base64'), content_type: 'image/png', content_id: i.cid }))
      });
      return { id: data && data.id, inline: true };
    } catch (e) {
      console.error('I9-SYSTEM: email with inline images failed, retrying text-only:', e.message);
      const lines = report.images.map((i) => `${i.caption}: image failed: email attachment rejected (${e.message})`);
      const failedHtml = `<div class="container"><p class="failed">${lines.map(esc).join('<br>')}</p></div>`;
      const html = report.html.replace(/<img class="wheel-img"[^>]*>/g, '').replace(/<\/body>/i, `${failedHtml}</body>`);
      const data = await post({ ...base, html });
      return { id: data && data.id, inline: false, error: e.message };
    }
  }
  const data = await post({ ...base, html: report.html });
  return { id: data && data.id, inline: false };
}
