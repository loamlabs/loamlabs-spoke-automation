// _lib/order-sheet-store.js
// ORDER-SHEET PR 2: the saved "as sent" copy of an order's sheet. After the webhook has answered and the note and the emails are done, the webhook saves the sheet it just computed
// (small JSON) and the spoke-map PNGs it just sent, in Supabase (table order_sheets + private bucket order-sheet-images; the SQL is in sql/order_sheets.sql). The dashboard then shows that
// copy ("as sent") instead of a recalculation, up to a year or two later.
//
//   saveOrderSheetCopy({ orderData, componentData, systemReport | buildReport, images })   best effort, NEVER throws, never changes the order, the note or an email
//   loadSavedSheet(orderNumber)                                                            { status: 'found'|'none'|'error'|'not-configured', sheet, images, savedAt }
//   loadSavedImage(path)                                                                   Buffer | null
//   cleanupExpired({ apply })                                                              retention (see scripts/order-sheet-cleanup.mjs)
//
// OFF by default: saving happens only when env ORDER_SHEET_SAVE is exactly "on" (any other value, or unset, saves nothing). Reading a saved copy needs only the two Supabase variables.
// Env (the same two the abandoned-build collector uses, same Supabase project): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY. Nothing here prints a key.
// PRIVACY: what is saved is the sheet of _lib/order-sheet.js (a whitelist: no customer name, email, address, phone or note) plus the PNGs. Nothing else of the order is saved.
// Retention lives in the SQL (rows 24 months, images 12 months, `expires_at` / `images_expire_at` on each row).
// All network calls go through `deps.fetchImpl` (default: global fetch), so the tests run against an in-memory fake.

import { buildOrderSheet } from './order-sheet.js';
import { timeoutSignal, withTimeout } from './http-timeout.js';

export const SAVE_FLAG = 'ORDER_SHEET_SAVE';
export const BUCKET = 'order-sheet-images';
export const SAVE_BUDGET_MS = 15000;            // the whole save (sheet + up to 6 images + row) gives up after this; it runs after the answer, but it must not hang
export const CALL_TIMEOUT_MS = 6000;            // each Supabase call

export const saveEnabled = (env = process.env) => String(env[SAVE_FLAG] == null ? '' : env[SAVE_FLAG]).trim().toLowerCase() === 'on';

function config(deps = {}) {
  const env = deps.env || process.env;
  const url = String(deps.url || env.SUPABASE_URL || '').trim().replace(/\/+$/, ''), key = String(deps.key || env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  const domain = String(deps.shop || env.SHOPIFY_STORE_DOMAIN || '').trim();
  return { url, key, shop: domain.split('.')[0] || domain, ok: !!(url && key && domain) };
}
// the two limits can be overridden through env for tests (like SHOPIFY_FETCH_TIMEOUT_MS); leave them unset in production
const envMs = (deps, name) => Number((deps.env || process.env)[name]);
const callTimeout = (deps) => (Number(deps.callTimeoutMs) > 0 ? Number(deps.callTimeoutMs) : (envMs(deps, 'ORDER_SHEET_STORE_TIMEOUT_MS') > 0 ? envMs(deps, 'ORDER_SHEET_STORE_TIMEOUT_MS') : CALL_TIMEOUT_MS));
const saveBudget = (deps) => (Number(deps.budgetMs) > 0 ? Number(deps.budgetMs) : (envMs(deps, 'ORDER_SHEET_SAVE_BUDGET_MS') > 0 ? envMs(deps, 'ORDER_SHEET_SAVE_BUDGET_MS') : SAVE_BUDGET_MS));

async function sb(cfg, deps, pathAndQuery, init = {}) {
  const res = await (deps.fetchImpl || fetch)(`${cfg.url}${pathAndQuery}`, {
    ...init, headers: { apikey: cfg.key, Authorization: `Bearer ${cfg.key}`, ...(init.headers || {}) }, signal: timeoutSignal(callTimeout(deps))
  });
  return res;
}

const seg = (s) => encodeURIComponent(String(s));
export const imagePath = (shop, orderNumber, wheel, view) => `${seg(shop)}/${seg(orderNumber)}/${seg(wheel)}-${seg(view)}.png`;

/**
 * Save the sheet and the images of one order. Never throws.
 * @param {{ orderData: object, componentData?: Map|null, systemReport?: { wheels: Array, lengths: object }, buildReport?: object, images?: Array<{cid: string, png: Buffer}> }} o
 *   images = the PNGs the email carried (System: report.images, Standard: the studio additions' images), found by their `cid`.
 * @returns {Promise<{ ok: boolean, skipped?: string, error?: string, images?: number, imagesFailed?: number }>}
 */
export async function saveOrderSheetCopy(o, deps = {}) {
  const n = o && o.orderData && o.orderData.order_number;
  try {
    if (!saveEnabled(deps.env || process.env)) return { ok: false, skipped: 'off' };
    const cfg = config(deps);
    if (!cfg.ok) { console.warn(`ORDER-SHEET: order #${n}: not saved (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SHOPIFY_STORE_DOMAIN is not set).`); return { ok: false, skipped: 'not-configured' }; }
    return await withTimeout(doSave(o, cfg, deps), saveBudget(deps), 'saving the order sheet');
  } catch (e) {
    console.warn(`ORDER-SHEET: order #${n}: the sheet was not saved (${e && e.message ? e.message : e}); the order is not affected.`);
    return { ok: false, error: e && e.message ? String(e.message).slice(0, 200) : 'error' };
  }
}

async function doSave(o, cfg, deps) {
  const sheet = buildOrderSheet({ orderData: o.orderData, componentData: o.componentData || null, buildReport: o.buildReport || null, systemReport: o.systemReport || null, mode: 'as-sent', calculatedAt: typeof deps.now === 'function' ? deps.now() : undefined });
  const orderNumber = sheet.orderNumber;
  if (!orderNumber) throw new Error('the order has no number');
  if (o.orderData && o.orderData.cancelled_at) throw new Error('cancelled order, not saved');
  const byCid = new Map((o.images || []).filter((i) => i && i.cid && i.png && i.png.length).map((i) => [i.cid, i.png]));
  const stored = [];
  let failed = 0;
  for (const w of sheet.wheels) for (const d of w.images || []) {
    const png = byCid.get(d.cid);
    if (!png) { failed++; continue; }
    const path = imagePath(cfg.shop, orderNumber, d.wheel, d.view);
    try {
      const res = await sb(cfg, deps, `/storage/v1/object/${BUCKET}/${path}`, { method: 'POST', headers: { 'Content-Type': 'image/png', 'x-upsert': 'true', 'Cache-Control': 'max-age=3600' }, body: png });
      if (!res.ok) throw new Error(`storage answered ${res.status}`);
      stored.push({ wheel: d.wheel, view: d.view, path: decodeURIComponent(path), bytes: png.length, caption: d.caption });
    } catch (e) { failed++; console.warn(`ORDER-SHEET: order #${orderNumber}: image ${d.wheel}/${d.view} not stored (${e && e.message}).`); }
  }
  const res = await sb(cfg, deps, '/rest/v1/rpc/save_order_sheet', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ p_shop: cfg.shop, p_order_number: String(orderNumber), p_kind: sheet.kind, p_numbering_version: sheet.numberingVersion, p_sheet: sheet, p_images: stored })
  });
  if (!res.ok) throw new Error(`the database answered ${res.status}`);
  console.log(`ORDER-SHEET: order #${orderNumber} saved (${stored.length} images${failed ? `, ${failed} not stored` : ''}).`);
  return { ok: true, images: stored.length, imagesFailed: failed };
}

/** The saved copy of an order, or why there is none. Never throws. status: found | none | error | not-configured */
export async function loadSavedSheet(orderNumber, deps = {}) {
  try {
    const cfg = config(deps);
    if (!cfg.ok) return { status: 'not-configured' };
    const now = typeof deps.now === 'function' ? deps.now() : new Date().toISOString();
    const q = `/rest/v1/order_sheets?shop=eq.${seg(cfg.shop)}&order_number=eq.${seg(orderNumber)}&expires_at=gt.${seg(now)}&select=sheet,images,created_at,updated_at,images_expire_at&limit=1`;
    const res = await sb(cfg, deps, q, { method: 'GET', headers: { Accept: 'application/json' } });
    if (!res.ok) return { status: 'error', error: `the database answered ${res.status}` };
    const rows = await res.json();
    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row || !row.sheet || typeof row.sheet !== 'object') return { status: 'none' };
    return { status: 'found', sheet: row.sheet, images: Array.isArray(row.images) ? row.images : [], savedAt: row.updated_at || row.created_at || null, imagesExpireAt: row.images_expire_at || null };
  } catch (e) {
    return { status: 'error', error: e && e.message ? String(e.message).slice(0, 200) : 'error' };
  }
}

/** One stored PNG (private bucket, read with the service key), or null when it is missing / expired / unreadable. Never throws. */
export async function loadSavedImage(path, deps = {}) {
  try {
    const cfg = config(deps);
    if (!cfg.ok || !path) return null;
    const enc = String(path).split('/').map(seg).join('/');
    const res = await sb(cfg, deps, `/storage/v1/object/authenticated/${BUCKET}/${enc}`, { method: 'GET' });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length ? buf : null;
  } catch (e) { return null; }
}

/**
 * Retention: images older than `images_expire_at` are deleted from the bucket (the row keeps its sheet and loses the image list); rows older than `expires_at` are deleted with
 * their images. Dry run unless apply is true. Returns counts.
 */
export async function cleanupExpired({ apply = false } = {}, deps = {}) {
  const cfg = config(deps);
  if (!cfg.ok) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SHOPIFY_STORE_DOMAIN must be set');
  const now = typeof deps.now === 'function' ? deps.now() : new Date().toISOString();
  const json = async (res) => { if (!res.ok) throw new Error(`Supabase answered ${res.status}`); return res.json(); };
  const expiredImages = (await json(await sb(cfg, deps, `/rest/v1/order_sheets?shop=eq.${seg(cfg.shop)}&images_expire_at=lt.${seg(now)}&select=order_number,images&limit=500`, { method: 'GET' }))).filter((r) => Array.isArray(r.images) && r.images.length);
  const expiredRows = await json(await sb(cfg, deps, `/rest/v1/order_sheets?shop=eq.${seg(cfg.shop)}&expires_at=lt.${seg(now)}&select=order_number,images&limit=500`, { method: 'GET' }));
  const out = { dryRun: !apply, rowsWithExpiredImages: expiredImages.length, rowsExpired: expiredRows.length, imagesDeleted: 0, rowsDeleted: 0 };
  const del = async (images) => {
    const paths = (images || []).map((i) => i && i.path).filter(Boolean);
    if (!paths.length) return 0;
    const res = await sb(cfg, deps, `/storage/v1/object/${BUCKET}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prefixes: paths }) });
    if (!res.ok) throw new Error(`storage answered ${res.status} on delete`);
    return paths.length;
  };
  if (!apply) return out;
  for (const r of expiredImages) {
    out.imagesDeleted += await del(r.images);
    const res = await sb(cfg, deps, `/rest/v1/order_sheets?shop=eq.${seg(cfg.shop)}&order_number=eq.${seg(r.order_number)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify({ images: [] }) });
    if (!res.ok) throw new Error(`the database answered ${res.status} on update`);
  }
  for (const r of expiredRows) {
    out.imagesDeleted += await del(r.images);
    const res = await sb(cfg, deps, `/rest/v1/order_sheets?shop=eq.${seg(cfg.shop)}&order_number=eq.${seg(r.order_number)}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
    if (!res.ok) throw new Error(`the database answered ${res.status} on delete`);
    out.rowsDeleted++;
  }
  return out;
}
