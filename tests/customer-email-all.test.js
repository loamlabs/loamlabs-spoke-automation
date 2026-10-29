// I9-SYSTEM: the customer spoke-color email is built and (flag on) sent for EVERY System build, including builds where both wheels are one solid
// color. Unchanged and checked here too: the SYSTEM_CUSTOMER_EMAIL flag (only exactly "on"), the dedupe guard, From / reply-to / subject, the internal
// report, no sends on cancel, and Standard orders never get a customer spoke-color email.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runWebhook, loadSample, createMock, loadMockShopify } from './helpers/webhook-harness.mjs';

const INDEX = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'api', 'index.js');
const isCustomerMail = (e) => String(e.subject).startsWith('Your custom spoke colors');
const isInternalMail = (e) => String(e.subject).startsWith('I9 System Build Report');
const ON = { SYSTEM_CUSTOMER_EMAIL: 'on' };
const cids = (e) => (e.attachments || []).map((a) => a.content_id);

const CASES = [
  { name: 'both wheels solid (Black x24 + Black x24)', sample: 'solix-24h-wheelset-both-solid-black', order: 90010, images: ['front-all-spokes', 'rear-all-spokes'] },
  { name: 'one solid, one custom', sample: 'solix-24h-wheelset-front-custom-rear-solid', order: 90009, images: ['front-all-spokes', 'front-rotor-only', 'front-drive-only', 'rear-all-spokes'] },
  { name: 'both custom', sample: 'solix-24h-wheelset-multicolor', order: 90001, images: ['front-all-spokes', 'front-rotor-only', 'front-drive-only', 'rear-all-spokes', 'rear-drive-only', 'rear-rotor-only'] }
];

for (const c of CASES) {
  test(`flag on, ${c.name}: internal email, then ONE customer email to the order's customer with the expected images`, async () => {
    const r = await runWebhook(INDEX, 'orders/create', loadSample('system', c.sample), { env: ON });
    assert.equal(r.status, 200);
    assert.equal(r.restEmails.length, 2);
    const [internal, customer] = r.restEmails;
    assert.ok(isInternalMail(internal) && isCustomerMail(customer), 'internal first, then the customer email');
    assert.deepEqual(internal.to, ['builder@example.com']);
    assert.deepEqual(customer.to, ['customer@example.com']);
    assert.equal(customer.from, 'LoamLabs <info@loamlabsusa.com>');
    assert.equal(customer.reply_to, 'info@loamlabsusa.com');
    assert.equal(customer.subject, `Your custom spoke colors, order #${c.order}`);
    assert.deepEqual(cids(customer), c.images);
    assert.deepEqual(cids(internal), c.images, 'the internal report carries the same images');
    assert.ok(customer.html.includes('Hi Alex,') && customer.html.includes('Here are the spoke colors for your wheels.'));
    assert.equal(/Spoke lengths|not calculated|NOTE:|Build ID|Custom color fee|inventory/i.test(customer.html), false, 'no internal text in the customer email');
    assert.ok(internal.html.includes('Spoke lengths for System hubs: NOT CALCULATED.'), 'the internal report is unchanged');
    assert.equal(r.inventoryAdjustments.length, 0);
  });

  test(`flag off, ${c.name}: nothing is sent to the customer, internal report unaffected`, async () => {
    for (const env of [{}, { SYSTEM_CUSTOMER_EMAIL: 'off' }, { SYSTEM_CUSTOMER_EMAIL: 'ON' }, { SYSTEM_CUSTOMER_EMAIL: 'true' }]) {
      const r = await runWebhook(INDEX, 'orders/create', loadSample('system', c.sample), { env });
      assert.equal(r.status, 200);
      assert.equal(r.restEmails.filter(isCustomerMail).length, 0, JSON.stringify(env));
      assert.equal(r.restEmails.filter(isInternalMail).length, 1, JSON.stringify(env));
    }
  });
}

test('both wheels solid, flag on: the customer email shows each solid wheel as "all Black" with its one image and the color tables', async () => {
  const r = await runWebhook(INDEX, 'orders/create', loadSample('system', 'solix-24h-wheelset-both-solid-black'), { env: ON });
  const customer = r.restEmails.find(isCustomerMail);
  assert.equal((customer.html.match(/<img class="wheel-img"/g) || []).length, 2);
  assert.ok(customer.html.includes('Front wheel: all Black') && customer.html.includes('Rear wheel: all Black'));
  assert.ok(customer.html.includes('Whole wheel (24)'));
  assert.ok(customer.html.indexOf('FRONT WHEEL') < customer.html.indexOf('cid:front-all-spokes') && customer.html.indexOf('cid:front-all-spokes') < customer.html.indexOf('REAR WHEEL'));
  assert.equal(/one color|no image/i.test(customer.html), false);
  assert.ok(customer.attachments.every((a) => a.content_type === 'image/png' && Buffer.from(a.content, 'base64').subarray(1, 4).toString() === 'PNG'));
});

test('dedupe guard unchanged: the same both-solid order delivered twice gives one internal and one customer email', async () => {
  const mock = createMock(loadMockShopify());
  const first = await runWebhook(INDEX, 'orders/create', loadSample('system', 'solix-24h-wheelset-both-solid-black'), { mock, env: ON });
  assert.equal(first.restEmails.length, 2);
  await runWebhook(INDEX, 'orders/create', loadSample('system', 'solix-24h-wheelset-both-solid-black'), { mock, env: ON });
  assert.equal(mock.calls.restEmails.filter(isInternalMail).length, 1);
  assert.equal(mock.calls.restEmails.filter(isCustomerMail).length, 1);
  assert.equal(mock.calls.notes.length, 1);
});

test('no address on the order: no customer email (logged), internal unaffected; also for a both-solid order', async () => {
  const order = loadSample('system', 'solix-24h-wheelset-both-solid-black'); order.email = null; order.customer = null;
  const r = await runWebhook(INDEX, 'orders/create', order, { env: ON });
  assert.equal(r.restEmails.filter(isCustomerMail).length, 0);
  assert.equal(r.restEmails.filter(isInternalMail).length, 1);
  assert.ok(r.logs.some(([, m]) => m.includes('no customer email address')));
});

test('Resend rejecting the customer email of a both-solid order leaves the internal email and the 200 untouched', async () => {
  const mock = createMock(loadMockShopify());
  const inner = mock.fetch;
  mock.fetch = async (url, init) => {
    if (String(url).includes('api.resend.com') && String(JSON.parse(init.body).subject).startsWith('Your custom spoke colors')) return { ok: false, status: 422, json: async () => ({ message: 'invalid recipient' }) };
    return inner(url, init);
  };
  const r = await runWebhook(INDEX, 'orders/create', loadSample('system', 'solix-24h-wheelset-both-solid-black'), { mock, env: ON });
  assert.equal(r.status, 200);
  assert.equal(r.restEmails.filter(isInternalMail).length, 1);
  assert.equal(cids(r.restEmails.filter(isInternalMail)[0]).length, 2);
  assert.equal(r.notes.length, 1);
});

test('orders/cancelled for a both-solid System order: no email at all, even with the flag on', async () => {
  const r = await runWebhook(INDEX, 'orders/cancelled', loadSample('system', 'solix-24h-wheelset-both-solid-black'), { env: ON });
  assert.equal(r.status, 200);
  assert.equal(r.emails.length, 0);
  assert.equal(r.notes.length, 0);
  assert.equal(r.inventoryAdjustments.length, 0);
});

test('Standard orders never get a customer spoke-color email, flag on or off (their path is untouched)', async () => {
  for (const sample of ['steel-jbend-wheelset', 'berd-straightpull-front', 'rimbrake-front-own-rear-hub']) {
    for (const env of [{}, ON]) {
      const r = await runWebhook(INDEX, 'orders/create', loadSample('standard', sample), { env });
      assert.equal(r.status, 200, sample);
      assert.equal(r.restEmails.length, 0, `${sample}: no REST (System or customer) email`);
      assert.equal(r.sdkEmails.length, 1, `${sample}: only the one Standard report through the SDK`);
      assert.equal(r.emails.filter(isCustomerMail).length, 0, sample);
      assert.ok(r.inventoryAdjustments.length > 0, `${sample}: Standard inventory path still runs`);
    }
  }
});
