// Runs api/index.js (any version of it) against a sample order with Shopify and Resend mocked, and returns what it did:
// the order note it wrote, the inventory adjustments it made, the variant lookups, and the emails it sent (SDK or REST).
// Used by tests/webhook-*.test.js and scripts/standard-proof.mjs.
import { createHmac } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
if (!globalThis.__harnessLoaderRegistered) { register('./loader.mjs', pathToFileURL(here + path.sep)); globalThis.__harnessLoaderRegistered = true; }

export const TEST_ENV = {
  SHOPIFY_WEBHOOK_SECRET: 'test-webhook-secret',
  SHOPIFY_STORE_DOMAIN: 'test-store.myshopify.com',
  SHOPIFY_ADMIN_API_TOKEN: 'shpat_test',
  SHOPIFY_PRIMARY_LOCATION_ID: '77777',
  RESEND_API_KEY: 're_test',
  BUILDER_EMAIL_ADDRESS: 'builder@example.com',
  INTERNAL_API_SECRET: 'internal-test'
};
export function applyTestEnv(extra) {
  Object.assign(process.env, TEST_ENV);
  delete process.env.SYSTEM_CUSTOMER_EMAIL; // the customer-email flag is OFF unless a test sets it through opts.env
  if (extra) Object.assign(process.env, extra);
}

export function loadSample(kind, name) {
  return JSON.parse(fs.readFileSync(path.join(here, '..', '..', 'samples', kind, name + '.json'), 'utf8'));
}
export function loadMockShopify() {
  return JSON.parse(fs.readFileSync(path.join(here, '..', '..', 'samples', 'standard', 'mock-shopify.json'), 'utf8'));
}

// fetch() stand-in for the Shopify Admin GraphQL API and the Resend REST API.
export function createMock(mockData) {
  const data = mockData || { metafields: {}, variantColors: ['Black', 'Silver', 'White Berd', 'Black Berd'], variantLengths: [230, 330] };
  const calls = { metafieldQueries: [], variantQueries: [], inventoryAdjustments: [], notes: [], locationQueries: [], restEmails: [], orderNoteQueries: [], other: [] };
  // Shopify's live order notes: seeded from the delivered order, overwritten by orderUpdate, read by the orderNote query (the idempotency guard).
  const state = { orderNotes: {}, failOrderNoteQuery: false };
  const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });
  const variantsFor = (productId) => {
    const out = [];
    const [lo, hi] = data.variantLengths;
    data.variantColors.forEach((color, ci) => { for (let L = lo; L <= hi; L++) out.push({ id: `${productId}/v/${ci}/${L}`, title: `${color} / ${L}mm`, inventoryItem: { id: `gid://shopify/InventoryItem/${ci}${L}` } }); });
    return out;
  };
  const fetch = async (url, init) => {
    const u = String(url);
    if (u.includes('api.resend.com')) { calls.restEmails.push(JSON.parse(init.body)); return json({ id: 'mock-resend-rest-id' }); }
    if (!u.includes('/admin/api/')) { calls.other.push(u); return json({}, 404); }
    const body = JSON.parse(init.body), q = String(body.query || '');
    if (q.includes('getComponentMetafields')) {
      calls.metafieldQueries.push(body.variables.ids);
      const nodes = body.variables.ids.map((id) => {
        const m = data.metafields[id];
        if (!m) return null;
        const mfs = Object.entries(m).filter(([k]) => k !== '_parent_product_id').map(([key, value]) => ({ key, namespace: 'custom', value: String(value) }));
        return { id, metafields: { nodes: mfs }, product: { id: m._parent_product_id || `gid://shopify/Product/unknown-${id.split('/').pop()}`, metafields: { nodes: [] } } };
      });
      return json({ data: { nodes } });
    }
    if (q.includes('getProductVariants')) { calls.variantQueries.push(body.variables.id); return json({ data: { product: { variants: { nodes: variantsFor(body.variables.id) } } } }); }
    if (q.includes('inventoryAdjustQuantities')) { calls.inventoryAdjustments.push(body.variables.input); return json({ data: { inventoryAdjustQuantities: { inventoryAdjustmentGroup: { id: 'gid://shopify/InventoryAdjustmentGroup/1' }, userErrors: [] } } }); }
    if (q.includes('orderNote(')) {
      calls.orderNoteQueries.push(body.variables.id);
      if (state.failOrderNoteQuery) return json({ errors: [{ message: 'simulated Shopify outage' }] });
      return json({ data: { order: { note: state.orderNotes[body.variables.id] ?? null } } });
    }
    if (q.includes('orderUpdate')) { calls.notes.push(body.variables.input); state.orderNotes[body.variables.input.id] = body.variables.input.note; return json({ data: { orderUpdate: { order: { id: body.variables.input.id }, userErrors: [] } } }); }
    if (q.includes('locations(')) { calls.locationQueries.push(1); return json({ data: { locations: { nodes: [{ id: 'gid://shopify/Location/77777' }] } } }); }
    calls.other.push(q.slice(0, 80));
    return json({ data: {} });
  };
  return { fetch, calls, state };
}

function fakeReq(rawBody, headers) {
  const buf = Buffer.from(rawBody);
  return { method: 'POST', headers, async *[Symbol.asyncIterator]() { yield buf; } };
}
function fakeRes() {
  const res = { statusCode: 200, body: null, headers: {} };
  res.setHeader = (k, v) => { res.headers[k] = v; return res; };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  res.send = (b) => { res.body = b; return res; };
  res.end = (b) => { if (b !== undefined) res.body = b; return res; };
  return res;
}

/**
 * Runs one webhook event through the given api/index.js.
 * @param {string} indexPath absolute path of the api/index.js to test
 * @param {'orders/create'|'orders/cancelled'} topic
 * @param {object} orderData the sample order
 * @param {{ mock?: ReturnType<typeof createMock>, quiet?: boolean, env?: object, keepDedupe?: boolean }} opts  env = extra process.env values for this run (e.g. SYSTEM_CUSTOMER_EMAIL: 'on')
 */
export async function runWebhook(indexPath, topic, orderData, opts = {}) {
  applyTestEnv(opts.env);
  const mock = opts.mock || createMock(loadMockShopify());
  if (orderData && orderData.admin_graphql_api_id && !(orderData.admin_graphql_api_id in mock.state.orderNotes)) mock.state.orderNotes[orderData.admin_graphql_api_id] = orderData.note || null;
  if (opts.keepDedupe !== true) { try { (await import(new URL('../_lib/system-dedupe.js', pathToFileURL(indexPath)).href)).resetSystemDedupe(); } catch (e) { /* the code under test has no guard (old origin/main) */ } }
  const rawBody = JSON.stringify(orderData);
  const hmac = createHmac('sha256', process.env.SHOPIFY_WEBHOOK_SECRET).update(rawBody).digest('base64');
  const realFetch = globalThis.fetch;
  const logs = [];
  const realLog = { log: console.log, warn: console.warn, error: console.error };
  globalThis.__harness = { sdkEmails: [] };
  globalThis.fetch = mock.fetch;
  if (opts.quiet !== false) { console.log = (...a) => logs.push(['log', a.map(String).join(' ')]); console.warn = (...a) => logs.push(['warn', a.map(String).join(' ')]); console.error = (...a) => logs.push(['error', a.map((x) => (x && x.stack) || String(x)).join(' ')]); }
  try {
    const mod = await import(pathToFileURL(indexPath).href);
    const res = fakeRes();
    await mod.default(fakeReq(rawBody, { 'x-shopify-hmac-sha256': hmac, 'x-shopify-topic': topic }), res);
    const sdkEmails = globalThis.__harness.sdkEmails.slice();
    return {
      status: res.statusCode, body: res.body,
      note: mock.calls.notes.length ? mock.calls.notes[mock.calls.notes.length - 1].note : null,
      notes: mock.calls.notes.map((n) => n.note),
      inventoryAdjustments: mock.calls.inventoryAdjustments,
      variantQueries: mock.calls.variantQueries,
      metafieldQueries: mock.calls.metafieldQueries,
      sdkEmails, restEmails: mock.calls.restEmails,
      emails: [...sdkEmails.map((e) => ({ via: 'sdk', subject: e.subject, html: e.html, to: e.to, attachments: e.attachments || [] })),
        ...mock.calls.restEmails.map((e) => ({ via: 'rest', subject: e.subject, html: e.html, to: e.to, attachments: e.attachments || [] }))],
      logs, calls: mock.calls
    };
  } finally {
    globalThis.fetch = realFetch;
    Object.assign(console, realLog);
  }
}
