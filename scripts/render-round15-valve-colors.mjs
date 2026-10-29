// Round 15: contact sheet of the valve colors (all 30 values of Agent C's map) and one realistic order (We Are One rim, front valve Red, rear valve Turquoise).
//   node scripts/render-round15-valve-colors.mjs [outDir]       default: ../loamlabs-system-builder/agent-prompts/backend-report-images  -> round15-valve-colors.png
// Part 1: the same I9 Hydra2 front 28h picture (I9 ring) at 240 px real size + a 4x close-up of the stem and nut, one cell per color, light to dark (brightness).
// Part 2: both wheels' report pictures at 600 px for a We Are One order, through the real report code (renderWheelImages) with a valve stem component in the build.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { loadSample } from '../tests/helpers/webhook-harness.mjs';
import { findSystemBuildRecipe, systemWheels, hexFor } from '../_lib/system-build.js';
import { renderWheelImages } from '../_lib/system-report.js';
import { svgToPng } from '../_lib/wheel-png.js';
import { geometry } from '../_lib/studio-geometry.js';
import { wheelSvg, VALVE_EDGE } from '../_lib/wheel-svg.js';
import { loadRing, ringLayout } from '../_lib/rim-rings.js';
import { VALVE_COLOR_MAP } from '../_lib/valve-color-map.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.resolve(process.argv[2] || path.join(root, '..', 'loamlabs-system-builder', 'agent-prompts', 'backend-report-images'));
const { Resvg } = createRequire(import.meta.url)('@resvg/resvg-js');
const render = (svg, width) => new Resvg(svg, { fitTo: { mode: 'width', value: width }, background: '#ffffff' }).render().asPng();
const b64 = (b) => b.toString('base64');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const text = (x, y, s, size = 13, fill = '#222', weight = 'normal') => `<text x="${x}" y="${y}" font-family="Arial, sans-serif" font-size="${size}" font-weight="${weight}" fill="${fill}">${esc(s)}</text>`;
const brightness = (hex) => { const n = parseInt(hex.slice(1), 16); return (0.299 * (n >> 16 & 255) + 0.587 * (n >> 8 & 255) + 0.114 * (n & 255)) / 255; };

const order = loadSample('system', 'hydra2-wheelset-28f-32r');
const w9 = systemWheels(findSystemBuildRecipe(order).recipe, null, order).find((x) => x.position === 'front');
const ring9 = await loadRing(w9.rimRing, 'front');
const geom9 = geometry({ wheels: { front: w9.config } }).front;
const drawI9 = (size, hex, light) => wheelSvg({ config: w9.config, geom: geom9, colorsHex: { drive: w9.colors.drive.map(hexFor), rotor: w9.colors.rotor.map(hexFor) }, hubHex: w9.hubColorHex, pov: 'rotor', sides: ['drive', 'rotor'], size, ring: ring9, valveColor: hex, valveLight: light });
const base240 = ringLayout(600, 0.464 * 600, ring9).end(180, 0)[1];

const colors = Object.entries(VALVE_COLOR_MAP).filter(([k]) => k !== 'default').map(([k, v]) => ({ name: k, ...v, br: brightness(v.hex), edge: v.light === true || brightness(v.hex) > 0.5 })).sort((a, b) => b.br - a.br);
const cols = 3, cellW = 520, cellH = 290, head = 70;
let body = text(20, 28, 'Valve colors (round 15): all 30 values of Agent C\'s map on the I9 Hydra2 front 28h picture, light to dark', 18, '#222', 'bold');
body += text(20, 50, `Each cell: the 240 px picture at real size, and a 4x close-up of the stem and nut. "edge" = light color with the ${VALVE_EDGE} px darker edge (brightness above 50% or flagged light). "approx" = approximate color in the map. Default (no valve / unknown): #2b2b2b.`, 12, '#555');
colors.forEach((c, i) => {
  const x = 20 + (i % cols) * cellW, y = head + Math.floor(i / cols) * cellH;
  const svg240 = drawI9(240, c.hex, c.light), svg600 = drawI9(600, c.hex, c.light);
  const cx = 300, vb = `${cx - 30} ${base240 - 44} 60 52`;
  const close = render(svg600.replace('width="600" height="600" viewBox="0 0 600 600"', `width="240" height="208" viewBox="${vb}"`), 240);
  body += `<g transform="translate(${x} ${y})"><image href="data:image/png;base64,${b64(render(svg240, 240))}" width="240" height="240"/>` +
    `<image x="250" y="0" href="data:image/png;base64,${b64(close)}" width="240" height="208"/>` +
    text(0, 258, `${c.name}  ${c.hex}${c.edge ? '  edge' : ''}${c.approximate ? '  approx' : ''}`, 13, '#222', 'bold') + text(0, 274, c.note || '', 11, '#666') + '</g>';
});
let y = head + Math.ceil(colors.length / cols) * cellH + 20;

// part 2: a realistic order through the real report code
const o2 = loadSample('system', 'hydra2-bundle-front-custom-rear-solid');
const rec = findSystemBuildRecipe(o2).recipe;
const valve = (color, len) => ({ variantId: 'gid://shopify/ProductVariant/7001', title: "Peaty's Tubeless Valve", variantTitle: `${color} / ${len}`, selectedOptions: [{ name: 'Color', value: color }, { name: 'Length', value: len }] });
rec.components.frontValveStem = valve('Red', '42mm'); rec.components.rearValveStem = valve('Turquoise', '42mm');
const wheels = systemWheels(rec, null, o2);
body += text(20, y, 'Realistic example: We Are One rim order, front valve Red, rear valve Turquoise (report pictures at 600 px, all-spokes pictures from the real report code)', 16, '#222', 'bold');
y += 16;
let x = 20;
for (const w of wheels) {
  const r = await renderWheelImages(w, svgToPng, 600);
  const img = r.images.find((i) => /all-spokes/.test(i.cid));
  body += `<g transform="translate(${x} ${y})"><image href="data:image/png;base64,${b64(img.png)}" width="600" height="600"/></g>` + text(x, y + 620, `${w.label} wheel, ${w.rimTitle}, valve ${w.valveColorText} (${w.valveColor})`, 13);
  x += 640;
}
y += 650;
const width = 20 * 2 + cols * cellW;
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'round15-valve-colors.png'), render(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${y}"><rect width="100%" height="100%" fill="#fff"/>${body}</svg>`, width));
console.log(`wrote round15-valve-colors.png (${width} x ${y}) to ${out}`);
