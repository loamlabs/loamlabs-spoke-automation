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

export const RIM_COLOR = '#3b4148';   // .lls-preview .lls-rim (light) and --rim of the light theme
export const EDGE_COLOR = '#8e939a';  // thin dark edge around every spoke (opaque; the Studio's 32% black edge over white, a little darker)

function f(n) { return Number(n).toFixed(2); }
function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

// '#rrggbb' mixed toward another '#rrggbb' by t (0..1); opaque result. Unknown input returns the base unchanged.
export function mixHex(base, toward, t) {
  const p = (h) => { const m = /^#([0-9a-f]{6})$/i.exec(String(h).trim()); return m ? [0, 2, 4].map((i) => parseInt(m[1].substr(i, 2), 16)) : null; };
  const a = p(base), b = p(toward);
  if (!a || !b) return base;
  return '#' + a.map((v, i) => Math.round(v + (b[i] - v) * t).toString(16).padStart(2, '0')).join('');
}

export function wheelSvg(o) {
  const box = o.size || 600, pov = o.pov === 'rotor' ? 'rotor' : 'drive';
  const wh = o.config, g = o.geom;
  const wanted = Array.isArray(o.sides) && o.sides.length ? o.sides : ['drive', 'rotor'];
  // draw order: the viewed side last so its spokes sit on top (as the Studio does)
  const sides = ['drive', 'rotor'].filter((s) => wanted.includes(s)).sort((a, b) => (a === pov ? 1 : 0) - (b === pov ? 1 : 0));
  // same proportions as the Studio's wheelHtml
  const c = box / 2, ro = box * 0.464, bw = box * 0.028, inner = ro - bw, rimR = inner - 1, scale = rimR / (wh.erd / 2);
  // the Studio draws th = 3 (edge 1 px each side) in its 522 px stage; scale that to the box
  const th = Math.max(2, 3 * box / 522), e = th > 2.5 ? 1 : 0.5, halo = th + 2 * e;
  let spokes = '';
  sides.forEach((side) => {
    const rh = wh[side].pcd / 2 * scale;
    let lines = '';
    (g[side] || []).forEach((p, k) => {
      const a1 = (pov === 'drive' ? p.hub : (360 - p.hub) % 360) * Math.PI / 180;
      const a2 = (pov === 'drive' ? p.rim : (360 - p.rim) % 360) * Math.PI / 180;
      const x1 = c + rh * Math.sin(a1), y1 = c - rh * Math.cos(a1), x2 = c + rimR * Math.sin(a2), y2 = c - rimR * Math.cos(a2);
      const hex = (o.colorsHex && o.colorsHex[side] && o.colorsHex[side][k]) || '#8a9099';
      const pos = ` x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}"`;
      lines += `<line${pos} stroke="${EDGE_COLOR}" stroke-width="${f(halo)}"/>` +
        `<line${pos} stroke="${esc(hex)}" stroke-width="${f(th)}"/>`;
    });
    spokes += `<g data-side="${side}">${lines}</g>`;
  });
  // valve stem (CSS: 3px top radius, 1px dark border, horizontal gray gradient)
  const sw = Math.max(2, box * 0.018), stemH = box * 0.05 + 1, stemX = c - sw / 2, stemY = c + inner - box * 0.05;
  // hub disc (drawn over the spokes, like the Studio) and its cap; the Studio's white shine is a lighter opaque center here
  const hr = Math.max(wh.drive.pcd, wh.rotor.pcd) / 2 * scale + box * 0.012, hubBorder = Math.max(1.5, box * 0.008), cr = hr * 0.4;
  const hubHex = o.hubHex || '#8a9099';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${box}" height="${box}" viewBox="0 0 ${box} ${box}">` +
    `<defs>` +
    `<linearGradient id="stem" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#8d949d"/><stop offset="0.5" stop-color="#e3e7ec"/><stop offset="1" stop-color="#8d949d"/></linearGradient>` +
    `<radialGradient id="hubshine" cx="0.35" cy="0.30" r="0.75"><stop offset="0" stop-color="${mixHex(hubHex, '#ffffff', 0.55)}"/><stop offset="0.7" stop-color="${hubHex}"/><stop offset="1" stop-color="${hubHex}"/></radialGradient>` +
    `</defs>` +
    `<rect width="${box}" height="${box}" fill="#ffffff"/>` +
    `<circle cx="${f(c)}" cy="${f(c)}" r="${f(ro - bw / 2)}" fill="none" stroke="${RIM_COLOR}" stroke-width="${f(bw)}"/>` +
    `<rect x="${f(stemX)}" y="${f(stemY)}" width="${f(sw)}" height="${f(stemH)}" rx="${f(Math.min(3, sw / 2))}" fill="url(#stem)" stroke="#6b7076" stroke-width="1"/>` +
    spokes +
    `<circle cx="${f(c)}" cy="${f(c)}" r="${f(hr - hubBorder / 2)}" fill="url(#hubshine)" stroke="#4a4d52" stroke-width="${f(hubBorder)}"/>` +
    `<circle cx="${f(c)}" cy="${f(c)}" r="${f(cr - 0.5)}" fill="#1d2127" stroke="#6b6f73" stroke-width="1"/>` +
    `</svg>`;
}
