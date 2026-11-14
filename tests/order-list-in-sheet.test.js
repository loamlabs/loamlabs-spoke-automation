// ORDER-SHEET: the I9 order list inside the order sheet (`orderList`), live and saved. The list is the one the System email prints (same function), as text AND as data; Standard orders have none
// (null with a plain status, not an error); a sheet saved before this has no orderList and still loads.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildOrderSheet, ORDER_SHEET_VERSION } from '../_lib/order-sheet.js';
import { buildSystemReport } from '../_lib/system-report.js';
import { parseCartLink } from '../_lib/i9-order-list.js';
import { findSystemBuildRecipe, systemWheels } from '../_lib/system-build.js';
import { findStandardStudioRecipe } from '../_lib/standard-build.js';
import { saveOrderSheetCopy, SAVE_FLAG } from '../_lib/order-sheet-store.js';
import { makeHandler as makeSheetHandler, orderListStatusOf } from '../api/order-sheet.js';
import { runCalculationEngine } from '../api/index.js';
import { SYSTEM_SAMPLES, STANDARD_STUDIO_SAMPLES } from '../samples/index.js';
import { chartOrder } from './helpers/chart-order.mjs';
import { createFakeSupabase, SB_ENV } from './helpers/fake-supabase.mjs';
import { runWebhook, loadSample } from './helpers/webhook-harness.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const clone = (o) => JSON.parse(JSON.stringify(o));
const order1466 = () => JSON.parse(fs.readFileSync(path.join(here, 'fixtures', 'order-1466.json'), 'utf8'));
const AT = '2026-11-13T12:00:00.000Z';
const png = async () => Buffer.from('PNG');
const metaOf = (o) => (o._sample && o._sample.metafields ? new Map(Object.entries(o._sample.metafields)) : null);

/* ------------------------------------------------------------------ the shape, for #1466 */

test('#1466: orderList carries the email\'s text exactly, the plain cart link, the "order by email" text and sections A to E as data', async () => {
  const o = order1466();
  const report = await buildSystemReport({ recipe: findSystemBuildRecipe(o).recipe, orderData: o, renderPng: png });
  const s = buildOrderSheet({ orderData: o, calculatedAt: AT });
  assert.equal(s.sheetVersion, ORDER_SHEET_VERSION); assert.equal(ORDER_SHEET_VERSION, 3);
  assert.equal(s.orderListStatus, 'present'); assert.equal(s.orderListNote, null);
  const L = s.orderList;
  assert.deepEqual(Object.keys(L), ['version', 'orderNumber', 'snapshotDate', 'text', 'cartLink', 'cartLinkAdds', 'orderByEmailText', 'sections']);
  assert.deepEqual([L.version, L.orderNumber, L.snapshotDate], [1, '1466', '2026-11-08']);
  assert.equal(L.text, report.i9OrderList.text, 'the text is what the email prints, character for character');
  assert.equal(L.cartLink, 'https://b2b.industrynine.com/cart/43663812755591:9,43663812821127:8,43663819047047:9,43663819112583:8');
  assert.equal(L.cartLinkAdds, '9 x 282 mm Black, 8 x 282 mm Bronze, 9 x 284 mm Black, 8 x 284 mm Bronze (total 34 spokes, includes 2 spares)');
  assert.equal(L.orderByEmailText, 'Hi Thomas, for LoamLabs order #1466 please add System spokes: 305 mm: 8 Black, 7 Bronze; 307 mm: 8 Black, 7 Bronze. Thank you.');
  assert.deepEqual(Object.keys(L.sections), ['prebuilt', 'dealerSpokes', 'orderByEmail', 'hubs', 'rims']);
  // A
  assert.deepEqual([L.sections.prebuilt.none, L.sections.prebuilt.wheels], [true, []]);
  assert.deepEqual(L.sections.prebuilt.lines, ['A. PRE-BUILT WHEELS', '   none for this order (both wheels are two-color)']);
  // B
  const B = L.sections.dealerSpokes;
  assert.deepEqual(B.sides.map((x) => [x.position, x.side, x.lengthMm, x.baseColor]), [['rear', 'rotor', 284, 'Black'], ['rear', 'drive', 282, 'Black']]);
  assert.deepEqual(B.sides[0].entries, [{ color: 'Black', n: 8, spare: 1, qty: 9, outOfStock: false }, { color: 'Bronze', n: 8, spare: 0, qty: 8, outOfStock: false }]);
  assert.deepEqual(B.noLength, []);
  assert.equal(B.cartLink.url, L.cartLink); assert.deepEqual(B.cartLink.totals, { spokes: 34, spares: 2 });
  assert.deepEqual(B.cartLink.items.map((x) => [x.lengthMm, x.color, x.qty, x.spares]), [[282, 'Black', 9, 1], [282, 'Bronze', 8, 0], [284, 'Black', 9, 1], [284, 'Bronze', 8, 0]]);
  assert.deepEqual(parseCartLink(B.cartLink.url).map((x) => [x.variantId, x.qty]), B.cartLink.items.map((x) => [x.variantId, x.qty]), 'the items are the link');
  assert.equal(B.lines[0].startsWith('B. SPOKES on I9\'s dealer list, with spares'), true);
  // C
  const C = L.sections.orderByEmail;
  assert.equal(C.to, 'Thomas Ward'); assert.equal(C.message, L.orderByEmailText);
  assert.deepEqual(C.sides.map((x) => [x.position, x.side, x.lengthMm, x.entries.map((e) => `${e.color} ${e.qty}`).join(',')]), [['front', 'rotor', 305, 'Black 8,Bronze 7'], ['front', 'drive', 307, 'Black 8,Bronze 7']]);
  assert.ok(C.sides.every((x) => x.entries.every((e) => e.reason === 'length' && e.reasonText === null)));
  // D, E
  assert.deepEqual(L.sections.hubs.wheels.map((x) => [x.position, x.customerSupplied]), [['front', false], ['rear', false]]);
  assert.match(L.sections.hubs.wheels[1].text, /Hydra2 SYSTEM Rear Hub - 6-Bolt \(32h \/ Bronze \/ 12x148mm\), driver XD/);
  assert.deepEqual(L.sections.rims.wheels.map((x) => [x.position, x.i9Code]), [['front', 'TR303'], ['rear', 'TR305']]);
  // the sections' lines are the text, block by block
  const all = ['prebuilt', 'dealerSpokes', 'orderByEmail', 'hubs', 'rims'].flatMap((k) => L.sections[k].lines);
  assert.ok(all.every((line) => L.text.includes(line)), 'every section line is a line of the text');
  assert.deepEqual(all.filter((l) => /^[A-E]\. /.test(l)).map((l) => l[0]), ['A', 'B', 'C', 'D', 'E']);
  assert.equal(JSON.stringify(s).length < 90000, true);
  assert.deepEqual(JSON.parse(JSON.stringify(s)), s, 'plain JSON');
  // the PR 1 field is gone (version 3): its data is orderList.text / cartLink / cartLinkAdds / orderByEmailText / snapshotDate
  assert.equal('i9OrderList' in s, false); assert.equal(JSON.stringify(s).includes('i9OrderList'), false);
});

/* ------------------------------------------------------------------ the cases */

test('lengths not on the dealer list (305/307 type) go to "order by email"; with every length on the list there is no such section and no text', () => {
  const some = buildOrderSheet({ orderData: order1466(), calculatedAt: AT }).orderList;
  assert.ok(some.sections.orderByEmail.sides.length === 2 && some.orderByEmailText);
  const all = buildOrderSheet({ orderData: order1466(), calculatedAt: AT, lengthCalculator: (g) => (g.position === 'front' ? { left: 284, right: 282, sourceText: 'x', chart: { partNumber: 'TR303' } } : { left: 284, right: 282, sourceText: 'x', chart: { partNumber: 'TR305' } }) }).orderList;
  assert.deepEqual(all.sections.orderByEmail.sides, []); assert.equal(all.orderByEmailText, null); assert.equal(all.sections.orderByEmail.message, null);
  assert.match(all.text, /none: every length and color of this order is on I9's dealer list/);
  assert.equal(all.sections.dealerSpokes.sides.length, 4, 'both wheels, both sides');
  assert.equal(all.sections.dealerSpokes.cartLink.items.length, 4);
  const none = buildOrderSheet({ orderData: order1466(), calculatedAt: AT, lengthCalculator: () => ({ left: 305, right: 307, sourceText: 'x', chart: { partNumber: 'TR303' } }) }).orderList;
  assert.equal(none.cartLink, null); assert.equal(none.sections.dealerSpokes.cartLink, null); assert.deepEqual(none.sections.dealerSpokes.sides, []);
  assert.match(none.text, /no spokes of this order are on I9's dealer list \(no cart link\)/);
});

test('a one-color (pre-built wheel) case: section A names the wheel and its color; the lengths and spares are those of the wheel', () => {
  const o = chartOrder({ front: { rim: '51797703229747', holes: 28 }, rear: { rim: '51797703229747', holes: 32 }, orderNumber: 97001 });
  const s = buildOrderSheet({ orderData: o, calculatedAt: AT });
  const A = s.orderList.sections.prebuilt;
  assert.equal(A.none, false); assert.deepEqual(A.wheels.map((w) => [w.position, w.color]), [['front', 'Black'], ['rear', 'Black']]);
  assert.ok(A.lines.some((l) => /Front: ONE COLOR \(Black\): check I9 for a pre-built wheelset/.test(l)));
  assert.match(s.orderList.text, /A\. PRE-BUILT WHEELS\n   Front: ONE COLOR \(Black\)/);
  for (const side of s.orderList.sections.dealerSpokes.sides.concat(s.orderList.sections.orderByEmail.sides)) {
    assert.equal(side.entries.length, 1); assert.equal(side.entries[0].spare, 1, 'the one color is the spare color'); assert.equal(side.entries[0].qty, side.entries[0].n + 1);
  }
});

test('spares: +1 per side in the base color only; the base color and, when it is not recorded, the reason are on each side', () => {
  const s = buildOrderSheet({ orderData: order1466(), calculatedAt: AT }).orderList;
  for (const side of [...s.sections.dealerSpokes.sides, ...s.sections.orderByEmail.sides]) {
    assert.equal(side.baseColor, 'Black');
    for (const e of side.entries) assert.equal(e.spare, e.color === 'Black' ? 1 : 0);
  }
  const o = order1466(); // base color not recorded: the most common color, and the list says so
  const line = o.line_items.find((l) => (l.properties || []).some((p) => p.name === '_build')), prop = line.properties.find((p) => p.name === '_build');
  const b = JSON.parse(prop.value); delete b.system.studio.base; prop.value = JSON.stringify(b);
  const n = buildOrderSheet({ orderData: o, calculatedAt: AT }).orderList;
  assert.ok(n.sections.dealerSpokes.sides.every((x) => /base color not recorded/.test(x.baseColorNote)), JSON.stringify(n.sections.dealerSpokes.sides[0]));
});

test('a one-wheel build: one wheel in every section and the text of the email', async () => {
  const o = clone(SYSTEM_SAMPLES['hydra2-front-28h-only']);
  const s = buildOrderSheet({ orderData: o, calculatedAt: AT });
  const report = await buildSystemReport({ recipe: findSystemBuildRecipe(o).recipe, orderData: o, renderPng: png });
  assert.equal(s.orderListStatus, 'present'); assert.equal(s.orderList.text, report.i9OrderList.text);
  assert.deepEqual(s.orderList.sections.hubs.wheels.map((w) => w.position), ['front']); assert.deepEqual(s.orderList.sections.rims.wheels.map((w) => w.position), ['front']);
  assert.match(s.orderList.sections.prebuilt.lines.join('\n'), /the wheel is|ONE COLOR/);
});

test('every System sample: the text equals the email\'s list, the sections agree with it, the cart link items equal the link', async () => {
  for (const [name, sample] of Object.entries(SYSTEM_SAMPLES)) {
    const o = clone(sample), report = await buildSystemReport({ recipe: findSystemBuildRecipe(o).recipe, orderData: o, renderPng: png });
    const s = buildOrderSheet({ orderData: o, calculatedAt: AT }), L = s.orderList;
    assert.equal(s.orderListStatus, 'present', name); assert.equal(L.text, report.i9OrderList.text, name);
    assert.equal(L.cartLink, report.i9OrderList.linkUrl, name); assert.equal(L.orderByEmailText, report.i9OrderList.thomasText, name);
    if (L.cartLink) assert.deepEqual(parseCartLink(L.cartLink).map((x) => [x.variantId, x.qty]), L.sections.dealerSpokes.cartLink.items.map((x) => [x.variantId, x.qty]), name);
    assert.deepEqual(L.sections.hubs.wheels.map((w) => w.position), s.wheels.map((w) => w.position), name);
    assert.equal(L.sections.rims.wheels.length, s.wheels.length, name);
  }
});

test('Standard orders: orderList is null with the plain status "not-applicable" and a note (never an error); there is no i9OrderList field', () => {
  const keyed = clone(STANDARD_STUDIO_SAMPLES['std-nip-both-wheels-painted-both-fees']);
  const classic = loadSample('standard', 'steel-jbend-wheelset');
  for (const [o, cd] of [[keyed, metaOf(keyed)], [classic, null]]) {
    const rec = findStandardStudioRecipe(o) ? findStandardStudioRecipe(o).recipe : JSON.parse(o.line_items.flatMap((l) => l.properties || []).find((p) => p.name === '_build').value);
    const buildReport = runCalculationEngine(rec, cd || new Map(Object.entries(JSON.parse(fs.readFileSync(path.join(here, '..', 'samples', 'standard', 'mock-shopify.json'), 'utf8')).metafields)));
    const s = buildOrderSheet({ orderData: o, componentData: cd, buildReport, calculatedAt: AT });
    assert.equal(s.kind, 'standard'); assert.equal(s.orderList, null); assert.equal(s.orderListStatus, 'not-applicable'); assert.equal(s.orderListNote, 'Standard builds have no I9 order list.');
    assert.equal('i9OrderList' in s, false);
    assert.equal(s.warnings.some((w) => /order list/i.test(w)), false, 'not a warning either');
  }
});

/* ------------------------------------------------------------------ privacy of the whole sheet */

test('PRIVACY: no customer name, email, address, phone or note anywhere in the whole sheet JSON (orderList included), for #1466 and every System sample', () => {
  const PII = ['Zebulon', 'Quimby-Faraday', 'zebulon.q@private-mail.example', '+1 555 010 4242', '12 Hidden Lane Unit 9', 'Nowhereville', 'ZZ-SECRET-NOTE please leave at back door', '203.0.113.77'];
  const inject = (o) => { Object.assign(o, { email: PII[2], contact_email: PII[2], phone: PII[3], note: PII[6], browser_ip: PII[7], customer: { first_name: PII[0], last_name: PII[1], email: PII[2], phone: PII[3], default_address: { address1: PII[4], city: PII[5] } }, shipping_address: { first_name: PII[0], last_name: PII[1], address1: PII[4], city: PII[5], phone: PII[3] }, billing_address: { address1: PII[4] }, note_attributes: [{ name: 'g', value: PII[6] }] }); return o; };
  const CUSTOMER_KEYS = /^(email|phone|contact_email|customer|shipping_address|billing_address|default_address|note|note_attributes|browser_ip|first_name|last_name|address1|city|zip)$/i;
  const walk = (v, p) => { if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${p}[${i}]`)); else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { assert.equal(CUSTOMER_KEYS.test(k), false, `key ${p}.${k}`); walk(x, `${p}.${k}`); } };
  for (const [name, o] of [['1466', inject(order1466())], ...Object.entries(SYSTEM_SAMPLES).map(([n, x]) => [n, inject(clone(x))])]) {
    const s = buildOrderSheet({ orderData: o, calculatedAt: AT }), text = JSON.stringify(s);
    assert.equal(s.orderListStatus, 'present', name);
    for (const v of PII) assert.equal(text.includes(v), false, `${name}: ${v}`);
    for (const frag of ['Zebulon', 'Quimby', 'private-mail', '555 010', 'Hidden Lane', 'ZZ-SECRET', 'customer@example.com', 'Alex']) assert.equal(text.includes(frag), false, `${name}: ${frag}`);
    walk(s.orderList, `${name}.orderList`);
    assert.ok(s.orderList.text.includes(`order #${s.orderNumber}`), 'the order number is there');
  }
});

/* ------------------------------------------------------------------ the saved copy */

const SB = { ...SB_ENV, [SAVE_FLAG]: 'on' };
const sbDeps = (sb, extra = {}) => ({ env: SB, fetchImpl: sb.fetchImpl, now: () => AT, ...extra });

test('the saved copy carries orderList, as the email had it (the webhook passes its own report); a webhook run stores the list of the email it sent', async () => {
  const sb = createFakeSupabase({ now: () => new Date(AT) });
  const o = order1466(), report = await buildSystemReport({ recipe: findSystemBuildRecipe(o).recipe, orderData: o, renderPng: png });
  assert.equal((await saveOrderSheetCopy({ orderData: o, systemReport: report, images: report.images }, sbDeps(sb))).ok, true);
  const row = [...sb.rows.values()][0];
  assert.equal(row.sheet.orderList.text, report.i9OrderList.text); assert.equal(row.sheet.orderListStatus, 'present'); assert.equal(row.sheet.calculation.mode, 'as-sent');
  assert.equal(row.sheet.sheetVersion, ORDER_SHEET_VERSION); assert.equal('i9OrderList' in row.sheet, false);
  // through the real webhook: every line of the stored list is in the email that was sent
  const sb2 = createFakeSupabase(); const { createMock, loadMockShopify } = await import('./helpers/webhook-harness.mjs');
  const mock = createMock(loadMockShopify()); const inner = mock.fetch; mock.fetch = async (url, init) => (sb2.isSupabase(url) ? sb2.fetchImpl(url, init) : inner(url, init));
  const r = await runWebhook(path.resolve(here, '..', 'api', 'index.js'), 'orders/create', loadSample('system', 'hydra2-wheelset-32f-32r'), { mock, env: { ...SB } });
  assert.equal(r.status, 200); const stored = [...sb2.rows.values()][0];
  assert.equal(stored.sheet.orderListStatus, 'present');
  const esc = (x) => x.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const html = r.restEmails[0].html;
  for (const line of stored.sheet.orderList.text.split('\n').filter((l) => l && !l.includes('[Open I9 cart link]'))) assert.ok(html.includes(esc(line)), `in the email: ${line}`);
});

/* ------------------------------------------------------------------ the endpoint, with and without the new part */

const SECRET = 'sheet-secret-for-tests';
const toNode = (o) => ({ id: `gid://shopify/Order/${o.id}`, name: `#${o.order_number}`, legacyResourceId: String(o.id), createdAt: '2026-11-12T10:00:00Z', cancelledAt: null, lineItems: { nodes: o.line_items.map((li) => ({ id: `gid://shopify/LineItem/${li.id}`, title: li.title, name: li.name || li.title, variantTitle: li.variant_title || '', quantity: li.quantity, sku: '', variant: li.variant_id != null ? { legacyResourceId: String(li.variant_id) } : null, customAttributes: (li.properties || []).map((p) => ({ key: p.name, value: p.value })) })) } });
function combined(sb, orders) {
  const shopify = [];
  const fetchImpl = async (url, init) => {
    if (sb.isSupabase(url)) return sb.fetchImpl(url, init);
    const body = JSON.parse(init.body); shopify.push(body.query);
    if (/orders\(first/.test(body.query)) { const n = String(body.variables.q).replace(/^name:#/, ''); return { ok: true, status: 200, json: async () => ({ data: { orders: { nodes: orders.filter((x) => String(x.order_number) === n).map(toNode) } } }) }; }
    return { ok: true, status: 200, json: async () => ({ data: { nodes: [] } }) };
  };
  return { fetchImpl, shopify };
}
const fakeRes = () => ({ statusCode: 200, headers: {}, body: undefined, setHeader(k, v) { this.headers[k.toLowerCase()] = v; return this; }, status(c) { this.statusCode = c; return this; }, json(o) { this.body = o; return this; }, send(b) { this.body = b; return this; } });
const call = async (h, query) => { const res = fakeRes(); await h({ method: 'GET', query, headers: { 'x-order-sheet-secret': SECRET } }, res); return res; };
test.beforeEach(() => { Object.assign(process.env, SB_ENV, { ORDER_SHEET_SECRET: SECRET, SHOPIFY_ADMIN_API_TOKEN: 'shpat_test' }); delete process.env[SAVE_FLAG]; });

test('GET /api/order-sheet: live answer has orderList and orderListStatus "present"; Standard answers "not-applicable"; both keep the PR 1 / PR 2 shape', async () => {
  const std = clone(STANDARD_STUDIO_SAMPLES['std-nip-both-wheels-painted-both-fees']); std.order_number = 97100; std.id = 6000097100;
  const sb = createFakeSupabase();
  const meta = Object.fromEntries(Object.entries(std._sample.metafields));
  const c = combined(sb, [order1466(), std]);
  const fetchImpl = async (url, init) => { const r = await c.fetchImpl(url, init); const b = init && init.body ? JSON.parse(init.body) : {}; if (b.query && /getComponentMetafields/.test(b.query)) return { ok: true, status: 200, json: async () => ({ data: { nodes: b.variables.ids.map((id) => (meta[id] ? { id, metafields: { nodes: Object.entries(meta[id]).filter(([k]) => k !== '_parent_product_id').map(([key, value]) => ({ key, namespace: 'custom', value: String(value) })) }, product: { id: meta[id]._parent_product_id || 'gid://shopify/Product/x', metafields: { nodes: [] } } } : null)) } }) }; return r; };
  const h = makeSheetHandler({ fetchImpl, runEngine: runCalculationEngine });
  const live = await call(h, { order: '1466' });
  assert.equal(live.statusCode, 200); assert.equal(live.body.ok, true); assert.equal(live.body.source, 'recalculated'); assert.equal(live.body.orderListStatus, 'present');
  assert.ok(live.body.sheet.orderList && live.body.sheet.orderList.text.startsWith('I9 ORDER LIST  -  order #1466'));
  assert.ok(live.body.sheet.wheels.length === 2 && live.body.sheet.numbering && live.body.sheet.calculation, 'the earlier parts are all still there');
  const st = await call(h, { order: '97100' });
  assert.equal(st.statusCode, 200); assert.equal(st.body.sheet.kind, 'standard'); assert.equal(st.body.orderListStatus, 'not-applicable'); assert.equal(st.body.sheet.orderList, null);
});

test('GET /api/order-sheet with an OLD saved row (no orderList): it loads and answers as saved with status "not-saved"; &fresh=1 gives the recalculated list; Standard rows say "not-applicable"', async () => {
  const sb = createFakeSupabase({ now: () => new Date(AT) });
  const o = order1466();
  // an old row: the sheet as PR 1 / PR 2 saved it (version 1, no orderList, no status)
  const sheet = clone(buildOrderSheet({ orderData: o, calculatedAt: AT, mode: 'as-sent' }));
  delete sheet.orderList; delete sheet.orderListStatus; delete sheet.orderListNote; sheet.sheetVersion = 1;
  sb.rows.set('test-store|1466', { shop: 'test-store', order_number: '1466', kind: 'system', numbering_version: 1, sheet, images: [], created_at: AT, updated_at: AT, images_expire_at: '2027-11-13T12:00:00.000Z', expires_at: '2028-11-13T12:00:00.000Z' });
  const stdSheet = { sheetVersion: 1, kind: 'standard', orderNumber: '1377', wheels: [], warnings: [], calculation: { mode: 'as-sent' } };
  sb.rows.set('test-store|1377', { shop: 'test-store', order_number: '1377', kind: 'standard', numbering_version: 1, sheet: stdSheet, images: [], created_at: AT, updated_at: AT, images_expire_at: '2027-11-13T12:00:00.000Z', expires_at: '2028-11-13T12:00:00.000Z' });
  const c = combined(sb, [order1466()]);
  const h = makeSheetHandler({ fetchImpl: c.fetchImpl, runEngine: runCalculationEngine, now: () => AT, loadSaved: undefined });
  const old = await call(h, { order: '1466' });
  assert.equal(old.statusCode, 200); assert.equal(old.body.source, 'saved'); assert.equal(old.body.orderListStatus, 'not-saved');
  assert.equal('orderList' in old.body.sheet, false); assert.equal(old.body.sheet.sheetVersion, 1); assert.deepEqual(old.body.sheet.wheels, sheet.wheels, 'the old sheet is returned exactly as saved');
  assert.equal(c.shopify.length, 0, 'no Shopify call for the saved answer');
  const fresh = await call(h, { order: '1466', fresh: '1' });
  assert.equal(fresh.body.source, 'recalculated'); assert.deepEqual(fresh.body.saved, { status: 'skipped' }); assert.equal(fresh.body.orderListStatus, 'present');
  assert.match(fresh.body.sheet.calculation.text, /^recalculated on .*, may differ from what was sent$/); assert.ok(fresh.body.sheet.orderList.cartLink);
  assert.equal((await call(h, { order: '1377' })).body.orderListStatus, 'not-applicable');
  // the status helper on its own
  assert.equal(orderListStatusOf(sheet), 'not-saved'); assert.equal(orderListStatusOf(stdSheet), 'not-applicable'); assert.equal(orderListStatusOf({ kind: 'system', orderList: { text: 'x' } }), 'present'); assert.equal(orderListStatusOf(null), 'not-saved');
  for (const v of ['true', 'YES', '1']) assert.equal((await call(h, { order: '1466', fresh: v })).body.source, 'recalculated', v);
  for (const v of ['0', 'no', '', undefined]) assert.equal((await call(h, { order: '1466', fresh: v })).body.source, 'saved', String(v));
});

test('old saved rows that still carry the removed field i9OrderList (sheet versions 1 and 2) still load and are answered exactly as saved; the new sheet never writes it', async () => {
  const sb = createFakeSupabase({ now: () => new Date(AT) });
  const o = order1466();
  const fresh = clone(buildOrderSheet({ orderData: o, calculatedAt: AT, mode: 'as-sent' }));
  assert.equal('i9OrderList' in fresh, false, 'the builder no longer writes the field');
  const legacyField = { text: 'I9 ORDER LIST  -  order #1466 (old copy)', linkUrl: 'https://b2b.industrynine.com/cart/1:1', linkAdds: '1 x 280 mm Black', thomasText: 'Hi Thomas, old copy', snapshotDate: '2026-11-08' };
  // version 1 row: old field only (no orderList); version 2 row: old field and orderList
  const v1 = clone(fresh); delete v1.orderList; delete v1.orderListStatus; delete v1.orderListNote; v1.sheetVersion = 1; v1.i9OrderList = legacyField;
  const v2 = clone(fresh); v2.sheetVersion = 2; v2.i9OrderList = legacyField;
  const row = (n, sheet, ver) => sb.rows.set(`test-store|${n}`, { shop: 'test-store', order_number: String(n), kind: 'system', numbering_version: 1, sheet, images: [], created_at: AT, updated_at: AT, images_expire_at: '2027-11-13T12:00:00.000Z', expires_at: '2028-11-13T12:00:00.000Z' });
  row('1466', v1); row('1467', v2);
  const c = combined(sb, [order1466()]);
  const h = makeSheetHandler({ fetchImpl: c.fetchImpl, runEngine: runCalculationEngine, now: () => AT, loadSaved: undefined });
  const a = await call(h, { order: '1466' });
  assert.equal(a.statusCode, 200); assert.equal(a.body.source, 'saved'); assert.equal(a.body.orderListStatus, 'not-saved');
  assert.deepEqual(a.body.sheet, v1, 'the version 1 row comes back exactly as saved, old field included (the dashboard keeps its legacy card for it)');
  const b = await call(h, { order: '1467' });
  assert.equal(b.statusCode, 200); assert.equal(b.body.source, 'saved'); assert.equal(b.body.orderListStatus, 'present');
  assert.deepEqual(b.body.sheet, v2, 'the version 2 row comes back exactly as saved');
  assert.equal(c.shopify.length, 0, 'no Shopify call for saved answers');
  const f = await call(h, { order: '1466', fresh: '1' });
  assert.equal(f.body.source, 'recalculated'); assert.equal('i9OrderList' in f.body.sheet, false); assert.equal(f.body.sheet.sheetVersion, ORDER_SHEET_VERSION);
});
