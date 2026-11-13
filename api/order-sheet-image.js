// File: /api/order-sheet-image.js
// ORDER-SHEET: read-only. One PNG of one wheel and one view of an order's spoke map, drawn from the sheet's own data (no numbers on the spokes; the table carries them).
//
//   GET /api/order-sheet-image?order=1466&wheel=front&view=all[&width=600]      headers: x-order-sheet-secret: <ORDER_SHEET_SECRET>
//   wheel = front | rear;  view = all (all spokes) | high (high-tension side only) | low (low-tension side only; a one-color wheel has only "all");  width 200 to 1200 (default 600)
//   200 image/png    400 BAD_ORDER_NUMBER / BAD_WHEEL / BAD_VIEW    401 UNAUTHORIZED    404 ORDER_NOT_FOUND or NO_SUCH_IMAGE    422 NOT_A_BUILDER_ORDER    502 SHOPIFY_ERROR / DRAW_FAILED
// The page asks for the images one at a time (a whole set in one JSON would be about 1.4 MB). Same read-only rules as api/order-sheet.js.

import { secretMatches, SECRET_HEADER, parseOrderNumber, sheetForOrder } from '../_lib/order-sheet-api.js';
import { OrderSheetError } from '../_lib/order-sheet.js';
import { renderSheetImage, VIEWS } from '../_lib/order-sheet-image.js';
import { runCalculationEngine } from './index.js';

export const config = { maxDuration: 30 };

function json(res, status, body) { res.setHeader('Cache-Control', 'no-store'); return res.status(status).json(body); }

export function makeHandler(deps = {}) {
  return async function handler(req, res) {
    if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return json(res, 405, { ok: false, error: 'METHOD_NOT_ALLOWED' }); }
    if (!secretMatches(req.headers[SECRET_HEADER], process.env.ORDER_SHEET_SECRET)) return json(res, 401, { ok: false, error: 'UNAUTHORIZED' });
    const q = req.query || {};
    const number = parseOrderNumber(q.order);
    if (!number) return json(res, 400, { ok: false, error: 'BAD_ORDER_NUMBER', message: 'Give the order number as digits, for example ?order=1466.' });
    const wheel = String(q.wheel || '').toLowerCase(), view = String(q.view || 'all').toLowerCase();
    if (wheel !== 'front' && wheel !== 'rear') return json(res, 400, { ok: false, error: 'BAD_WHEEL', message: 'wheel must be front or rear.' });
    if (!VIEWS.includes(view)) return json(res, 400, { ok: false, error: 'BAD_VIEW', message: 'view must be all, high or low.' });
    try {
      const { sheet } = await sheetForOrder(number, deps);
      const w = sheet.wheels.find((x) => x.position === wheel);
      if (!w) return json(res, 404, { ok: false, error: 'NO_SUCH_IMAGE', message: `Order #${number} has no ${wheel} wheel build.` });
      let img;
      try { img = await (deps.renderSheetImage || renderSheetImage)({ wheel: w, view, width: q.width, renderPng: deps.renderPng }); }
      catch (e) { return json(res, w.redraw && w.images.some((i) => i.view === view) ? 502 : 404, { ok: false, error: w.redraw && w.images.some((i) => i.view === view) ? 'DRAW_FAILED' : 'NO_SUCH_IMAGE', message: String(e && e.message).slice(0, 200) }); }
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Content-Disposition', `inline; filename="order-${number}-${wheel}-${view}.png"`);
      return res.status(200).send(img.png);
    } catch (e) {
      if (e instanceof OrderSheetError) return json(res, e.code === 'ORDER_NOT_FOUND' ? 404 : 422, { ok: false, error: e.code, message: e.message });
      console.error(`order-sheet-image: order #${number} failed:`, e && e.message);
      return json(res, 502, { ok: false, error: 'SHOPIFY_ERROR', message: 'The order could not be read from Shopify. Try again in a moment.' });
    }
  };
}

export default makeHandler({ runEngine: runCalculationEngine });
