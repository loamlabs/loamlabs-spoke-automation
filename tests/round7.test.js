// Round 7: time limits on every outbound call, the function duration setting, a System report that fails still sends a plain internal email,
// and two separate customer-email switches (SYSTEM_CUSTOMER_EMAIL for System, STANDARD_CUSTOMER_EMAIL for Standard).
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runWebhook, loadSample, createMock, loadMockShopify } from './helpers/webhook-harness.mjs';
import { sendCustomerEmailIfEnabled, sendSystemEmail, buildFailureEmail, CUSTOMER_EMAIL_FLAGS } from '../_lib/system-report.js';
import { withTimeout, shopifyTimeoutMs, resendTimeoutMs } from '../_lib/http-timeout.js';

const INDEX = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'api', 'index.js');
const isSystemInternal = (e) => /^I9 System Build Report/.test(e.subject);
const isStandardInternal = (e) => /^Spoke Calculation Complete/.test(e.subject);
const isCustomer = (e) => /^Your custom spoke colors/.test(e.subject);
const STANDARD = 'std-berd-rear-custom-two-painted';
const SYSTEM = 'hydra2-wheelset-32f-32r';

// A fetch that never answers, like a hung connection: it only ends when the caller's AbortSignal fires (a call without a signal fails the test after 4 s).
function hang(init) {
  return new Promise((_, reject) => {
    const guard = setTimeout(() => reject(new Error('test guard: this call has no abort signal, it would hang')), 4000);
    if (init && init.signal) {
      const done = () => { clearTimeout(guard); reject(init.signal.reason || new Error('aborted')); };
      if (init.signal.aborted) done(); else init.signal.addEventListener('abort', done, { once: true });
    }
  });
}
const isResend = (url) => String(url).includes('api.resend.com');
const isShopify = (url) => String(url).includes('/admin/api/');

/* ------------------------------------------------------------------ 1. time limits */

test('timeouts: defaults are 8 s (Shopify) and 10 s (Resend); env overrides are positive numbers only', () => {
  const keep = { s: process.env.SHOPIFY_FETCH_TIMEOUT_MS, r: process.env.RESEND_FETCH_TIMEOUT_MS };
  try {
    delete process.env.SHOPIFY_FETCH_TIMEOUT_MS; delete process.env.RESEND_FETCH_TIMEOUT_MS;
    assert.equal(shopifyTimeoutMs(), 8000); assert.equal(resendTimeoutMs(), 10000);
    for (const bad of ['0', '-5', 'abc', '']) { process.env.SHOPIFY_FETCH_TIMEOUT_MS = bad; assert.equal(shopifyTimeoutMs(), 8000, bad); }
    process.env.RESEND_FETCH_TIMEOUT_MS = '250'; assert.equal(resendTimeoutMs(), 250);
  } finally { for (const [k, v] of [['SHOPIFY_FETCH_TIMEOUT_MS', keep.s], ['RESEND_FETCH_TIMEOUT_MS', keep.r]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
});

test('timeouts: withTimeout rejects a slow promise and lets a fast one through', async () => {
  await assert.rejects(withTimeout(new Promise((r) => setTimeout(r, 500).unref()), 30, 'slow call'), /slow call timed out after 30 ms/);
  assert.equal(await withTimeout(Promise.resolve(7), 1000), 7);
});

test('timeouts: sendSystemEmail with a hung Resend: the send with images times out, the text-only send goes out; if that hangs too it throws (no hang)', async () => {
  const report = { subject: 'S', html: '<html><body><img class="wheel-img" src="cid:a"></body></html>', images: [{ filename: 'a.png', png: Buffer.from('x'), cid: 'a', caption: 'c' }] };
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push(JSON.parse(init.body)); if (calls.length === 1) return hang(init); return { ok: true, json: async () => ({ id: 'ok' }) }; };
  const started = Date.now();
  const r = await sendSystemEmail({ report, apiKey: 'k', to: 'a@b.co', fetchImpl, timeoutMs: 80 });
  assert.equal(r.inline, false); assert.equal(r.id, 'ok');
  assert.ok(/timeout|aborted/i.test(r.error), r.error);
  assert.equal(calls.length, 2); assert.ok(calls[0].attachments && !calls[1].attachments);
  assert.ok(Date.now() - started < 1500);
  await assert.rejects(sendSystemEmail({ report, apiKey: 'k', to: 'a@b.co', fetchImpl: async (u, init) => hang(init), timeoutMs: 60 }), /timeout|aborted/i);
});

test('timeouts, webhook: Resend REST hangs on the first send (with images): the internal System email still arrives, text-only', async () => {
  const mock = createMock(loadMockShopify()); const inner = mock.fetch; let n = 0;
  mock.fetch = async (url, init) => (isResend(url) && n++ === 0 ? hang(init) : inner(url, init));
  const started = Date.now();
  const r = await runWebhook(INDEX, 'orders/create', loadSample('system', SYSTEM), { mock, env: { RESEND_FETCH_TIMEOUT_MS: '100' } });
  assert.equal(r.status, 200);
  assert.equal(r.restEmails.filter(isSystemInternal).length, 1, 'one internal email');
  assert.equal((r.restEmails[0].attachments || []).length, 0, 'it went out text-only');
  assert.ok(r.restEmails[0].html.includes('image failed'), 'and says why');
  assert.equal(r.notes.length, 1);
  assert.ok(Date.now() - started < 3000);
});

test('timeouts, webhook: Resend REST hangs on every send for a Standard (keyed) order: the SDK fallback sends the internal email, 200, no hang', async () => {
  const mock = createMock(loadMockShopify()); const inner = mock.fetch;
  mock.fetch = async (url, init) => (isResend(url) ? hang(init) : inner(url, init));
  const started = Date.now();
  const r = await runWebhook(INDEX, 'orders/create', loadSample('standard', STANDARD), { mock, env: { RESEND_FETCH_TIMEOUT_MS: '100' } });
  assert.equal(r.status, 200);
  assert.equal(r.restEmails.length, 0);
  assert.equal(r.sdkEmails.filter(isStandardInternal).length, 1, 'the SDK fallback delivered the internal email once');
  assert.equal(r.notes.length, 1); assert.equal(r.inventoryAdjustments.length, 2, 'inventory unchanged');
  assert.ok(Date.now() - started < 3000);
});

test('timeouts, webhook: the Resend SDK itself hangs: the webhook stops waiting after the limit and still answers 200', async () => {
  const started = Date.now();
  const r = await runWebhook(INDEX, 'orders/create', loadSample('standard', 'steel-jbend-wheelset'), { sdkDelayMs: 3000, env: { RESEND_FETCH_TIMEOUT_MS: '120' } });
  assert.equal(r.status, 200);
  assert.ok(Date.now() - started < 2000, `waited ${Date.now() - started} ms`);
  assert.ok(r.logs.some(([lvl, m]) => lvl === 'error' && /Resend SDK send timed out/.test(m)), 'the timeout is logged like any send error');
  assert.equal(r.notes.length, 1); assert.equal(r.inventoryAdjustments.length > 0, true);
});

test('timeouts, webhook: every Shopify call hangs (note read, metafields, note write): a System order still sends its internal email and answers 200', async () => {
  const mock = createMock(loadMockShopify()); const inner = mock.fetch;
  mock.fetch = async (url, init) => (isShopify(url) ? hang(init) : inner(url, init));
  const started = Date.now();
  const r = await runWebhook(INDEX, 'orders/create', loadSample('system', SYSTEM), { mock, env: { SHOPIFY_FETCH_TIMEOUT_MS: '40' } });
  assert.equal(r.status, 200);
  assert.equal(r.restEmails.filter(isSystemInternal).length, 1, 'the internal email is sent');
  assert.equal(r.inventoryAdjustments.length, 0);
  assert.ok(r.logs.some(([, m]) => /timeout|aborted/i.test(m)), 'the timeouts show in the log as Shopify attempt failures');
  assert.ok(Date.now() - started < 12000, `took ${Date.now() - started} ms`);
});

/* ------------------------------------------------------------------ 2. function duration */

test('duration: api/index.js and the staff test endpoint export maxDuration 30 in the Node.js /api config (and index.js keeps bodyParser off)', async () => {
  const idx = await import(pathToFileURL(INDEX).href);
  assert.equal(idx.config.maxDuration, 30);
  assert.equal(idx.config.api.bodyParser, false);
  const t = await import(pathToFileURL(path.resolve(path.dirname(INDEX), 'test-system-email.js')).href);
  assert.equal(t.config.maxDuration, 30);
});

/* ------------------------------------------------------------------ 3. report failure */

test('System report throws: ONE plain internal email with the order number, the error and the raw line items; no note, no customer email, no inventory, 200', async () => {
  const order = loadSample('system', SYSTEM);
  const r = await runWebhook(INDEX, 'orders/create', order, { query: 'breakSystemReport=1', env: { SYSTEM_CUSTOMER_EMAIL: 'on' } });
  assert.equal(r.status, 200);
  assert.equal(r.restEmails.length, 1, 'exactly one email, and not a customer email');
  const e = r.restEmails[0];
  assert.deepEqual(e.to, ['builder@example.com']);
  assert.ok(e.subject.includes(`#${order.order_number}`) && /REPORT FAILED/.test(e.subject), e.subject);
  assert.ok(e.html.includes(`Order #${order.order_number}`) && e.html.includes('simulated report failure'));
  for (const li of order.line_items) assert.ok(e.html.includes(String(li.title).replace(/&/g, '&amp;')), `line item ${li.title} listed`);
  assert.ok(e.html.includes('_build'), 'the properties are listed');
  assert.equal((e.attachments || []).length, 0);
  assert.equal(r.notes.length, 0, 'no order note');
  assert.equal(r.inventoryAdjustments.length, 0);
  assert.ok(r.logs.some(([lvl, m]) => lvl === 'error' && m.includes('could not build the System report')));
});

test('System report throws and Resend rejects the plain email too: the claim is released, so a re-delivery tries again', async () => {
  const order = loadSample('system', SYSTEM);
  const mock = createMock(loadMockShopify()); const inner = mock.fetch; let fail = true;
  mock.fetch = async (url, init) => (isResend(url) && fail ? { ok: false, status: 500, json: async () => ({ message: 'down' }) } : inner(url, init));
  const first = await runWebhook(INDEX, 'orders/create', order, { mock, query: 'breakSystemReport=1' }); // starts from a clean dedupe state
  assert.equal(first.status, 200); assert.equal(mock.calls.restEmails.length, 0, 'nothing was delivered');
  assert.ok(first.logs.some(([, m]) => m.includes('the plain failure email failed too')));
  fail = false;
  const second = await runWebhook(INDEX, 'orders/create', order, { mock, query: 'breakSystemReport=1', keepDedupe: true });
  assert.equal(second.status, 200); assert.equal(mock.calls.restEmails.length, 1, 'the re-delivery sent it');
  const third = await runWebhook(INDEX, 'orders/create', order, { mock, query: 'breakSystemReport=1', keepDedupe: true });
  assert.equal(third.status, 200); assert.equal(mock.calls.restEmails.length, 1, 'and a third delivery is a duplicate: nothing more');
});

test('buildFailureEmail: escapes HTML, cuts a long _build property, survives missing fields', () => {
  const r = buildFailureEmail({ orderData: { order_number: 5, line_items: [{ title: '<script>x</script>', quantity: 1, properties: [{ name: '_build', value: 'y'.repeat(5000) }, null] }, null] }, error: 'plain string error' });
  assert.ok(!r.html.includes('<script>x'));
  assert.ok(r.html.includes('[cut, 5000 characters]'));
  assert.ok(r.html.includes('plain string error'));
  assert.deepEqual(r.images, []);
  assert.equal(buildFailureEmail({ orderData: null, error: new Error('x') }).subject.includes('Order #n/a'), true);
});

test('a normal System order is unchanged by the report guard (full report, note, one internal email)', async () => {
  const r = await runWebhook(INDEX, 'orders/create', loadSample('system', SYSTEM));
  assert.equal(r.status, 200); assert.equal(r.restEmails.length, 1); assert.equal(r.notes.length, 1);
  assert.ok(!/REPORT FAILED/.test(r.restEmails[0].subject));
});

/* ------------------------------------------------------------------ 4. two customer-email switches */

test('switches: the two names are fixed', () => {
  assert.deepEqual(CUSTOMER_EMAIL_FLAGS, { system: 'SYSTEM_CUSTOMER_EMAIL', standard: 'STANDARD_CUSTOMER_EMAIL' });
});

test('switches, System order: only SYSTEM_CUSTOMER_EMAIL="on" sends a customer email; STANDARD_CUSTOMER_EMAIL does nothing for System', async () => {
  const order = () => loadSample('system', SYSTEM);
  let r = await runWebhook(INDEX, 'orders/create', order(), { env: { STANDARD_CUSTOMER_EMAIL: 'on' } });
  assert.equal(r.restEmails.filter(isCustomer).length, 0); assert.equal(r.restEmails.filter(isSystemInternal).length, 1);
  assert.ok(r.logs.some(([, m]) => m.includes('SYSTEM_CUSTOMER_EMAIL is not "on"')));
  r = await runWebhook(INDEX, 'orders/create', order(), { env: { SYSTEM_CUSTOMER_EMAIL: 'on' } });
  assert.equal(r.restEmails.filter(isCustomer).length, 1); assert.equal(r.restEmails.filter(isSystemInternal).length, 1);
});

test('switches, keyed Standard order: only STANDARD_CUSTOMER_EMAIL="on" sends a customer email; SYSTEM_CUSTOMER_EMAIL does nothing for Standard; exact "on" only', async () => {
  const order = () => loadSample('standard', STANDARD);
  let r = await runWebhook(INDEX, 'orders/create', order(), { env: { SYSTEM_CUSTOMER_EMAIL: 'on' } });
  assert.equal(r.emails.filter(isCustomer).length, 0, 'the System switch does not turn on Standard customer emails');
  assert.equal(r.emails.filter(isStandardInternal).length, 1, 'internal email unaffected');
  assert.ok(r.logs.some(([, m]) => m.includes('STANDARD-STUDIO') && m.includes('STANDARD_CUSTOMER_EMAIL is not "on"')));
  for (const v of ['ON', 'true', '1', 'yes', ' on', 'on ', '']) {
    r = await runWebhook(INDEX, 'orders/create', order(), { env: { STANDARD_CUSTOMER_EMAIL: v } });
    assert.equal(r.emails.filter(isCustomer).length, 0, `value ${JSON.stringify(v)}`);
    assert.equal(r.emails.filter(isStandardInternal).length, 1);
  }
  r = await runWebhook(INDEX, 'orders/create', order(), { env: { STANDARD_CUSTOMER_EMAIL: 'on' } });
  assert.equal(r.emails.filter(isCustomer).length, 1); assert.equal(r.emails.filter(isStandardInternal).length, 1);
  assert.deepEqual(r.emails.find(isCustomer).to, ['customer@example.com']);
});

test('switches: both on = each kind sends its own one customer email; both off (default) = none', async () => {
  const both = { SYSTEM_CUSTOMER_EMAIL: 'on', STANDARD_CUSTOMER_EMAIL: 'on' };
  assert.equal((await runWebhook(INDEX, 'orders/create', loadSample('system', SYSTEM), { env: both })).restEmails.filter(isCustomer).length, 1);
  assert.equal((await runWebhook(INDEX, 'orders/create', loadSample('standard', STANDARD), { env: both })).emails.filter(isCustomer).length, 1);
  assert.equal((await runWebhook(INDEX, 'orders/create', loadSample('system', SYSTEM))).restEmails.filter(isCustomer).length, 0);
  assert.equal((await runWebhook(INDEX, 'orders/create', loadSample('standard', STANDARD))).emails.filter(isCustomer).length, 0);
});

test('switches: sendCustomerEmailIfEnabled never sends for an unknown kind, and reads the env it is given', async () => {
  const sent = []; const send = async (o) => { sent.push(o); return { id: 'x', inline: false }; };
  const customer = { subject: 's', html: 'h', images: [] }, orderData = { email: 'c@d.co' }, quiet = () => {};
  assert.equal((await sendCustomerEmailIfEnabled({ customer, orderData, kind: 'bogus', env: { SYSTEM_CUSTOMER_EMAIL: 'on', STANDARD_CUSTOMER_EMAIL: 'on' }, send, log: quiet })).sent, false);
  assert.equal((await sendCustomerEmailIfEnabled({ customer, orderData, env: { STANDARD_CUSTOMER_EMAIL: 'on' }, send, log: quiet })).sent, false, 'default kind is system');
  assert.equal((await sendCustomerEmailIfEnabled({ customer, orderData, kind: 'standard', env: { STANDARD_CUSTOMER_EMAIL: 'on' }, send, log: quiet })).sent, true);
  assert.equal(sent.length, 1);
});

/* ------------------------------------------------------------------ 5. text-only fallback without broken images */

test('text-only fallback of the Standard internal email has no cid: image left (the captions stay as text)', async () => {
  const mock = createMock(loadMockShopify()); const inner = mock.fetch; let n = 0;
  mock.fetch = async (url, init) => (isResend(url) && n++ === 0 ? { ok: false, status: 422, json: async () => ({ message: 'too large' }) } : inner(url, init));
  const r = await runWebhook(INDEX, 'orders/create', loadSample('standard', STANDARD), { mock });
  assert.equal(r.status, 200);
  const e = r.emails.find(isStandardInternal);
  assert.ok(e, 'internal email delivered');
  assert.equal((e.attachments || []).length, 0);
  assert.ok(!/cid:/.test(e.html), 'no broken cid: image references');
  assert.ok(e.html.includes('image failed: email attachment rejected'));
  assert.ok(/wheel, all spokes/i.test(e.html), 'the image captions are still there as text');
});

test('with images accepted the Standard internal email still carries its cid: images', async () => {
  const r = await runWebhook(INDEX, 'orders/create', loadSample('standard', STANDARD));
  const e = r.emails.find(isStandardInternal);
  assert.ok(/src="cid:/.test(e.html)); assert.ok(e.attachments.length > 0);
});
