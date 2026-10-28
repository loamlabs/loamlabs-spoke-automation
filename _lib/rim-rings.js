// _lib/rim-rings.js
// The photo rim ring of the build report pictures (round 12). Agent A's Spoke Color Studio draws the rim from a photo of the real rim (a We Are One ring or an
// Industry Nine ring) instead of a plain stroked circle; this file holds the same drawing rules for the server side pictures. The geometry numbers are generated
// from Agent A's contract (_lib/rim-ring-data.js), the images are base64 PNGs (_lib/rim-ring-images.js, loaded only when a wheel is drawn).
//
// Drawing, for a wheel box of `box` px with `ro` = the outer rim radius (0.464 * box) and the center c = box / 2 (agent-prompts/AGENT_A_RIM_PHOTOS_REPORT.md):
//   1. s = ro / ((outerRx + outerRy) / 2). The image is size*s px wide, placed at c - outerCx*s, c - outerCy*s and turned clockwise by rot = valveAngleDeg + rotationDeg
//      about the wheel center. It is never mirrored, also for the rotor side view.
//   2. The inner ellipse (the rim's inner edge) is the contract's inner ellipse, scaled by s and turned by rot about the wheel center.
//   3. A spoke whose rim hole is at drawn angle a (degrees clockwise from 12 o'clock) ends on the ray from the inner ellipse center in direction (sin a, -cos a), at the
//      ellipse radius in that direction plus a tuck (clamp(box * 0.0046, 1.5, 2.5) px), so the spoke end is hidden under the ring.
//   4. The hub radius uses the mean inner radius: scale = ((rx + ry) / 2) / (erd / 2).
//   5. Layers: spokes, ring, valve stem (its base on the inner edge at the bottom), hub.

import { RING_GEOMETRY } from './rim-ring-data.js';

export const RING_KEYS = ['wao', 'i9'];
const RAD = Math.PI / 180;

/**
 * Which ring a rim gets (the theme's cart rule, assets/cart-wheel-previews.js): a rim component whose title starts with "We Are One" = We Are One; otherwise
 * a rim whose vendor is "Industry Nine" = Industry Nine; anything else, or no rim at all = We Are One. System builds carry the rebranded vendor ("Industry Nine"
 * for every rim), so for them the title is what tells a We Are One rim from an Industry Nine one.
 * @param {{title?: string, vendor?: string}|null|undefined} rim   the rim component of the recipe
 * @returns {'wao'|'i9'}
 */
export function ringKeyForRim(rim) {
  if (!rim || typeof rim !== 'object') return 'wao';
  if (/^\s*we are one\b/i.test(String(rim.title || ''))) return 'wao';
  if (/^\s*industry nine\b/i.test(String(rim.vendor || ''))) return 'i9';
  return 'wao';
}

/** The ring geometry for a brand and wheel position (Industry Nine is turned +40 deg on a front wheel and -40 deg on a rear wheel; We Are One 0). */
export function ringGeometry(key, position) {
  if (key === 'i9') return { key, ...(position === 'rear' ? RING_GEOMETRY.i9_rear : RING_GEOMETRY.i9_front) };
  return { key: 'wao', ...RING_GEOMETRY.wao };
}

/** The ring as wheelSvg takes it: the geometry plus the image as a data URI. Async because the images module is loaded on first use. */
export async function loadRing(key, position) {
  const { RING_PNG_BASE64 } = await import('./rim-ring-images.js');
  const g = ringGeometry(key, position);
  return { ...g, href: `data:image/png;base64,${RING_PNG_BASE64[g.key]}` };
}

/**
 * Where everything goes for one wheel box (pure geometry, no strings).
 * @param {number} box  picture width/height in px
 * @param {number} ro   outer rim radius in px (0.464 * box)
 * @param {object} ring a ring geometry (ringGeometry result)
 */
export function ringLayout(box, ro, ring) {
  const c = box / 2, s = ro / ((ring.outerRx + ring.outerRy) / 2), rot = ring.valveAngleDeg + ring.rotationDeg, q = rot * RAD;
  const dx = (ring.innerCx - ring.outerCx) * s, dy = (ring.innerCy - ring.outerCy) * s;
  const cx = c + dx * Math.cos(q) - dy * Math.sin(q), cy = c + dx * Math.sin(q) + dy * Math.cos(q);
  const rx = ring.innerRx * s, ry = ring.innerRy * s, axis = (ring.innerAngleDeg + rot) * RAD;
  const tuck = Math.min(2.5, Math.max(1.5, box * 0.0046));
  return {
    c, s, rot, tuck, rx, ry, cx, cy, axis, meanInner: (rx + ry) / 2,
    image: { x: c - ring.outerCx * s, y: c - ring.outerCy * s, size: ring.size * s },
    // the point where a spoke whose rim hole is at drawn angle a (degrees clockwise from 12 o'clock) ends; extra = 0 gives the inner edge itself
    end(aDeg, extra = tuck) {
      const a = aDeg * RAD, vx = Math.sin(a), vy = -Math.cos(a);
      const u = Math.atan2(vy, vx) - axis;
      const r = (rx * ry) / Math.sqrt((ry * Math.cos(u)) ** 2 + (rx * Math.sin(u)) ** 2);
      return [cx + (r + extra) * vx, cy + (r + extra) * vy];
    }
  };
}
