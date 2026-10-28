// Valve-position measurements, shared by tests/standard-valve.test.js and scripts/valve-angles.mjs.
// The definition is the theme's (tests/spoke-studio-geometry.test.js at commit 4308879, valveDeg): the angle in degrees between the two spokes in the two rim holes
// next to the valve (180 deg minus / plus half a hole), as drawn: hub hole point (radius pcd / 2) to rim hole point (radius erd / 2). 0 = parallel.
import { geometry } from '../../_lib/studio-geometry.js';

const mod360 = (a) => ((a % 360) + 360) % 360;
const near180 = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

// angle at the valve of a geometry result g ({ drive: [{hub, rim}], rotor: [...] }) for the wheel config w ({ erd, rimHoles, drive: {pcd}, rotor: {pcd} })
export function valveDeg(g, w) {
  const N = w.rimHoles, all = [];
  ['drive', 'rotor'].forEach((s) => g[s].forEach((p) => all.push({ p, r: w[s].pcd / 2 })));
  const v = [180 - 180 / N, 180 + 180 / N].map((a) => {
    const b = all.reduce((x, y) => (near180(y.p.rim, a) < near180(x.p.rim, a) ? y : x)), a1 = b.p.hub * Math.PI / 180, a2 = b.p.rim * Math.PI / 180;
    return [w.erd / 2 * Math.sin(a2) - b.r * Math.sin(a1), w.erd / 2 * Math.cos(a2) - b.r * Math.cos(a1)];
  });
  return Math.atan2(Math.abs(v[0][0] * v[1][1] - v[0][1] * v[1][0]), v[0][0] * v[1][0] + v[0][1] * v[1][1]) * 180 / Math.PI;
}

// the same wheel turned rigidly by `steps` rim holes (positive = clockwise); the rim holes and the valve do not move
export function turned(g, steps, N) {
  const t = (p) => ({ hub: mod360(p.hub + steps * 360 / N), rim: mod360(p.rim + steps * 360 / N) });
  return { drive: g.drive.map(t), rotor: g.rotor.map(t) };
}

// The lacing before any phase. System tables are keyed by position (front:32, rear:28), so draw the wheel at the position that has no table entry for its hole count.
export function unphasedGeometry(pos, w) {
  const N = w.rimHoles, at = N === 32 ? 'rear' : N === 28 ? 'front' : pos;
  return geometry({ wheels: { [at]: w } })[at];
}

// smallest valve angle over every whole-hole rotation of the default lacing, and the rotation (holes, positive = clockwise) the Studio's tie rule would pick
export function bestValve(pos, w) {
  const N = w.rimHoles, base = unphasedGeometry(pos, w), steps = [];
  for (let r = -Math.floor((N - 1) / 2); r <= Math.floor(N / 2); r++) steps.push(r);
  const angles = steps.map((r) => ({ r, a: valveDeg(turned(base, r, N), w) }));
  const min = Math.min(...angles.map((x) => x.a));
  const best = angles.filter((x) => x.a <= min + 1e-7).map((x) => x.r).sort((a, b) => Math.abs(a) - Math.abs(b) || b - a)[0];
  return { min, rotation: best, base: valveDeg(base, w) };
}

// The valve angle measured on a rendered wheel SVG (_lib/wheel-svg.js), all-spokes image: the two spoke lines whose rim ends are nearest the valve at 6 o'clock,
// angle between their drawn directions. The drawing scales hub and rim radius by one factor, so the angle is the same as in the geometry (to the 2-decimal rounding of the SVG).
export function svgValveAngle(svg) {
  const box = Number(/viewBox="0 0 ([\d.]+)/.exec(svg)[1]), c = box / 2;
  const lines = [...svg.matchAll(/<line x1="([-\d.]+)" y1="([-\d.]+)" x2="([-\d.]+)" y2="([-\d.]+)" stroke="(#[0-9a-fA-F]{6})"/g)]
    .filter((m) => m[5].toLowerCase() !== '#8e939a').map((m) => ({ x1: +m[1], y1: +m[2], x2: +m[3], y2: +m[4] }));
  const ang = (l) => (Math.atan2(l.x2 - c, c - l.y2) * 180 / Math.PI + 360) % 360; // rim end, degrees clockwise from 12 o'clock
  const left = lines.filter((l) => ang(l) < 180).sort((a, b) => ang(b) - ang(a))[0];
  const right = lines.filter((l) => ang(l) > 180).sort((a, b) => ang(a) - ang(b))[0];
  const v = [left, right].map((l) => [l.x2 - l.x1, l.y2 - l.y1]);
  return Math.atan2(Math.abs(v[0][0] * v[1][1] - v[0][1] * v[1][0]), v[0][0] * v[1][0] + v[0][1] * v[1][1]) * 180 / Math.PI;
}
