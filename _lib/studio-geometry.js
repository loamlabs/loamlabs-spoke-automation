// _lib/studio-geometry.js
// I9-SYSTEM: lacing geometry of the Spoke Color Studio, vendored from the dev theme (assets/spoke-studio.js, LoamStudio.geometry).
//
// The theme file is the source of truth and stays untouched there. This copy exists so the backend can draw a System wheel exactly as
// the Studio draws it (same rim holes, same hub-hole-to-rim-hole assignment, same 2:1 symmetry fix, same Hydra2 front 32h phase).
// tests/studio-geometry-drift.test.js compares this module's output with the theme's LoamStudio.geometry for the sandbox wheels, so
// the two cannot silently drift. If you change the lacing in the theme, port the change here (and vice versa) and run the tests.
//
// Everything below the "ported" line is the theme code with the minimum of edits (ESM export, no DOM, no palettes).
//
//   geometry(config) -> { front?: { drive: [spoke], rotor: [spoke] }, rear?: {...} }
//   spoke = { hub, rim, rimIndex, rank, vrank, sweep }
//     hub      angle of the hub hole, degrees clockwise from 12 o'clock, drive-side point of view
//     rim      angle of the rim hole the spoke goes to
//     rimIndex hole number on the whole rim (0-based)
//     rank     position among ALL spokes of the wheel, clockwise from 12 o'clock
//     vrank    the same, counted clockwise from the first rim hole clockwise of the valve stem (valve at 6 o'clock = 180 degrees)
//     sweep    +1 / -1: the spoke leans forward / back
//   Spoke index k in each side array is the index the Studio value uses (value.spokes[wheel][side][k]).
//
// config = { rimHolePhase?: 0|1, wheels: { front?: { erd, rimHoles, rimHolePhase?, drive: { n, pcd, cross }, rotor: { n, pcd, cross } }, rear?: {...} } }

const SIDES = ['drive', 'rotor'];
const WHEEL_ORDER = ['front', 'rear'];

function num(v, d) { v = Number(v); return isFinite(v) && v > 0 ? v : d; }
function diff(a, b) { return Math.abs(((a - b + 540) % 360) - 180); }
function warn(msg) { if (typeof console !== 'undefined' && console.warn) console.warn('[studio-geometry] ' + msg); }

// The wheel part of the Studio's normalizeConfig (palettes, titles and hub colors are not needed for the lacing).
export function normalizeWheels(cfg) {
  cfg = cfg || {};
  const W = {}, keys = [];
  WHEEL_ORDER.forEach(function (key) {
    const w = cfg.wheels && cfg.wheels[key];
    if (!w || !w.drive || !w.rotor) return;
    const nd = Math.round(num(w.drive.n, 0)), nr = Math.round(num(w.rotor.n, 0));
    if (!nd || !nr) { warn('wheel "' + key + '" needs drive.n and rotor.n'); return; }
    const total = nd + nr;
    if (w.rimHoles && Number(w.rimHoles) !== total) warn('wheel "' + key + '": rimHoles (' + w.rimHoles + ') does not match drive.n + rotor.n (' + total + '); using ' + total);
    W[key] = {
      key: key,
      erd: num(w.erd, 568), rimHoles: total, ratio: nd === nr ? '1:1' : '2:1',
      rimHolePhase: Number(w.rimHolePhase != null ? w.rimHolePhase : (cfg.rimHolePhase != null ? cfg.rimHolePhase : 1)) === 0 ? 0 : 1,
      drive: { n: nd, pcd: num(w.drive.pcd, 50), cross: num(w.drive.cross, 3) },
      rotor: { n: nr, pcd: num(w.rotor.pcd, 50), cross: num(w.rotor.cross, 3) }
    };
    keys.push(key);
  });
  if (!keys.length) throw new Error('studio-geometry: config.wheels needs at least one of front / rear');
  return { W: W, keys: keys };
}

/* ------------------------------------------------------------------ ported from assets/spoke-studio.js (keep in step with the theme) */

// Rim holes sit at half-steps so the valve (6 o'clock) lands between two holes. They alternate
// drive / rotor: 1:1 alternates; for 2:1 the minority side gets every third hole (spread evenly for other ratios).
function rimHoles(w) {
  var nh = w.rimHoles, nd = w.drive.n, nr = w.rotor.n, d = [], r = [], j;
  var minority = Math.min(nd, nr);
  for (j = 0; j < nh; j++) {
    var a = (j + 0.5) * 360 / nh, toRotor;
    if (nd === nr) toRotor = (j % 2) === (w.rimHolePhase === 0 ? 0 : 1); // 1:1 only; 2:1 layouts ignore the phase
    else {
      var isMin = Math.floor(j * minority / nh) !== Math.floor((j - 1) * minority / nh);
      toRotor = (nr < nd) ? isMin : !isMin;
    }
    (toRotor ? r : d).push(a);
  }
  return { drive: d, rotor: r };
}

// Each hub hole goes to the rim hole nearest its laced target (crossing sets the sweep angle).
// phase = angular offset of the hub holes (illustrative, not engineering-accurate).
function assign(n, cross, holes, phase) {
  var delta = 360 * cross / n, tg = [], k, i, r;
  for (k = 0; k < n; k++) {
    var h = k * 360 / n + phase, s = k % 2 === 0 ? 1 : -1;
    tg.push({ k: k, h: h % 360, t: (((h + s * delta) % 360) + 360) % 360 });
  }
  tg.sort(function (a, b) { return a.t - b.t || a.k - b.k; });
  var hs = holes.slice().sort(function (a, b) { return a - b; }), best = 1e9, bs = 0;
  for (r = 0; r < n; r++) {
    var c = 0;
    for (i = 0; i < n; i++) c += diff(tg[i].t, hs[(i + r) % n]);
    if (c < best) { best = c; bs = r; }
  }
  var out = new Array(n);
  for (i = 0; i < n; i++) out[tg[i].k] = { hub: tg[i].h, rim: hs[(i + bs) % n], s: tg[i].k % 2 === 0 ? 1 : -1 };
  return out;
}

// 2:1 wheels, MAJORITY side (rear drive side, front rotor side). Leading and trailing spokes alternate (k even / k odd), so a correct lacing has
// 8-fold (n/2-fold) symmetry: every even spoke sits the same distance from its laced target, and every odd spoke too. The rim holes of this
// side come in pairs (the minority side takes every third hole), and the two spoke parities each take ONE hole of every pair:
//   MAJORITY_ODD_TAKES_LOWER = true  -> odd spokes take the lower-angle hole of each pair, even spokes the upper one
//                                       (24h 2:1 rear: evens k0,k2.. -> 82.5,127.5,... deviation -11.25; odds k1,k3.. -> 337.5,22.5,... +18.75).
// Flip this one constant if the real lacing turns out to be the other way round.
var MAJORITY_ODD_TAKES_LOWER = true;
function assignMajority(n, cross, holes, phase) {
  var delta = 360 * cross / n, hs = holes.slice().sort(function (a, b) { return a - b; }), m = n / 2, k, i, r, j;
  // find the pairs: small gap = the two holes of one pair
  var mean = 360 / n, start = -1;
  for (i = 0; i < n; i++) { if (((hs[(i + 1) % n] - hs[i] + 360) % 360) < mean) { start = i; break; } }
  if (start < 0) return null;
  var lower = [], upper = [];
  for (j = 0; j < m; j++) {
    var a = hs[(start + 2 * j) % n], b = hs[(start + 2 * j + 1) % n];
    if (((b - a + 360) % 360) >= mean) return null; // not a clean pair structure
    lower.push(a); upper.push(b);
  }
  var out = new Array(n);
  [0, 1].forEach(function (parity) {
    var useLower = parity === 1 ? MAJORITY_ODD_TAKES_LOWER : !MAJORITY_ODD_TAKES_LOWER;
    var set = (useLower ? lower : upper).slice().sort(function (x, y) { return x - y; }), tg = [];
    for (k = parity; k < n; k += 2) {
      var h = k * 360 / n + phase, sgn = k % 2 === 0 ? 1 : -1;
      tg.push({ k: k, h: h % 360, t: (((h + sgn * delta) % 360) + 360) % 360 });
    }
    tg.sort(function (x, y) { return x.t - y.t || x.k - y.k; });
    var best = 1e9, bs = 0;
    for (r = 0; r < m; r++) {
      var c = 0;
      for (i = 0; i < m; i++) c += diff(tg[i].t, set[(i + r) % m]);
      if (c < best - 1e-9) { best = c; bs = r; }
    }
    for (i = 0; i < m; i++) out[tg[i].k] = { hub: tg[i].h, rim: set[(i + bs) % m], s: tg[i].k % 2 === 0 ? 1 : -1 };
  });
  return out;
}

// Lacing phase per wheel: rotates the WHOLE lacing (hub holes and the spoke-to-rim-hole assignment together) relative to the rim and the valve.
// Key = '<position>:<hub count>', value = rotation in RIM HOLES (negative = counter-clockwise as seen from the drive side). Every spoke keeps
// its sweep and deviation; the rim holes (and so the valve, vrank and the patterns) do not move; spoke index k is re-counted from the hub holes.
//   Hydra2 front 32h: the valve stem must sit between parallel spokes -> 2 rim holes counter-clockwise.
var LACING_PHASE_HOLES = { 'front:32': -2 };
function rotateLacing(list, stepDeg) {
  var n = list.length, pitch = 360 / n, q = Math.round(stepDeg / pitch);
  if (Math.abs(stepDeg - q * pitch) > 1e-6) { warn('lacing phase of ' + stepDeg + ' degrees is not a whole number of hub holes; ignored'); return list; }
  return list.map(function (_, k) {
    var o = list[(((k - q) % n) + n) % n];
    return { hub: (((o.hub + stepDeg) % 360) + 360) % 360, rim: (((o.rim + stepDeg) % 360) + 360) % 360, s: o.s };
  });
}

function buildGeom(W) {
  var G = {};
  Object.keys(W).forEach(function (key) {
    var w = W[key], h = rimHoles(w);
    // 1:1 hubs: stagger the two flanges by half a hole pitch so the two sides do not draw on top of each other.
    var rotorPhase = w.ratio === '1:1' ? 15 + 180 / w.rotor.n : 15;
    G[key] = {
      drive: assign(w.drive.n, w.drive.cross, h.drive, 15),
      rotor: assign(w.rotor.n, w.rotor.cross, h.rotor, rotorPhase)
    };
    // exact 2:1: the majority side uses the symmetry-aware assignment (the minority side and 1:1 wheels keep the plain one)
    var big = w.drive.n > w.rotor.n ? 'drive' : 'rotor', small = big === 'drive' ? 'rotor' : 'drive';
    if (w.drive.n !== w.rotor.n && w[big].n === 2 * w[small].n) {
      var sym = assignMajority(w[big].n, w[big].cross, h[big], big === 'drive' ? 15 : rotorPhase);
      if (sym) G[key][big] = sym;
    }
    var phaseHoles = LACING_PHASE_HOLES[key + ':' + w.rimHoles];
    if (phaseHoles) SIDES.forEach(function (side) { G[key][side] = rotateLacing(G[key][side], phaseHoles * 360 / w.rimHoles); });
    // rank = this spoke's position (0..N-1) among ALL spokes of the wheel (both sides together), counting clockwise around the
    // rim from 12 o'clock, drive-side point of view. rimIndex = hole number on the whole rim.
    var all = [];
    SIDES.forEach(function (side) { G[key][side].forEach(function (p) { all.push(p); }); });
    all.sort(function (a, b) { return a.rim - b.rim; });
    all.forEach(function (p, r) { p.rank = r; p.rimIndex = Math.round(p.rim * w.rimHoles / 360 - 0.5); });
    // vrank = the same spokes counted clockwise (as seen from the drive side) starting at the valve stem, which the Studio draws at
    // 6 o'clock (180 degrees): vrank 0 is the first spoke clockwise of the stem (the nearest one to the left of it in the default
    // drive view). Every pattern counts by it, so the first painted spoke is the same place on every wheel.
    var byValve = all.slice().sort(function (a, b) { return ((a.rim - 180 + 360) % 360) - ((b.rim - 180 + 360) % 360); });
    byValve.forEach(function (p, r) { p.vrank = r; });
  });
  return G;
}

/* ------------------------------------------------------------------ public */

// Same output as the theme's LoamStudio.geometry(config).
export function geometry(config) {
  const C = normalizeWheels(config), G = buildGeom(C.W), out = {};
  C.keys.forEach(function (k) {
    out[k] = {};
    SIDES.forEach(function (side) { out[k][side] = G[k][side].map(function (p) { return { hub: p.hub, rim: p.rim, rimIndex: p.rimIndex, rank: p.rank, vrank: p.vrank, sweep: p.s }; }); });
  });
  return out;
}

export const STUDIO_GEOMETRY_CONSTANTS = { MAJORITY_ODD_TAKES_LOWER, LACING_PHASE_HOLES };
