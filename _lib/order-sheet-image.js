// _lib/order-sheet-image.js
// ORDER-SHEET: one spoke-map PNG of one wheel and view, drawn ONLY from the sheet's own data (sheet.wheels[i].redraw + sheet.wheels[i].images), exactly as the report pictures are drawn
// (same wheelSvg call as renderWheelImages in _lib/system-report.js), with no numbers on the spokes (the sheet's table carries them). Because it needs nothing but the sheet,
// the same function will draw the images of a saved copy later.

import { geometry } from './studio-geometry.js';
import { wheelSvg } from './wheel-svg.js';
import { loadRing } from './rim-rings.js';
import { svgToPng } from './wheel-png.js';

export const VIEWS = ['all', 'high', 'low'];
export const WIDTH_RANGE = [200, 1200];
export const DEFAULT_WIDTH = 600;
export function clampWidth(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(WIDTH_RANGE[1], Math.max(WIDTH_RANGE[0], Math.round(n))) : DEFAULT_WIDTH;
}

/**
 * @param {{ wheel: object, view: 'all'|'high'|'low', width?: number, renderPng?: Function }} o   wheel = one entry of sheet.wheels
 * @returns {Promise<{ png: Buffer, caption: string, view: string }>}  throws Error with a plain message when the wheel cannot be drawn
 */
export async function renderSheetImage(o) {
  const w = o.wheel, view = o.view, width = clampWidth(o.width), renderPng = o.renderPng || svgToPng;
  if (!w || !w.redraw) throw new Error('this wheel has no drawing data (no usable geometry in the build)');
  const spec = (w.images || []).find((i) => i.view === view);
  if (!spec) throw new Error(`this wheel has no "${view}" view (a one-color wheel has only "all")`);
  const r = w.redraw;
  const geom = geometry(r.autoValvePhase === true ? { autoValvePhase: true, wheels: { [w.position]: r.config } } : { wheels: { [w.position]: r.config } })[w.position];
  let ring = null;
  if (r.rimRing !== null) { try { ring = await loadRing(r.rimRing || 'wao', w.position); } catch (e) { ring = null; } } // a ring problem never costs the picture: plain rim
  const draw = (rg) => wheelSvg({ config: r.config, geom, colorsHex: r.colorsHex, hubHex: r.hubColorHex, pov: spec.pov, sides: spec.sides, size: width, ring: rg, valveColor: r.valveColor || undefined, valveLight: r.valveLight == null ? undefined : r.valveLight, nipples: r.nipplesHex || undefined });
  let png;
  try { png = await renderPng(draw(ring), { width }); } catch (e) { if (!ring) throw e; png = await renderPng(draw(null), { width }); }
  if (!png || !png.length) throw new Error('the renderer returned no bytes');
  return { png, caption: spec.caption, view };
}
