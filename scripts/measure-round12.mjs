// Round 12: time to build one wheel picture (SVG + resvg PNG, 600 px), plain rim vs photo ring, and the one-off cost of loading the ring images.
//   node scripts/measure-round12.mjs [runs=15]
import os from 'node:os';
import { performance } from 'node:perf_hooks';
import { loadSample } from '../tests/helpers/webhook-harness.mjs';
import { findSystemBuildRecipe, systemWheels } from '../_lib/system-build.js';
import { geometry } from '../_lib/studio-geometry.js';
import { wheelSvg } from '../_lib/wheel-svg.js';
import { svgToPng } from '../_lib/wheel-png.js';
import { loadRing } from '../_lib/rim-rings.js';
import { hexFor } from '../_lib/system-build.js';

const RUNS = Number(process.argv[2] || 15);
const order = loadSample('system', 'hydra2-bundle-front-custom-rear-solid');
const w = systemWheels(findSystemBuildRecipe(order).recipe, null, order)[0];
const geom = geometry({ wheels: { [w.position]: w.config } })[w.position];
const colorsHex = { drive: w.colors.drive.map(hexFor), rotor: w.colors.rotor.map(hexFor) };
const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const fmt = (a) => `min ${Math.min(...a).toFixed(0)} / median ${med(a).toFixed(0)} / max ${Math.max(...a).toFixed(0)} ms`;

console.log(`machine: ${os.cpus()[0].model.trim()}, ${os.cpus().length} threads, node ${process.version}; ${RUNS} runs per case (+1 warm-up)`);
const t0 = performance.now();
const ring = await loadRing('wao', 'front');
console.log(`first ring load (import of the 0.8 MB images module + data URI): ${(performance.now() - t0).toFixed(0)} ms (once per function instance)`);
await loadRing('i9', 'front');
for (const [label, r] of [['plain stroked rim (before)', null], ['WAO photo ring (after)', ring], ['I9 photo ring (after)', await loadRing('i9', 'front')]]) {
  const build = [], render = [], bytes = [];
  for (let i = 0; i < RUNS + 1; i++) {
    const a = performance.now();
    const svg = wheelSvg({ config: w.config, geom, colorsHex, hubHex: w.hubColorHex, pov: 'rotor', sides: ['drive', 'rotor'], size: 600, ring: r });
    const b = performance.now();
    const png = await svgToPng(svg, { width: 600 });
    const c = performance.now();
    if (i > 0) { build.push(b - a); render.push(c - b); bytes.push(png.length); }
  }
  console.log(`${label}\n  build SVG : ${fmt(build)}\n  render PNG: ${fmt(render)}\n  PNG size  : ${(med(bytes) / 1024).toFixed(0)} KB`);
}
