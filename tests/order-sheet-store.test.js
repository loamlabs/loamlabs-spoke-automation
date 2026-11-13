// ORDER-SHEET PR 2: the saved "as sent" copy. Everything against an in-memory fake Supabase (tests/helpers/fake-supabase.mjs): save, read back, equals what the email used, delivery twice,
// failures that must not matter, privacy of what is stored, retention, the endpoints' use of the saved copy, and the webhook itself (flag off = nothing changes; failures change nothing).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { saveOrderSheetCopy, loadSavedSheet, loadSavedImage, cleanupExpired, saveEnabled, SAVE_FLAG, BUCKET } from '../_lib/order-sheet-store.js';
import { buildOrderSheet } from '../_lib/order-sheet.js';
import { buildSystemReport } from '../_lib/system-report.js';
import { buildStandardAdditions } from '../_lib/standard-report.js';
import { findSystemBuildRecipe, systemWheels } from '../_lib/system-build.js';
import { findStandardStudioRecipe } from '../_lib/standard-build.js';
import { SYSTEM_SAMPLES, STANDARD_STUDIO_SAMPLES } from '../samples/index.js';
import { runCalculationEngine } from '../api/index.js';
import { makeHandler as makeSheetHandler } from '../api/order-sheet.js';
import { makeHandler as makeImageHandler } from '../api/order-sheet-image.js';
import { createFakeSupabase, SB_ENV, MONTH_MS } from './helpers/fake-supabase.mjs';
import { runWebhook, loadSample, loadMockShopify, createMock } from './helpers/webhook-harness.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const clone = (o) => JSON.parse(JSON.stringify(o));
const order1466 = () => JSON.parse(fs.readFileSync(path.join(here, 'fixtures', 'order-1466.json'), 'utf8'));
const NOW = () => new Date('2026-11-13T09:00:00.000Z');
const ON = { ...SB_ENV, [SAVE_FLAG]: 'on' };
const png = async (svg) => Buffer.from(`PNG-STUB-${String(svg).length}-${String(svg).slice(0, 40).replace(/[^a-z0-9]/gi, '')}`);
const deps = (sb, env = ON, extra = {}) => ({ env, fetchImpl: sb.fetchImpl, now: () => NOW().toISOString(), ...extra });
const withNum = (o, n) => { const x = clone(o); x.order_number = n; x.id = 6000000000 + n; x.name = `#${n}`; return x; };

async function systemSave(order, sb, env = ON) {
  const found = findSystemBuildRecipe(order);
  const report = await buildSystemReport({ recipe: found.recipe, orderData: order, renderPng: png });
  const res = await saveOrderSheetCopy({ orderData: order, componentData: null, systemReport: report, images: report.images }, deps(sb, env));
  return { res, report };
}

/* ------------------------------------------------------------------ the switch */

test('the save is OFF by default: nothing is sent anywhere unless ORDER_SHEET_SAVE is "on" (case and spaces ignored)', async () => {
  for (const v of [undefined, '', 'off', 'OFF', 'true', '1', 'yes', 'onn', 'no']) {
    const sb = createFakeSupabase();
    const r = await saveOrderSheetCopy({ orderData: order1466(), images: [] }, deps(sb, { ...SB_ENV, ...(v === undefined ? {} : { [SAVE_FLAG]: v }) }));
    assert.deepEqual([r.ok, r.skipped], [false, 'off'], String(v)); assert.equal(sb.calls.length, 0, `${v}: no call at all`);
  }
  assert.equal(saveEnabled({ [SAVE_FLAG]: 'on' }), true); assert.equal(saveEnabled({ [SAVE_FLAG]: ' ON ' }), true); assert.equal(saveEnabled({}), false);
  assert.equal(saveEnabled({ [SAVE_FLAG]: 'on' }), true);
  // and with the real process environment: unset in the test env, so off
  assert.equal(saveEnabled(process.env), false);
});

test('without the Supabase settings the save is skipped quietly (no throw, no call)', async () => {
  const sb = createFakeSupabase();
  for (const env of [{ [SAVE_FLAG]: 'on' }, { [SAVE_FLAG]: 'on', SUPABASE_URL: 'https://x.supabase.co' }, { [SAVE_FLAG]: 'on', SUPABASE_SERVICE_ROLE_KEY: 'k', SHOPIFY_STORE_DOMAIN: 'a.myshopify.com' }]) {
    const r = await saveOrderSheetCopy({ orderData: order1466(), images: [] }, deps(sb, env));
    assert.deepEqual([r.ok, r.skipped], [false, 'not-configured']);
  }
  assert.equal(sb.calls.length, 0);
});

/* ------------------------------------------------------------------ save and read back */

test('save and read back #1466: one row, the as-sent label, the six images in the private bucket, and the same sheet comes back', async () => {
  const sb = createFakeSupabase();
  const o = order1466();
  const { res, report } = await systemSave(o, sb);
  assert.deepEqual([res.ok, res.images, res.imagesFailed], [true, 6, 0]);
  assert.equal(sb.rows.size, 1);
  const row = [...sb.rows.values()][0];
  assert.deepEqual([row.shop, row.order_number, row.kind, row.numbering_version], ['test-store', '1466', 'system', 1]);
  assert.equal(row.sheet.calculation.mode, 'as-sent'); assert.equal(row.sheet.calculation.text, 'as sent on 2026-11-13');
  assert.equal(row.images.length, 6);
  assert.deepEqual([...sb.objects.keys()].sort(), ['front-all', 'front-high', 'front-low', 'rear-all', 'rear-high', 'rear-low'].map((x) => `test-store/1466/${x}.png`));
  assert.equal(BUCKET, 'order-sheet-images');
  const back = await loadSavedSheet('1466', deps(sb));
  assert.equal(back.status, 'found'); assert.deepEqual(back.sheet, row.sheet); assert.equal(back.savedAt, row.updated_at);
  for (const im of back.images) {
    const bytes = await loadSavedImage(im.path, deps(sb));
    const original = report.images.find((i) => i.position === im.wheel && i.cid.includes(im.view === 'all' ? 'all-spokes' : (im.view === 'high' ? (im.wheel === 'front' ? 'rotor' : 'drive') : (im.wheel === 'front' ? 'drive' : 'rotor')) ));
    assert.ok(bytes && original && bytes.equals(original.png), `${im.wheel}/${im.view}: the stored picture is the one the email carried`);
  }
  assert.equal(await loadSavedImage('test-store/1466/nothing.png', deps(sb)), null);
});

test('the saved sheet IS what the email used: every System sample (lengths, counts, per-wheel numbers, warnings) and every stored picture equals the report', async () => {
  const sb = createFakeSupabase();
  let n = 90000;
  for (const [name, sample] of Object.entries(SYSTEM_SAMPLES)) {
    const o = withNum(sample, ++n);
    const { res, report } = await systemSave(o, sb);
    assert.equal(res.ok, true, name);
    const saved = (await loadSavedSheet(String(n), deps(sb))).sheet;
    for (const rw of report.wheels) {
      const w = saved.wheels.find((x) => x.position === rw.position), L = report.lengths[rw.position];
      if (L.pending) assert.equal(w.lengths.status, 'not-calculated', name); else assert.deepEqual([w.lengths.rotorMm, w.lengths.driveMm], [L.left, L.right], name);
      assert.deepEqual(w.counts, rw.counts.all.map((c) => ({ color: c.color, n: c.n })), name);
      assert.deepEqual(w.warnings, rw.warnings, name);
    }
    assert.deepEqual(saved, buildOrderSheet({ orderData: o, systemReport: report, mode: 'as-sent', calculatedAt: NOW().toISOString() }), `${name}: equals the sheet built from the report the email used`);
    const row = sb.rows.get(`test-store|${n}`);
    assert.equal(row.images.length, report.images.length, `${name}: one stored picture per email picture`);
    for (const im of row.images) assert.ok(sb.objects.get(im.path).equals(report.images.find((i) => i.position === im.wheel && i.caption === im.caption).png), `${name} ${im.wheel}/${im.view}`);
  }
});

test('a keyed Standard order: saved with its lengths from the engine and the pictures of the Standard email', async () => {
  const sb = createFakeSupabase();
  const o = withNum(STANDARD_STUDIO_SAMPLES['std-nip-both-wheels-painted-both-fees'], 91234);
  const componentData = new Map(Object.entries(o._sample.metafields)), recipe = findStandardStudioRecipe(o).recipe;
  const buildReport = runCalculationEngine(recipe, componentData);
  const extra = await buildStandardAdditions({ recipe, orderData: o, componentData, buildReport, renderPng: png });
  const res = await saveOrderSheetCopy({ orderData: o, componentData, buildReport, images: extra.images }, deps(sb));
  assert.equal(res.ok, true);
  const saved = (await loadSavedSheet('91234', deps(sb))).sheet;
  assert.equal(saved.kind, 'standard'); assert.equal(saved.calculation.mode, 'as-sent');
  for (const w of saved.wheels) assert.deepEqual([w.lengths.rotorMm, w.lengths.driveMm], [Number(buildReport[w.position].lengths.left.rounded), Number(buildReport[w.position].lengths.right.rounded)]);
  assert.equal(sb.rows.get('test-store|91234').images.length, extra.images.length);
});

test('delivery twice: one row, the same pictures overwritten, no error, the creation date kept and the expiry restarted', async () => {
  let t = NOW();
  const sb = createFakeSupabase({ now: () => t });
  const o = order1466();
  const first = await systemSave(o, sb);
  const row1 = clone([...sb.rows.values()][0]); const objects1 = [...sb.objects.keys()].sort();
  t = new Date(+t + 60000);
  const second = await systemSave(o, sb);
  assert.equal(first.res.ok && second.res.ok, true);
  assert.equal(sb.rows.size, 1, 'no duplicate row'); assert.deepEqual([...sb.objects.keys()].sort(), objects1, 'no duplicate pictures');
  const row2 = [...sb.rows.values()][0];
  assert.equal(row2.created_at, row1.created_at); assert.ok(row2.updated_at > row1.updated_at && row2.expires_at > row1.expires_at);
  assert.deepEqual(row2.sheet.wheels, row1.sheet.wheels);
});

/* ------------------------------------------------------------------ failures must not matter */

test('a failing or slow Supabase never throws and returns quickly; a failing picture upload still saves the row (without that picture)', async () => {
  const o = order1466();
  for (const fail of [{ 'rpc/save_order_sheet': 500 }, { 'rpc/save_order_sheet': 'network' }, { '/storage/v1/object': 'network' }]) {
    const sb = createFakeSupabase({ fail });
    const t0 = Date.now(); const { res } = await systemSave(o, sb);
    assert.ok(Date.now() - t0 < 3000);
    if ('rpc/save_order_sheet' in fail) { assert.equal(res.ok, false, JSON.stringify(fail)); assert.equal(sb.rows.size, 0); }
    else { assert.equal(res.ok, true); assert.equal(res.images, 0); assert.equal(res.imagesFailed, 6); assert.deepEqual([...sb.rows.values()][0].images, []); }
  }
  const slow = createFakeSupabase({ hangOn: ['rpc/save_order_sheet'] });
  const t0 = Date.now();
  const found = findSystemBuildRecipe(o); const report = await buildSystemReport({ recipe: found.recipe, orderData: o, renderPng: png });
  const r = await saveOrderSheetCopy({ orderData: o, systemReport: report, images: report.images }, deps(slow, ON, { callTimeoutMs: 60, budgetMs: 400 }));
  assert.equal(r.ok, false); assert.ok(Date.now() - t0 < 2500, `${Date.now() - t0} ms`);
  // an order that cannot be saved at all (cancelled, no number, no build) is reported, not thrown
  for (const bad of [{ ...order1466(), cancelled_at: '2026-11-13T00:00:00Z' }, { line_items: [] }, undefined]) assert.equal((await saveOrderSheetCopy({ orderData: bad, images: [] }, deps(createFakeSupabase()))).ok, false);
});

/* ------------------------------------------------------------------ privacy of what is stored */

test('PRIVACY: what is sent to the database and to the bucket has no customer name, email, address, phone or note (every sample, #1466), and only the six parameters', async () => {
  const PII = { first: 'Zebulon', last: 'Quimby-Faraday', email: 'zebulon.q@private-mail.example', phone: '+1 555 010 4242', addr: '12 Hidden Lane Unit 9', city: 'Nowhereville', note: 'ZZ-SECRET-NOTE please leave at back door' };
  const inject = (o) => { Object.assign(o, { email: PII.email, contact_email: PII.email, phone: PII.phone, note: PII.note, browser_ip: '203.0.113.77', customer: { id: 4242, first_name: PII.first, last_name: PII.last, email: PII.email, phone: PII.phone, default_address: { address1: PII.addr, city: PII.city } }, shipping_address: { first_name: PII.first, last_name: PII.last, address1: PII.addr, city: PII.city, phone: PII.phone }, billing_address: { first_name: PII.first, address1: PII.addr }, note_attributes: [{ name: 'g', value: PII.note }] }); return o; };
  const sb = createFakeSupabase();
  const orders = [inject(withNum(order1466(), 95000)), ...Object.entries(SYSTEM_SAMPLES).map(([, s], i) => inject(withNum(s, 95001 + i)))];
  for (const o of orders) await systemSave(o, sb);
  const std = inject(withNum(STANDARD_STUDIO_SAMPLES['std-nip-both-wheels-painted-both-fees'], 95500));
  const cd = new Map(Object.entries(std._sample.metafields)), rec = findStandardStudioRecipe(std).recipe, br = runCalculationEngine(rec, cd);
  await saveOrderSheetCopy({ orderData: std, componentData: cd, buildReport: br, images: [] }, deps(sb));
  assert.ok(sb.rows.size >= 13);
  const sent = sb.calls.filter((c) => c.path === '/rest/v1/rpc/save_order_sheet');
  assert.equal(sent.length, sb.rows.size);
  for (const c of sent) {
    assert.deepEqual(Object.keys(JSON.parse(c.body)).sort(), ['p_images', 'p_kind', 'p_numbering_version', 'p_order_number', 'p_sheet', 'p_shop']);
    for (const v of Object.values(PII)) assert.equal(c.body.includes(v), false, `the row body must not hold "${v}"`);
    for (const frag of ['Zebulon', 'Quimby', 'private-mail', '555 010', 'Hidden Lane', 'Nowhereville', 'ZZ-SECRET', '203.0.113.77']) assert.equal(c.body.includes(frag), false, frag);
  }
  for (const c of sb.calls.filter((x) => x.path.startsWith('/storage/'))) assert.equal(/Zebulon|private-mail|555 010/.test(String(c.path)), false, 'no personal data in a file name either');
  const CUSTOMER_KEYS = /^(email|phone|contact_email|customer|shipping_address|billing_address|default_address|note|note_attributes|browser_ip|first_name|last_name|address1|address2|city|zip|province)$/i;
  const walk = (v, p) => { if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${p}[${i}]`)); else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { assert.equal(CUSTOMER_KEYS.test(k), false, `key ${p}.${k} in a stored row looks like a customer field`); walk(x, `${p}.${k}`); } };
  for (const r of sb.rows.values()) walk(r, 'row');
});

/* ------------------------------------------------------------------ the SQL and the retention */

test('the SQL: private bucket, row level security on with no policies, 12 / 24 month expiry on every row, one row per order, no customer columns', () => {
  const sql = fs.readFileSync(path.join(root, 'sql', 'order_sheets.sql'), 'utf8').replace(/\r\n/g, '\n');
  assert.match(sql, /alter table public\.order_sheets enable row level security/i);
  assert.equal(/create policy/i.test(sql), false, 'no policy: only the service role reads or writes');
  assert.match(sql, /values \('order-sheet-images', 'order-sheet-images', false\)/, 'the bucket is private');
  assert.match(sql, /images_expire_at\s+timestamptz not null default \(now\(\) \+ interval '12 months'\)/); assert.match(sql, /expires_at\s+timestamptz not null default \(now\(\) \+ interval '24 months'\)/);
  assert.match(sql, /unique \(shop, order_number\)/); assert.match(sql, /on conflict \(shop, order_number\) do update/);
  const table = sql.slice(sql.indexOf('create table'), sql.indexOf(');', sql.indexOf('create table')));
  assert.equal(/email|phone|address|first_name|last_name|customer|\bnote\b/i.test(table.replace(/--.*$/gm, '')), false, 'no customer column');
  assert.match(sql, /grant execute on function public\.save_order_sheet[^;]+to service_role/);
});

test('retention: expired images are deleted from the bucket (the row keeps its sheet), expired rows are deleted with their images, a dry run deletes nothing, fresh rows are untouched', async () => {
  let t = NOW();
  const sb = createFakeSupabase({ now: () => t });
  for (const n of [1, 2, 3]) await systemSave(withNum(order1466(), 70000 + n), sb);
  const keep = [...sb.objects.keys()].length;
  assert.equal(keep, 18);
  // 13 months later: images expired, rows still valid. A fourth order is saved then (fresh).
  t = new Date(+NOW() + 13 * MONTH_MS);
  await systemSave(withNum(order1466(), 70004), sb);
  const d = deps(sb, ON, { now: () => t.toISOString() });
  const dry = await cleanupExpired({ apply: false }, d);
  assert.deepEqual([dry.dryRun, dry.rowsWithExpiredImages, dry.rowsExpired, dry.imagesDeleted, dry.rowsDeleted], [true, 3, 0, 0, 0]);
  assert.equal(sb.objects.size, 24);
  const done = await cleanupExpired({ apply: true }, d);
  assert.deepEqual([done.imagesDeleted, done.rowsDeleted], [18, 0]);
  assert.equal(sb.objects.size, 6, 'only the fresh order keeps its pictures');
  assert.equal(sb.rows.size, 4, 'the sheets are still there');
  assert.equal((await loadSavedSheet('70001', d)).status, 'found'); assert.deepEqual((await loadSavedSheet('70001', d)).images, []);
  // 25 months after the first saves: those rows expire
  t = new Date(+NOW() + 25 * MONTH_MS);
  const d2 = deps(sb, ON, { now: () => t.toISOString() });
  assert.equal((await loadSavedSheet('70001', d2)).status, 'none', 'an expired row is not served even before the cleanup ran');
  const done2 = await cleanupExpired({ apply: true }, d2);
  assert.equal(done2.rowsDeleted, 3); assert.equal(sb.rows.size, 1, 'the order saved at 13 months is still valid'); assert.equal(sb.objects.size, 6, 'and keeps its pictures (they expire at 25 months exactly, not before)');
  await assert.rejects(cleanupExpired({ apply: true }, { env: {}, fetchImpl: sb.fetchImpl }), /must be set/);
});

/* ------------------------------------------------------------------ the endpoints with a saved copy */

const SECRET = 'sheet-secret-for-tests';
function toNode(o) { return { id: `gid://shopify/Order/${o.id}`, name: `#${o.order_number}`, legacyResourceId: String(o.id), createdAt: '2026-11-12T10:00:00Z', cancelledAt: null, lineItems: { nodes: o.line_items.map((li) => ({ id: `gid://shopify/LineItem/${li.id}`, title: li.title, name: li.name || li.title, variantTitle: li.variant_title || '', quantity: li.quantity, sku: '', variant: li.variant_id != null ? { legacyResourceId: String(li.variant_id) } : null, customAttributes: (li.properties || []).map((p) => ({ key: p.name, value: p.value })) })) } }; }
// one fetch for both: Supabase goes to the fake database, Shopify to a recorder with the orders given
function combined(sb, orders) {
  const shopify = [];
  const fetchImpl = async (url, init) => {
    if (sb.isSupabase(url)) return sb.fetchImpl(url, init);
    const body = JSON.parse(init.body); shopify.push(body.query);
    if (/orders\(first/.test(body.query)) { const n = String(body.variables.q).replace(/^name:#/, ''); return { ok: true, status: 200, json: async () => ({ data: { orders: { nodes: orders.filter((o) => String(o.order_number) === n).map(toNode) } } }) }; }
    return { ok: true, status: 200, json: async () => ({ data: { nodes: [] } }) };
  };
  return { fetchImpl, shopify };
}
const fakeRes = () => ({ statusCode: 200, headers: {}, body: undefined, setHeader(k, v) { this.headers[k.toLowerCase()] = v; return this; }, status(c) { this.statusCode = c; return this; }, json(o) { this.body = o; return this; }, send(b) { this.body = b; return this; } });
const call = async (h, query) => { const res = fakeRes(); await h({ method: 'GET', query, headers: { 'x-order-sheet-secret': SECRET } }, res); return res; };
const isPng = (b) => Buffer.isBuffer(b) && b.length > 8;
test.beforeEach(() => { Object.assign(process.env, SB_ENV, { ORDER_SHEET_SECRET: SECRET, SHOPIFY_ADMIN_API_TOKEN: 'shpat_test' }); delete process.env[SAVE_FLAG]; });

test('endpoint: an order WITH a saved copy is answered from it (source "saved", as sent, savedAt) with NO Shopify call; an order without one falls back to the labelled recalculated sheet', async () => {
  const sb = createFakeSupabase({ now: NOW });
  await systemSave(order1466(), sb);
  const c = combined(sb, [order1466(), withNum(order1466(), 1467)]);
  const h = makeSheetHandler({ fetchImpl: c.fetchImpl, runEngine: runCalculationEngine });
  const saved = await call(h, { order: '1466' });
  assert.equal(saved.statusCode, 200); assert.equal(saved.body.source, 'saved'); assert.equal(saved.body.sheet.calculation.mode, 'as-sent'); assert.equal(saved.body.savedAt, NOW().toISOString());
  assert.equal(c.shopify.length, 0, 'the saved copy needs no Shopify call (it works while Shopify is down)');
  const fresh = await call(h, { order: '1467' });
  assert.equal(fresh.statusCode, 200); assert.equal(fresh.body.source, 'recalculated'); assert.deepEqual(fresh.body.saved, { status: 'none' });
  assert.equal(fresh.body.sheet.calculation.mode, 'recalculated'); assert.match(fresh.body.sheet.calculation.text, /^recalculated on .*, may differ from what was sent$/);
  assert.ok(c.shopify.length >= 1);
});

test('endpoint: the sheet from the saved copy equals the recalculated one (same data), and Supabase trouble falls back to recalculating (with the reason)', async () => {
  const sb = createFakeSupabase({ now: NOW });
  await systemSave(order1466(), sb);
  const c = combined(sb, [order1466()]);
  const saved = (await call(makeSheetHandler({ fetchImpl: c.fetchImpl, runEngine: runCalculationEngine }), { order: '1466' })).body.sheet;
  const down = createFakeSupabase({ fail: { '/rest/v1/order_sheets': 500 } });
  const c2 = combined(down, [order1466()]);
  const r = await call(makeSheetHandler({ fetchImpl: c2.fetchImpl, runEngine: runCalculationEngine }), { order: '1466' });
  assert.equal(r.statusCode, 200); assert.equal(r.body.source, 'recalculated'); assert.equal(r.body.saved.status, 'error');
  assert.deepEqual(r.body.sheet.wheels, saved.wheels, 'today the recalculation equals what was sent');
  // Supabase not set up at all: the same fallback, status not-configured
  const saveEnv = { url: process.env.SUPABASE_URL }; delete process.env.SUPABASE_URL;
  try { const r2 = await call(makeSheetHandler({ fetchImpl: c2.fetchImpl, runEngine: runCalculationEngine }), { order: '1466' }); assert.equal(r2.body.saved.status, 'not-configured'); assert.equal(r2.body.source, 'recalculated'); }
  finally { process.env.SUPABASE_URL = saveEnv.url; }
});

test('endpoint: a year later: the stored picture is served as sent; after the pictures expired (12 months) the same picture is redrawn from the saved sheet; Shopify is never called', async () => {
  let t = NOW();
  const sb = createFakeSupabase({ now: () => t });
  const { report } = await systemSave(order1466(), sb);
  const c = combined(sb, []);
  const mk = () => makeImageHandler({ fetchImpl: c.fetchImpl, runEngine: runCalculationEngine, now: () => t.toISOString() });
  const stored = await call(mk(), { order: '1466', wheel: 'front', view: 'all' });
  assert.equal(stored.statusCode, 200); assert.equal(stored.headers['x-order-sheet-source'], 'saved'); assert.equal(stored.headers['content-type'], 'image/png');
  assert.ok(stored.body.equals(report.images.find((i) => i.cid === 'front-all-spokes').png), 'the picture exactly as the email had it');
  // 13 months later the cleanup removes the pictures; the sheet stays
  t = new Date(+NOW() + 13 * MONTH_MS);
  const d = deps(sb, ON, { now: () => t.toISOString() });
  await cleanupExpired({ apply: true }, d);
  assert.equal(sb.objects.size, 0);
  process.env.SHOPIFY_STORE_DOMAIN = SB_ENV.SHOPIFY_STORE_DOMAIN;
  const sheetCall = await call(makeSheetHandler({ fetchImpl: c.fetchImpl, runEngine: runCalculationEngine, now: () => t.toISOString() }), { order: '1466' });
  assert.equal(sheetCall.body.source, 'saved', 'the sheet is still there a year later');
  const redrawn = await call(makeImageHandler({ fetchImpl: c.fetchImpl, runEngine: runCalculationEngine, now: () => t.toISOString() }), { order: '1466', wheel: 'front', view: 'all' });
  assert.equal(redrawn.statusCode, 200); assert.equal(redrawn.headers['x-order-sheet-source'], 'saved-redrawn'); assert.ok(isPng(redrawn.body));
  assert.equal(redrawn.body.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), true, 'a real PNG');
  assert.equal(c.shopify.length, 0, 'no Shopify call for any of it');
  // a width asked for is drawn, not served from the stored 600 px picture; a view the wheel does not have is 404
  const big = await call(mk(), { order: '1466', wheel: 'rear', view: 'low', width: '900' }); assert.equal(big.statusCode, 200);
  const bad = await call(mk(), { order: '1466', wheel: 'middle', view: 'all' }); assert.equal(bad.statusCode, 400);
});

test('endpoint: the endpoints can only READ the saved copy (they import the readers, never the save or the cleanup)', () => {
  for (const f of ['api/order-sheet.js', 'api/order-sheet-image.js']) {
    const src = fs.readFileSync(path.join(root, f), 'utf8');
    const m = src.match(/import\s*\{([^}]*)\}\s*from\s*'\.\.\/_lib\/order-sheet-store\.js'/);
    assert.ok(m, f); const names = m[1].split(',').map((s) => s.trim()).sort();
    assert.deepEqual(names, f.endsWith('image.js') ? ['loadSavedImage', 'loadSavedSheet'] : ['loadSavedSheet'], f);
  }
});

/* ------------------------------------------------------------------ the webhook itself */

const STORE_EVENTS = (mock, sb) => { const events = []; const inner = mock.fetch; mock.fetch = async (url, init) => { const u = String(url); if (sb.isSupabase(u)) { events.push('supabase'); return sb.fetchImpl(u, init); } if (u.includes('api.resend.com')) events.push('email'); else if (init && init.body && /orderUpdate/.test(String(init.body))) events.push('note'); return inner(url, init); }; return events; };
const INDEX = path.resolve(root, 'api', 'index.js');
const SYSTEM = 'hydra2-wheelset-32f-32r';

test('webhook, flag OFF (the default): Supabase is never called and the order, note and emails are exactly what they were', async () => {
  const sb = createFakeSupabase(); const mock = createMock(loadMockShopify()); const events = STORE_EVENTS(mock, sb);
  const r = await runWebhook(INDEX, 'orders/create', loadSample('system', SYSTEM), { mock, env: { ...SB_ENV } });
  assert.equal(r.status, 200); assert.equal(sb.calls.length, 0); assert.equal(events.includes('supabase'), false);
  assert.equal(r.notes.length, 1); assert.ok(r.restEmails.length >= 1);
});

test('webhook, flag ON: the copy is saved AFTER the note and the emails; the note and the emails are identical to a flag-off run; a repeated delivery makes no second row', async () => {
  const order = loadSample('system', SYSTEM);
  const off = await runWebhook(INDEX, 'orders/create', clone(order), { env: { ...SB_ENV } });
  const sb = createFakeSupabase(); const mock = createMock(loadMockShopify()); const events = STORE_EVENTS(mock, sb);
  const on = await runWebhook(INDEX, 'orders/create', clone(order), { mock, env: { ...ON } });
  assert.equal(on.status, 200); assert.equal(on.background, true, 'the work after the answer');
  assert.deepEqual(on.notes, off.notes, 'the order note is identical'); assert.deepEqual(on.restEmails.map((e) => [e.subject, e.html]), off.restEmails.map((e) => [e.subject, e.html]), 'the emails are identical');
  assert.equal(sb.rows.size, 1);
  const firstSb = events.indexOf('supabase'), lastOther = Math.max(events.lastIndexOf('note'), events.lastIndexOf('email'));
  assert.ok(firstSb > lastOther && lastOther >= 0, `order of events: ${events.join(',')}`);
  const row = [...sb.rows.values()][0];
  assert.equal(row.sheet.calculation.mode, 'as-sent'); assert.ok(row.images.length > 0); assert.equal(row.images.length, (on.restEmails[0].attachments || []).length, 'one stored picture for every picture the email carried');
  // the delivery arrives again (Shopify can deliver twice): still one row
  const again = await runWebhook(INDEX, 'orders/create', clone(order), { mock, env: { ...ON }, keepDedupe: false });
  assert.equal(again.status, 200); assert.equal(sb.rows.size, 1);
});

test('webhook, flag ON, Supabase failing (500, network down, hanging): still 200, and the note and the emails are identical to a flag-off run; the failure is only a warning in the log', async () => {
  const order = loadSample('system', SYSTEM);
  const off = await runWebhook(INDEX, 'orders/create', clone(order), { env: { ...SB_ENV } });
  for (const [label, sbOpts] of [['500', { fail: { '/rest/v1/rpc': 500, '/storage/v1': 500 } }], ['network', { fail: { '/rest/v1/rpc': 'network', '/storage/v1': 'network' } }], ['hang', { hangOn: ['/rest/v1/rpc', '/storage/v1'] }]]) {
    const sb = createFakeSupabase(sbOpts); const mock = createMock(loadMockShopify()); STORE_EVENTS(mock, sb);
    const t0 = Date.now();
    const on = await runWebhook(INDEX, 'orders/create', clone(order), { mock, env: { ...ON, ORDER_SHEET_STORE_TIMEOUT_MS: '80', ORDER_SHEET_SAVE_BUDGET_MS: '600' } });
    assert.equal(on.status, 200, label); assert.ok(Date.now() - t0 < 12000, `${label}: ${Date.now() - t0} ms`);
    assert.deepEqual(on.notes, off.notes, label); assert.deepEqual(on.restEmails.map((e) => [e.subject, e.html]), off.restEmails.map((e) => [e.subject, e.html]), label);
    assert.equal(sb.rows.size, 0, label);
    assert.equal(on.logs.some(([lvl, m]) => lvl === 'error' && /🚨.*ORDER-SHEET|ORDER-SHEET.*🚨/.test(m)), false, `${label}: only a warning`);
    assert.ok(on.logs.some(([lvl, m]) => lvl === 'warn' && /ORDER-SHEET/.test(m)), `${label}: the failure is logged as a warning`);
  }
});

test('webhook, flag ON, a Standard order: saved after its inventory, note and emails; inventory and note identical to a flag-off run', async () => {
  const order = loadSample('standard', 'std-nip-both-wheels-painted-both-fees');
  const mockFor = () => createMock({ ...loadMockShopify(), metafields: { ...loadMockShopify().metafields, ...order._sample.metafields } });
  const off = await runWebhook(INDEX, 'orders/create', clone(order), { mock: mockFor(), env: { ...SB_ENV } });
  const sb = createFakeSupabase(); const mock = mockFor(); const events = STORE_EVENTS(mock, sb);
  const on = await runWebhook(INDEX, 'orders/create', clone(order), { mock, env: { ...ON } });
  assert.equal(on.status, 200);
  assert.deepEqual(on.inventoryAdjustments, off.inventoryAdjustments); assert.deepEqual(on.notes, off.notes);
  assert.equal(sb.rows.size, 1); assert.equal([...sb.rows.values()][0].kind, 'standard');
  assert.ok(events.indexOf('supabase') > Math.max(events.lastIndexOf('note'), events.lastIndexOf('email')), events.join(','));
});
