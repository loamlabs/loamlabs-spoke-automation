// Round 9: a note write that Shopify refuses (HTTP 200 with orderUpdate.userErrors) is a FAILED write: it is logged with the order number
// ("ORDER #n: note write rejected: <messages>"), the existing fallbacks run (the internal email still goes out) and the internal email says the note
// could not be written and why. A clean write still logs success and the email carries no notice.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runWebhook, loadSample, createMock, loadMockShopify } from './helpers/webhook-harness.mjs';
import { addNoteFailureNotice } from '../_lib/system-report.js';

const INDEX = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'api', 'index.js');
const SYSTEM = 'hydra2-wheelset-32f-32r';
const STANDARD_KEYED = 'std-berd-rear-custom-two-painted';
const STANDARD_UNKEYED = 'steel-jbend-wheelset';
const NOTICE = 'The order note could not be written';
const isResend = (url) => String(url).includes('api.resend.com');
const isNoteWrite = (url, init) => !isResend(url) && /orderUpdate/.test(String(init && init.body));
const reply = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });

// Shopify answers the order-note update with `answer` (everything else is the normal fake)
function noteAnswers(answer) {
  const mock = createMock(loadMockShopify()); const inner = mock.fetch;
  mock.fetch = async (url, init) => (isNoteWrite(url, init) ? reply(answer) : inner(url, init));
  return mock;
}
const REFUSED = { data: { orderUpdate: { order: null, userErrors: [{ field: ['id'], message: 'Order does not exist' }, { field: ['note'], message: 'Note is too long' }] } } };
function watchUnhandled() { const seen = []; const on = (e) => seen.push(e); process.on('unhandledRejection', on); return { seen, stop: () => process.off('unhandledRejection', on) }; }
const errorLogs = (r) => r.logs.filter(([lvl]) => lvl === 'error').map(([, m]) => m);

test('System order, note refused (userErrors): logged with the order number, ONE internal email that says so with the reason, 200, nothing unhandled', async () => {
  const w = watchUnhandled();
  try {
    const order = loadSample('system', SYSTEM);
    const r = await runWebhook(INDEX, 'orders/create', order, { mock: noteAnswers(REFUSED) });
    assert.equal(r.status, 200);
    assert.ok(errorLogs(r).some((m) => m.includes(`ORDER #${order.order_number}: note write rejected: Order does not exist; Note is too long`)), errorLogs(r).join('\n'));
    assert.ok(!r.logs.some(([, m]) => /successfully added note/i.test(m)), 'no success line');
    assert.equal(r.restEmails.length, 1, 'the internal email still goes out');
    const html = r.restEmails[0].html;
    assert.ok(html.includes(NOTICE) && html.includes('Order does not exist; Note is too long'), 'the email says the note failed, and why');
    assert.ok(/^I9 System Build Report for Order/.test(r.restEmails[0].subject));
    assert.ok(r.restEmails[0].attachments.length > 0, 'the report still has its images');
  } finally { w.stop(); }
  assert.deepEqual(w.seen, []);
});

test('System order, note refused AND the first email attempt (with images) fails: the text-only retry carries the notice too', async () => {
  const mock = noteAnswers(REFUSED); const inner = mock.fetch; let n = 0;
  mock.fetch = async (url, init) => (isResend(url) && n++ === 0 ? { ok: false, status: 422, json: async () => ({ message: 'too large' }) } : inner(url, init));
  const r = await runWebhook(INDEX, 'orders/create', loadSample('system', SYSTEM), { mock });
  assert.equal(r.restEmails.length, 1); assert.equal((r.restEmails[0].attachments || []).length, 0);
  assert.ok(r.restEmails[0].html.includes(NOTICE) && r.restEmails[0].html.includes('image failed'));
});

test('keyed Standard order, note refused: logged with the order number, the internal email (with images) is sent and says so, inventory was done, customer email unaffected', async () => {
  const w = watchUnhandled();
  try {
    const order = loadSample('standard', STANDARD_KEYED);
    const r = await runWebhook(INDEX, 'orders/create', order, { mock: noteAnswers(REFUSED), env: { SYSTEM_CUSTOMER_EMAIL: 'on' } });
    assert.equal(r.status, 200);
    assert.ok(errorLogs(r).some((m) => m.includes(`ORDER #${order.order_number}: note write rejected: Order does not exist; Note is too long`)));
    const internal = r.emails.filter((e) => /^Spoke Calculation Complete/.test(e.subject));
    assert.equal(internal.length, 1);
    assert.ok(internal[0].html.includes(NOTICE) && internal[0].html.includes('Note is too long'));
    assert.ok(internal[0].attachments.length > 0, 'images still attached');
    assert.ok(r.inventoryAdjustments.length > 0, 'inventory untouched by the note failure');
    const customer = r.emails.filter((e) => /^Your custom spoke colors/.test(e.subject));
    assert.equal(customer.length, 1); assert.ok(!customer[0].html.includes(NOTICE), 'the customer never sees the notice');
  } finally { w.stop(); }
  assert.deepEqual(w.seen, []);
});

test('unkeyed Standard order (SDK email path), note refused: the internal email says so', async () => {
  const order = loadSample('standard', STANDARD_UNKEYED);
  const r = await runWebhook(INDEX, 'orders/create', order, { mock: noteAnswers(REFUSED) });
  assert.equal(r.status, 200);
  assert.ok(errorLogs(r).some((m) => m.includes(`ORDER #${order.order_number}: note write rejected`)));
  assert.equal(r.sdkEmails.length, 1);
  assert.ok(r.sdkEmails[0].html.includes(NOTICE) && r.sdkEmails[0].html.includes('Order does not exist'));
});

test('an answer without an orderUpdate result counts as rejected too', async () => {
  const order = loadSample('system', SYSTEM);
  const r = await runWebhook(INDEX, 'orders/create', order, { mock: noteAnswers({ data: {} }) });
  assert.ok(errorLogs(r).some((m) => m.includes(`ORDER #${order.order_number}: note write rejected: Shopify returned no orderUpdate result`)));
  assert.ok(r.restEmails[0].html.includes(NOTICE));
});

test('a thrown error (GraphQL errors, all retries) is treated the same: logged with the order number, the email mentions it', async () => {
  const order = loadSample('standard', STANDARD_KEYED);
  const r = await runWebhook(INDEX, 'orders/create', order, { mock: noteAnswers({ errors: [{ message: 'Internal error' }] }) });
  assert.ok(errorLogs(r).some((m) => m.includes(`ORDER #${order.order_number}: failed to add note to order`)));
  const internal = r.emails.find((e) => /^Spoke Calculation Complete/.test(e.subject));
  assert.ok(internal && internal.html.includes(NOTICE) && internal.html.includes('Internal error'));
});

test('a clean write still logs success with the order number, and the emails carry no notice', async () => {
  for (const [kind, name] of [['system', SYSTEM], ['standard', STANDARD_KEYED], ['standard', STANDARD_UNKEYED]]) {
    const order = loadSample(kind, name);
    const r = await runWebhook(INDEX, 'orders/create', order);
    assert.ok(r.logs.some(([lvl, m]) => lvl === 'log' && m.includes(`ORDER #${order.order_number}: successfully added note`)), name);
    assert.ok(!errorLogs(r).some((m) => /note write rejected|failed to add note/.test(m)), name);
    for (const e of r.emails) assert.ok(!e.html.includes(NOTICE), name);
    assert.equal(r.notes.length, 1);
  }
});

test('addNoteFailureNotice: goes first in the container, escapes the reason, leaves html without a container alone', () => {
  const out = addNoteFailureNotice('<body><div class="container"><h2>x</h2></div></body>', 'bad <b>&"');
  assert.ok(out.indexOf(NOTICE) > out.indexOf('<div class="container">') && out.indexOf(NOTICE) < out.indexOf('<h2>'));
  assert.ok(out.includes('bad &lt;b&gt;&amp;&quot;') && !out.includes('<b>&"'));
  assert.equal(addNoteFailureNotice('<p>no container</p>', 'r'), '<p>no container</p>');
});
