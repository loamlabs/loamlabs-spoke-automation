// _lib/valve-colors.js (round 15): the color of a wheel's valve stem in the report pictures, from the valve stem component of the order's _build
// (components.frontValveStem / rearValveStem, option "Color"). The map (Color text -> hex) is Agent C's, generated into _lib/valve-color-map.js.
// Nothing here throws: a missing or unknown color is the default dark valve.
import { VALVE_COLOR_MAP } from './valve-color-map.js';

export const VALVE_DEFAULT_HEX = VALVE_COLOR_MAP.default.hex;

const norm = (t) => (typeof t === 'string' ? t.toLowerCase().trim().replace(/\s+/g, ' ') : '');
const known = (k) => k !== '' && k !== 'default' && Object.prototype.hasOwnProperty.call(VALVE_COLOR_MAP, k);

/** { hex, light, approximate, known } for a Color option text; unknown / missing / not a string -> the default dark valve (known:false). */
export function valveColorInfo(colorText) {
  const k = norm(colorText);
  if (!known(k)) return { hex: VALVE_DEFAULT_HEX, light: false, approximate: false, known: false };
  const e = VALVE_COLOR_MAP[k];
  return { hex: e.hex, light: e.light === true, approximate: e.approximate === true, known: true };
}

/** The hex of a Color option text (lower-case + trim lookup); the default dark `#2b2b2b` for anything unknown. */
export function valveColorFor(colorText) { return valveColorInfo(colorText).hex; }

/** The Color option text of a valve stem build component, or null. */
export function valveColorTextOf(comp) {
  const opts = comp && typeof comp === 'object' && Array.isArray(comp.selectedOptions) ? comp.selectedOptions : [];
  const o = opts.find((x) => x && typeof x === 'object' && String(x.name).toLowerCase().trim() === 'color');
  return o && typeof o.value === 'string' ? o.value : null;
}

/**
 * The per-wheel valve fields for a wheel object, from its valve stem component (null / absent = no valve chosen = default dark, nothing to log).
 * valveColorUnknown is true when a valve stem IS in the build but its Color is missing or not in the map (the picture then gets the default dark valve and the caller logs it).
 */
export function valveFieldsFor(comp) {
  if (!comp || typeof comp !== 'object') return { valveColor: VALVE_DEFAULT_HEX, valveLight: false, valveColorText: null, valveColorUnknown: false };
  const text = valveColorTextOf(comp), info = valveColorInfo(text);
  return { valveColor: info.hex, valveLight: info.light, valveColorText: text, valveColorUnknown: !info.known };
}

/** One log-safe line for an unknown valve color: "unknown valve color: <text>". */
export function unknownValveColorText(text) {
  return 'unknown valve color: ' + (text == null || text === '' ? '(none)' : String(text).replace(/[\r\n\t]+/g, ' ').slice(0, 60));
}
