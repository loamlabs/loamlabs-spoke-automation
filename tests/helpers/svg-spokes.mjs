// Reads the spokes back out of a wheel SVG (_lib/wheel-svg.js): per side group, in DRAW order, one entry per spoke (edge line + color line).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const angleOf = (x, y, c) => ((Math.atan2(x - c, -(y - c)) * 180 / Math.PI) + 360) % 360; // clockwise from 12 o'clock, as drawn
export const angDiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

// [{ side, pairs: [{ text, x1, y1, x2, y2, stroke, hub, rim }] }] in the order the groups appear in the SVG
export function spokeGroups(svg) {
  const box = Number(/<svg[^>]* width="([\d.]+)"/.exec(svg)[1]), c = box / 2, out = [];
  for (const g of svg.matchAll(/<g data-side="(drive|rotor)">([\s\S]*?)<\/g>/g)) {
    const pairs = [...g[2].matchAll(/(<line x1="([-\d.]+)" y1="([-\d.]+)" x2="([-\d.]+)" y2="([-\d.]+)" stroke="#8e939a"[^>]*\/>)(<line [^>]*stroke="([^"]+)"[^>]*\/>)/g)]
      .map((m) => ({ text: m[1] + m[6], x1: +m[2], y1: +m[3], x2: +m[4], y2: +m[5], stroke: m[7], hub: angleOf(+m[2], +m[3], c), rim: angleOf(+m[4], +m[5], c) }));
    out.push({ side: g[1], pairs });
  }
  return out;
}

// the SVG with every side's spokes put in a canonical order (sorted by their own text): equal for two drawings that differ only in the paint order
export function orderIgnored(svg) {
  return svg.replace(/(<g data-side="(?:drive|rotor)">)([\s\S]*?)(<\/g>)/g, (all, open, body, close) => {
    const pairs = [...body.matchAll(/<line [^>]*\/><line [^>]*\/>/g)].map((m) => m[0]);
    if (pairs.join('') !== body) throw new Error('unexpected content inside a spoke group');
    return open + pairs.slice().sort().join('') + close;
  });
}

// the wheel-svg.js of a git commit, loaded as a module from a temp folder; returns { wheelSvg, cleanup } or null when the commit is not in this checkout
export async function wheelSvgAt(ref) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  let tmp;
  try {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wheelsvg-'));
    fs.writeFileSync(path.join(tmp, 'wheel-svg.js'), execFileSync('git', ['show', `${ref}:_lib/wheel-svg.js`], { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }));
    fs.writeFileSync(path.join(tmp, 'package.json'), '{"type":"module"}');
  } catch (e) { if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); return null; }
  const mod = await import(pathToFileURL(path.join(tmp, 'wheel-svg.js')).href);
  return { wheelSvg: mod.wheelSvg, cleanup: () => fs.rmSync(tmp, { recursive: true, force: true }) };
}
