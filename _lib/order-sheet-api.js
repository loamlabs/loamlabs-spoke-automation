// _lib/order-sheet-api.js
// ORDER-SHEET: what the two endpoints (api/order-sheet.js, api/order-sheet-image.js) share: the secret check, reading ONE order by number from Shopify (read-only GraphQL queries,
// no customer fields), reading the component metafields, and turning the order into a sheet. Everything outbound goes through `deps.fetchImpl`, so the tests can prove
// that nothing but read queries is sent and that no inventory, order-note or email call is ever made (this file does not even import them).
//
// Auth: a NEW dedicated secret in the header `x-order-sheet-secret` (env ORDER_SHEET_SECRET), separate from INTERNAL_API_SECRET so it can be rotated alone. Fails closed.

import { timingSafeEqual } from 'node:crypto';
import { timeoutSignal, shopifyTimeoutMs } from './http-timeout.js';
import { buildOrderSheet, OrderSheetError } from './order-sheet.js';
import { findSystemBuildRecipe, findWheelBuildLineItem, parseBuildRecipe } from './system-build.js';

export const SECRET_HEADER = 'x-order-sheet-secret';

export function secretMatches(provided, expected) {
  if (typeof expected !== 'string' || !expected || typeof provided !== 'string') return false;
  const a = Buffer.from(provided, 'utf8'), b = Buffer.from(expected, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

// "1466", "#1466" -> "1466"; anything else -> null (digits only, 1 to 9 of them)
export function parseOrderNumber(v) {
  const t = String(Array.isArray(v) ? v[0] : (v == null ? '' : v)).trim().replace(/^#/, '');
  return /^\d{1,9}$/.test(t) ? String(Number(t)) : null;
}

// the ONLY fields read about an order: number, id, dates and the line items with their properties. No customer, email, phone, address, shipping, billing or note field.
export const ORDER_QUERY = `query($q: String!) { orders(first: 5, query: $q) { nodes { id name legacyResourceId createdAt cancelledAt lineItems(first: 100) { nodes { id title name variantTitle quantity sku variant { legacyResourceId } customAttributes { key value } } } } } }`;
export const COMPONENT_QUERY = `query getComponentMetafields($ids: [ID!]!) { nodes(ids: $ids) { ... on ProductVariant { id metafields(first: 50) { nodes { key namespace value } } product { id metafields(first: 50) { nodes { key namespace value } } } } } }`;

async function gql(query, variables, deps) {
  if (/\bmutation\b/i.test(query)) throw new Error('order sheet: only read queries are allowed'); // belt and braces: a mutation never leaves this file
  const domain = deps.domain || process.env.SHOPIFY_STORE_DOMAIN, token = deps.token || process.env.SHOPIFY_ADMIN_API_TOKEN;
  if (!domain || !token) throw new Error('Shopify is not configured (SHOPIFY_STORE_DOMAIN / SHOPIFY_ADMIN_API_TOKEN)');
  const res = await (deps.fetchImpl || fetch)(`https://${domain}/admin/api/2024-07/graphql.json`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
    body: JSON.stringify({ query, variables }), signal: timeoutSignal(deps.timeoutMs || shopifyTimeoutMs())
  });
  if (!res.ok) throw new Error(`Shopify answered ${res.status}`);
  const json = await res.json();
  if (json.errors) throw new Error(`Shopify error: ${JSON.stringify(json.errors).slice(0, 200)}`);
  return json.data;
}

/** The order with this number as a webhook-shaped orderData (line_items with properties), or null when there is no such order. Read-only. */
export async function fetchOrderByNumber(orderNumber, deps = {}) {
  const data = await gql(ORDER_QUERY, { q: `name:#${orderNumber}` }, deps);
  const node = ((data && data.orders && data.orders.nodes) || []).find((n) => n && n.name === `#${orderNumber}`);
  if (!node) return null;
  return {
    id: node.legacyResourceId != null ? Number(node.legacyResourceId) : null, admin_graphql_api_id: node.id,
    order_number: Number(orderNumber), name: node.name, created_at: node.createdAt, cancelled_at: node.cancelledAt || null,
    line_items: ((node.lineItems && node.lineItems.nodes) || []).map((li) => ({
      id: li.id, title: li.title, name: li.name || li.title, variant_title: li.variantTitle || '', quantity: li.quantity, sku: li.sku || '',
      variant_id: li.variant && li.variant.legacyResourceId != null ? Number(li.variant.legacyResourceId) : null,
      properties: ((li.customAttributes) || []).map((a) => ({ name: a.key, value: a.value }))
    }))
  };
}

/** Hub / rim / spoke metafields of the recipe's component variants (same data as the webhook's fetchComponentData), or null when there are none or the read failed. Read-only. */
export async function fetchComponentMetafields(recipe, deps = {}) {
  const ids = [...new Set(Object.values((recipe && recipe.components) || {}).map((c) => c && c.variantId).filter(Boolean))];
  if (!ids.length) return null;
  const data = await gql(COMPONENT_QUERY, { ids }, deps);
  const map = new Map();
  for (const node of (data && data.nodes) || []) {
    if (!node) continue;
    const merged = {};
    ((node.product && node.product.metafields && node.product.metafields.nodes) || []).forEach((mf) => { if (mf.namespace === 'custom') merged[mf.key] = mf.value; });
    ((node.metafields && node.metafields.nodes) || []).forEach((mf) => { if (mf.namespace === 'custom') merged[mf.key] = mf.value; });
    if (node.product && node.product.id) merged._parent_product_id = node.product.id;
    map.set(node.id, merged);
  }
  return map;
}

/**
 * Order number -> everything the sheet and the images need. Throws OrderSheetError (ORDER_NOT_FOUND, NOT_A_BUILDER_ORDER); other errors are Shopify failures.
 * deps: { fetchImpl, domain, token, timeoutMs, runEngine(recipe, componentData) -> buildReport (Standard orders), now() }
 */
export async function loadOrderForSheet(orderNumber, deps = {}) {
  const orderData = await fetchOrderByNumber(orderNumber, deps);
  if (!orderData) throw new OrderSheetError('ORDER_NOT_FOUND', `No order #${orderNumber} was found.`);
  const line = findWheelBuildLineItem(orderData);
  const recipe = line ? parseBuildRecipe(line) : null;
  if (!recipe || typeof recipe !== 'object') throw new OrderSheetError('NOT_A_BUILDER_ORDER', `Order #${orderNumber} is not a wheel builder order (it has no wheel build).`);
  let componentData = null, componentError = null;
  try { componentData = await fetchComponentMetafields(recipe, deps); } catch (e) { componentError = e && e.message ? e.message : String(e); }
  let buildReport = null;
  if (!findSystemBuildRecipe(orderData) && typeof deps.runEngine === 'function') {
    try { buildReport = componentData ? deps.runEngine(recipe, componentData) : null; } catch (e) { componentError = componentError || (e && e.message); }
  }
  return { orderData, recipe, componentData, buildReport, componentError };
}

/** loadOrderForSheet + buildOrderSheet. A failed component read does not stop the sheet: it becomes a warning on it. */
export async function sheetForOrder(orderNumber, deps = {}) {
  const ctx = await loadOrderForSheet(orderNumber, deps);
  const calculatedAt = typeof deps.now === 'function' ? deps.now() : new Date().toISOString();
  const sheet = buildOrderSheet({ orderData: ctx.orderData, componentData: ctx.componentData, buildReport: ctx.buildReport, calculatedAt });
  if (ctx.componentError) sheet.warnings.unshift(`The part data could not be read from the store (${ctx.componentError}); lengths may be missing or wrong.`);
  return { sheet, ctx };
}
