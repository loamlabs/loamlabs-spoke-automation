// _lib/system-lengths.js
// I9-SYSTEM: LENGTH-CALC HOOK
//
// Spoke lengths for Industry Nine SYSTEM hubs are NOT calculated yet: the System spoke seats differently from a J-bend or a classic
// straight-pull spoke and the allowance / seating constants must come from I9's engineer. Until then this function returns null and the
// report prints "Spoke lengths for System hubs: not calculated (method pending)". When it returns numbers, _lib/system-report.js shows
// them in the email and in the order note with no other code change.
//
// Do not guess a formula here. When the method arrives:
//   1. fill in the constants below (they are the unknowns, grep "I9-SYSTEM: TODO"),
//   2. implement the body (the classic reference is calculateSpokeLength in _lib/calculator.js),
//   3. keep the signature: calculateSystemSpokeLengths(wheel) -> null | { left, right, note? }   (tests/system-lengths.test.js guards it).

/**
 * Input: one wheel. Left = rotor (non-drive) side, right = drive side, the same convention as _lib/calculator.js.
 * Values come from the hub variant / product metafields (custom.hub_flange_diameter_left/right, custom.hub_flange_offset_left/right,
 * custom.hub_spoke_hole_diameter), the rim (custom.rim_erd), the Studio wheel config (spokes per side, crossing per side).
 * Any value Shopify does not have yet is null.
 *
 * @typedef {Object} SystemWheelGeometry
 * @property {'front'|'rear'} position
 * @property {string|null} hubModel                      'Solix' | 'Hydra2'
 * @property {number|null} erd                           rim ERD, mm
 * @property {number|null} spokeHoleDiameter             hub spoke hole diameter, mm
 * @property {{left:number|null, right:number|null}} flangeDiameter   flange (spoke circle) diameter per side, mm
 * @property {{left:number|null, right:number|null}} flangeOffset     center-to-flange distance per side, mm
 * @property {{left:number, right:number}} cross                      crossing per side (3.5 = the Studio's 2:1 drawing value, not an engineering input yet)
 * @property {{left:number, right:number}} spokes                     spokes per side
 */

/**
 * Result: lengths in mm per side, already rounded the way the spokes are sold, plus an optional note for the report.
 * @typedef {Object} SystemSpokeLengths
 * @property {number} left
 * @property {number} right
 * @property {string} [note]
 */

// I9-SYSTEM: TODO allowance mm            (System spoke seating allowance, from I9)
export const SYSTEM_SPOKE_ALLOWANCE_MM = null;
// I9-SYSTEM: TODO rounding rule           ('even' = round up to the next even mm like steel, or whatever I9 sells)
export const SYSTEM_SPOKE_ROUNDING = null;
// I9-SYSTEM: TODO effective-cross rule    (the classic straight-pull code adds 0.5 to the cross; unknown for System)
export const SYSTEM_EFFECTIVE_CROSS_ADJUST = null;

export const SYSTEM_LENGTHS_PENDING_TEXT = 'Spoke lengths for System hubs: not calculated (method pending)';

/**
 * @param {SystemWheelGeometry} wheel
 * @returns {SystemSpokeLengths|null}  null = not calculated (method pending)
 */
export function calculateSystemSpokeLengths(wheel) { // eslint-disable-line no-unused-vars
  // I9-SYSTEM: LENGTH-CALC HOOK - intentionally disconnected. Returns null until I9's method is known.
  return null;
}
