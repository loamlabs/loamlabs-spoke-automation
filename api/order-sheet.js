// File: /api/order-sheet.js
// ORDER-SHEET: read-only. Returns the "order sheet" of a builder order as JSON, recalculated on demand from the order itself (PR 1: always recalculated and labelled so).
//
//   GET /api/order-sheet?order=1466        headers: x-order-sheet-secret: <ORDER_SHEET_SECRET>
//   200 { ok: true, source: 'saved' | 'recalculated', sheet: { ... } }   (see _lib/order-sheet.js and agent-prompts/AGENT_BACKEND1_ORDER_SHEET_PR1_REPORT.md for the format)
//       source 'saved': the copy the webhook saved when it processed the order (sheet.calculation.mode 'as-sent', plus savedAt); no Shopify call is made.
//       source 'recalculated': no saved copy (older order, or nothing saved yet): rebuilt now and labelled so (sheet.calculation.mode 'recalculated'); saved: { status: 'none' | 'error' | 'not-configured' } says why.
//   Every 200 also carries orderListStatus: 'present' (sheet.orderList is the I9 order list) | 'not-applicable' (Standard build: no I9 list, orderList is null) | 'not-saved' (a saved copy from before the list was
//   added: ask again with &fresh=1 for the recalculated list) | 'error' (the list could not be built; sheet.orderListNote says why).
//   Optional &fresh=1 skips the saved copy and answers recalculated (labelled so), e.g. to show the recalculated I9 list next to a saved sheet that has none.
//   400 { ok: false, error: 'BAD_ORDER_NUMBER' }      401 { ok: false, error: 'UNAUTHORIZED' }     404 { ok: false, error: 'ORDER_NOT_FOUND' }
//   422 { ok: false, error: 'NOT_A_BUILDER_ORDER' }   502 { ok: false, error: 'SHOPIFY_ERROR' }    405 for any method but GET
//
// Opens ONE order by its number (no listing). It looks for the saved copy first (Supabase, read only), then rebuilds. It reads the order and the part metafields through read-only Shopify queries (no customer fields are even requested), and it never
// adjusts inventory, writes an order note or sends an email: those functions are not imported here. The secret is separate from INTERNAL_API_SECRET.

import { secretMatches, SECRET_HEADER, parseOrderNumber, sheetForOrder } from '../_lib/order-sheet-api.js';
import { OrderSheetError } from '../_lib/order-sheet.js';
import { loadSavedSheet } from '../_lib/order-sheet-store.js';
import { runCalculationEngine } from './index.js'; // the Standard length calculation (pure); nothing else of the webhook is used

export const config = { maxDuration: 30 };

// a sheet saved before the order list existed has no orderList and no status: that is 'not-saved' for a System order, 'not-applicable' for a Standard one
export function orderListStatusOf(sheet) {
  if (!sheet || typeof sheet !== 'object') return 'not-saved';
  if (typeof sheet.orderListStatus === 'string') return sheet.orderListStatus;
  if (sheet.kind === 'standard') return 'not-applicable';
  return sheet.orderList ? 'present' : 'not-saved';
}

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
      const fresh = /^(1|true|yes)$/i.test(String(Array.isArray(req.query && req.query.fresh) ? req.query.fresh[0] : (req.query && req.query.fresh) || ''));
      const saved = fresh ? { status: 'skipped' } : await (deps.loadSaved || loadSavedSheet)(number, deps); // never throws; 'found' answers without any Shopify call
      if (saved.status === 'found') return send(res, 200, { ok: true, source: 'saved', savedAt: saved.savedAt, orderListStatus: orderListStatusOf(saved.sheet), sheet: saved.sheet });
      const { sheet } = await sheetForOrder(number, deps);
      return send(res, 200, { ok: true, source: 'recalculated', saved: { status: saved.status, ...(saved.error ? { error: saved.error } : {}) }, orderListStatus: orderListStatusOf(sheet), sheet });
    } catch (e) {
      if (e instanceof OrderSheetError) return send(res, e.code === 'ORDER_NOT_FOUND' ? 404 : 422, { ok: false, error: e.code, message: e.message });
      console.error(`order-sheet: order #${number} failed:`, e && e.message);
      return send(res, 502, { ok: false, error: 'SHOPIFY_ERROR', message: 'The order could not be read from Shopify. Try again in a moment.' });
    }
  };
}

export default makeHandler({ runEngine: runCalculationEngine });
