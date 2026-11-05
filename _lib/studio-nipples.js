// _lib/studio-nipples.js
// NIPPLE-REPORT: the nipple drawing of the Spoke Color Studio, vendored from the dev theme (assets/spoke-studio.js: NIPPLE, NIPPLE_COLORS, NIPPLE_MATCH, ART.nipples).
//
// Vendored from the theme at commit 9fdb48f (branch studio-nipples, Agent A): f2683bf (the nipple layer), 8f58599 (minimum picture 140 px), db5c6f1 (shape numbers) and
// 9fdb48f (Jerry's tuned numbers: width 0.0069, length 0.0185, pos -0.006, corner 0.0012; the nipples come out from BEHIND the rim). The theme file stays the source of truth;
// tests/studio-nipples-drift.test.js compares this module with the theme's LoamStudio.nipple / nippleColors / nippleMatch and with the nipple shapes the theme draws, so the
// two cannot silently drift. If Agent A changes the nipple look in the theme, port the numbers here (and vice versa) and run the tests.
//
// Drawing (assets/spoke-studio.js wheelHtml): the layer order of a picture is spokes, nipples, rim ring, valve stem, tap strips, hub (the ring covers the rim-side end of each
// nipple). A nipple is NIPPLE.width * S wide and NIPPLE.length * S long (S = the picture width) on the spoke's line, its middle NIPPLE.pos * S out from the rim's inner edge
// (the spoke's end point minus the tuck) along the spoke; positive = out into the rim face, negative = toward the hub. A picture narrower than NIPPLE.minBox px draws none.

export const NIPPLE = { width: 0.0069, length: 0.0185, pos: -0.006, minBox: 140, edgeShade: 0.55, edgePx: 0.6, corner: 0.0012, taper: 0, head: 0, headLen: 0.3, darkEdge: '#ffffff', darkEdgeOpacity: 0.4 };
// the light-nipple test of the Studio's valve (VALVE.lightAbove): luma above this = a light nipple, which gets a darker outline
export const NIPPLE_LIGHT_ABOVE = 0.5;
// REPORT ONLY (Jerry, 5 Nov): the order-report pictures draw each nipple 50% wider and 20% longer than the Studio does (first 50% longer; Jerry: "1/5 shorter than they are" = 1.5 x 0.8 = 1.2),
// so a Silver nipple is easy to spot and a Black one is at least faintly visible. The Studio's own numbers above stay as they are (the drift test pins them); wheelSvg passes this scale, nippleShapes' default of 1 is the Studio's look.
export const REPORT_NIPPLE_SCALE = { width: 1.5, length: 1.2 };

// Spoke color -> nipple color for "Match my spokes" (Studio default table). Not used by the report; vendored so the drift test can pin the whole nipple contract.
export const NIPPLE_MATCH = {
  'Black Berd': 'Black', 'Blue Berd': 'Blue', 'Flamingo Pink': 'Pink', 'Mallard Green': 'Green',
  'Martin Purple': 'Purple', 'Oriole Orange': 'Orange', 'Robin Red': 'Red'
};
// The 12 Sapim aluminium nipple colors in the store's order (hex = Agent A's guesses from the product photos; Black and Silver reuse the spoke palette's).
// Brass nipples are Black and Silver only. The order's own _build.standardStudio.colors map is read first; this table is the fallback for a color the map lacks.
export const NIPPLE_COLORS = [
  { name: 'Black', hex: '#1d1f23' }, { name: 'Silver', hex: '#c3c8cf' }, { name: 'Blue', hex: '#244d90' }, { name: 'Bright Green', hex: '#2b9452' },
  { name: 'Gold', hex: '#b27e0e' }, { name: 'Green', hex: '#3d5c38' }, { name: 'Lime', hex: '#a49d36' }, { name: 'Orange', hex: '#ad3819' },
  { name: 'Pink', hex: '#986879' }, { name: 'Purple', hex: '#722e73' }, { name: 'Red', hex: '#a42639' }, { name: 'Turquoise', hex: '#1880ab' }
];

const HEX6 = /^#[0-9a-f]{6}$/i;
/** '#rrggbb' of a nipple color name from the table (case-insensitive), or null. */
export function nippleTableHex(name) {
  const n = String(name == null ? '' : name).trim().toLowerCase();
  const hit = NIPPLE_COLORS.find((c) => c.name.toLowerCase() === n);
  return hit ? hit.hex : null;
}

function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
// '#rgb' / '#rrggbb' -> [r, g, b] (0..255), else null (no outline)
function parseHex(hex) {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
  return [0, 2, 4].map((i) => parseInt(h.substr(i, 2), 16));
}
const luma = (rgb) => (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
function isVeryDark(hex) {
  const rgb = parseHex(hex);
  return !!rgb && rgb.every((v) => v <= 48);
}

/**
 * The shapes (no wrapper) of the nipples of one wheel picture: one <rect> per nipple, rotated onto its spoke.
 * list[]: { x, y, ux, uy, hex }, (x, y) = the spoke's rim end point (already tucked `tuck` px under the ring edge), (ux, uy) = the spoke's unit direction towards the rim.
 * Same math as the Studio's ART.nipples (the plain-rectangle branch: the shipped numbers have taper 0 and head 0; a theme change that sets them fails the drift test).
 * scale (default 1 = exactly the Studio's size) multiplies the nipple's width and length: a number for both, or { width, length }. The rim-side end stays where the Studio puts it (behind the rim), so a larger nipple grows
 * toward the hub: the visible part of the nipple gets longer by the full amount. The 0.6 px outline does not scale.
 */
export function nippleShapes(box, list, tuck, scale = 1) {
  const ok = (v) => Number.isFinite(v) && v > 0;
  const kw = ok(scale) ? scale : (scale && ok(scale.width) ? scale.width : 1), kl = ok(scale) ? scale : (scale && ok(scale.length) ? scale.length : 1);
  const w = box * NIPPLE.width * kw, len = box * NIPPLE.length * kl, mid = box * NIPPLE.pos - (box * NIPPLE.length * (kl - 1)) / 2, f = (n) => +n.toFixed(2);
  const corner = Math.max(0, box * NIPPLE.corner);
  return list.map((q) => {
    const ex = q.x - q.ux * tuck, ey = q.y - q.uy * tuck, sx = ex + q.ux * (mid - len / 2), sy = ey + q.uy * (mid - len / 2), ang = Math.atan2(q.uy, q.ux) * 180 / Math.PI;
    const rgb = parseHex(q.hex);
    let edge = '';
    if (rgb && luma(rgb) > NIPPLE_LIGHT_ABOVE) edge = ' stroke="#' + rgb.map((v) => ('0' + Math.round(v * NIPPLE.edgeShade).toString(16)).slice(-2)).join('') + '" stroke-width="' + NIPPLE.edgePx + '" stroke-linejoin="miter"';
    else if (isVeryDark(q.hex)) edge = ' stroke="' + NIPPLE.darkEdge + '" stroke-opacity="' + NIPPLE.darkEdgeOpacity + '" stroke-width="' + NIPPLE.edgePx + '" stroke-linejoin="miter"';
    return '<rect x="' + f(sx) + '" y="' + f(sy - w / 2) + '" width="' + f(len) + '" height="' + f(w) + '" transform="rotate(' + f(ang) + ' ' + f(sx) + ' ' + f(sy) + ')" fill="' + esc(q.hex) + '"' +
      (corner > 0 ? ' rx="' + f(Math.min(corner, w / 2, len / 2)) + '"' : '') + edge + '/>';
  }).join('');
}

/** True for a hex the drawing accepts ('#rrggbb'); report code uses it to keep unvalidated text out of the SVG. */
export const isHex6 = (v) => typeof v === 'string' && HEX6.test(v.trim());
