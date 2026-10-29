// Round 13, phase 1: one System I9 wheel (mixed colors, all-spokes view) at three spoke widths on one contact sheet, with the new dark thin valve stem.
//   node scripts/render-round13-widths.mjs [outDir]       default: ../loamlabs-system-builder/agent-prompts/backend-report-images
// Columns: current width, about 15% thinner, about 30% thinner. Rows: the 600 px picture, the 240 px picture (both at their real pixel size), a 2x close-up of the 600 px picture.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { loadSample } from '../tests/helpers/webhook-harness.mjs';
import { findSystemBuildRecipe, systemWheels, hexFor } from '../_lib/system-build.js';
import { geometry } from '../_lib/studio-geometry.js';
import { wheelSvg } from '../_lib/wheel-svg.js';
import { loadRing } from '../_lib/rim-rings.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.resolve(process.argv[2] || path.join(root, '..', 'loamlabs-system-builder', 'agent-prompts', 'backend-report-images'));
const { Resvg } = createRequire(import.meta.url)('@resvg/resvg-js');

const order = loadSample('system', 'hydra2-wheelset-28f-32r');
const w = systemWheels(findSystemBuildRecipe(order).recipe, null, order).find((x) => x.position === 'front');
const geom = geometry({ wheels: { [w.position]: w.config } })[w.position];
const colorsHex = { drive: w.colors.drive.map(hexFor), rotor: w.colors.rotor.map(hexFor) };
const ring = await loadRing(w.rimRing, w.position);
const WIDTHS = [[1, 'current width (100%)'], [0.85, 'about 15% thinner (85%)'], [0.7, 'about 30% thinner (70%)']];

const png = (svg, width) => new Resvg(svg, { fitTo: { mode: 'width', value: width }, background: '#ffffff' }).render().asPng();
const draw = (size, spokeScale) => wheelSvg({ config: w.config, geom, colorsHex, hubHex: w.hubColorHex, pov: 'rotor', sides: ['drive', 'rotor'], size, ring, spokeScale });
const b64 = (b) => b.toString('base64');

const colW = 640, pad = 20, head = 56;
let y = head, body = '';
const rows = [];
// row 1: 600 px at real size
rows.push({ h: 600, label: '600 px picture (real size)', cell: (s) => `<image href="data:image/png;base64,${b64(png(draw(600, s), 600))}" width="600" height="600"/>` });
// row 2: 240 px at real size
rows.push({ h: 240, label: '240 px picture (real size)', cell: (s) => `<image href="data:image/png;base64,${b64(png(draw(240, s), 240))}" width="240" height="240"/>` });
// row 3: 2x close-up of the upper right of the 600 px picture and the valve at the bottom, side by side
rows.push({ h: 300, label: '2x close-up of the 600 px picture: upper right of the rim, and the valve stem at the bottom', cell: (s) => {
  const svg = draw(600, s);
  const crop = (vb, wpx, hpx) => png(svg.replace('width="600" height="600" viewBox="0 0 600 600"', `width="${wpx}" height="${hpx}" viewBox="${vb}"`), wpx);
  return `<image href="data:image/png;base64,${b64(crop('330 20 150 150', 300, 300))}" width="300" height="300"/>` +
    `<image x="320" href="data:image/png;base64,${b64(crop('225 450 150 150', 300, 300))}" width="300" height="300"/>`;
} });

WIDTHS.forEach(([s, label], i) => {
  body += `<text x="${pad + i * colW}" y="34" font-family="Arial, sans-serif" font-size="22" font-weight="bold" fill="#222">${label}</text>`;
});
for (const r of rows) {
  body += `<text x="${pad}" y="${y + 18}" font-family="Arial, sans-serif" font-size="14" fill="#555">${r.label}</text>`;
  y += 28;
  WIDTHS.forEach(([s], i) => { body += `<g transform="translate(${pad + i * colW} ${y})">${r.cell(s)}</g>`; });
  y += r.h + 24;
}
const width = pad * 2 + colW * WIDTHS.length - 20;
const sheet = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${y}"><rect width="100%" height="100%" fill="#fff"/>${body}</svg>`;
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'round13-spoke-widths.png'), png(sheet, width));
console.log(`wrote round13-spoke-widths.png (${width} x ${y}) to ${out}; wheel ${w.position} ${w.rimRing} ring, spoke widths at 600 px:`,
  WIDTHS.map(([s]) => `${(Math.max(2 * s, 3 * 600 / 522 * s)).toFixed(2)} px`).join(' / '), '; at 240 px:', WIDTHS.map(([s]) => `${(Math.max(2 * s, 3 * 240 / 522 * s)).toFixed(2)} px`).join(' / '));
