// _lib/i9-order-list.js
// "I9 ORDER LIST" v1: what to buy from Industry Nine for one System order, as a block of the INTERNAL report email (never the order note: customers read the note).
// Pure functions, no network, never throws for data problems (they become plain lines in the list).
//
//   A. pre-built wheels   a one-color wheel gets a reminder line (no product mapping in v1)
//   B. spokes on I9's B2B dealer list, with spares, plus ONE cart link that holds the whole order (https://b2b.industrynine.com/cart/<variantId>:<qty>,...)
//   C. spokes NOT on the dealer list (by exact length, or color, or hub): order by email or phone, with a ready-to-send text
//   D. hubs, E. rims: words only
//
// Spokes: per wheel, per side, per color: the counts of the build (the same numbers as the order note), the length the note prints for that side (rotor = left, drive = right),
// +1 spare per side in the BASE color (a one-color wheel: its color). Matching to the B2B list: the snapshot _lib/i9-b2b-spokes.json (scripts/generate-i9-b2b-spokes.mjs, from Jerry's
// weekly saved file). Exact length (SKU inches rounded to the mm, never a nearby length), STANDARD gauge only (see findDealerSpoke), exact color name. Anything else goes to block C.
import SNAPSHOT from './i9-b2b-spokes.json' with { type: 'json' };
import { clip, MAX_NAME_CHARS } from './system-build.js';

export const I9_CART_BASE = 'https://b2b.industrynine.com/cart/';
export const SPARES_PER_SIDE = 1;
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const SIDES = ['rotor', 'drive']; // the order the note prints them in

/**
 * The B2B spoke for one chart length and color, or why there is none.
 * Gauge: the Hydra2 and Solix System spokes are I9's STANDARD gauge (.114-.106, "System Spoke - NNNmm"). The DH Gauge (.118-.110) and Straight Gauge (.114) products are tagged
 * other hubs only in the B2B file (none carries Hydra2 or Solix), so they are never used. A standard product whose tags do not include the order's hub model is not used either:
 * I9 lists that length for other hubs, so it goes to block C ("check with I9") instead of the link.
 * @returns {{found: true, row: object} | {found: false, reason: 'length'|'ambiguous'|'hub'|'color', detail?: string}}
 */
export function findDealerSpoke({ mm, color, hubModel, snapshot = SNAPSHOT }) {
  const rows = snapshot.spokes.filter((r) => r.gauge === 'standard' && Math.round(r.mm) === mm);
  if (!rows.length) return { found: false, reason: 'length' };
  if (new Set(rows.map((r) => r.productId)).size > 1) return { found: false, reason: 'ambiguous' };
  if (hubModel && hubModel !== 'System' && !rows[0].tags.includes(hubModel)) return { found: false, reason: 'hub', detail: rows[0].tags.filter((t) => /^(Hydra|Hydra2|Solix|Torch)$/.test(t)).join(', ') };
  const row = rows.find((r) => r.color.toLowerCase() === String(color).toLowerCase());
  if (!row) return { found: false, reason: 'color', detail: rows.map((r) => r.color).join(', ') };
  return { found: true, row };
}

// The spare color of one side, and how it was decided (never a silent guess).
// A one-color wheel: its color. Otherwise the base color the Studio recorded (_build.system.studio.base.<wheel>.<side>) when that color is on the side; if the data has none,
// the most common color on the side, and the list says so.
function spareColorOf(recipe, w, side) {
  const counts = w.counts[side]; // [{ color, n }] by count desc then name
  if (!counts.length) return { color: null, text: null };
  if (w.counts.all.length === 1) return { color: w.counts.all[0].color, text: `one color, ${w.counts.all[0].color}` };
  const rec = recipe && recipe.system && recipe.system.studio && recipe.system.studio.base && recipe.system.studio.base[w.position];
  const recorded = rec && typeof rec[side] === 'string' && rec[side].trim() ? clip(rec[side].trim(), MAX_NAME_CHARS) : null; // clipped: it comes from the customer's browser
  if (recorded && counts.some((c) => c.color === recorded)) return { color: recorded, text: `base color: ${recorded}` };
  const common = counts[0].color;
  if (recorded) return { color: common, text: `recorded base color ${recorded} is not used on this side: used the most common color, ${common}` };
  return { color: common, text: `base color not recorded: used the most common color, ${common}` };
}

const mmText = (mm) => `${mm} mm`;
const fmtEntry = (e) => `${e.color} ${e.n}${e.spare ? ` +${e.spare} spare = ${e.qty}` : ''}`;
const stockNote = (row, date) => (row && row.available === false ? ` (listed as out of stock on ${date})` : '');

/**
 * @param {{ wheels: object[], lengthsByPos: object, orderNumber: string|number, recipe?: object, snapshot?: object }} o  wheels = systemWheels() output; lengthsByPos = the report's lengths per wheel
 * @returns {{ text: string, html: string, linkUrl: string|null, link: Array<{variantId:number, qty:number, mm:number, color:string, available:boolean}>, linkAdds: string, totals: object, thomasText: string|null, blocks: object }}
 */
export function buildI9OrderList({ wheels, lengthsByPos, orderNumber, recipe = {}, snapshot = SNAPSHOT }) {
  const date = snapshot.source.date;
  const linkMap = new Map();   // variantId -> { variantId, qty, spares, mm, color, row }
  const cMap = new Map();      // mm -> Map(color -> qty)
  const sideRows = [];         // one per wheel side
  for (const w of wheels) {
    const l = lengthsByPos[w.position];
    for (const side of SIDES) {
      const mm = l && !l.pending && isFinite(side === 'rotor' ? l.left : l.right) ? (side === 'rotor' ? l.left : l.right) : null;
      const spare = spareColorOf(recipe, w, side);
      const entries = w.counts[side].map((c) => ({ color: c.color, n: c.n, spare: c.color === spare.color ? SPARES_PER_SIDE : 0, qty: c.n + (c.color === spare.color ? SPARES_PER_SIDE : 0) }));
      const row = { w, side, mm, spare, entries, dealer: [], other: [] };
      for (const e of entries) {
        if (mm == null) continue;
        const hit = findDealerSpoke({ mm, color: e.color, hubModel: w.hubModel, snapshot });
        if (hit.found) {
          row.dealer.push({ ...e, row: hit.row });
          const cur = linkMap.get(hit.row.variantId) || { variantId: hit.row.variantId, qty: 0, spares: 0, mm, color: hit.row.color, row: hit.row };
          cur.qty += e.qty; cur.spares += e.spare; linkMap.set(hit.row.variantId, cur);
        } else {
          row.other.push({ ...e, why: hit });
          const byColor = cMap.get(mm) || new Map(); byColor.set(e.color, (byColor.get(e.color) || 0) + e.qty); cMap.set(mm, byColor);
        }
      }
      sideRows.push(row);
    }
  }
  const link = [...linkMap.values()].sort((a, b) => a.mm - b.mm || a.color.localeCompare(b.color));
  const linkUrl = link.length ? `${I9_CART_BASE}${link.map((x) => `${x.variantId}:${x.qty}`).join(',')}` : null;
  const totalSpokes = link.reduce((s, x) => s + x.qty, 0), totalSpares = link.reduce((s, x) => s + x.spares, 0);
  const linkAdds = link.map((x) => `${x.qty} x ${mmText(x.mm)} ${x.color}${stockNote(x.row, date)}`).join(', ') + ` (total ${totalSpokes} spokes, includes ${totalSpares} spares)`;
  const baseText = (r) => (r.spare.text ? `  (${r.spare.text})` : '');
  const pre = (r) => `   ${cap(r.w.position).padEnd(5)}  ${r.side}  `;
  const whyText = (why) => (why.reason === 'color' ? `color not on I9's list at this length (I9 has: ${why.detail})` : why.reason === 'hub' ? 'I9 lists this length only for other hubs, not for the hub on this wheel' : why.reason === 'ambiguous' ? 'more than one I9 product at this length' : 'length not on the dealer list');

  const L = [];                // text lines
  const lines = (arr) => arr.forEach((x) => L.push(x));
  L.push(`I9 ORDER LIST  -  order #${orderNumber}`, '');
  // A. pre-built wheels
  L.push('A. PRE-BUILT WHEELS');
  const solid = wheels.filter((w) => w.counts.all.length === 1);
  if (solid.length) solid.forEach((w) => L.push(`   ${cap(w.position)}: ONE COLOR (${w.counts.all[0].color}): check I9 for a pre-built wheelset with these specs before ordering parts.`));
  else L.push(`   none for this order (${wheels.length === 1 ? 'the wheel is' : 'both wheels are'} two-color)`);
  L.push('');
  // B. dealer list
  const marker = '[Open I9 cart link]';
  L.push(`B. SPOKES on I9's dealer list, with spares${linkUrl ? `   ${marker}` : ''}`);
  const bRows = sideRows.filter((r) => r.dealer.length);
  if (!bRows.length) L.push("   none: no spokes of this order are on I9's dealer list (no cart link)");
  bRows.forEach((r) => L.push(`${pre(r)}${mmText(r.mm)}  ${r.dealer.map((e) => fmtEntry(e) + stockNote(e.row, date)).join('   ')}${baseText(r)}`));
  const noLen = sideRows.filter((r) => r.mm == null);
  noLen.forEach((r) => L.push(`${pre(r)}length not calculated  ${r.entries.map(fmtEntry).join('   ')}${baseText(r)}  (left out of the link and out of block C: no chart length for this wheel)`));
  if (linkUrl) {
    L.push(`   THE LINK ADDS:  ${linkAdds}`);
    L.push(`   Cart link (plain): ${linkUrl}`);
    L.push(`   Check the cart against this list before paying. Variant ids from the ${date} B2B file.`);
  }
  L.push('');
  // C. not on the dealer list
  L.push('C. SPOKES NOT on the dealer list: ORDER BY EMAIL OR PHONE (Thomas Ward)');
  const cRows = sideRows.filter((r) => r.other.length);
  if (!cRows.length) {
    // when no side lost its length the sentence is unchanged; when some side was left out for a missing chart length it must not claim that every length is on the list
    if (!noLen.length) L.push("   none: every length and color of this order is on I9's dealer list");
    else if (noLen.length === sideRows.length) L.push('   none: no length is calculated for this order, so nothing could be matched against the dealer list (see block B)');
    else L.push(`   none: every length that is calculated is on I9's dealer list; the sides marked "length not calculated" in block B are not covered`);
  }
  cRows.forEach((r) => L.push(`${pre(r)}${mmText(r.mm)}  ${r.other.map((e) => fmtEntry(e) + (e.why.reason === 'length' ? '' : ` [${whyText(e.why)}]`)).join('   ')}${baseText(r)}`));
  let thomasText = null;
  if (cMap.size) {
    const parts = [...cMap.entries()].sort((a, b) => a[0] - b[0]).map(([mm, byColor]) => `${mmText(mm)}: ${[...byColor.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([c, q]) => `${q} ${c}`).join(', ')}`);
    thomasText = `Hi Thomas, for LoamLabs order #${orderNumber} please add System spokes: ${parts.join('; ')}. Thank you.`;
    L.push(`   Text: "${thomasText}"`);
  }
  L.push('');
  // D. hubs, E. rims (words only)
  L.push('D. HUBS (from I9)');
  for (const w of wheels) L.push(`   ${cap(w.position)}: ${w.supplied && w.supplied.hub ? 'customer-supplied' : `${w.hubTitle}${w.hubVariantTitle ? ` (${w.hubVariantTitle})` : ''}${w.position === 'rear' && w.freehub ? `, driver ${w.freehub}` : ''}`}`);
  L.push('');
  L.push('E. RIMS (from I9)');
  for (const w of wheels) {
    if (w.supplied && w.supplied.rim) { L.push(`   ${cap(w.position)}: customer-supplied`); continue; }
    const l = lengthsByPos[w.position], rawVendor = recipe && recipe.components && recipe.components[w.position + 'Rim'] && recipe.components[w.position + 'Rim'].vendor, vendor = typeof rawVendor === 'string' ? clip(rawVendor, MAX_NAME_CHARS) : null;
    const borrowed = !!(l && /borrowed/i.test(String(l.sourceText || '')));
    const code = l && !l.pending && l.chart && l.chart.partNumber && !borrowed ? `  (I9 code ${l.chart.partNumber})` : '';
    const notI9 = vendor && !/industry nine|we are one/i.test(vendor) ? `  (vendor ${vendor}: probably not sold by I9)` : '';
    L.push(`   ${cap(w.position)}: ${w.rimTitle}, ${w.total}h${code}${notI9}`);
  }
  const text = L.join('\n') + '\n';

  // ORDER-SHEET: the same list as DATA (sections A to E), built from the variables above and from the very lines of the list, so the order sheet and the email cannot disagree.
  // Nothing here changes `text` or `html` (the email is byte for byte what it was).
  const block = (letter) => {
    const start = L.findIndex((x) => x.startsWith(`${letter}. `));
    if (start < 0) return [];
    let end = L.findIndex((x, i) => i > start && /^[A-E]\. /.test(x));
    if (end < 0) end = L.length;
    const out = L.slice(start, end);
    while (out.length && out[out.length - 1] === '') out.pop();
    return out;
  };
  const sideOut = (r) => ({ position: r.w.position, side: r.side, lengthMm: r.mm, baseColor: r.spare.color || null, baseColorNote: r.spare.text || null });
  const entryOut = (e) => ({ color: e.color, n: e.n, spare: e.spare, qty: e.qty });
  const perWheel = (line) => { const m = /^\s{3}([A-Za-z]+): (.*)$/.exec(line); return m ? { position: m[1].toLowerCase(), text: m[2] } : null; };
  const sections = {
    prebuilt: { lines: block('A'), none: !solid.length, wheels: solid.map((w) => ({ position: w.position, color: w.counts.all[0].color })) },
    dealerSpokes: {
      lines: block('B'),
      sides: bRows.map((r) => ({ ...sideOut(r), entries: r.dealer.map((e) => ({ ...entryOut(e), outOfStock: !!(e.row && e.row.available === false) })) })),
      noLength: noLen.map((r) => ({ ...sideOut(r), entries: r.entries.map(entryOut) })),
      cartLink: linkUrl ? { url: linkUrl, adds: linkAdds, totals: { spokes: totalSpokes, spares: totalSpares }, items: link.map((x) => ({ variantId: x.variantId, qty: x.qty, spares: x.spares, lengthMm: x.mm, color: x.color, available: x.row.available })) } : null
    },
    orderByEmail: {
      lines: block('C'), to: 'Thomas Ward',
      sides: cRows.map((r) => ({ ...sideOut(r), entries: r.other.map((e) => ({ ...entryOut(e), reason: e.why.reason, reasonText: e.why.reason === 'length' ? null : whyText(e.why) })) })),
      message: thomasText
    },
    hubs: { lines: block('D'), wheels: block('D').slice(1).map(perWheel).filter(Boolean).map((x) => ({ ...x, customerSupplied: x.text === 'customer-supplied' })) },
    rims: { lines: block('E'), wheels: block('E').slice(1).map(perWheel).filter(Boolean).map((x) => { const m = /\(I9 code (TR\d+)\)/.exec(x.text); return { ...x, customerSupplied: x.text === 'customer-supplied', i9Code: m ? m[1] : null }; }) }
  };

  // the same lines as HTML: monospace block, the marker becomes the link, nothing else is formatted
  const htmlLines = L.map((line) => {
    const e = esc(line);
    return linkUrl && line.includes(marker) ? e.replace(esc(marker), `<a href="${esc(linkUrl)}"><strong>Open I9 cart link</strong></a>`) : e;
  });
  const html = `
                <div class="wheel-section">
                    <pre style="font-family:Consolas,Menlo,monospace;font-size:13px;line-height:1.5;white-space:pre-wrap;word-break:break-all;background:#f4f4f7;padding:12px;border-radius:5px;margin:0">${htmlLines.join('\n')}</pre>
                </div>`;
  return {
    text, html, linkUrl, link: link.map((x) => ({ variantId: x.variantId, qty: x.qty, mm: x.mm, color: x.color, available: x.row.available })), linkAdds: link.length ? linkAdds : null,
    totals: { spokes: totalSpokes, spares: totalSpares }, thomasText, snapshotDate: date,
    blocks: { solid: solid.map((w) => w.position), dealerSides: bRows.length, otherSides: cRows.length, noLength: noLen.length },
    sections
  };
}

/** Parses a cart link back into [{ variantId, qty }] (tests, and a sanity check for anyone who wants one). */
export function parseCartLink(url) {
  if (typeof url !== 'string' || !url.startsWith(I9_CART_BASE)) return null;
  return url.slice(I9_CART_BASE.length).split(',').map((p) => { const [id, q] = p.split(':'); return { variantId: Number(id), qty: Number(q) }; });
}
