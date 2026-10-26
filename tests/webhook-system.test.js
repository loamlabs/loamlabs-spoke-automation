// I9-SYSTEM: the webhook with System orders (mocked Shopify + Resend): no inventory is touched on create or cancel, the note and the
// email with inline images go out, and a Standard order still deducts inventory exactly as before.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runWebhook, loadSample, createMock, loadMockShopify } from './helpers/webhook-harness.mjs';

const INDEX = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'api', 'index.js');

test('System wheel set: 200, no inventory adjustment, no variant lookup, note written, email sent by REST with 4 inline images', async () => {
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
  assert.equal(r.sdkEmails.length, 0, 'the Standard email path was not used');
  assert.equal(r.restEmails.length, 1);
  const email = r.restEmails[0];
  assert.deepEqual(email.to, ['builder@example.com']);
  assert.ok(email.subject.includes('System Build Report for Order #90001'));
  assert.equal(email.attachments.length, 4);
  assert.deepEqual(email.attachments.map((a) => a.content_id), ['front-rotor-view', 'front-drive-view', 'rear-drive-view', 'rear-rotor-view']);
  assert.ok(email.attachments.every((a) => a.content_type === 'image/png' && Buffer.from(a.content, 'base64').subarray(1, 4).toString() === 'PNG'), 'real PNG bytes');
  assert.ok(email.html.includes('src="cid:front-rotor-view"'));
  assert.ok(!r.logs.some(([lvl, m]) => lvl === 'error' && m.includes('CRASH')), r.logs.filter(([l]) => l === 'error').map(([, m]) => m).join('\n'));
});

test('System front-only and rear-only orders: 200, nothing deducted, images for the one wheel', async () => {
  for (const [name, cids] of [['hydra2-28h-front-only', ['front-rotor-view', 'front-drive-view']], ['hydra2-28h-rear-all-different', ['rear-drive-view', 'rear-rotor-view']]]) {
    const r = await runWebhook(INDEX, 'orders/create', loadSample('system', name));
    assert.equal(r.status, 200, name);
    assert.equal(r.inventoryAdjustments.length, 0, name);
    assert.deepEqual(r.restEmails[0].attachments.map((a) => a.content_id), cids, name);
  }
});

test('System single-color wheel: no image for it, email still sent', async () => {
  const r = await runWebhook(INDEX, 'orders/create', loadSample('system', 'solix-single-color-front'));
  assert.equal(r.status, 200);
  assert.deepEqual(r.restEmails[0].attachments.map((a) => a.content_id), ['rear-drive-view', 'rear-rotor-view']);
  assert.ok(r.restEmails[0].html.includes('Front wheel: all Black'));
});

test('System order cancelled: nothing restocked, no note, no Shopify mutation at all', async () => {
  const order = loadSample('system', 'solix-24h-wheelset-multicolor');
  // as Shopify would send it after our note was written
  order.note = 'AUTOMATED SYSTEM BUILD REPORT (Industry Nine SYSTEM spokes)\nLeft: 8 x 290mm (Adjusted)'; // even a poisoned note must not restock
  const r = await runWebhook(INDEX, 'orders/cancelled', order);
  assert.equal(r.status, 200);
  assert.equal(r.inventoryAdjustments.length, 0);
  assert.equal(r.notes.length, 0);
  assert.equal(r.variantQueries.length, 0);
  assert.equal(r.metafieldQueries.length, 0);
});

test('Resend rejecting the inline images: the email still goes out text-only with "image failed" lines; webhook still 200', async () => {
  const mock = createMock(loadMockShopify());
  const inner = mock.fetch;
  let n = 0;
  mock.fetch = async (url, init) => {
    if (String(url).includes('api.resend.com') && n++ === 0) return { ok: false, status: 422, json: async () => ({ message: 'attachments too large' }) };
    return inner(url, init);
  };
  const r = await runWebhook(INDEX, 'orders/create', loadSample('system', 'hydra2-32h-wheelset'), { mock });
  assert.equal(r.status, 200);
  assert.equal(r.restEmails.length, 1, 'the retry without images was sent');
  assert.equal((r.restEmails[0].attachments || []).length, 0);
  assert.ok(r.restEmails[0].html.includes('image failed: email attachment rejected'));
  assert.equal(r.restEmails[0].html.includes('<img class="wheel-img"'), false);
});

test('Standard order still deducts inventory through the SDK email path (System code not in the way)', async () => {
  const r = await runWebhook(INDEX, 'orders/create', loadSample('standard', 'steel-jbend-wheelset'));
  assert.equal(r.status, 200);
  assert.equal(r.inventoryAdjustments.length, 4, 'left + right for front and rear');
  assert.equal(r.sdkEmails.length, 1);
  assert.equal(r.restEmails.length, 0);
  assert.ok(r.note.includes('AUTOMATED SPOKE CALCULATION & INVENTORY'));
  assert.ok(r.note.includes('Please ship by Friday.'));
});
