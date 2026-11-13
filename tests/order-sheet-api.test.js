// ORDER-SHEET: api/order-sheet.js and api/order-sheet-image.js with a fake Shopify (the real handlers, no network). Auth, errors, read-only proof, the sheet itself, the PNGs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeHandler as makeSheetHandler } from '../api/order-sheet.js';
import { makeHandler as makeImageHandler } from '../api/order-sheet-image.js';
import { parseOrderNumber, secretMatches, ORDER_QUERY, COMPONENT_QUERY } from '../_lib/order-sheet-api.js';
import { buildOrderSheet } from '../_lib/order-sheet.js';
import { SYSTEM_SAMPLES, STANDARD_STUDIO_SAMPLES } from '../samples/index.js';
import { runCalculationEngine } from '../api/index.js';
import { loadMockShopify } from './helpers/webhook-harness.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const SECRET = 'sheet-secret-for-tests';
const clone = (o) => JSON.parse(JSON.stringify(o));
const order1466 = () => JSON.parse(fs.readFileSync(path.join(here, 'fixtures', 'order-1466.json'), 'utf8'));
const MOCK_META = loadMockShopify().metafields;

// a webhook-shaped order -> the GraphQL node the order query returns
function toNode(o) {
  return {
    id: `gid://shopify/Order/${o.id}`, name: `#${o.order_number}`, legacyResourceId: String(o.id), createdAt: o.created_at || '2026-11-12T10:00:00Z', cancelledAt: null,
    lineItems: { nodes: o.line_items.map((li) => ({ id: `gid://shopify/LineItem/${li.id}`, title: li.title, name: li.name || li.title, variantTitle: li.variant_title || '', quantity: li.quantity, sku: li.sku || '', variant: li.variant_id != null ? { legacyResourceId: String(li.variant_id) } : null, customAttributes: (li.properties || []).map((p) => ({ key: p.name, value: p.value })) })) }
  };
}

// fake Shopify Admin GraphQL: orders by number, component metafields; records every call
function fakeShopify(orders, { componentMeta = MOCK_META, failOrders = false, failComponents = false, httpStatus = 200, hang = false } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const u = String(url), body = init && init.body ? JSON.parse(init.body) : {};
    calls.push({ url: u, method: init && init.method, query: body.query, variables: body.variables, headers: init && init.headers });
    if (hang) return new Promise((_, rej) => { const keep = setInterval(() => {}, 20); init.signal.addEventListener('abort', () => { clearInterval(keep); rej(init.signal.reason || new Error('aborted')); }); }); // keep: AbortSignal.timeout's own timer does not keep the loop alive
    if (!/\/admin\/api\/[^/]+\/graphql\.json$/.test(u)) return { ok: false, status: 404, json: async () => ({}) };
    const json = (data, status = 200) => ({ ok: status < 400, status, json: async () => data });
    if (httpStatus !== 200) return json({}, httpStatus);
    if (body.query === ORDER_QUERY) {
      if (failOrders) return json({ errors: [{ message: 'boom' }] });
      const n = String(body.variables.q).replace(/^name:#/, '');
      return json({ data: { orders: { nodes: orders.filter((o) => String(o.order_number) === n).map(toNode) } } });
    }
    if (body.query === COMPONENT_QUERY) {
      if (failComponents) return json({ errors: [{ message: 'components down' }] });
      return json({ data: { nodes: body.variables.ids.map((id) => { const m = componentMeta[id]; if (!m) return null; return { id, metafields: { nodes: Object.entries(m).filter(([k]) => k !== '_parent_product_id').map(([key, value]) => ({ key, namespace: 'custom', value: String(value) })) }, product: { id: m._parent_product_id || `gid://shopify/Product/x-${id}`, metafields: { nodes: [] } } }; }) } });
    }
    return json({ errors: [{ message: 'unexpected query' }] }, 400);
  };
  return { fetchImpl, calls };
}

function fakeRes() {
  const res = { statusCode: 200, headers: {}, body: undefined, setHeader(k, v) { this.headers[k.toLowerCase()] = v; return this; }, status(c) { this.statusCode = c; return this; }, json(o) { this.body = o; this.headers['content-type'] = this.headers['content-type'] || 'application/json'; return this; }, send(b) { this.body = b; return this; } };
  return res;
}
const req = (query, headers = { 'x-order-sheet-secret': SECRET }, method = 'GET') => ({ method, query, headers });
async function call(handler, r) { const res = fakeRes(); await handler(r, res); return res; }

test.beforeEach(() => { process.env.ORDER_SHEET_SECRET = SECRET; process.env.SHOPIFY_STORE_DOMAIN = 'test-store.myshopify.com'; process.env.SHOPIFY_ADMIN_API_TOKEN = 'shpat_test'; });
const realFetch = globalThis.fetch;
test.afterEach(() => { globalThis.fetch = realFetch; });

/* ------------------------------------------------------------------ small pieces */

test('order numbers: digits only (a # is allowed), 1 to 9 of them', () => {
  assert.equal(parseOrderNumber('1466'), '1466'); assert.equal(parseOrderNumber('#1466'), '1466'); assert.equal(parseOrderNumber(' 007 '), '7'); assert.equal(parseOrderNumber(['1466', 'x']), '1466');
  for (const bad of [undefined, null, '', 'abc', '14 66', '1466; drop', '-5', '1.5', '1234567890', '#', '0x10', '١٤٦٦']) assert.equal(parseOrderNumber(bad), null, String(bad));
});

test('the secret check fails closed', () => {
  assert.equal(secretMatches('a', 'a'), true);
  for (const [p, e] of [[undefined, 'a'], ['a', undefined], ['', ''], ['a', ''], ['ab', 'a'], [['a'], 'a'], [1, 'a']]) assert.equal(secretMatches(p, e), false);
});

/* ------------------------------------------------------------------ auth and request rules (both endpoints) */

for (const [label, make] of [['order-sheet', makeSheetHandler], ['order-sheet-image', makeImageHandler]]) {
  test(`${label}: 401 without the secret, with a wrong secret, with the INTERNAL secret, and when ORDER_SHEET_SECRET is not set; nothing is read from Shopify`, async () => {
    const shop = fakeShopify([order1466()]);
    const h = make({ fetchImpl: shop.fetchImpl, runEngine: runCalculationEngine });
    const q = { order: '1466', wheel: 'front', view: 'all' };
    process.env.INTERNAL_API_SECRET = 'internal-secret';
    for (const headers of [{}, { 'x-order-sheet-secret': 'wrong' }, { 'x-order-sheet-secret': '' }, { 'x-internal-secret': 'internal-secret' }, { 'x-order-sheet-secret': 'internal-secret' }]) {
      const res = await call(h, req(q, headers));
      assert.equal(res.statusCode, 401, JSON.stringify(headers)); assert.equal(res.body.error, 'UNAUTHORIZED');
    }
    delete process.env.ORDER_SHEET_SECRET;
    assert.equal((await call(h, req(q, { 'x-order-sheet-secret': 'anything' }))).statusCode, 401);
    assert.equal((await call(h, req(q, { 'x-order-sheet-secret': '' }))).statusCode, 401);
    assert.equal(shop.calls.length, 0, 'unauthorized requests cost no Shopify call');
  });

  test(`${label}: only GET is allowed (405), and a bad order number is a 400 before any Shopify call`, async () => {
    const shop = fakeShopify([order1466()]);
    const h = make({ fetchImpl: shop.fetchImpl, runEngine: runCalculationEngine });
    for (const m of ['POST', 'PUT', 'DELETE', 'PATCH']) { const res = await call(h, req({ order: '1466', wheel: 'front' }, { 'x-order-sheet-secret': SECRET }, m)); assert.equal(res.statusCode, 405, m); assert.equal(res.headers.allow, 'GET'); }
    for (const bad of [undefined, '', 'abc', '1466; x', '-1', '12345678901']) { const res = await call(h, req({ order: bad, wheel: 'front' })); assert.equal(res.statusCode, 400, String(bad)); assert.equal(res.body.error, 'BAD_ORDER_NUMBER'); }
    assert.equal(shop.calls.length, 0);
  });
}

/* ------------------------------------------------------------------ the sheet endpoint */

test('200: the sheet of #1466 through the real handler equals buildOrderSheet() on the same order; responses are never cached', async () => {
  const shop = fakeShopify([order1466()]);
  const h = makeSheetHandler({ fetchImpl: shop.fetchImpl, runEngine: runCalculationEngine, now: () => '2026-11-12T12:00:00.000Z' });
  const res = await call(h, req({ order: '1466' }));
  assert.equal(res.statusCode, 200); assert.equal(res.body.ok, true); assert.equal(res.headers['cache-control'], 'no-store');
  const direct = buildOrderSheet({ orderData: order1466(), calculatedAt: '2026-11-12T12:00:00.000Z' });
  assert.deepEqual(res.body.sheet.wheels, direct.wheels);
  assert.deepEqual(res.body.sheet.i9OrderList, direct.i9OrderList);
  assert.equal(res.body.sheet.orderName, '#1466'); assert.equal(res.body.sheet.calculation.mode, 'recalculated');
  assert.equal(res.body.sheet.numbering.label, 'numbering version 1, provisional');
});

test('200: "#1466" in the query works too; a Standard order gets its lengths from the calculation engine', async () => {
  const std = clone(STANDARD_STUDIO_SAMPLES['std-nip-both-wheels-painted-both-fees']);
  std.order_number = 91777; std.id = 6000091777;
  const shop = fakeShopify([order1466(), std], { componentMeta: std._sample.metafields });
  const h = makeSheetHandler({ fetchImpl: shop.fetchImpl, runEngine: runCalculationEngine });
  assert.equal((await call(h, req({ order: '#1466' }))).statusCode, 200);
  const res = await call(h, req({ order: '91777' }));
  assert.equal(res.statusCode, 200); assert.equal(res.body.sheet.kind, 'standard');
  const eng = runCalculationEngine(JSON.parse(std.line_items.flatMap((l) => l.properties || []).find((p) => p.name === '_build').value), new Map(Object.entries(std._sample.metafields)));
  for (const w of res.body.sheet.wheels) assert.deepEqual([w.lengths.rotorMm, w.lengths.driveMm], [Number(eng[w.position].lengths.left.rounded), Number(eng[w.position].lengths.right.rounded)]);
});

test('every System sample works through the endpoint', async () => {
  const orders = Object.values(SYSTEM_SAMPLES).map((s, i) => { const o = clone(s); o.order_number = 92000 + i; o.id = 6000092000 + i; return o; });
  const shop = fakeShopify(orders);
  const h = makeSheetHandler({ fetchImpl: shop.fetchImpl, runEngine: runCalculationEngine });
  for (const o of orders) { const res = await call(h, req({ order: String(o.order_number) })); assert.equal(res.statusCode, 200, String(o.order_number)); assert.equal(res.body.sheet.kind, 'system'); }
});

test('errors: unknown order 404, an order without a wheel build 422, Shopify down or slow 502 (and the message does not leak details)', async () => {
  const plain = { id: 6000093000, order_number: 93000, name: '#93000', line_items: [{ id: 1, title: 'Spoke wrench', quantity: 1, properties: [] }] };
  const h1 = makeSheetHandler({ fetchImpl: fakeShopify([order1466(), plain]).fetchImpl, runEngine: runCalculationEngine });
  const nf = await call(h1, req({ order: '5' })); assert.deepEqual([nf.statusCode, nf.body.error], [404, 'ORDER_NOT_FOUND']);
  const nb = await call(h1, req({ order: '93000' })); assert.deepEqual([nb.statusCode, nb.body.error], [422, 'NOT_A_BUILDER_ORDER']);
  for (const opts of [{ httpStatus: 500 }, { failOrders: true }]) {
    const res = await call(makeSheetHandler({ fetchImpl: fakeShopify([order1466()], opts).fetchImpl, runEngine: runCalculationEngine }), req({ order: '1466' }));
    assert.deepEqual([res.statusCode, res.body.error], [502, 'SHOPIFY_ERROR']); assert.ok(!/shpat|token|boom/i.test(JSON.stringify(res.body)));
  }
  process.env.SHOPIFY_FETCH_TIMEOUT_MS = '50';
  try { const res = await call(makeSheetHandler({ fetchImpl: fakeShopify([order1466()], { hang: true }).fetchImpl, runEngine: runCalculationEngine }), req({ order: '1466' })); assert.equal(res.statusCode, 502); }
  finally { delete process.env.SHOPIFY_FETCH_TIMEOUT_MS; }
});

test('a chart-miss order still answers 200 with "NOT CALCULATED" for that wheel; a failed component read becomes a warning, not an error', async () => {
  const o = order1466();
  const line = o.line_items.find((l) => (l.properties || []).some((p) => p.name === '_build')), prop = line.properties.find((p) => p.name === '_build');
  const b = JSON.parse(prop.value); b.components.rearRim.variantId = 'gid://shopify/ProductVariant/1'; prop.value = JSON.stringify(b);
  const res = await call(makeSheetHandler({ fetchImpl: fakeShopify([o]).fetchImpl, runEngine: runCalculationEngine }), req({ order: '1466' }));
  assert.equal(res.statusCode, 200);
  const rear = res.body.sheet.wheels.find((w) => w.position === 'rear');
  assert.equal(rear.lengths.status, 'not-calculated'); assert.match(rear.lengths.text, /NOT CALCULATED/);
  const down = await call(makeSheetHandler({ fetchImpl: fakeShopify([order1466()], { failComponents: true }).fetchImpl, runEngine: runCalculationEngine }), req({ order: '1466' }));
  assert.equal(down.statusCode, 200);
  assert.ok(down.body.sheet.warnings[0].startsWith('The part data could not be read from the store'), down.body.sheet.warnings[0]);
});

/* ------------------------------------------------------------------ read-only proof */

test('READ ONLY: every call to Shopify is one of the two read queries (no mutation), nothing goes to Resend, and no customer field is requested', async () => {
  globalThis.fetch = () => { throw new Error('the handlers must use only the injected fetch'); };
  const std = clone(STANDARD_STUDIO_SAMPLES['std-nip-both-wheels-painted-both-fees']); std.order_number = 91778; std.id = 6000091778;
  const shop = fakeShopify([order1466(), std], { componentMeta: { ...MOCK_META, ...std._sample.metafields } });
  const sheet = makeSheetHandler({ fetchImpl: shop.fetchImpl, runEngine: runCalculationEngine });
  const image = makeImageHandler({ fetchImpl: shop.fetchImpl, runEngine: runCalculationEngine });
  await call(sheet, req({ order: '1466' })); await call(sheet, req({ order: '91778' })); await call(image, req({ order: '1466', wheel: 'front', view: 'all' }));
  assert.ok(shop.calls.length >= 6, `${shop.calls.length} calls`);
  for (const c of shop.calls) {
    assert.match(c.url, /^https:\/\/test-store\.myshopify\.com\/admin\/api\/[^/]+\/graphql\.json$/);
    assert.equal(c.method, 'POST');
    assert.ok(c.query === ORDER_QUERY || c.query === COMPONENT_QUERY, 'only the two read queries');
    assert.equal(/mutation|inventory|orderUpdate|metafieldsSet|note\b|email|phone|address|customer\b/i.test(c.query.replace(/customAttributes/g, '')), false, c.query);
  }
  assert.equal(shop.calls.some((c) => /resend/i.test(c.url)), false);
});

test('READ ONLY: the new source files cannot reach inventory, the order note, email or any write (they do not import or name those functions)', () => {
  const files = ['api/order-sheet.js', 'api/order-sheet-image.js', '_lib/order-sheet.js', '_lib/order-sheet-api.js', '_lib/order-sheet-image.js', '_lib/spoke-numbering.js'];
  for (const f of files) {
    const src = fs.readFileSync(path.join(root, f), 'utf8').replace(/\r\n/g, '\n');
    for (const bad of ['adjustInventory', 'inventoryAdjust', 'addNoteToOrder', 'orderUpdate', 'metafieldsSet', 'sendSystemEmail', 'sendEmailReport', 'sendCustomerEmail', 'sendPlainFailureEmail', "from 'resend'", 'api.resend.com', 'RESEND_API_KEY', 'handleOrderCreate', 'claimSystemOrder'])
      assert.equal(src.includes(bad), false, `${f} must not contain ${bad}`);
    assert.equal(/[`'"]\s*mutation\b/.test(src), false, `${f} must not hold a GraphQL mutation`);
    // the only thing the endpoints take from the webhook module is the pure Standard length calculation
    const idx = src.match(/import\s*\{([^}]*)\}\s*from\s*'\.\/index\.js'/);
    if (f.startsWith('api/')) assert.deepEqual(idx && idx[1].split(',').map((s) => s.trim()), ['runCalculationEngine'], f);
    else assert.equal(/from\s+['"][^'"]*index\.js['"]/.test(src), false, `${f} must not import the webhook`);
  }
});

/* ------------------------------------------------------------------ the image endpoint */

const isPng = (b) => Buffer.isBuffer(b) && b.length > 1000 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
const pngWidth = (b) => b.readUInt32BE(16);

test('image: #1466 front and rear, all three views, are real PNGs (default width 600), sent as image/png and never cached', async () => {
  const h = makeImageHandler({ fetchImpl: fakeShopify([order1466()]).fetchImpl, runEngine: runCalculationEngine });
  for (const wheel of ['front', 'rear']) for (const view of ['all', 'high', 'low']) {
    const res = await call(h, req({ order: '1466', wheel, view }));
    assert.equal(res.statusCode, 200, `${wheel} ${view}`); assert.equal(res.headers['content-type'], 'image/png'); assert.equal(res.headers['cache-control'], 'no-store');
    assert.ok(isPng(res.body), `${wheel} ${view}: a PNG`); assert.equal(pngWidth(res.body), 600);
  }
  const noView = await call(h, req({ order: '1466', wheel: 'rear' })); assert.equal(noView.statusCode, 200, 'view defaults to all');
});

test('image: width is clamped to 200 to 1200; bad wheel and bad view are 400; a wheel the order does not have, or a view a one-color wheel does not have, is 404', async () => {
  const solid = clone(SYSTEM_SAMPLES['solix-24h-wheelset-front-custom-rear-solid']); solid.order_number = 94000; solid.id = 6000094000;
  const frontOnly = clone(SYSTEM_SAMPLES['hydra2-front-28h-only']); frontOnly.order_number = 94001; frontOnly.id = 6000094001;
  const h = makeImageHandler({ fetchImpl: fakeShopify([order1466(), solid, frontOnly]).fetchImpl, runEngine: runCalculationEngine });
  assert.equal(pngWidth((await call(h, req({ order: '1466', wheel: 'front', view: 'all', width: '99999' }))).body), 1200);
  assert.equal(pngWidth((await call(h, req({ order: '1466', wheel: 'front', view: 'all', width: '5' }))).body), 200);
  assert.equal(pngWidth((await call(h, req({ order: '1466', wheel: 'front', view: 'all', width: 'abc' }))).body), 600);
  assert.deepEqual((await call(h, req({ order: '1466', wheel: 'middle', view: 'all' }))).body.error, 'BAD_WHEEL');
  assert.deepEqual((await call(h, req({ order: '1466', wheel: 'front', view: 'sideways' }))).body.error, 'BAD_VIEW');
  const noRear = await call(h, req({ order: '94001', wheel: 'rear', view: 'all' })); assert.deepEqual([noRear.statusCode, noRear.body.error], [404, 'NO_SUCH_IMAGE']);
  const solidAll = await call(h, req({ order: '94000', wheel: 'rear', view: 'all' })); assert.equal(solidAll.statusCode, 200);
  const solidHigh = await call(h, req({ order: '94000', wheel: 'rear', view: 'high' })); assert.deepEqual([solidHigh.statusCode, solidHigh.body.error], [404, 'NO_SUCH_IMAGE']);
  const unknown = await call(h, req({ order: '5', wheel: 'front', view: 'all' })); assert.deepEqual([unknown.statusCode, unknown.body.error], [404, 'ORDER_NOT_FOUND']);
});
