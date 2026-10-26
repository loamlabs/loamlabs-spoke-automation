// _lib/wheel-svg.js
// I9-SYSTEM: draws one System wheel as an SVG, the way the Spoke Color Studio draws it in its light theme (assets/spoke-studio.js
// wheelHtml + spoke-studio.css .lls-rim/.lls-stem/.lls-hub/.lls-cap). White background, valve stem at 6 o'clock, hub disc from the PCD,
// spokes with a thin dark edge so Silver and light colors read on white. The side being viewed is drawn at full strength on top; the
// other (far) side is drawn first, slightly faded.
//
//   wheelSvg({ config, geom, colorsHex, hubHex, pov, size })
//     config    { erd, drive: { n, pcd }, rotor: { n, pcd } }            (the Studio wheel config, see _lib/system-build.js wheelConfigFor)
//     geom      { drive: [{ hub, rim }], rotor: [...] }                    (_lib/studio-geometry.js geometry(cfg)[wheel])
//     colorsHex { drive: ['#hex' ...], rotor: [...] }                      one entry per spoke, index k as in the Studio value
//     hubHex    '#hex' of the customer's hub color
//     pov       'drive' | 'rotor'                                           the side facing the viewer (rotor view is mirrored, like the Studio)
//     size      box width/height in px (default 600)

export const FAR_SIDE_OPACITY = 0.45; // I9-SYSTEM: the far side's spokes are drawn at this opacity (one constant; the Studio draws both at 1)
export const RIM_COLOR = '#3b4148';   // .lls-preview .lls-rim (light) and --rim of the light theme
export const EDGE_COLOR = 'rgba(0,0,0,.32)'; // the light theme's spoke edge

function f(n) { return Number(n).toFixed(2); }
function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

export function wheelSvg(o) {
  const box = o.size || 600, pov = o.pov === 'rotor' ? 'rotor' : 'drive';
  const wh = o.config, g = o.geom;
  // same proportions as the Studio's wheelHtml
  const c = box / 2, ro = box * 0.464, bw = box * 0.028, inner = ro - bw, rimR = inner - 1, scale = rimR / (wh.erd / 2);
  // the Studio draws th = 3 (edge 1 px each side) in its 522 px stage; scale that to the box
  const th = Math.max(2, 3 * box / 522), e = th > 2.5 ? 1 : 0.5, halo = th + 2 * e;
  const sides = pov === 'drive' ? ['rotor', 'drive'] : ['drive', 'rotor']; // far side first, the viewed side on top
  let spokes = '';
  sides.forEach((side) => {
    const rh = wh[side].pcd / 2 * scale, far = side !== pov;
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
    spokes += `<g data-side="${side}"${far ? ` opacity="${FAR_SIDE_OPACITY}"` : ''}>${lines}</g>`;
  });
  // valve stem (CSS: 3px top radius, 1px dark border, horizontal gray gradient)
  const sw = Math.max(2, box * 0.018), stemH = box * 0.05 + 1, stemX = c - sw / 2, stemY = c + inner - box * 0.05;
  // hub disc (drawn over the spokes, like the Studio) and its cap
  const hr = Math.max(wh.drive.pcd, wh.rotor.pcd) / 2 * scale + box * 0.012, hubBorder = Math.max(1.5, box * 0.008), cr = hr * 0.4;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${box}" height="${box}" viewBox="0 0 ${box} ${box}">` +
    `<defs>` +
    `<linearGradient id="stem" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#8d949d"/><stop offset="0.5" stop-color="#e3e7ec"/><stop offset="1" stop-color="#8d949d"/></linearGradient>` +
    `<radialGradient id="hubshine" cx="0.35" cy="0.30" r="0.55"><stop offset="0" stop-color="#ffffff" stop-opacity="0.55"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></radialGradient>` +
    `</defs>` +
    `<rect width="${box}" height="${box}" fill="#ffffff"/>` +
    `<circle cx="${f(c)}" cy="${f(c)}" r="${f(ro - bw / 2)}" fill="none" stroke="${RIM_COLOR}" stroke-width="${f(bw)}"/>` +
    `<rect x="${f(stemX)}" y="${f(stemY)}" width="${f(sw)}" height="${f(stemH)}" rx="${f(Math.min(3, sw / 2))}" fill="url(#stem)" stroke="rgba(0,0,0,.45)" stroke-width="1"/>` +
    spokes +
    `<circle cx="${f(c)}" cy="${f(c)}" r="${f(hr - hubBorder / 2)}" fill="${esc(o.hubHex || '#8a9099')}" stroke="rgba(0,0,0,.5)" stroke-width="${f(hubBorder)}"/>` +
    `<circle cx="${f(c)}" cy="${f(c)}" r="${f(hr - hubBorder / 2)}" fill="url(#hubshine)"/>` +
    `<circle cx="${f(c)}" cy="${f(c)}" r="${f(cr - 0.5)}" fill="#1d2127" stroke="rgba(255,255,255,.35)" stroke-width="1"/>` +
    `</svg>`;
}
