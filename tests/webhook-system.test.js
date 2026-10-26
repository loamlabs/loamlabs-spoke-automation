// I9-SYSTEM: the webhook with System orders (mocked Shopify + Resend): no inventory is touched on create or cancel, the note and the
// internal email with inline images go out, the customer email is OFF by default and only sent when SYSTEM_CUSTOMER_EMAIL is "on",
// and a Standard order still deducts inventory exactly as before.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runWebhook, loadSample, createMock, loadMockShopify } from './helpers/webhook-harness.mjs';

const INDEX = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'api', 'index.js');
const isCustomerMail = (e) => String(e.subject).startsWith('Your custom spoke colors');
const isInternalMail = (e) => String(e.subject).startsWith('I9 System Build Report');

test('System wheel set: 200, no inventory adjustment, no variant lookup, note written, ONE email (internal) by REST with 6 inline images; customer flag off', async () => {
  const order = loadSample('system', 'solix-24h-wheelset-multicolor');
  const r = await runWebhook(INDEX, 'orders/create', order);
  assert.equal(r.status, 200);
  assert.equal(r.inventoryAdjustments.length, 0, 'no Length Variant deduction for a System build');
  assert.equal(r.variantQueries.length, 0, 'no variant lookup');
  assert.equal(r.metafieldQueries.length, 1, 'one metafield fetch (hub flange / rim ERD)');
  assert.equal(r.notes.length, 1);
  assert.ok(r.note.includes('Customer note: please match the purple hubs'), 'customer note preserved');
  assert.ok(r.note.includes('AUTOMATED SYSTEM BUILD REPORT'));
  assert.ok(r.note.includes('FRONT WHEEL (Solix, 24h 2:1 (8 drive / 16 rotor))'));
  assert.ok(r.note.includes('Spoke lengths for System hubs: not calculated (method pending)'), 'the length line is in the order note');
  assert.equal(r.sdkEmails.length, 0, 'the Standard email path was not used');
  assert.equal(r.restEmails.length, 1, 'flag off: only the internal email');
  const email = r.restEmails[0];
  assert.deepEqual(email.to, ['builder@example.com']);
  assert.ok(email.subject.includes('System Build Report for Order #90001'));
  assert.deepEqual(email.attachments.map((a) => a.content_id), ['front-rotor-only', 'front-drive-only', 'front-all-spokes', 'rear-drive-only', 'rear-rotor-only', 'rear-all-spokes']);
  assert.ok(email.attachments.every((a) => a.content_type === 'image/png' && Buffer.from(a.content, 'base64').subarray(1, 4).toString() === 'PNG'), 'real PNG bytes');
  assert.ok(email.html.includes('src="cid:front-rotor-only"'));
  assert.ok(r.logs.some(([, m]) => m.includes('customer spoke-color email not sent (SYSTEM_CUSTOMER_EMAIL is not "on")')), 'one log line says why nothing went to the customer');
  assert.ok(!r.logs.some(([lvl, m]) => lvl === 'error' && m.includes('CRASH')), r.logs.filter(([l]) => l === 'error').map(([, m]) => m).join('\n'));
});

test('flag off (unset, "off", "ON", "true", "1"): nothing is ever sent to the customer; flag exactly "on": one email to the order customer', async () => {
  for (const value of [undefined, 'off', 'ON', 'true', '1', '']) {
    const r = await runWebhook(INDEX, 'orders/create', loadSample('system', 'hydra2-wheelset-28f-32r'), { env: value === undefined ? {} : { SYSTEM_CUSTOMER_EMAIL: value } });
    assert.equal(r.status, 200);
    assert.equal(r.restEmails.filter(isCustomerMail).length, 0, `flag ${JSON.stringify(value)}: no customer email`);
    assert.equal(r.restEmails.filter(isInternalMail).length, 1, `flag ${JSON.stringify(value)}: internal email unaffected`);
  }
  const r = await runWebhook(INDEX, 'orders/create', loadSample('system', 'hydra2-wheelset-28f-32r'), { env: { SYSTEM_CUSTOMER_EMAIL: 'on' } });
  assert.equal(r.status, 200);
  assert.equal(r.restEmails.length, 2, 'internal + customer');
  const [internal, customer] = r.restEmails;
  assert.ok(isInternalMail(internal) && isCustomerMail(customer), 'internal first, then the customer email');
  assert.deepEqual(customer.to, ['customer@example.com'], 'sent to the order customer, once');
  assert.equal(customer.from, 'LoamLabs <info@loamlabsusa.com>');
  assert.equal(customer.reply_to, 'info@loamlabsusa.com');
  assert.equal(customer.subject, 'Your custom spoke colors, order #90002');
  assert.deepEqual(customer.attachments.map((a) => a.content_id), ['front-rotor-only', 'front-drive-only', 'front-all-spokes', 'rear-drive-only', 'rear-rotor-only', 'rear-all-spokes']);
  assert.ok(customer.html.includes('Hi Alex,'));
  assert.equal(/Spoke lengths|not calculated|NOTE:|Build ID|inventory/i.test(customer.html), false, 'no internal text in the customer email');
  assert.deepEqual(internal.to, ['builder@example.com'], 'the internal email still goes to the builder only');
  assert.ok(internal.html.includes('Spoke lengths for System hubs: not calculated (method pending)'), 'lengths stay in the internal email');
});

test('flag on: order.email missing -> falls back to customer.email; no address at all -> no customer email, internal unaffected', async () => {
  const fallback = loadSample('system', 'hydra2-rear-32h-only'); fallback.email = ''; fallback.customer.email = 'fallback@example.com';
  let r = await runWebhook(INDEX, 'orders/create', fallback, { env: { SYSTEM_CUSTOMER_EMAIL: 'on' } });
  assert.deepEqual(r.restEmails.filter(isCustomerMail).map((e) => e.to), [['fallback@example.com']]);
  const none = loadSample('system', 'hydra2-rear-32h-only'); none.email = null; none.customer = null;
  r = await runWebhook(INDEX, 'orders/create', none, { env: { SYSTEM_CUSTOMER_EMAIL: 'on' } });
  assert.equal(r.status, 200);
  assert.equal(r.restEmails.filter(isCustomerMail).length, 0);
  assert.equal(r.restEmails.filter(isInternalMail).length, 1);
  assert.ok(r.logs.some(([, m]) => m.includes('no customer email address')));
});

test('flag on but no wheel has more than one color: no customer email', async () => {
  const order = loadSample('system', 'solix-single-color-front');
  const recipeProp = order.line_items[0].properties.find((p) => p.name === '_build');
  const recipe = JSON.parse(recipeProp.value);
  recipe.system.studio.spokes.rear.drive = recipe.system.studio.spokes.rear.drive.map(() => 'Black');
  recipeProp.value = JSON.stringify(recipe);
  const r = await runWebhook(INDEX, 'orders/create', order, { env: { SYSTEM_CUSTOMER_EMAIL: 'on' } });
  assert.equal(r.status, 200);
  assert.equal(r.restEmails.filter(isCustomerMail).length, 0);
  assert.equal(r.restEmails.filter(isInternalMail).length, 1);
});

test('Resend rejecting the CUSTOMER email (images and text-only) leaves the internal email and the webhook answer untouched', async () => {
  const mock = createMock(loadMockShopify());
  const inner = mock.fetch;
  mock.fetch = async (url, init) => {
    if (String(url).includes('api.resend.com') && String(JSON.parse(init.body).subject).startsWith('Your custom spoke colors')) return { ok: false, status: 422, json: async () => ({ message: 'invalid recipient' }) };
    return inner(url, init);
  };
  const r = await runWebhook(INDEX, 'orders/create', loadSample('system', 'hydra2-wheelset-32f-32r'), { mock, env: { SYSTEM_CUSTOMER_EMAIL: 'on' } });
  assert.equal(r.status, 200);
  const internal = r.restEmails.filter(isInternalMail);
  assert.equal(internal.length, 1);
  assert.equal(internal[0].attachments.length, 6, 'internal email complete with its 6 images');
  assert.ok(r.logs.some(([lvl, m]) => lvl === 'error' && m.includes('customer spoke-color email')));
  assert.equal(r.notes.length, 1, 'the order note was written');
});

test('System front-only and rear-only orders: 200, nothing deducted, 3 images for the one wheel', async () => {
  for (const [name, cids] of [['hydra2-front-28h-only', ['front-rotor-only', 'front-drive-only', 'front-all-spokes']], ['hydra2-rear-32h-all-different', ['rear-drive-only', 'rear-rotor-only', 'rear-all-spokes']]]) {
    const r = await runWebhook(INDEX, 'orders/create', loadSample('system', name));
    assert.equal(r.status, 200, name);
    assert.equal(r.inventoryAdjustments.length, 0, name);
    assert.deepEqual(r.restEmails[0].attachments.map((a) => a.content_id), cids, name);
  }
});

test('System solid front wheel: one all-spokes image for it (not the side-only images), email still sent', async () => {
  const r = await runWebhook(INDEX, 'orders/create', loadSample('system', 'solix-single-color-front'));
  assert.equal(r.status, 200);
  assert.deepEqual(r.restEmails[0].attachments.map((a) => a.content_id), ['front-all-spokes', 'rear-drive-only', 'rear-rotor-only', 'rear-all-spokes']);
  assert.ok(r.restEmails[0].html.includes('Front wheel: all Black'));
  assert.equal(r.restEmails[0].html.includes('one color, no image'), false);
});

test('System order cancelled: nothing restocked, no note, no Shopify mutation, NO email (not even with the customer flag on)', async () => {
  const order = loadSample('system', 'solix-24h-wheelset-multicolor');
  order.note = 'AUTOMATED SYSTEM BUILD REPORT (Industry Nine SYSTEM spokes)\nLeft: 8 x 290mm (Adjusted)'; // even a poisoned note must not restock
  const r = await runWebhook(INDEX, 'orders/cancelled', order, { env: { SYSTEM_CUSTOMER_EMAIL: 'on' } });
  assert.equal(r.status, 200);
  assert.equal(r.inventoryAdjustments.length, 0);
  assert.equal(r.notes.length, 0);
  assert.equal(r.variantQueries.length, 0);
  assert.equal(r.metafieldQueries.length, 0);
  assert.equal(r.emails.length, 0, 'no sends on orders/cancelled');
});

test('Resend rejecting the inline images of the internal email: it still goes out text-only with "image failed" lines; webhook still 200', async () => {
  const mock = createMock(loadMockShopify());
  const inner = mock.fetch;
  let n = 0;
  mock.fetch = async (url, init) => {
    if (String(url).includes('api.resend.com') && n++ === 0) return { ok: false, status: 422, json: async () => ({ message: 'attachments too large' }) };
    return inner(url, init);
  };
  const r = await runWebhook(INDEX, 'orders/create', loadSample('system', 'hydra2-wheelset-32f-32r'), { mock });
  assert.equal(r.status, 200);
  assert.equal(r.restEmails.length, 1, 'the retry without images was sent');
  assert.equal((r.restEmails[0].attachments || []).length, 0);
  assert.ok(r.restEmails[0].html.includes('image failed: email attachment rejected'));
  assert.equal(r.restEmails[0].html.includes('<img class="wheel-img"'), false);
});

test('Resend rejecting the customer attachments: the customer gets the text-only version with no technical wording', async () => {
  const mock = createMock(loadMockShopify());
  const inner = mock.fetch;
  mock.fetch = async (url, init) => {
    const b = JSON.parse(init.body);
    if (String(url).includes('api.resend.com') && String(b.subject).startsWith('Your custom spoke colors') && b.attachments) return { ok: false, status: 422, json: async () => ({ message: 'attachments too large' }) };
    return inner(url, init);
  };
  const r = await runWebhook(INDEX, 'orders/create', loadSample('system', 'hydra2-wheelset-32f-32r'), { mock, env: { SYSTEM_CUSTOMER_EMAIL: 'on' } });
  const customer = r.restEmails.filter(isCustomerMail);
  assert.equal(customer.length, 1, 'only the text-only retry was recorded as accepted');
  assert.equal(customer[0].attachments, undefined);
  assert.equal(/image failed|attachment|rejected|<img/i.test(customer[0].html), false);
  assert.ok(customer[0].html.includes('Here are the spoke colors you designed for your wheels.'));
});

test('Standard order still deducts inventory through the SDK email path (System code and the customer flag not in the way)', async () => {
  const r = await runWebhook(INDEX, 'orders/create', loadSample('standard', 'steel-jbend-wheelset'), { env: { SYSTEM_CUSTOMER_EMAIL: 'on' } });
  assert.equal(r.status, 200);
  assert.equal(r.inventoryAdjustments.length, 4, 'left + right for front and rear');
  assert.equal(r.sdkEmails.length, 1);
  assert.equal(r.restEmails.length, 0, 'a Standard order never gets a System or customer email');
  assert.ok(r.note.includes('AUTOMATED SPOKE CALCULATION & INVENTORY'));
  assert.ok(r.note.includes('Please ship by Friday.'));
});
