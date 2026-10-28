// Round 5 side-by-side check: the Studio's FINAL_CROSS_TOP = 'trailing' screenshot (rear 32h 3-cross, drive side only, silver = leading group, black = trailing group)
// next to the same wheel drawn by the email pipeline, both at the same height.
//   node scripts/final-cross-check.mjs [studio-screenshot.png] [out.png]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
import { loadSample } from '../tests/helpers/webhook-harness.mjs';
import { findStandardStudioRecipe, standardWheels } from '../_lib/standard-build.js';
import { findSystemBuildRecipe, systemWheels, hexFor } from '../_lib/system-build.js';
import { geometry } from '../_lib/studio-geometry.js';
import { wheelSvg } from '../_lib/wheel-svg.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const shot = process.argv[2] || path.resolve(root, '..', 'loamlabs-system-builder', 'studio-sandbox-a-round4', 'screenshots-round4', 'final-cross', 'rear-32h-3cross-drive-side-trailing-on-top-light.png');
const out = process.argv[3] || path.join(root, 'out', 'round5-final-cross-check.png');
fs.mkdirSync(path.dirname(out), { recursive: true });

const sets = [];
// the Standard 32h 3-cross rear wheel (drawn with autoValvePhase, as every Standard email image is) and the System Hydra2 rear 32h (no flag)
{
  const order = loadSample('standard', 'std-steel-wheelset-solid'), recipe = findStandardStudioRecipe(order).recipe;
  const w = standardWheels(recipe, new Map(Object.entries(order._sample.metafields)), order).find((x) => x.position === 'rear');
  sets.push({ label: 'email image, Standard rear 32h 3-cross', w, geom: geometry({ autoValvePhase: true, wheels: { rear: w.config } }).rear });
}
{
  const order = loadSample('system', 'hydra2-rear-32h-only'), w = systemWheels(findSystemBuildRecipe(order).recipe, null, order).find((x) => x.position === 'rear');
  sets.push({ label: 'email image, System Hydra2 rear 32h', w, geom: geometry({ wheels: { rear: w.config } }).rear });
}
const H = 600, parts = [];
const b64 = (buf) => Buffer.from(buf).toString('base64');
const png = (svg) => new Resvg(svg, { fitTo: { mode: 'width', value: 600 } }).render().asPng();
const alt = (n) => Array.from({ length: n }, (_, k) => hexFor(k % 2 === 0 ? 'Silver' : 'Black')); // even spoke numbers (leading) silver, odd (trailing) black, as in the Studio screenshot
for (const { w, geom } of sets) {
  const svg = wheelSvg({ config: w.config, geom, colorsHex: { drive: alt(geom.drive.length), rotor: alt(geom.rotor.length) }, hubHex: '#c7ccd2', pov: 'drive', sides: ['drive'], size: 600 });
  parts.push(png(svg));
}
const shotBuf = fs.readFileSync(shot);
const w = 3 * H + 40;
let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${H + 40}" viewBox="0 0 ${w} ${H + 40}"><rect width="${w}" height="${H + 40}" fill="#ffffff"/>`;
svg += `<image x="0" y="40" width="${H}" height="${H}" href="data:image/png;base64,${b64(shotBuf)}"/>`;
parts.forEach((p, i) => { svg += `<image x="${(i + 1) * H + 20 * (i + 1)}" y="40" width="${H}" height="${H}" href="data:image/png;base64,${b64(p)}"/>`; });
svg += `<g font-family="Arial" font-size="20" fill="#222"><text x="10" y="26">Studio (FINAL_CROSS_TOP trailing), drive side</text><text x="${H + 30}" y="26">${sets[0].label}</text><text x="${2 * H + 50}" y="26">${sets[1].label}</text></g></svg>`;
fs.writeFileSync(out, new Resvg(svg).render().asPng());
console.log('wrote', out);
