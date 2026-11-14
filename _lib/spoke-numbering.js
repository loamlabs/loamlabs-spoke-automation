// _lib/spoke-numbering.js
// ORDER-SHEET: the spoke numbers of the order sheet. THE ONE PLACE that knows the numbering rule: the sheet, the lists and any number drawn on a picture later all call spokeNumber().
// To change the rule edit NUMBERING (and, if the shape of the rule changes, the function below), raise NUMBERING.version, and the sheet header prints the new version.
//
// The rule (Jerry, Nov 12 2026; NOT confirmed on a real wheel yet, so it is printed as "numbering version 1, provisional"):
//   * valve stem at the bottom (6 o'clock). Each side is numbered as seen from that side's own face, going clockwise, starting with the first spoke to the LEFT of the valve
//     (clockwise from the valve; that is the first spoke after the valve in the Studio's own "vrank" order for the drive-side view).
//   * the high-tension side takes the EVEN numbers (2, 4, 6 ...): spoke 2 is the first spoke left of the valve. High-tension side on a 1:1 wheel: front = rotor side, rear = drive side.
//   * the low-tension side takes the ODD numbers (1, 3, 5 ...): flip the wheel (valve still at the bottom), spoke 1 is the first spoke left of the valve.
//   * "Left of the valve" for the low-tension side is counter-clockwise in the high-tension side's view, because the flipped wheel is the mirror image.
// A wheel with unequal sides (2:1 hubs such as Solix 24h) has no odd/even split. NOT specified by the rule above: until Jerry decides, each side is numbered 1, 2, 3 ... on its
// own with the same direction and starting point, and the text says which side ("Drive 3"). (NUMBERING.unequalSides)
//
// Pure: no network, never throws for odd data (an unusable spoke gets number null).
// Test: tests/spoke-numbering.test.js reproduces agent-prompts/ORDER_1466_BUILD_SHEET_PROVISIONAL.md (front 28h, rear 32h) spoke for spoke.

export const NUMBERING = {
  version: 1,
  status: 'provisional',
  label: 'numbering version 1, provisional',
  valveAngle: 180,                                  // the valve at the bottom: 180 degrees clockwise from 12 o'clock, as the geometry module has it
  povOfSide: { drive: 'as-geometry', rotor: 'mirror' }, // geometry angles are the drive-side view; the rotor face sees the mirror image
  highSide: { front: 'rotor', rear: 'drive' },      // 1:1 wheels
  first: { high: 2, low: 1 },
  step: 2,
  unequalSides: 'per-side',                         // 2:1 wheels: 1, 2, 3 ... per side (NOT confirmed)
  rule: 'High-tension side: even numbers 2, 4, 6 ... (front = rotor side, rear = drive side). Low-tension side: odd numbers 1, 3, 5 ... Each side is counted clockwise as seen from that side, valve stem at the bottom; spoke 2 (high) and spoke 1 (low) are the first spoke to the left of the valve.'
};

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// JERRY'S CONVENTION (Nov 13 2026), BEHIND THE FLAG SPOKE_NUMBERING_JERRY=on (default OFF: nothing below runs and every sheet, email and saved copy stays as it is).
//   Valve stem at the bottom. HIGH-tension side (1:1 wheels: front = rotor side, rear = drive side): spoke 2 is the first spoke to the LEFT of the valve, then every other spoke
//   by even numbers going clockwise (as seen from that side); the low-tension spokes are skipped. Flip the wheel over, valve still at the bottom: on the LOW-tension side spoke 1 is
//   the first spoke to the left of the valve, then 3, 5 ... counter-clockwise (as seen from that flipped side), so the numbers keep running in one direction around the rim.
// In one picture: look at the wheel from the HIGH-tension face, valve at 6 o'clock, and read clockwise: the low-tension spoke just before the valve (counter-clockwise of it) is 1, the
// high-tension spoke just after the valve is 2, then 3, 4, 5 ... alternate sides all the way round. The high-tension numbers are the same spokes as in version 1; only the low-tension
// side is numbered differently (version 1 counts it away from the valve, clockwise as seen from its own face).
// Wheels with unequal sides (2:1 hubs): Jerry's convention only describes 1:1 wheels, so the 2:1 numbering is NOT changed by the flag (per side, as in version 1).
export const NUMBERING_FLAG = 'SPOKE_NUMBERING_JERRY';
export const NUMBERING_JERRY = {
  version: 2,
  status: 'provisional',
  convention: 'jerry',
  label: "numbering version 2 (Jerry's convention), provisional",
  valveAngle: 180,
  povOfSide: { drive: 'as-geometry', rotor: 'mirror' },
  highSide: { front: 'rotor', rear: 'drive' },
  first: { high: 2, low: 1 },
  step: 2,
  unequalSides: 'per-side',
  rule: "Valve stem at the bottom. High-tension side (front: rotor side, rear: drive side): spoke 2 is the first spoke to the left of the valve, then 4, 6, 8 ... clockwise as seen from that side (low-tension spokes skipped). Flip the wheel over, valve still at the bottom: on the low-tension side spoke 1 is the first spoke to the left of the valve, then 3, 5, 7 ... counter-clockwise as seen from that side, so the numbers keep running in one direction around the rim (seen from the high-tension side: 1 just before the valve, 2 just after it, then 3, 4, 5 ... clockwise). Wheels with unequal sides (2:1): each side 1, 2, 3 ... as in version 1."
};
/** true when the environment switches Jerry's convention on (only the exact word "on", any case); default OFF. */
export const jerryNumberingOn = (env = process.env) => String(env && env[NUMBERING_FLAG] != null ? env[NUMBERING_FLAG] : '').trim().toLowerCase() === 'on';
/** the numbering settings in force: NUMBERING (version 1) unless the flag is on. */
export const numberingFor = (env = process.env) => (jerryNumberingOn(env) ? NUMBERING_JERRY : NUMBERING);

const SIDES = ['drive', 'rotor'];
const norm = (a) => (((a % 360) + 360) % 360);

/** Jerry's convention for ONE spoke of a wheel with equal sides. Angles are the rim hole as seen from the HIGH-tension face (clockwise from 12 o'clock, valve at 180). */
function jerryNumber(position, side, k, geom) {
  const empty = { number: null, text: null, high: null };
  const N = NUMBERING_JERRY, highSide = N.highSide[position];
  if (!highSide) return empty;
  const seenFromHigh = (rim) => norm(highSide === 'rotor' ? 360 - Number(rim) : Number(rim)); // geometry angles are the drive-side view; the rotor face sees the mirror image
  const list = geom[side].map((p, i) => ({ i, d: norm(seenFromHigh(p && p.rim) - N.valveAngle) })); // d = clockwise distance from the valve, seen from the high-tension face
  if (list.some((p) => !Number.isFinite(p.d))) return empty;
  list.sort((a, b) => a.d - b.d || a.i - b.i);
  const high = side === highSide;
  // high side: first spoke clockwise of the valve = 2. low side: spoke 1 is the last one in that order (the one just counter-clockwise of the valve as seen from the high face = the first to
  // the left of the valve when the wheel is flipped), then 3, 5 ... continue clockwise as seen from the high face (= counter-clockwise as seen from the flipped side).
  const ordered = high ? list : [list[list.length - 1], ...list.slice(0, -1)];
  const idx = ordered.findIndex((p) => p.i === k);
  const n = (high ? N.first.high : N.first.low) + N.step * idx;
  return { number: n, text: String(n), high };
}

/** Clockwise distance of a spoke's rim hole from the valve, as seen from `side`'s own face (0 = at the valve). */
function distanceFromValve(rimAngle, side) {
  const seen = NUMBERING.povOfSide[side] === 'mirror' ? norm(360 - rimAngle) : norm(rimAngle);
  return norm(seen - NUMBERING.valveAngle);
}

/**
 * The number of one spoke.
 * @param {{ position: 'front'|'rear', side: 'drive'|'rotor', k: number, geom: { drive: Array<{rim:number}>, rotor: Array<{rim:number}> } }} o
 *   k = the spoke's index in its side of the geometry (the same index the Studio value uses for its color); geom = geometry(config)[position].
 * @returns {{ number: number|null, text: string|null, high: boolean|null }} number = the number printed on the sheet (null when it cannot be told), text = e.g. "12" or, for unequal sides, "Drive 3".
 */
export function spokeNumber(o) {
  const empty = { number: null, text: null, high: null };
  try {
    const { position, side, k, geom } = o || {};
    if (!SIDES.includes(side) || !geom || !Array.isArray(geom[side]) || !Number.isInteger(k) || k < 0 || k >= geom[side].length) return empty;
    for (const s of SIDES) if (!Array.isArray(geom[s])) return empty;
    if (o.numbering && o.numbering.convention === 'jerry' && geom.drive.length === geom.rotor.length) return jerryNumber(position, side, k, geom); // flag SPOKE_NUMBERING_JERRY=on; 2:1 wheels fall through to version 1
    const list = geom[side].map((p, i) => ({ i, d: distanceFromValve(Number(p && p.rim), side) }));
    if (list.some((p) => !Number.isFinite(p.d))) return empty;
    list.sort((a, b) => a.d - b.d || a.i - b.i);
    const idx = list.findIndex((p) => p.i === k);
    const equal = geom.drive.length === geom.rotor.length;
    if (!equal) return { number: idx + 1, text: `${side === 'drive' ? 'Drive' : 'Rotor'} ${idx + 1}`, high: null };
    const high = NUMBERING.highSide[position] === side;
    if (!NUMBERING.highSide[position]) return empty;
    const n = (high ? NUMBERING.first.high : NUMBERING.first.low) + NUMBERING.step * idx;
    return { number: n, text: String(n), high };
  } catch (e) {
    return empty;
  }
}

/**
 * Every spoke of a wheel with its number, sorted by number (unequal sides: drive then rotor).
 * @param {{ position: 'front'|'rear', geom: object, colors: { drive: string[], rotor: string[] } }} o
 * @returns {Array<{ number: number|null, text: string|null, side: 'drive'|'rotor', k: number, color: string|null, high: boolean|null }>}
 */
export function numberSpokes(o) {
  const { position, geom, colors, numbering } = o || {};
  const out = [];
  for (const side of SIDES) {
    const list = geom && Array.isArray(geom[side]) ? geom[side] : [];
    list.forEach((p, k) => {
      const r = spokeNumber({ position, side, k, geom, numbering });
      out.push({ number: r.number, text: r.text, side, k, color: colors && Array.isArray(colors[side]) && colors[side][k] != null ? String(colors[side][k]) : null, high: r.high });
    });
  }
  const equal = geom && Array.isArray(geom.drive) && Array.isArray(geom.rotor) && geom.drive.length === geom.rotor.length;
  out.sort((a, b) => (equal ? (a.number - b.number) : (a.side === b.side ? a.number - b.number : (a.side === 'drive' ? -1 : 1))));
  return out;
}
