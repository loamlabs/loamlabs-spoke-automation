// I9-SYSTEM: idempotency. A re-delivered orders/create for a System order must not send the internal or the customer email twice,
// must not write the note twice, and must not block other orders. Three layers: in-process claim, marker in the delivered note,
// marker in the order's live note in Shopify. If the live note cannot be read the order is processed anyway.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runWebhook, loadSample, createMock, loadMockShopify } from './helpers/webhook-harness.mjs';
import { claimSystemOrder, releaseSystemOrder, resetSystemDedupe, noteHasSystemReport, noteShowsProcessed, CLAIM_TTL_MS, SYSTEM_REPORT_MARKER } from '../_lib/system-dedupe.js';
import { buildSystemReport } from '../_lib/system-report.js';
import { findSystemBuildRecipe } from '../_lib/system-build.js';

const INDEX = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'api', 'index.js');
const isCustomerMail = (e) => String(e.subject).startsWith('Your custom spoke colors');
const isInternalMail = (e) => String(e.subject).startsWith('I9 System Build Report');
const ON = { SYSTEM_CUSTOMER_EMAIL: 'on' };

/* ------------------------------------------------------------------ unit */

test('claim: the first caller owns the order, a duplicate is refused, release lets it be claimed again', () => {
  resetSystemDedupe();
  assert.equal(claimSystemOrder('gid://shopify/Order/1'), true);
  assert.equal(claimSystemOrder('gid://shopify/Order/1'), false, 'duplicate');
  assert.equal(claimSystemOrder('gid://shopify/Order/2'), true, 'another order is not blocked');
  releaseSystemOrder('gid://shopify/Order/1');
  assert.equal(claimSystemOrder('gid://shopify/Order/1'), true, 'released after a crash');
  assert.equal(claimSystemOrder(null), true, 'no key: cannot dedupe in process, never blocks');
  assert.equal(claimSystemOrder(null), true);
  resetSystemDedupe();
});

test('claim: expires after the TTL', () => {
  resetSystemDedupe();
  const t0 = 1_000_000;
  assert.equal(claimSystemOrder('k', t0), true);
  assert.equal(claimSystemOrder('k', t0 + CLAIM_TTL_MS - 1), false);
  assert.equal(claimSystemOrder('k', t0 + CLAIM_TTL_MS), true, 'claim expired');
  resetSystemDedupe();
});

test('marker: the note the System path writes contains it; plain and Standard notes do not', async () => {
  const order = loadSample('system', 'hydra2-front-28h-only');
  const report = await buildSystemReport({ recipe: findSystemBuildRecipe(order).recipe, orderData: order, renderPng: async () => Buffer.from('x') });
  assert.ok(report.note.startsWith(SYSTEM_REPORT_MARKER));
  assert.equal(noteHasSystemReport(report.note), true);
  assert.equal(noteHasSystemReport(`Please ship Friday.\n\n----\n\n${report.note}`), true, 'still found after the customer note is prepended');
  for (const n of [null, undefined, '', 'Customer note only', 'AUTOMATED SPOKE CALCULATION & INVENTORY\nFRONT WHEEL']) assert.equal(noteHasSystemReport(n), false);
});

test('processed = the live note holds one more marker than the delivered (customer) note; a typed or copied marker is not a record', async () => {
  const order = loadSample('system', 'hydra2-front-28h-only');
  const report = await buildSystemReport({ recipe: findSystemBuildRecipe(order).recipe, orderData: order, renderPng: async () => Buffer.from('x') });
  const customer = 'Please ship Friday.';
  const live = `${customer}\n\n----\n\n${report.note}`;
  assert.equal(noteShowsProcessed(live, customer), true, 'our report appended after the customer note');
  assert.equal(noteShowsProcessed(report.note, null), true, 'no customer note');
  assert.equal(noteShowsProcessed(report.note, ''), true);
  assert.equal(noteShowsProcessed(customer, customer), false, 'not processed yet');
  assert.equal(noteShowsProcessed(null, customer), false, 'live note unreadable -> not proven processed (fail open)');
  assert.equal(noteShowsProcessed(undefined, customer), false);
  const typed = `${SYSTEM_REPORT_MARKER} please`;
  assert.equal(noteShowsProcessed(typed, typed), false, 'the customer typed the marker at checkout: still unprocessed');
  assert.equal(noteShowsProcessed(`${typed}\n\n----\n\n${report.note}`, typed), true, 'and processed once our report is appended after it');
  assert.equal(noteShowsProcessed(report.note, report.note), false, 'admin-duplicated order: the copied note is not a record for the new order');
});

/* ------------------------------------------------------------------ webhook */

test('re-delivered orders/create (original payload, live note now holds the report): second delivery sends nothing and writes nothing', async () => {
  const mock = createMock(loadMockShopify());
  const order = loadSample('system', 'solix-24h-wheelset-multicolor');
  const first = await runWebhook(INDEX, 'orders/create', order, { mock, env: ON });
  assert.equal(first.status, 200);
  assert.equal(first.restEmails.length, 2, 'first delivery: internal + customer');
  assert.equal(first.notes.length, 1);
  const emailsAfterFirst = mock.calls.restEmails.length, notesAfterFirst = mock.calls.notes.length, metaAfterFirst = mock.calls.metafieldQueries.length;

  // Shopify re-delivers the ORIGINAL payload (its note has no report yet); the in-process claim is cleared to prove the live-note layer on its own
  const second = await runWebhook(INDEX, 'orders/create', loadSample('system', 'solix-24h-wheelset-multicolor'), { mock, env: ON });
  assert.equal(second.status, 200, 'the duplicate is still answered with 200');
  assert.equal(mock.calls.restEmails.length, emailsAfterFirst, 'no second internal or customer email');
  assert.equal(mock.calls.notes.length, notesAfterFirst, 'no second note write');
  assert.equal(mock.calls.metafieldQueries.length, metaAfterFirst, 'no wasted work');
  assert.equal(second.inventoryAdjustments.length, 0);
  assert.equal(mock.calls.orderNoteQueries.length, 2, 'the live note was checked on both deliveries');
  assert.ok(second.logs.some(([, m]) => m.includes('already has its System report in the order note') && m.includes('nothing sent')));
  assert.equal(mock.calls.restEmails.filter(isInternalMail).length, 1);
  assert.equal(mock.calls.restEmails.filter(isCustomerMail).length, 1);
});

test('concurrent / immediate duplicate on the same instance (live note not yet written): the in-process claim stops it', async () => {
  const order = loadSample('system', 'hydra2-wheelset-32f-32r');
  const first = await runWebhook(INDEX, 'orders/create', order, { env: ON, keepDedupe: true });
  assert.equal(first.restEmails.length, 2);
  // a fresh mock = Shopify's live note shows nothing yet (the note write of the first delivery has not landed); same process, claim kept
  const second = await runWebhook(INDEX, 'orders/create', loadSample('system', 'hydra2-wheelset-32f-32r'), { env: ON, keepDedupe: true });
  assert.equal(second.status, 200);
  assert.equal(second.restEmails.length, 0, 'nothing sent');
  assert.equal(second.notes.length, 0);
  assert.equal(second.calls.orderNoteQueries.length, 0, 'stopped before any Shopify call');
  assert.ok(second.logs.some(([, m]) => m.includes('(duplicate delivery); nothing sent')));
});

test('the delivered payload carries the marker in its (customer) note: NOT a duplicate, the order is processed and the note appended', async () => {
  // a customer who types the marker at checkout, or a staff-duplicated System order whose note was copied, must still get the report
  const order = loadSample('system', 'hydra2-rear-32h-only');
  order.note = `${SYSTEM_REPORT_MARKER} (Industry Nine SYSTEM spokes)\nFRONT WHEEL ...`;
  const mock = createMock(loadMockShopify());
  const r = await runWebhook(INDEX, 'orders/create', order, { mock, env: ON });
  assert.equal(r.status, 200);
  assert.equal(r.restEmails.filter(isInternalMail).length, 1, 'internal email sent');
  assert.equal(r.restEmails.filter(isCustomerMail).length, 1, 'customer email sent');
  assert.equal(r.notes.length, 1, 'report appended to the note');
  assert.equal(r.calls.orderNoteQueries.length, 1, 'the live note was checked');
  assert.ok(r.note.startsWith(order.note), 'customer note preserved');
  // and a re-delivery of that same payload is now recognized (live note holds one more marker than the delivered note)
  const again = await runWebhook(INDEX, 'orders/create', JSON.parse(JSON.stringify(order)), { mock, env: ON });
  assert.equal(again.status, 200);
  assert.equal(mock.calls.restEmails.length, 2, 'no second internal or customer email');
  assert.equal(mock.calls.notes.length, 1, 'no second note write');
});

test('a different order is never blocked by an earlier one (same process, claims kept)', async () => {
  const a = await runWebhook(INDEX, 'orders/create', loadSample('system', 'hydra2-front-28h-only'), { keepDedupe: true });
  const b = await runWebhook(INDEX, 'orders/create', loadSample('system', 'hydra2-front-32h-only'), { keepDedupe: true });
  assert.equal(a.restEmails.length, 1);
  assert.equal(b.restEmails.length, 1);
  assert.equal(b.notes.length, 1);
});

test('first delivery with the live note unreadable (Shopify error): fail open, the order is processed and emailed', async () => {
  const mock = createMock(loadMockShopify());
  mock.state.failOrderNoteQuery = true;
  const r = await runWebhook(INDEX, 'orders/create', loadSample('system', 'hydra2-front-28h-only'), { mock, env: ON });
  assert.equal(r.status, 200);
  assert.equal(r.restEmails.filter(isInternalMail).length, 1, 'a missed report is worse than a rare duplicate');
  assert.equal(r.restEmails.filter(isCustomerMail).length, 1);
  assert.equal(r.notes.length, 1);
  assert.ok(r.logs.some(([lvl, m]) => lvl === 'warn' && m.includes('could not read the live order note')));
});

test('flag off: a duplicate also sends nothing (and the first delivery sent only the internal email)', async () => {
  const mock = createMock(loadMockShopify());
  const first = await runWebhook(INDEX, 'orders/create', loadSample('system', 'solix-24h-wheelset-multicolor'), { mock });
  assert.equal(first.restEmails.length, 1);
  await runWebhook(INDEX, 'orders/create', loadSample('system', 'solix-24h-wheelset-multicolor'), { mock });
  assert.equal(mock.calls.restEmails.length, 1);
});

test('Standard orders are not affected by the guard (their path is untouched: no note lookup, still adjusts inventory)', async () => {
  const r = await runWebhook(INDEX, 'orders/create', loadSample('standard', 'steel-jbend-wheelset'));
  assert.equal(r.inventoryAdjustments.length, 4);
  assert.equal(r.calls.orderNoteQueries.length, 0);
  assert.equal(r.sdkEmails.length, 1);
});
