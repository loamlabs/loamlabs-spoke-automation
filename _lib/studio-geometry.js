// _lib/studio-geometry.js
// I9-SYSTEM: lacing geometry of the Spoke Color Studio, vendored from the dev theme (assets/spoke-studio.js, LoamStudio.geometry).
//
// The theme file is the source of truth and stays untouched there. This copy exists so the backend can draw a System wheel exactly as
// the Studio draws it (same rim holes, same hub-hole-to-rim-hole assignment, same 2:1 symmetry fix, same Hydra2 front 32h phase).
// tests/studio-geometry-drift.test.js compares this module's output with the theme's LoamStudio.geometry for the sandbox wheels, so
// the two cannot silently drift. If you change the lacing in the theme, port the change here (and vice versa) and run the tests.
//
// Everything below the "ported" line is the theme code with the minimum of edits (ESM export, no DOM, no palettes).
// Last synced with the theme commit e7f7c70 (agent-b-integration): LACING_PHASE_HOLES = { 'front:32': -2, 'rear:28': 2 } plus the explicit LACING_2TO1_24H table for the Solix 24h wheels.
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

// ONE place for the lacing phase of each wheel: rotates the WHOLE lacing (hub holes, spoke-to-rim-hole assignment and which rim holes belong to
// which side) rigidly relative to the rim and the valve. Every spoke keeps its sweep and deviation; the set of rim hole angles and the valve do
// not move, so vrank and the patterns stay put (only which side owns which rim hole can shift on a 2:1 wheel).
//   Key   = '<position>:<hub count>'   (hub count = total spokes = rim holes)
//   Value = rotation in RIM HOLES (one hole = 360 / hub count degrees).
//   SIGN  = angles in this file are the drive-side view, measured clockwise from 12 o'clock:
//           positive = clockwise seen from the DRIVE side, negative = counter-clockwise seen from the drive side
//           (= clockwise seen from the ROTOR side, because the rotor view is the mirror image).
//   Hydra2 front 32h : -2  the valve stem sits between parallel spokes (2 holes counter-clockwise, drive-side view)
//   (Solix 24h 2:1 front and rear are NOT here any more: their lacing is the explicit LACING_2TO1_24H table below.)
//   Hydra2 rear 28h  : +2  (not sold today) 2 holes clockwise seen from the DRIVE side, chosen by Jerry from a sample image. On a 28h hub
//                      +2 and -2 draw the same wheel (14 spokes per side = 7-fold lacing symmetry); only spoke numbering k differs. The
//                      PCD and crossing used for it are SAMPLE numbers: recheck if I9 releases a real 28h rear with different ones.
// When the step is a whole number of hub holes the spokes are re-counted from the hub holes (k = 0 is the hub hole at the usual start angle);
// otherwise the hub holes turn with the lacing and spoke index k is kept.
var LACING_PHASE_HOLES = { 'front:32': -2, 'rear:28': 2 };
function rotateLacing(list, stepDeg) {
  var n = list.length, pitch = 360 / n, q = Math.round(stepDeg / pitch), whole = Math.abs(stepDeg - q * pitch) < 1e-6;
  return list.map(function (_, k) {
    var o = list[whole ? (((k - q) % n) + n) % n : k];
    return { hub: (((o.hub + stepDeg) % 360) + 360) % 360, rim: (((o.rim + stepDeg) % 360) + 360) % 360, s: o.s };
  });
}

// Solix 24h 2:1 lacing as measured on real I9 System wheels (Jerry, approved from a render). Angles are drive-view degrees, clockwise from 12 o'clock;
// rim holes sit at 7.5, 22.5 ... 352.5 and the valve at 180 (between holes 172.5 and 187.5). Spoke k of a side has its hub hole at
// hub0 + k * (360 / spokes on that side); an EVEN k leans one way (s = +1, rim = hub + pos) and an ODD k the other way (s = -1, rim = hub + neg).
// Which rim holes belong to which side simply follows from rim = hub + sweep. Keyed by the position, the side that carries the 16 spokes is
// 'major' (high tension: front = rotor side, rear = drive side) and the 8-spoke side 'minor' (low tension).
//   front: the 8 low-tension (drive) rim holes are 22.5, 67.5, ... 337.5 (every 45); the valve sits between two HIGH-tension holes (172.5, 187.5).
//   rear : the exact mirror image, left to right (every rim angle a -> 360 - a, every sweep changes sign, high tension = drive side).
// Only used for an exact 24h 2:1 wheel (16 + 8 spokes); every other wheel keeps the generic lacing above.
var LACING_2TO1_24H = {
  front: { major: { hub0: 315, pos: 82.5, neg: -60 }, minor: { hub0: 315, pos: 22.5, neg: -67.5 } },
  rear: { major: { hub0: 22.5, pos: 60, neg: -82.5 }, minor: { hub0: 0, pos: 67.5, neg: -22.5 } }
};
function lacingFromTable(spec, n) {
  var out = [], k, pitch = 360 / n;
  for (k = 0; k < n; k++) {
    var s = k % 2 === 0 ? 1 : -1, hub = (((spec.hub0 + k * pitch) % 360) + 360) % 360;
    out.push({ hub: hub, rim: (((hub + (s > 0 ? spec.pos : spec.neg)) % 360) + 360) % 360, s: s });
  }
  return out;
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
    var table = LACING_2TO1_24H[key], phaseHoles = LACING_PHASE_HOLES[key + ':' + w.rimHoles];
    if (table && w.rimHoles === 24 && w[big].n === 16 && w[small].n === 8) {
      G[key][big] = lacingFromTable(table.major, 16);
      G[key][small] = lacingFromTable(table.minor, 8);
    } else if (phaseHoles) SIDES.forEach(function (side) { G[key][side] = rotateLacing(G[key][side], phaseHoles * 360 / w.rimHoles); });
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

export const STUDIO_GEOMETRY_CONSTANTS = { MAJORITY_ODD_TAKES_LOWER, LACING_PHASE_HOLES, LACING_2TO1_24H };
