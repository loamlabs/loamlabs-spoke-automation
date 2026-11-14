// Writes SPOKE_NUMBERING_COMPARE.md (and one PNG per wheel) next to it: the sheet's spoke numbers in the old numbering (version 1, what the sheet says today) and in Jerry's convention
// (version 2, flag SPOKE_NUMBERING_JERRY=on) side by side, for order #1466, a System order with a 2-color pattern and a Standard Studio order.
// Nothing is sent, saved or changed: it builds the sheets in memory with the flag passed as an argument (the environment is never switched on).
//   node scripts/spoke-numbering-compare.mjs "<output folder>"
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildOrderSheet } from '../_lib/order-sheet.js';
import { geometry } from '../_lib/studio-geometry.js';
import { svgToPng } from '../_lib/wheel-png.js';
import { hexFor } from '../_lib/system-build.js';
import { findStandardStudioRecipe } from '../_lib/standard-build.js';
import { SYSTEM_SAMPLES, STANDARD_STUDIO_SAMPLES } from '../samples/index.js';
import { runCalculationEngine } from '../api/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(process.argv[2] || path.join(here, '..', 'out', 'numbering-compare'));
fs.mkdirSync(outDir, { recursive: true });
const AT = '2026-11-13T12:00:00.000Z';
const ON = { SPOKE_NUMBERING_JERRY: 'on' };
const clone = (o) => JSON.parse(JSON.stringify(o));
const norm = (a) => ((a % 360) + 360) % 360;
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const log = console.log; console.log = () => {}; console.warn = () => {};

const order1466 = JSON.parse(fs.readFileSync(path.join(here, '..', 'tests', 'fixtures', 'order-1466.json'), 'utf8'));
const stdSample = STANDARD_STUDIO_SAMPLES['std-steel-front-32h-3cross-two-colors'];
const cases = [
  { key: '1466', title: 'Order #1466 (System, Hydra2 28h front / 32h rear, Bronze and Black)', make: (env) => buildOrderSheet({ orderData: clone(order1466), calculatedAt: AT, env }) },
  { key: 'system2color', title: 'System sample "hydra2-wheelset-32f-32r" (Hydra2 32h front and rear, front Red and Silver, rear Blue, Black and Gold)', make: (env) => buildOrderSheet({ orderData: clone(SYSTEM_SAMPLES['hydra2-wheelset-32f-32r']), calculatedAt: AT, env }) },
  { key: 'standard', title: 'Standard Studio sample "std-steel-front-32h-3cross-two-colors" (steel spokes, 32h front, 3-cross, two colors)', make: (env) => { const cd = new Map(Object.entries(stdSample._sample.metafields)); return buildOrderSheet({ orderData: clone(stdSample), componentData: cd, buildReport: runCalculationEngine(findStandardStudioRecipe(stdSample).recipe, cd), calculatedAt: AT, env }); } }
];

const clock = (theta) => { const h = norm(theta) / 30; const hh = Math.floor(h) || 12, mm = Math.round((h - Math.floor(h)) * 60); return `${hh}:${String(mm).padStart(2, '0')}`; };
const side = (theta) => { const d = norm(theta - 180); return d === 0 ? 'on the valve' : (d < 180 ? `${d.toFixed(1)} degrees to the LEFT of the valve` : `${(360 - d).toFixed(1)} degrees to the RIGHT of the valve`); };

function svgFor(wheel, spokes, title, subtitle) {
  const W = 560, H = 660, cx = 280, cy = 330, R = 215;
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="#fff"/>`,
    `<text x="${W / 2}" y="28" font-family="Arial, Helvetica, sans-serif" font-size="20" font-weight="bold" text-anchor="middle">${title}</text>`,
    `<text x="${W / 2}" y="52" font-family="Arial, Helvetica, sans-serif" font-size="14" text-anchor="middle" fill="#444">${subtitle}</text>`,
    `<circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="#999" stroke-width="3"/>`,
    `<circle cx="${cx}" cy="${cy}" r="${R - 78}" fill="none" stroke="#ddd" stroke-width="1"/>`];
  for (const s of spokes) {
    const a = (s.theta * Math.PI) / 180, rr = s.high ? R + 24 : R - 24, x = cx + rr * Math.sin(a), y = cy - rr * Math.cos(a), hx = cx + R * Math.sin(a), hy = cy - R * Math.cos(a);
    const fill = hexFor(s.color || 'Black');
    parts.push(`<line x1="${hx.toFixed(1)}" y1="${hy.toFixed(1)}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="#bbb" stroke-width="1"/>`);
    parts.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="12" fill="${s.high ? fill : '#fff'}" stroke="${fill}" stroke-width="3"/>`);
    const txtFill = s.high ? (/#(?:1d1f23|1f62d6|7b3fb9|d0262b|2f9e48|8d6a3e)/i.test(fill) ? '#fff' : '#000') : '#000';
    parts.push(`<text x="${x.toFixed(1)}" y="${(y + 4).toFixed(1)}" font-family="Arial, Helvetica, sans-serif" font-size="${wheelHoles(wheel) > 40 ? 9 : 11}" font-weight="bold" text-anchor="middle" fill="${txtFill}">${s.number}</text>`);
  }
  const vy = cy + R + 26;
  parts.push(`<polygon points="${cx},${vy - 2} ${cx - 8},${vy + 16} ${cx + 8},${vy + 16}" fill="#d0262b"/><text x="${cx}" y="${vy + 34}" font-family="Arial, Helvetica, sans-serif" font-size="14" font-weight="bold" text-anchor="middle" fill="#d0262b">VALVE (6 o'clock)</text>`);
  parts.push(`<text x="${cx}" y="${cy - 8}" font-family="Arial, Helvetica, sans-serif" font-size="14" text-anchor="middle" fill="#333">${cap(wheel.position)} wheel, seen from the</text><text x="${cx}" y="${cy + 12}" font-family="Arial, Helvetica, sans-serif" font-size="14" font-weight="bold" text-anchor="middle" fill="#333">${cap(wheel.highSide)} (high-tension) side</text>`);
  parts.push(`<text x="${cx}" y="${cy + 36}" font-family="Arial, Helvetica, sans-serif" font-size="12" text-anchor="middle" fill="#555">filled dot outside the rim = ${wheel.highSide} side (high tension, even)</text><text x="${cx}" y="${cy + 52}" font-family="Arial, Helvetica, sans-serif" font-size="12" text-anchor="middle" fill="#555">ring inside the rim = ${wheel.lowSide} side (low tension, odd)</text>`);
  parts.push('</svg>');
  return parts.join('');
}
const wheelHoles = (w) => w.spokes.length;

const md = [];
md.push('# Spoke numbering: today (version 1) next to Jerry\'s convention (version 2, flag SPOKE_NUMBERING_JERRY, OFF)');
md.push('', 'Made by `scripts/spoke-numbering-compare.mjs` in loamlabs-spoke-automation. The flag is OFF everywhere; this file was made by building the sheets in memory with the flag passed in, nothing was sent or saved.', '');
md.push('**Jerry\'s convention (valve stem at the bottom).** High-tension side (front: rotor side, rear: drive side): spoke 2 is the first spoke to the LEFT of the valve, then 4, 6, 8 ... clockwise as seen from that side. Flip the wheel over, valve still at the bottom: on the low-tension side spoke 1 is the first spoke to the left of the valve, then 3, 5, 7 ... counter-clockwise (as seen from that flipped side), so the numbers keep running in one direction around the rim.', '');
md.push('**In one picture:** hold the wheel with the HIGH-tension face towards you and the valve at 6 o\'clock. Reading clockwise (from the valve to the left, up and over) the numbers go 1, 2, 3, 4, 5 ... alternating low, high, low, high. Spoke 1 is the low-tension spoke just to the RIGHT of the valve (as you look at the high-tension face), spoke 2 is the high-tension spoke just to the LEFT of it.', '');
md.push('**What changes.** The high-tension (even) numbers stay on the same spokes as today. Only the low-tension (odd) side is renumbered: today the low side is counted clockwise as seen from ITS OWN face (so, seen from the high-tension face, 1 then 3, 5 ... walk away from the valve to the right); in the new convention 3, 5 ... continue clockwise past the valve, so 1, 2, 3, 4 ... run round the rim in one direction. 2:1 wheels (Solix, unequal sides) are not changed by the flag (no convention was given for them). Emails and order notes carry no spoke numbers and are not touched.', '');
md.push('The pictures below are drawn from the high-tension face, valve at the bottom. Filled dot outside the rim = high-tension (even) spoke, ring inside the rim = low-tension (odd) spoke, fill color = the spoke color on the order.', '');

for (const c of cases) {
  const off = c.make({}), on = c.make(ON);
  md.push(`## ${c.title}`, '', `Sheet numbering label today: "${off.numbering.label}". With the flag: "${on.numbering.label}".`, '');
  for (let wi = 0; wi < off.wheels.length; wi++) {
    const wo = off.wheels[wi], wn = on.wheels[wi];
    const cfg = wo.redraw.config, geom = geometry(wo.redraw.autoValvePhase ? { autoValvePhase: true, wheels: { [wo.position]: cfg } } : { wheels: { [wo.position]: cfg } })[wo.position];
    const equal = wo.highSide != null;
    md.push(`### ${cap(wo.position)} wheel: ${wo.spokeCountLabel || wo.total + 'h'}${wo.hubTitle ? ', ' + wo.hubTitle : ''}`, '');
    if (!equal) { md.push('Unequal sides (2:1): the numbering is the same with and without the flag.', ''); continue; }
    const high = wo.highSide, low = wo.lowSide;
    const theta = (s) => norm(high === 'rotor' ? 360 - geom[s.side][s.k].rim : geom[s.side][s.k].rim);
    const mo = new Map(wo.spokes.map((s) => [s.side + s.k, s])), mn = new Map(wn.spokes.map((s) => [s.side + s.k, s]));
    const rows = wn.spokes.map((s) => ({ ...s, theta: theta(s), old: mo.get(s.side + s.k).number }));
    const s2 = rows.find((s) => s.number === 2), s1 = rows.find((s) => s.number === 1), s3 = rows.find((s) => s.number === 3);
    const o1 = rows.find((s) => s.old === 1), o2 = rows.find((s) => s.old === 2), o3 = rows.find((s) => s.old === 3);
    md.push(`- **High-tension side: ${cap(high)}** (even numbers). **Low-tension side: ${cap(low)}** (odd numbers). Valve stem at the bottom (6 o'clock).`);
    md.push(`- **Spoke 2** (new and old): the ${high}-side spoke, ${s2.color}, ${side(s2.theta)} (about ${clock(s2.theta)} on the clock face seen from the ${high} side).`);
    md.push(`- **Spoke 1, new:** the ${low}-side spoke, ${s1.color}, ${side(s1.theta)} (${clock(s1.theta)}), the first ${low}-side spoke left of the valve once the wheel is flipped. **Spoke 1, old:** ${o1.side}-side, ${o1.color}, the same spoke (${side(o1.theta)}).`);
    md.push(`- **Spoke 3, new:** the ${low}-side spoke ${s3.color}, ${side(s3.theta)} (${clock(s3.theta)}). **Spoke 3, old:** ${o3.side}-side ${o3.color}, ${side(o3.theta)} (${clock(o3.theta)}).`);
    md.push(`- Numbers changed on ${rows.filter((s) => s.old !== s.number).length} of ${rows.length} spokes (${rows.filter((s) => s.old !== s.number && s.side === low).length} low-tension, ${rows.filter((s) => s.old !== s.number && s.side === high).length} high-tension).`);
    for (const [tag, key, label] of [['old', 'old', 'Today (version 1)'], ['new', 'number', "Jerry's convention (version 2)"]]) {
      const svg = svgFor({ ...wo, spokes: rows }, rows.map((s) => ({ ...s, number: s[key] })), `${cap(wo.position)} wheel: ${label}`, `seen from the ${high} side, valve at the bottom`);
      const file = `SPOKE_NUMBERING_COMPARE_${c.key}_${wo.position}_${tag}.png`;
      fs.writeFileSync(path.join(outDir, file), await svgToPng(svg, { width: 560 }));
    }
    md.push('', `Pictures: ![today](SPOKE_NUMBERING_COMPARE_${c.key}_${wo.position}_old.png) ![new](SPOKE_NUMBERING_COMPARE_${c.key}_${wo.position}_new.png)`, '');
    md.push('| New # | Old # | Side | Color | Seen from the high-tension face | Changed |', '|---|---|---|---|---|---|');
    for (const s of [...rows].sort((a, b) => a.number - b.number)) md.push(`| ${s.number} | ${s.old} | ${cap(s.side)}${s.high ? ' (high)' : ' (low)'} | ${s.color} | ${side(s.theta)} | ${s.old !== s.number ? 'yes' : ''} |`);
    md.push('');
  }
}
fs.writeFileSync(path.join(outDir, 'SPOKE_NUMBERING_COMPARE.md'), md.join('\n') + '\n');
console.log = log; console.log('written', path.join(outDir, 'SPOKE_NUMBERING_COMPARE.md'), 'and', fs.readdirSync(outDir).filter((f) => f.endsWith('.png')).length, 'pictures');
