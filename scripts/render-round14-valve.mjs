// Round 14: contact sheet of the Presta-style valve (stem + nut) on the photo rings.
//   node scripts/render-round14-valve.mjs [outDir]       default: ../loamlabs-system-builder/agent-prompts/backend-report-images  -> round14-valve-shape.png
// Rows 1 and 2: System I9 Hydra2 front 28h (I9 ring) and the We Are One Fuse 28h front (WAO ring): the 600 px picture and the 240 px picture at real pixel size,
// a 4x close-up of the stem and nut (vector render at 4x) and a 4x enlargement of the REAL 240 px picture's pixels (nearest neighbour, to see the anti-aliasing).
// Row 3: valveColor red, silver, gold on the I9 picture (240 px real size + 4x close-up).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { loadSample } from '../tests/helpers/webhook-harness.mjs';
import { findSystemBuildRecipe, systemWheels, hexFor } from '../_lib/system-build.js';
import { geometry } from '../_lib/studio-geometry.js';
import { wheelSvg } from '../_lib/wheel-svg.js';
import { loadRing, ringLayout } from '../_lib/rim-rings.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.resolve(process.argv[2] || path.join(root, '..', 'loamlabs-system-builder', 'agent-prompts', 'backend-report-images'));
const { Resvg } = createRequire(import.meta.url)('@resvg/resvg-js');
const render = (svg, width) => new Resvg(svg, { fitTo: { mode: 'width', value: width }, background: '#ffffff' }).render().asPng();
const b64 = (b) => b.toString('base64');
const frontOf = (sample) => { const order = loadSample('system', sample); return systemWheels(findSystemBuildRecipe(order).recipe, null, order).find((x) => x.position === 'front'); };

const JOBS = [['I9 ring', 'hydra2-wheelset-28f-32r'], ['We Are One ring', 'hydra2-bundle-front-custom-rear-solid']];
const colW = 340, pad = 20;
let body = '', y = 0;
const text = (x, yy, s, size = 14, fill = '#222', weight = 'normal') => `<text x="${x}" y="${yy}" font-family="Arial, sans-serif" font-size="${size}" font-weight="${weight}" fill="${fill}">${s}</text>`;

async function draws(w, key, size, valveColor) {
  const ring = await loadRing(key, w.position);
  const geom = geometry({ wheels: { [w.position]: w.config } })[w.position];
  const svg = wheelSvg({ config: w.config, geom, colorsHex: { drive: w.colors.drive.map(hexFor), rotor: w.colors.rotor.map(hexFor) }, hubHex: w.hubColorHex, pov: 'rotor', sides: ['drive', 'rotor'], size, ring, valveColor });
  const c = size / 2, base = ringLayout(size, 0.464 * size, ring).end(180, 0)[1];
  return { svg, c, base };
}
// 4x close-up of the stem and nut from a vector render: an 80 x 70 px region (at 600 px) drawn 320 x 280
async function closeVector(w, key, valveColor) {
  const { svg, c, base } = await draws(w, key, 600, valveColor);
  const vb = `${c - 40} ${base - 58} 80 70`;
  return `<image href="data:image/png;base64,${b64(render(svg.replace('width="600" height="600" viewBox="0 0 600 600"', `width="320" height="280" viewBox="${vb}"`), 320))}" width="320" height="280"/>`;
}
// 4x enlargement of the pixels of the real 240 px picture (nearest neighbour)
async function closePixels(w, key, valveColor) {
  const { svg, c, base } = await draws(w, key, 240, valveColor);
  const png = render(svg, 240);
  return `<svg x="0" y="0" width="320" height="280" viewBox="${c - 40} ${base - 58} 80 70"><image href="data:image/png;base64,${b64(png)}" width="240" height="240" image-rendering="optimizeSpeed"/></svg>`;
}

y = 30; body += text(pad, y, 'Valve shape (round 14): stem 0.0068 S, height 0.0483 S, flat top, nut 0.0164 S x 0.0041 S, color #2b2b2b; S = picture width', 18, '#222', 'bold');
for (const [label, sample] of JOBS) {
  const w = frontOf(sample), key = w.rimRing;
  y += 30; body += text(pad, y, `${label} (${sample}, front wheel, ${w.config.drive.n + w.config.rotor.n}h)`, 15, '#222', 'bold');
  y += 14;
  const p600 = await draws(w, key, 600), p240 = await draws(w, key, 240);
  let x = pad;
  body += `<g transform="translate(${x} ${y})"><image href="data:image/png;base64,${b64(render(p600.svg, 600))}" width="600" height="600"/></g>` + text(x, y + 620, '600 px, real size');
  x += 620;
  body += `<g transform="translate(${x} ${y})"><image href="data:image/png;base64,${b64(render(p240.svg, 240))}" width="240" height="240"/></g>` + text(x, y + 260, '240 px, real size');
  body += `<g transform="translate(${x} ${y + 290})">${await closePixels(w, key)}</g>` + text(x, y + 590, '4x enlargement of the real 240 px pixels');
  x += 340;
  body += `<g transform="translate(${x} ${y + 290})">${await closeVector(w, key)}</g>` + text(x, y + 590, '4x close-up (600 px picture drawn at 4x)');
  y += 650;
}
// colored valves on the I9 picture
y += 20; body += text(pad, y, 'valveColor (not wired to the cart yet): red #cc0000, silver #c0c0c0, gold #d4af37 (light colors get a 0.3 px darker edge of the same shade)', 15, '#222', 'bold');
y += 14;
const w9 = frontOf(JOBS[0][1]);
let x = pad;
for (const [name, hex] of [['red', '#cc0000'], ['silver', '#c0c0c0'], ['gold', '#d4af37']]) {
  const p = await draws(w9, w9.rimRing, 240, hex);
  body += `<g transform="translate(${x} ${y})"><image href="data:image/png;base64,${b64(render(p.svg, 240))}" width="240" height="240"/></g>` + text(x, y + 260, `${name} ${hex}, 240 px real size`);
  body += `<g transform="translate(${x + 250} ${y})">${await closeVector(w9, w9.rimRing, hex)}</g>` + text(x + 250, y + 300, `${name}, 4x close-up`);
  x += 600;
}
y += 330;
const width = 1800;
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'round14-valve-shape.png'), render(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${y}"><rect width="100%" height="100%" fill="#fff"/>${body}</svg>`, width));
console.log(`wrote round14-valve-shape.png (${width} x ${y}) to ${out}`);
