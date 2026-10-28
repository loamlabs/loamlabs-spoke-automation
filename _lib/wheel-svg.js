// _lib/wheel-svg.js
// I9-SYSTEM: draws one System wheel as an SVG, the way the Spoke Color Studio draws it in its light theme (assets/spoke-studio.js
// wheelHtml + spoke-studio.css .lls-rim/.lls-stem/.lls-hub/.lls-cap). White background, valve stem at 6 o'clock, hub disc from the PCD in
// the customer's hub color, spokes with a thin dark edge so Silver and light colors read on white.
//
// Every spoke is drawn at full color and full opacity: there is NO fading and no alpha anywhere in the SVG (no opacity attributes, no
// rgba(), no stop-opacity), so tests can assert that the output carries none.
//
//   wheelSvg({ config, geom, colorsHex, hubHex, pov, sides, size })
//     config    { erd, drive: { n, pcd }, rotor: { n, pcd } }            (the Studio wheel config, see _lib/system-build.js wheelConfigFor)
//     geom      { drive: [{ hub, rim }], rotor: [...] }                    (_lib/studio-geometry.js geometry(cfg)[wheel])
//     colorsHex { drive: ['#hex' ...], rotor: [...] }                      one entry per spoke, index k as in the Studio value
//     hubHex    '#hex' of the customer's hub color
//     pov       'drive' | 'rotor'   the side facing the viewer (rotor view is mirrored, like the Studio)
//     sides     which sides' spokes are drawn: ['drive'] | ['rotor'] | ['drive','rotor'] (default both). The viewed side is drawn on top.
//     size      box width/height in px (default 600)
//     arrow     false leaves out the rolling-forward arrow (default: drawn)
//     ring      optional photo rim ring { key, href (data URI), ...geometry } (_lib/rim-rings.js loadRing): drawn instead of the stroked circle, spoke ends on its inner
//               ellipse, order spokes / ring / valve stem / hub. Without it the output is exactly what it was before round 12.
//
// Spoke paint order inside ONE side (the Studio's FINAL_CROSS_TOP, assets/spoke-studio.js ART.spokeLayer): the spokes of one group are drawn first and the
// other group on top, so at the outermost crossing of a side every spoke of the top group crosses over every spoke of the other, whatever the colors.
// Leading = geometry sweep +1 (the rim hole is clockwise of the hub hole in the drive-side view, even spoke numbers), trailing = sweep -1 (odd numbers);
// trailing is on top (the Studio's shipped value). The order depends on nothing else, and it is the same in a rotor-side (mirrored) view. Inside a group the
// spokes keep their spoke-number order. The far side of an all-spokes image is still drawn first, so it stays behind the near side.
//
// Rolling-forward arrow (the Studio's "Arrow B", assets/spoke-studio.js ART.rollArrow): an arc over the top of the rim with an arrowhead, showing
// which way the wheel turns when the bike rolls forward as seen from the side facing the viewer: clockwise looking at the drive side,
// counter-clockwise looking at the rotor side (the Studio: ccw = pov === 'rotor'). Solid colour only (the Studio's fading tail is a plain arc here);
// it sits just outside the rim, inside the box, and is drawn as <g data-roll="cw|ccw"> so tests can find it.

import { ringLayout } from './rim-rings.js';

export const RIM_COLOR = '#3b4148';   // .lls-preview .lls-rim (light) and --rim of the light theme
export const ARROW_COLOR = '#2a6fd0';  // medium blue, solid (the Studio's --rollarrow #0b57c4 / #6db2ff, without the fade)
export const FINAL_CROSS_TOP = 'trailing'; // which group of a side's spokes is drawn on top: 'trailing' (shipped in the Studio) or 'leading'
export const EDGE_COLOR = '#8e939a';  // thin dark edge around every spoke (opaque; the Studio's 32% black edge over white, a little darker)

// REVIEW: every number written into the SVG must be finite and sane. Coordinates in the 1e8 range (rim_erd = 0.0001 from a tampered
// _build) made @resvg/resvg-js panic inside tiny-skia, which aborts the whole Node process; a thrown RangeError is caught per image instead.
const MAX_COORD = 1e6;
function f(n) {
  n = Number(n);
  if (!isFinite(n) || Math.abs(n) > MAX_COORD) throw new RangeError(`wheel drawing value out of range (${n})`);
  return n.toFixed(2);
}
function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

// '#rrggbb' mixed toward another '#rrggbb' by t (0..1); opaque result. Unknown input returns the base unchanged.
export function mixHex(base, toward, t) {
  const p = (h) => { const m = /^#([0-9a-f]{6})$/i.exec(String(h).trim()); return m ? [0, 2, 4].map((i) => parseInt(m[1].substr(i, 2), 16)) : null; };
  const a = p(base), b = p(toward);
  if (!a || !b) return base;
  return '#' + a.map((v, i) => Math.round(v + (b[i] - v) * t).toString(16).padStart(2, '0')).join('');
}

// The Studio's sizes follow its 480 px reference drawing (radius ro + 14, stroke 7, head 22 long x 26 wide). Here the gap to the rim is 13 and the head 24 wide
// so the whole arrow (arc top at ro + 16.5 of a box/2 = 0.5 * box) stays inside the image and the head never touches the rim.
function rollArrow(box, ro, ccw) {
  const k = box / 480, c = box / 2, r = ro + 13 * k, sw = 7 * k, L = 22 * k, W = 12 * k, t1 = -138, t2 = -46;
  const X = (x) => (ccw ? box - x : x); // the counter-clockwise arrow is the mirror image
  const P = (t, rr) => { const q = t * Math.PI / 180; return [X(c + rr * Math.cos(q)), c + rr * Math.sin(q)]; };
  const a = P(t1, r), b = P(t2, r), q = t2 * Math.PI / 180, e = P(t2, r);
  const sg = ccw ? -1 : 1, tx = sg * -Math.sin(q), ty = Math.cos(q), nx = sg * Math.cos(q), ny = Math.sin(q);
  const head = [[e[0] + tx * L, e[1] + ty * L], [e[0] + nx * W, e[1] + ny * W], [e[0] - nx * W, e[1] - ny * W]].map((v) => v.map(f).join(',')).join(' ');
  return `<g data-roll="${ccw ? 'ccw' : 'cw'}">` +
    `<path d="M${f(a[0])} ${f(a[1])} A${f(r)} ${f(r)} 0 0 ${ccw ? 0 : 1} ${f(b[0])} ${f(b[1])}" fill="none" stroke="${ARROW_COLOR}" stroke-width="${f(sw)}" stroke-linecap="butt"/>` +
    `<polygon points="${head}" fill="${ARROW_COLOR}"/></g>`;
}

export function wheelSvg(o) {
  const box = o.size || 600, pov = o.pov === 'rotor' ? 'rotor' : 'drive';
  const wh = o.config, g = o.geom;
  const wanted = Array.isArray(o.sides) && o.sides.length ? o.sides : ['drive', 'rotor'];
  // draw order: the viewed side last so its spokes sit on top (as the Studio does)
  const sides = ['drive', 'rotor'].filter((s) => wanted.includes(s)).sort((a, b) => (a === pov ? 1 : 0) - (b === pov ? 1 : 0));
  // same proportions as the Studio's wheelHtml
  const c = box / 2, ro = box * 0.464, bw = box * 0.028, inner = ro - bw, rimR = inner - 1;
  // with a photo ring the rim's inner edge is the ring's inner ellipse (_lib/rim-rings.js); without one everything below is as it always was
  const L = o.ring ? ringLayout(box, ro, o.ring) : null;
  const scale = (L ? L.meanInner : rimR) / (wh.erd / 2);
  // the Studio draws th = 3 (edge 1 px each side) in its 522 px stage; scale that to the box
  const th = Math.max(2, 3 * box / 522), e = th > 2.5 ? 1 : 0.5, halo = th + 2 * e;
  let spokes = '';
  sides.forEach((side) => {
    const rh = wh[side].pcd / 2 * scale;
    let lines = '';
    const topS = FINAL_CROSS_TOP === 'leading' ? 1 : -1; // geometry sweep of the group that is drawn on top
    const list = (g[side] || []).map((p, k) => ({ p, k }));
    const ordered = list.filter(({ p }) => p.sweep !== topS).concat(list.filter(({ p }) => p.sweep === topS)); // stable: spoke-number order inside a group
    ordered.forEach(({ p, k }) => {
      const a1 = (pov === 'drive' ? p.hub : (360 - p.hub) % 360) * Math.PI / 180;
      const a2 = (pov === 'drive' ? p.rim : (360 - p.rim) % 360) * Math.PI / 180;
      const x1 = c + rh * Math.sin(a1), y1 = c - rh * Math.cos(a1);
      const [x2, y2] = L ? L.end(a2 * 180 / Math.PI) : [c + rimR * Math.sin(a2), c - rimR * Math.cos(a2)];
      const hex = (o.colorsHex && o.colorsHex[side] && o.colorsHex[side][k]) || '#8a9099';
      const pos = ` x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}"`;
      lines += `<line${pos} stroke="${EDGE_COLOR}" stroke-width="${f(halo)}"/>` +
        `<line${pos} stroke="${esc(hex)}" stroke-width="${f(th)}"/>`;
    });
    spokes += `<g data-side="${side}">${lines}</g>`;
  });
  // valve stem (CSS: 3px top radius, 1px dark border, horizontal gray gradient)
  const sw = Math.max(2, box * 0.018), stemH = box * 0.05 + 1, stemX = c - sw / 2, stemY = (L ? L.end(180, 0)[1] : c + inner) - box * 0.05;
  const stem = `<rect x="${f(stemX)}" y="${f(stemY)}" width="${f(sw)}" height="${f(stemH)}" rx="${f(Math.min(3, sw / 2))}" fill="url(#stem)" stroke="#6b7076" stroke-width="1"/>`;
  // the photo ring, drawn over the spokes (their ends are tucked under it) and never mirrored, also in the rotor side view; the stem and the hub come after it
  const ringImg = L ? `<image data-ring="${esc(o.ring.key || '')}" href="${esc(o.ring.href)}" x="${f(L.image.x)}" y="${f(L.image.y)}" width="${f(L.image.size)}" height="${f(L.image.size)}" transform="rotate(${f(L.rot)} ${f(c)} ${f(c)})"/>` : '';
  // hub disc (drawn over the spokes, like the Studio) and its cap; the Studio's white shine is a lighter opaque center here
  const hr = Math.max(wh.drive.pcd, wh.rotor.pcd) / 2 * scale + box * 0.012, hubBorder = Math.max(1.5, box * 0.008), cr = hr * 0.4;
  const hubHex = o.hubHex || '#8a9099';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${box}" height="${box}" viewBox="0 0 ${box} ${box}">` +
    `<defs>` +
    `<linearGradient id="stem" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#8d949d"/><stop offset="0.5" stop-color="#e3e7ec"/><stop offset="1" stop-color="#8d949d"/></linearGradient>` +
    `<radialGradient id="hubshine" cx="0.35" cy="0.30" r="0.75"><stop offset="0" stop-color="${mixHex(hubHex, '#ffffff', 0.55)}"/><stop offset="0.7" stop-color="${hubHex}"/><stop offset="1" stop-color="${hubHex}"/></radialGradient>` +
    `</defs>` +
    `<rect width="${box}" height="${box}" fill="#ffffff"/>` +
    (L ? spokes + ringImg + stem
      : `<circle cx="${f(c)}" cy="${f(c)}" r="${f(ro - bw / 2)}" fill="none" stroke="${RIM_COLOR}" stroke-width="${f(bw)}"/>` + stem + spokes) +
    `<circle cx="${f(c)}" cy="${f(c)}" r="${f(hr - hubBorder / 2)}" fill="url(#hubshine)" stroke="#4a4d52" stroke-width="${f(hubBorder)}"/>` +
    `<circle cx="${f(c)}" cy="${f(c)}" r="${f(cr - 0.5)}" fill="#1d2127" stroke="#6b6f73" stroke-width="1"/>` +
    (o.arrow === false ? '' : rollArrow(box, ro, pov === 'rotor')) +
    `</svg>`;
}
