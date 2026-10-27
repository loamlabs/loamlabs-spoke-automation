// Prints the valve angle (degrees between the two spokes beside the valve; 0 = parallel) of every wheel of every keyed Standard sample:
// the old drawing (no autoValvePhase), the new drawing from the geometry, the new drawing MEASURED on the rendered all-spokes SVG, and the minimum over all rotations.
//   node scripts/valve-angles.mjs      -> out/valve-angles.md and the table on screen
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSample } from '../tests/helpers/webhook-harness.mjs';
import { findStandardStudioRecipe, standardWheels } from '../_lib/standard-build.js';
import { renderWheelImages } from '../_lib/system-report.js';
import { geometry } from '../_lib/studio-geometry.js';
import { valveDeg, bestValve, svgValveAngle } from '../tests/helpers/valve.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const names = fs.readdirSync(path.join(root, 'samples', 'standard')).filter((f) => /^std-.*\.json$/.test(f)).map((f) => f.replace(/\.json$/, ''));
const rows = [];
for (const name of names) {
  const order = loadSample('standard', name), recipe = findStandardStudioRecipe(order).recipe;
  for (const w of standardWheels(recipe, new Map(Object.entries(order._sample.metafields)), order)) {
    const cfgW = { erd: w.config.erd, rimHoles: w.config.rimHoles, drive: w.config.drive, rotor: w.config.rotor };
    const oldG = geometry({ wheels: { [w.position]: w.config } })[w.position], newG = geometry({ autoValvePhase: true, wheels: { [w.position]: w.config } })[w.position];
    const img = (await renderWheelImages(w, async () => Buffer.from('x'), 600)).images.find((i) => i.sides.length === 2);
    const best = bestValve(w.position, cfgW);
    rows.push({ sample: name, wheel: `${w.position} ${w.total}h ${w.config.drive.cross}-cross`, 'old drawing': +valveDeg(oldG, cfgW).toFixed(2), 'new drawing (geometry)': +valveDeg(newG, cfgW).toFixed(2), 'new drawing (measured on the image)': +svgValveAngle(img.svg).toFixed(2), 'best possible': +best.min.toFixed(2), 'rotation vs unphased lacing (holes)': best.rotation });
  }
}
console.table(rows);
const md = ['# Valve angle per Standard sample wheel (degrees between the two spokes beside the valve; 0 = parallel)', '',
  '| sample | wheel | old drawing | new (geometry) | new (measured on the image) | best possible | rotation (holes) |', '|---|---|---|---|---|---|---|',
  ...rows.map((r) => `| ${r.sample} | ${r.wheel} | ${r['old drawing']} | ${r['new drawing (geometry)']} | ${r['new drawing (measured on the image)']} | ${r['best possible']} | ${r['rotation vs unphased lacing (holes)']} |`), ''];
fs.mkdirSync(path.join(root, 'out'), { recursive: true });
fs.writeFileSync(path.join(root, 'out', 'valve-angles.md'), md.join('\n'));
