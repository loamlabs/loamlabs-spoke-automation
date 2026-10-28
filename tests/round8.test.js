// Round 8: the webhook is answered first; the images, the order note and the emails run after the answer (Vercel waitUntil).
// The harness (helpers/webhook-harness.mjs) offers a waitUntil like Vercel's and returns after the answer AND the background work, with the time of each
// (replyMs, doneMs) and a snapshot of what had happened when the answer was sent (atReply).
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runWebhook, loadSample, createMock, loadMockShopify } from './helpers/webhook-harness.mjs';

const INDEX = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'api', 'index.js');
const SYSTEM = 'hydra2-wheelset-32f-32r';
const STANDARD_KEYED = 'std-berd-rear-custom-two-painted';
const STANDARD_UNKEYED = 'steel-jbend-wheelset';
const isResend = (url) => String(url).includes('api.resend.com');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const quiet = { env: { SYSTEM_CUSTOMER_EMAIL: 'on' } };

// every Shopify and Resend REST call waits ms first (a slow network)
function slow(mock, ms) {
  const inner = mock.fetch;
  mock.fetch = async (url, init) => { await sleep(ms); return inner(url, init); };
  return mock;
}
// no promise may end up unhandled during a test
function watchUnhandled() {
  const seen = [];
  const on = (e) => seen.push(e);
  process.on('unhandledRejection', on);
  return { seen, stop: () => process.off('unhandledRejection', on) };
}

/* ------------------------------------------------------------------ the answer comes first */

test('System order: the answer is sent before the (slow) note write and emails; they all happen afterwards', async () => {
  const mock = slow(createMock(loadMockShopify()), 120);
  const r = await runWebhook(INDEX, 'orders/create', loadSample('system', SYSTEM), { mock, ...quiet });
  assert.equal(r.status, 200); assert.equal(r.background, true);
  assert.deepEqual(r.atReply, { restEmails: 0, sdkEmails: 0, notes: 0, inventoryAdjustments: 0 }, 'at the answer: no note, no email yet');
  assert.ok(r.replyMs < 100, `answered in ${r.replyMs.toFixed(0)} ms, before any 120 ms call could finish`);
  assert.ok(r.doneMs > r.replyMs + 300, `the work ended much later (${r.doneMs.toFixed(0)} ms)`);
  assert.equal(r.notes.length, 1, 'the note was written afterwards'); assert.equal(r.restEmails.length, 2, 'internal + customer email sent afterwards');
});

test('keyed Standard order: inventory is done BEFORE the answer; the images, note and emails come AFTER it', async () => {
  const mock = slow(createMock(loadMockShopify()), 120);
  const r = await runWebhook(INDEX, 'orders/create', loadSample('standard', STANDARD_KEYED), { mock, ...quiet, sdkDelayMs: 200 });
  assert.equal(r.status, 200);
  assert.ok(r.inventoryAdjustments.length > 0, 'the sample deducts inventory');
  assert.equal(r.atReply.inventoryAdjustments, r.inventoryAdjustments.length, 'every inventory adjustment was made before the answer');
  assert.equal(r.atReply.notes, 0, 'the note is not written yet'); assert.equal(r.atReply.restEmails + r.atReply.sdkEmails, 0, 'no email yet');
  assert.ok(r.doneMs > r.replyMs + 300);
  assert.equal(r.notes.length, 1); assert.equal(r.emails.filter((e) => /^Spoke Calculation Complete/.test(e.subject)).length, 1);
  assert.equal(r.emails.filter((e) => /^Your custom spoke colors/.test(e.subject)).length, 1);
});

test('unkeyed Standard order: inventory before the answer; the note and the email after it (nothing else changed)', async () => {
  const mock = slow(createMock(loadMockShopify()), 100);
  const r = await runWebhook(INDEX, 'orders/create', loadSample('standard', STANDARD_UNKEYED), { mock, sdkDelayMs: 200 });
  assert.equal(r.status, 200);
  assert.ok(r.inventoryAdjustments.length > 0);
  assert.equal(r.atReply.inventoryAdjustments, r.inventoryAdjustments.length);
  assert.equal(r.atReply.notes, 0); assert.equal(r.atReply.sdkEmails, 0);
  assert.equal(r.notes.length, 1); assert.equal(r.sdkEmails.length, 1);
  assert.equal(r.emails.filter((e) => /^Your custom spoke colors/.test(e.subject)).length, 0, 'an unkeyed order never emails the customer');
});

test('an order with no custom wheel build: answered 200, no background work, nothing sent', async () => {
  const order = { id: 5551, admin_graphql_api_id: 'gid://shopify/Order/5551', order_number: 5551, email: 'c@d.co', line_items: [{ id: 1, title: 'Valve stems', quantity: 1, properties: [] }] };
  const r = await runWebhook(INDEX, 'orders/create', order, quiet);
  assert.equal(r.status, 200); assert.equal(r.emails.length, 0); assert.equal(r.notes.length, 0); assert.equal(r.inventoryAdjustments.length, 0);
});

test('no waitUntil available (not on Vercel): the work is done first and the answer comes after it, as before round 8', async () => {
  const mock = slow(createMock(loadMockShopify()), 100);
  const r = await runWebhook(INDEX, 'orders/create', loadSample('system', SYSTEM), { mock, background: false, ...quiet });
  assert.equal(r.status, 200); assert.equal(r.background, false);
  assert.equal(r.atReply.restEmails, 2); assert.equal(r.atReply.notes, 1, 'everything was done when the answer went out');
});

/* ------------------------------------------------------------------ a failing background step still sends the plain internal email */

test('System order: the report email fails (images and text-only): the plain failure email goes out, with the order number and the raw line items; 200; nothing unhandled', async () => {
  const w = watchUnhandled();
  try {
    const order = loadSample('system', SYSTEM);
    const mock = createMock(loadMockShopify()); const inner = mock.fetch; let n = 0;
    mock.fetch = async (url, init) => (isResend(url) && n++ < 2 ? { ok: false, status: 500, json: async () => ({ message: 'down' }) } : inner(url, init));
    const r = await runWebhook(INDEX, 'orders/create', order, { mock });
    assert.equal(r.status, 200);
    assert.equal(r.restEmails.length, 1, 'exactly one email: the plain one');
    const e = r.restEmails[0];
    assert.ok(/REPORT FAILED/.test(e.subject) && e.subject.includes(`#${order.order_number}`), e.subject);
    for (const li of order.line_items) assert.ok(e.html.includes(String(li.title).replace(/&/g, '&amp;')));
    assert.ok(r.logs.some(([lvl, m]) => lvl === 'error' && m.includes(`#${order.order_number}`) && /failed to send the report email/.test(m)), 'a log line names the order');
    await sleep(20);
  } finally { w.stop(); }
  assert.deepEqual(w.seen, []);
});

test('keyed Standard order: the normal email fails everywhere (images, text-only, SDK): the plain failure email goes out; the note and inventory are untouched by it; 200', async () => {
  const w = watchUnhandled();
  try {
    const order = loadSample('standard', STANDARD_KEYED);
    const mock = createMock(loadMockShopify()); const inner = mock.fetch; let n = 0;
    mock.fetch = async (url, init) => (isResend(url) && n++ < 2 ? { ok: false, status: 500, json: async () => ({ message: 'down' }) } : inner(url, init));
    const r = await runWebhook(INDEX, 'orders/create', order, { mock, sdkError: 'sdk down' });
    assert.equal(r.status, 200);
    assert.equal(r.sdkEmails.length, 0);
    assert.equal(r.restEmails.length, 1);
    assert.ok(/REPORT FAILED/.test(r.restEmails[0].subject) && r.restEmails[0].subject.includes(`#${order.order_number}`), r.restEmails[0].subject);
    assert.ok(r.restEmails[0].html.includes('_build'), 'the raw properties are listed');
    assert.ok(r.inventoryAdjustments.length > 0 && r.notes.length === 1, 'inventory and note were done as usual');
    assert.ok(r.logs.some(([lvl, m]) => lvl === 'error' && m.includes(`#${order.order_number}`)), 'a log line names the order');
  } finally { w.stop(); }
  assert.deepEqual(w.seen, []);
});

test('unkeyed Standard order: the email fails (SDK): the plain failure email goes out', async () => {
  const order = loadSample('standard', STANDARD_UNKEYED);
  const r = await runWebhook(INDEX, 'orders/create', order, { sdkError: 'sdk down' });
  assert.equal(r.status, 200);
  assert.equal(r.restEmails.length, 1);
  assert.ok(/REPORT FAILED/.test(r.restEmails[0].subject) && r.restEmails[0].subject.includes(`#${order.order_number}`));
});

test('System report throws (simulated): the plain failure email goes out after the answer, 200, no note, nothing unhandled', async () => {
  const w = watchUnhandled();
  try {
    const order = loadSample('system', SYSTEM);
    const r = await runWebhook(INDEX, 'orders/create', order, { query: 'breakSystemReport=1', ...quiet });
    assert.equal(r.status, 200); assert.equal(r.atReply.restEmails, 0, 'the answer came first');
    assert.equal(r.restEmails.length, 1); assert.ok(/REPORT FAILED/.test(r.restEmails[0].subject)); assert.equal(r.notes.length, 0);
  } finally { w.stop(); }
  assert.deepEqual(w.seen, []);
});

test('everything fails (all Resend calls, all Shopify note calls): 200, no crash, no unhandled rejection, the order number in the log', async () => {
  const w = watchUnhandled();
  try {
    for (const [kind, name] of [['system', SYSTEM], ['standard', STANDARD_KEYED], ['standard', STANDARD_UNKEYED]]) {
      const order = loadSample(kind, name);
      const mock = createMock(loadMockShopify()); const inner = mock.fetch;
      mock.fetch = async (url, init) => (isResend(url) ? { ok: false, status: 500, json: async () => ({ message: 'down' }) } : /orderUpdate/.test(String(init && init.body)) ? { ok: false, status: 500, json: async () => ({}) } : inner(url, init));
      const r = await runWebhook(INDEX, 'orders/create', order, { mock, sdkError: 'sdk down', ...quiet });
      assert.equal(r.status, 200, name);
      assert.ok(r.logs.some(([lvl, m]) => lvl === 'error' && m.includes(`#${order.order_number}`) && /plain failure email failed too/.test(m)), `${name}: the log says nobody was told, with the order number`);
    }
    await sleep(20);
  } finally { w.stop(); }
  assert.deepEqual(w.seen, []);
});

/* ------------------------------------------------------------------ duplicate deliveries */

test('duplicate delivery of a System order: the second call answers at once and does no work at all', async () => {
  const order = loadSample('system', SYSTEM);
  const mock = slow(createMock(loadMockShopify()), 150);
  const first = await runWebhook(INDEX, 'orders/create', order, { mock, keepDedupe: true, ...quiet });
  assert.equal(first.restEmails.length, 2);
  const before = { rest: mock.calls.restEmails.length, notes: mock.calls.notes.length, nq: mock.calls.orderNoteQueries.length, mq: mock.calls.metafieldQueries.length };
  const second = await runWebhook(INDEX, 'orders/create', order, { mock, keepDedupe: true, ...quiet });
  assert.equal(second.status, 200);
  assert.ok(second.replyMs < 60 && second.doneMs < 60, `answered in ${second.replyMs.toFixed(0)} ms and finished in ${second.doneMs.toFixed(0)} ms`);
  assert.deepEqual({ rest: mock.calls.restEmails.length, notes: mock.calls.notes.length, nq: mock.calls.orderNoteQueries.length, mq: mock.calls.metafieldQueries.length }, before, 'no Shopify call, no note, no email');
});

test('duplicate delivery of a keyed Standard order: the second call answers at once, no second inventory deduction, no email, no note', async () => {
  const order = loadSample('standard', STANDARD_KEYED);
  const mock = slow(createMock(loadMockShopify()), 150);
  const first = await runWebhook(INDEX, 'orders/create', order, { mock, keepDedupe: true, ...quiet });
  const adj = mock.calls.inventoryAdjustments.length, mails = mock.calls.restEmails.length, notes = mock.calls.notes.length, calls = mock.calls.metafieldQueries.length + mock.calls.orderNoteQueries.length;
  assert.ok(adj > 0 && notes === 1);
  const second = await runWebhook(INDEX, 'orders/create', order, { mock, keepDedupe: true, ...quiet });
  assert.equal(second.status, 200);
  assert.ok(second.replyMs < 60 && second.doneMs < 60, `answered in ${second.replyMs.toFixed(0)} ms`);
  assert.equal(mock.calls.inventoryAdjustments.length, adj); assert.equal(mock.calls.restEmails.length, mails); assert.equal(mock.calls.notes.length, notes);
  assert.equal(mock.calls.metafieldQueries.length + mock.calls.orderNoteQueries.length, calls, 'not even a read');
  assert.equal(second.sdkEmails.length, 0);
  void first;
});
