// Round 12: renders sample report pictures with the photo rim rings (System and Standard orders, We Are One and Industry Nine rims, front and rear, both sides,
// solid and mixed color patterns) for Jerry to look at, plus one contact sheet.
//   node scripts/render-rim-photo-samples.mjs [outDir]        default: ../loamlabs-system-builder/agent-prompts/backend-report-images
// Files: round12-<system|standard>-<wao|i9>-<sample>-<cid>.png and round12-contact-sheet.png. The pictures are the ones the report builds (same code path).
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { loadSample } from '../tests/helpers/webhook-harness.mjs';
import { findSystemBuildRecipe, systemWheels } from '../_lib/system-build.js';
import { findStandardStudioRecipe, standardWheels } from '../_lib/standard-build.js';
import { renderWheelImages } from '../_lib/system-report.js';
import { svgToPng } from '../_lib/wheel-png.js';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.resolve(process.argv[2] || path.join(root, '..', 'loamlabs-system-builder', 'agent-prompts', 'backend-report-images'));
fs.mkdirSync(out, { recursive: true });

const systemWheelsOf = (name, patch) => { const order = loadSample('system', name); const rec = findSystemBuildRecipe(order).recipe; return systemWheels(patch ? patch(rec) : rec, null, order); };
const standardWheelsOf = (name, patch) => {
  const order = loadSample('standard', name); const rec = findStandardStudioRecipe(order).recipe;
  return standardWheels(patch ? patch(rec) : rec, new Map(Object.entries(order._sample.metafields)), order);
};
const withRim = (pos, rim) => (rec) => ({ ...rec, components: { ...rec.components, [pos + 'Rim']: { ...rec.components[pos + 'Rim'], ...rim } } });
const I9_STD = { title: 'Industry Nine Sector Alloy Rim (Trail)', vendor: 'Industry Nine' };

const JOBS = [
  // [kind, brand label, sample, wheels]
  ['system', 'wao', 'hydra2-bundle-front-custom-rear-solid', () => systemWheelsOf('hydra2-bundle-front-custom-rear-solid')],                    // WAO Fuse 28h front (mixed) + 32h rear (solid)
  ['system', 'wao', 'solix-24h-wheelset-multicolor', () => systemWheelsOf('solix-24h-wheelset-multicolor')],                                       // WAO Union 24h 2:1, mixed pattern both wheels
  ['system', 'i9', 'hydra2-wheelset-28f-32r', () => systemWheelsOf('hydra2-wheelset-28f-32r')],                                                    // I9 rim 28h front + 32h rear
  ['system', 'i9', 'hydra2-rear-32h-all-different', () => systemWheelsOf('hydra2-rear-32h-all-different')],                                        // I9 rim, every spoke a different color
  ['standard', 'wao', 'std-steel-front-32h-3cross-two-colors', () => standardWheelsOf('std-steel-front-32h-3cross-two-colors')],                   // WAO rim
  ['standard', 'wao', 'std-steel-rear-36h-3cross-custom', () => standardWheelsOf('std-steel-rear-36h-3cross-custom')],
  ['standard', 'i9', 'std-steel-front-28h-3cross-custom', () => standardWheelsOf('std-steel-front-28h-3cross-custom', withRim('front', I9_STD))], // same order with an Industry Nine rim
  ['standard', 'i9', 'std-steel-rear-36h-3cross-custom', () => standardWheelsOf('std-steel-rear-36h-3cross-custom', withRim('rear', I9_STD))]
];

const files = [];
for (const [kind, brand, sample, make] of JOBS) {
  for (const w of make()) {
    const t0 = performance.now();
    const r = await renderWheelImages(w, svgToPng, 600);
    const ms = performance.now() - t0;
    if (r.errors.length) throw new Error(`${sample} ${w.position}: ${r.errors.join('; ')}`);
    for (const img of r.images) {
      const base = `round12-${kind}-${brand}-${sample}-${img.cid}`;
      fs.writeFileSync(path.join(out, base + '.png'), img.png);
      files.push({ base, caption: `${kind} ${brand.toUpperCase()} ring | ${sample} | ${img.caption}`, png: img.png });
    }
    console.log(`${kind} ${brand} ${sample} ${w.position}: ${r.images.length} picture(s), ring ${w.rimRing}, ${ms.toFixed(0)} ms (${(ms / r.images.length).toFixed(0)} ms each)`);
  }
}

// contact sheet: 4 pictures per row, 450 px each, caption under each
const cols = 4, cell = 450, cap = 46, rows = Math.ceil(files.length / cols);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
let body = '';
files.forEach((f, i) => {
  const x = (i % cols) * cell, y = Math.floor(i / cols) * (cell + cap);
  body += `<image href="data:image/png;base64,${f.png.toString('base64')}" x="${x}" y="${y}" width="${cell}" height="${cell}"/>` +
    `<text x="${x + 6}" y="${y + cell + 14}" font-family="Arial, sans-serif" font-size="11" fill="#222">${esc(f.caption.split(' | ')[0])} | ${esc(f.caption.split(' | ')[1])}</text>` +
    `<text x="${x + 6}" y="${y + cell + 30}" font-family="Arial, sans-serif" font-size="11" fill="#555">${esc(f.caption.split(' | ')[2])}</text>`;
});
const sheet = `<svg xmlns="http://www.w3.org/2000/svg" width="${cols * cell}" height="${rows * (cell + cap)}"><rect width="100%" height="100%" fill="#fff"/>${body}</svg>`;
const { Resvg } = createRequire(import.meta.url)('@resvg/resvg-js');
fs.writeFileSync(path.join(out, 'round12-contact-sheet.png'), new Resvg(sheet, { fitTo: { mode: 'width', value: cols * cell }, background: '#ffffff' }).render().asPng());
console.log(`wrote ${files.length} pictures and round12-contact-sheet.png to ${out}`);
