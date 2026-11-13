// File: /api/order-sheet.js
// ORDER-SHEET: read-only. Returns the "order sheet" of a builder order as JSON, recalculated on demand from the order itself (PR 1: always recalculated and labelled so).
//
//   GET /api/order-sheet?order=1466        headers: x-order-sheet-secret: <ORDER_SHEET_SECRET>
//   200 { ok: true, sheet: { ... } }       (see _lib/order-sheet.js and agent-prompts/AGENT_BACKEND1_ORDER_SHEET_PR1_REPORT.md for the format)
//   400 { ok: false, error: 'BAD_ORDER_NUMBER' }      401 { ok: false, error: 'UNAUTHORIZED' }     404 { ok: false, error: 'ORDER_NOT_FOUND' }
//   422 { ok: false, error: 'NOT_A_BUILDER_ORDER' }   502 { ok: false, error: 'SHOPIFY_ERROR' }    405 for any method but GET
//
// Opens ONE order by its number (no listing). It reads the order and the part metafields through read-only Shopify queries (no customer fields are even requested), and it never
// adjusts inventory, writes an order note or sends an email: those functions are not imported here. The secret is separate from INTERNAL_API_SECRET.

import { secretMatches, SECRET_HEADER, parseOrderNumber, sheetForOrder } from '../_lib/order-sheet-api.js';
import { OrderSheetError } from '../_lib/order-sheet.js';
import { runCalculationEngine } from './index.js'; // the Standard length calculation (pure); nothing else of the webhook is used

export const config = { maxDuration: 30 };

function send(res, status, body) {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(status).json(body);
}

export function makeHandler(deps = {}) {
  return async function handler(req, res) {
    if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return send(res, 405, { ok: false, error: 'METHOD_NOT_ALLOWED' }); }
    if (!secretMatches(req.headers[SECRET_HEADER], process.env.ORDER_SHEET_SECRET)) return send(res, 401, { ok: false, error: 'UNAUTHORIZED' });
    const number = parseOrderNumber(req.query && req.query.order);
    if (!number) return send(res, 400, { ok: false, error: 'BAD_ORDER_NUMBER', message: 'Give the order number as digits, for example ?order=1466.' });
    try {
      const { sheet } = await sheetForOrder(number, deps);
      return send(res, 200, { ok: true, sheet });
    } catch (e) {
      if (e instanceof OrderSheetError) return send(res, e.code === 'ORDER_NOT_FOUND' ? 404 : 422, { ok: false, error: e.code, message: e.message });
      console.error(`order-sheet: order #${number} failed:`, e && e.message);
      return send(res, 502, { ok: false, error: 'SHOPIFY_ERROR', message: 'The order could not be read from Shopify. Try again in a moment.' });
    }
  };
}

export default makeHandler({ runEngine: runCalculationEngine });
