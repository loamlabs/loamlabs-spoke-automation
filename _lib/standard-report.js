// _lib/standard-report.js
// Standard orders that carry the theme's `standardStudio` key get the same treatment System orders get, as ADDITIONS to today's Standard report:
//   - one all-spokes image per solid wheel, three images (two single-side views, one all-spokes) per custom wheel, front first;
//   - a color table per side in the internal email and the order note;
//   - for Berd wheels with colors that must be painted: the painted-spoke list for the builder (what blanks to pull and what to paint, grouped by spoke length);
//   - the customer email (built by buildCustomerEmail in _lib/system-report.js from the wheels returned here), sent under the same SYSTEM_CUSTOMER_EMAIL flag (the one switch for System and keyed Standard).
// The painted-spoke list and every warning stay out of the customer email. Wording never says "System", "Industry Nine" or "Studio".
//
//   const extra = await buildStandardAdditions({ recipe, orderData, componentData, buildReport });
//   extra = { wheels, images, imageErrors, paintPlans, warnings, html (block for the internal email), noteText (appended to the order note) }

import { standardWheels } from './standard-build.js';
import { renderWheelImages, IMAGE_WIDTH_PX } from './system-report.js';
import { svgToPng } from './wheel-png.js';
import { clip } from './system-build.js';

const TIMES = '×';
const TIMES_HTML = '&times;';
function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
// escapes everything except the &times; entity this module puts in on purpose
function escKeepTimes(s) { return esc(s).replace(/&amp;times;/g, '&times;'); }

// "Oriole Orange" stays, "White Berd" -> "White", "Black Berd" -> "Black" (Berd is the brand, the paint list talks about colors)
export function shortColorName(name) { return String(name == null ? '' : name).replace(/\s+Berd$/i, '').trim() || String(name); }
const isBlack = (c) => /^black( berd)?$/i.test(String(c));
const entriesText = (list, times = TIMES) => list.map((e) => `${shortColorName(e.name)} ${times}${e.n}`).join(', ');
const countsText = (list, times = TIMES) => list.map((c) => `${c.color} ${times}${c.n}`).join(', ');

/* ------------------------------------------------------------------ the painted-spoke list */

// Rounded spoke lengths of one wheel from the existing Standard calculation: { left, right } in mm, a side is null when the length cannot be calculated.
// (left = the non-drive / left side, right = the drive / right side, as in _lib/calculator.js; the Studio's `rotor` side is the left, `drive` the right.)
export function standardLengthsOf(buildReport, pos) {
  const w = buildReport && buildReport[pos];
  const ok = !!(w && w.calculationSuccessful && w.lengths);
  const num = (x) => (ok && x && isFinite(Number(x.rounded)) && Number(x.rounded) > 0 ? Number(x.rounded) : null);
  return { left: ok ? num(w.lengths.left) : null, right: ok ? num(w.lengths.right) : null };
}
const SIDE_TO_LENGTH = { drive: 'right', rotor: 'left' };

/**
 * The painted-spoke plan for one wheel, or null when the wheel has no color that must be painted (steel, Berd in Black / White only, no paint information).
 * Spokes of a painted color are made from the blank (White Berd); Black Berd is bought as black; White Berd is bought as white and not painted.
 * Grouped by the spoke length of each side (the two sides can differ).
 * @returns {null | { position, label, paintColors, groups: [{ length: number|null, pull: [{name,n}], paint: [{name,n}], spokes: number }], total: { pull, paint, spokes }, anyUnknown: boolean }}
 */
export function paintPlanFor(wheel, lengths) {
  const paintSet = new Set(wheel.paintColors || []);
  const used = wheel.counts.all.map((c) => c.color);
  if (![...paintSet].some((c) => used.includes(c))) return null;
  const blank = wheel.blank;
  const groups = new Map(); // key: length or 'unknown'
  for (const side of ['drive', 'rotor']) {
    const L = lengths ? lengths[SIDE_TO_LENGTH[side]] : null;
    const key = L == null ? 'unknown' : String(L);
    if (!groups.has(key)) groups.set(key, { length: L == null ? null : L, painted: new Map(), white: 0, black: 0, other: new Map() });
    const g = groups.get(key);
    for (const color of wheel.colors[side]) {
      if (paintSet.has(color)) g.painted.set(color, (g.painted.get(color) || 0) + 1);
      else if (color === blank) g.white += 1;
      else if (isBlack(color)) g.black += 1;
      else g.other.set(color, (g.other.get(color) || 0) + 1);
    }
  }
  const finish = (g) => {
    const painted = [...g.painted.entries()].map(([name, n]) => ({ name, n })).sort((a, b) => a.name.localeCompare(b.name));
    const paintedTotal = painted.reduce((s, e) => s + e.n, 0);
    const pull = [];
    if (paintedTotal + g.white > 0) pull.push({ name: blank, n: paintedTotal + g.white });
    if (g.black > 0) pull.push({ name: 'Black Berd', n: g.black });
    [...g.other.entries()].sort((a, b) => a[0].localeCompare(b[0])).forEach(([name, n]) => pull.push({ name, n }));
    return { pull, paint: painted, spokes: paintedTotal + g.white + g.black + [...g.other.values()].reduce((s, n) => s + n, 0) };
  };
  const list = [...groups.values()].filter((g) => g.painted.size > 0 || g.white > 0 || g.black > 0 || g.other.size > 0)
    .sort((a, b) => (a.length == null) - (b.length == null) || (a.length || 0) - (b.length || 0));
  const plan = list.map((g) => ({ length: g.length, ...finish(g) })).filter((g) => g.paint.length > 0);
  // wheel totals over every spoke of the wheel
  const all = { painted: new Map(), white: 0, black: 0, other: new Map() };
  for (const g of groups.values()) {
    g.painted.forEach((n, k) => all.painted.set(k, (all.painted.get(k) || 0) + n));
    all.white += g.white; all.black += g.black;
    g.other.forEach((n, k) => all.other.set(k, (all.other.get(k) || 0) + n));
  }
  const total = finish(all);
  return { position: wheel.position, label: wheel.label, paintColors: [...paintSet].filter((c) => used.includes(c)), groups: plan, total, anyUnknown: plan.some((g) => g.length == null) };
}

// "Rear, 288 mm: pull White ×18, Black ×6 -> paint Oriole Orange ×8, Martin Purple ×10"
export function paintGroupParts(plan, g, times = TIMES) {
  const where = g.length == null ? `${plan.label}, length unknown` : `${plan.label}, ${g.length} mm`;
  const tail = g.length == null ? ' (spoke lengths could not be calculated for this wheel)' : '';
  return { where, rest: `pull ${entriesText(g.pull, times)} -> paint ${entriesText(g.paint, times)}${tail}` };
}
export function paintGroupText(plan, g, times = TIMES) { const p = paintGroupParts(plan, g, times); return `${p.where}: ${p.rest}`; }
export function paintTotalText(plan, times = TIMES) {
  return `${plan.label} total (${plan.total.spokes} spokes): pull ${entriesText(plan.total.pull, times)} -> paint ${entriesText(plan.total.paint, times)}`;
}

/* ------------------------------------------------------------------ internal email block + order note */

const IMG_STYLE = 'display:block;width:100%;max-width:' + IMAGE_WIDTH_PX + 'px;height:auto;border:1px solid #ddd;border-radius:4px;background:#fff;';
const CAPTION_STYLE = 'font-size:0.95em;color:#555;margin:4px 0 16px;';
const FAILED_STYLE = 'color:#D8000C;background-color:#FFD2D2;padding:10px;border-radius:3px;';

function swatchRow(label, list, hexOf) {
  const cells = list.map((c) => `<span style="display:inline-block;width:11px;height:11px;border-radius:50%;border:1px solid #666;vertical-align:-1px;margin-right:4px;background:${hexOf(c.color)}"></span>${esc(c.color)} ${TIMES_HTML}${c.n}`).join(', ');
  return `<tr><td>${esc(label)}</td><td>${cells}</td></tr>`;
}

function wheelColorsHtml(w, images, imageErrors) {
  const imgs = images.filter((i) => i.position === w.position);
  const errs = imageErrors.filter((e) => e.startsWith(`${w.label} wheel`));
  const solidLine = w.isMultiColor ? '' : `<p><strong>${esc(w.label)} wheel: all ${esc(w.counts.all[0] ? w.counts.all[0].color : 'n/a')}</strong></p>`;
  const pics = imgs.map((i) => `<img src="cid:${i.cid}" width="${IMAGE_WIDTH_PX}" alt="${esc(i.caption)}" style="${IMG_STYLE}"><p style="${CAPTION_STYLE}">${esc(i.caption)}</p>`).join('');
  const failed = errs.map((e) => `<p style="${FAILED_STYLE}">${esc(e)}</p>`).join('');
  const warn = w.warnings.map((t) => `<p class="alert"><strong>NOTE:</strong> ${esc(t)}</p>`).join('');
  return `
            <h4>${esc(w.label.toUpperCase())} WHEEL (${esc(w.spokeProduct)}, ${esc(w.spokeCountLabel)})</h4>
            <table class="data-table">
                ${swatchRow(`${w.sideLabels.drive} (${w.colors.drive.length})`, w.counts.drive, w.hexOf)}
                ${swatchRow(`${w.sideLabels.rotor} (${w.colors.rotor.length})`, w.counts.rotor, w.hexOf)}
                ${swatchRow(`Whole wheel (${w.total})`, w.counts.all, w.hexOf)}
            </table>
            ${solidLine}${pics}${failed}${warn}`;
}

function paintHtml(plans) {
  if (!plans.length) return '';
  const body = plans.map((p) => `
            <h4>${esc(p.label.toUpperCase())} WHEEL: spokes to paint</h4>
            ${p.groups.map((g) => { const t = paintGroupParts(p, g, TIMES_HTML); return `<p style="margin:4px 0;"><strong>${esc(t.where)}:</strong> ${escKeepTimes(t.rest)}</p>`; }).join('')}
            <p style="margin:4px 0;"><em>${escKeepTimes(paintTotalText(p, TIMES_HTML))}</em></p>`).join('');
  return `
        <div class="wheel-section">
            <h3>PAINTED SPOKES (for the builder, not in the customer email)</h3>
            <p>Spokes of a painted color are made from the blank (White Berd); Black Berd is bought as black.</p>${body}
        </div>`;
}

function noteTextFor(wheels, plans, imageErrors) {
  let note = '\n--------------------------------------------------\nSPOKE COLORS:\n';
  wheels.forEach((w) => {
    note += `${w.label.toUpperCase()} WHEEL (${w.spokeProduct}, ${w.spokeCountLabel})\n`;
    note += `  ${w.sideLabels.drive} (${w.colors.drive.length}): ${countsText(w.counts.drive)}\n`;
    note += `  ${w.sideLabels.rotor} (${w.colors.rotor.length}): ${countsText(w.counts.rotor)}\n`;
    note += `  Whole wheel (${w.total}): ${countsText(w.counts.all)}${w.isMultiColor ? '' : ' (one color)'}\n`;
    w.warnings.forEach((t) => { note += `  NOTE: ${t}\n`; });
  });
  if (plans.length) {
    note += 'PAINTED SPOKES (spokes of a painted color are made from the blank, White Berd; Black Berd is bought as black):\n';
    plans.forEach((p) => {
      p.groups.forEach((g) => { note += `  ${paintGroupText(p, g)}\n`; });
      note += `  ${paintTotalText(p)}\n`;
    });
  }
  if (imageErrors.length) note += `IMAGES:\n- ${imageErrors.join('\n- ')}\n`;
  return note;
}

/**
 * Builds everything the Standard path adds for an order that carries standardStudio. Never throws: a problem becomes a warning or an imageErrors line.
 * @param {{ recipe: object, orderData?: object, componentData?: Map|null, buildReport?: object, renderPng?: Function, imageWidth?: number }} o
 */
export async function buildStandardAdditions(o) {
  const orderData = o.orderData || {}, renderPng = o.renderPng || svgToPng, width = o.imageWidth || IMAGE_WIDTH_PX;
  const wheels = standardWheels(o.recipe, o.componentData || null, orderData);
  const images = [], imageErrors = [], plans = [];
  for (const w of wheels) {
    try {
      const r = await renderWheelImages(w, renderPng, width);
      images.push(...r.images); imageErrors.push(...r.errors);
    } catch (e) { imageErrors.push(`${w.label} wheel: image failed: ${clip(e && e.message ? e.message : String(e), 120)}`); }
    try {
      const plan = paintPlanFor(w, standardLengthsOf(o.buildReport, w.position));
      if (plan) plans.push(plan);
    } catch (e) { w.warnings.push(`${w.label} wheel: the painted-spoke list could not be built (${clip(e && e.message ? e.message : String(e), 120)}).`); }
  }
  const html = wheels.length ? `
        <div class="wheel-section">
            <h3>SPOKE COLORS</h3>${wheels.map((w) => wheelColorsHtml(w, images, imageErrors)).join('')}
        </div>${paintHtml(plans)}` : '';
  return {
    wheels, images, imageErrors, paintPlans: plans,
    warnings: wheels.flatMap((w) => w.warnings),
    html, noteText: wheels.length ? noteTextFor(wheels, plans, imageErrors) : ''
  };
}
