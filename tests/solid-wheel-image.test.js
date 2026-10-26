// I9-SYSTEM: a wheel that is ONE solid color shows exactly one image in the email, the all-spokes view (same view and caption style as the
// third image of a custom wheel); it does not get the drive-side-only and rotor-side-only images. A wheel with two or more colors keeps its
// three images. Both the internal report and the customer version are checked. When emails are sent is unchanged (covered by the other suites).
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSample, runWebhook } from './helpers/webhook-harness.mjs';
import { findSystemBuildRecipe, systemWheels, SYSTEM_COLOR_HEX } from '../_lib/system-build.js';
import { buildSystemReport, buildCustomerEmail, imageSpecsFor } from '../_lib/system-report.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const INDEX = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'api', 'index.js');
const fakePng = async () => Buffer.from('PNG');
const cidsOf = (report) => report.images.map((i) => i.cid);
const imgTags = (html) => (html.match(/<img class="wheel-img"/g) || []).length;

// builds a report for a sample, optionally making wheels solid (every spoke of the wheel one color) first
async function reportFor(sample, { solid = {} } = {}) {
  const order = loadSample('system', sample), recipe = findSystemBuildRecipe(order).recipe;
  for (const [pos, color] of Object.entries(solid)) {
    const s = recipe.system.studio.spokes[pos];
    s.drive = s.drive.map(() => color); s.rotor = s.rotor.map(() => color);
    recipe.system.studio.base[pos] = { drive: color, rotor: color };
  }
  const report = await buildSystemReport({ recipe, orderData: order, renderPng: fakePng });
  return { report, order, recipe, customer: buildCustomerEmail({ wheels: report.wheels, images: report.images, orderData: order }) };
}

test('the solid-wheel image is the SAME spec as the third (all spokes) image of a custom wheel: same view, same caption style', () => {
  for (const pos of ['front', 'rear']) {
    assert.deepEqual(imageSpecsFor(pos, true), [imageSpecsFor(pos)[2]]);
    assert.equal(imageSpecsFor(pos).length, 3, 'a custom wheel still has three');
  }
  assert.equal(imageSpecsFor('rear', true)[0].caption, 'Rear wheel, all spokes (drive side view)');
  assert.equal(imageSpecsFor('front', true)[0].caption, 'Front wheel, all spokes (rotor side view)');
});

test('solid REAR wheel, custom front wheel (the Solix 24h sample): 1 + 3 images, one all-spokes image for the rear', async () => {
  const { report, customer } = await reportFor('solix-24h-wheelset-front-custom-rear-solid');
  const [front, rear] = report.wheels;
  assert.equal(front.isMultiColor, true); assert.equal(rear.isMultiColor, false);
  assert.deepEqual(front.counts.all, [{ color: 'Orange', n: 16 }, { color: 'Purple', n: 8 }]);
  assert.deepEqual(rear.counts.all, [{ color: 'Black', n: 24 }]);
  assert.deepEqual(cidsOf(report), ['front-rotor-only', 'front-drive-only', 'front-all-spokes', 'rear-all-spokes'], 'front: three, rear: one');
  assert.deepEqual(report.images.map((i) => i.caption), ['Front wheel, rotor side spokes only', 'Front wheel, drive side spokes only', 'Front wheel, all spokes (rotor side view)', 'Rear wheel, all spokes (drive side view)']);
  assert.deepEqual(report.imageErrors, []);
  for (const [label, html] of [['internal', report.html], ['customer', customer.html]]) {
    assert.equal(imgTags(html), 4, `${label}: four images in total`);
    assert.ok(html.includes('src="cid:rear-all-spokes"'), label);
    assert.equal(/rear-drive-only|rear-rotor-only/.test(html), false, `${label}: no side-only images for the solid rear wheel`);
    assert.equal(html.includes('one color, no image'), false, `${label}: the "(one color, no image)" text is gone`);
    assert.ok(html.includes('Rear wheel: all Black'), `${label}: the rear wheel still says it is all Black`);
    assert.ok(html.indexOf('Rear wheel: all Black') < html.indexOf('cid:rear-all-spokes'));
    assert.ok(html.indexOf('FRONT WHEEL') < html.indexOf('REAR WHEEL'));
  }
  assert.equal((customer.html.match(/class="caption"/g) || []).length, 4, 'every image carries its caption');
});

test('the solid wheel image really is the full wheel in one color: both sides drawn, every spoke Black, hub in the hub color', async () => {
  const { report } = await reportFor('solix-24h-wheelset-front-custom-rear-solid');
  const svg = report.images.find((i) => i.cid === 'rear-all-spokes').svg;
  const lines = (side) => { const m = new RegExp(`<g data-side="${side}">([\\s\\S]*?)</g>`).exec(svg); return m ? (m[1].match(/<line /g) || []).length : 0; };
  assert.equal(lines('drive'), 32, '16 drive spokes (edge + color line each)');
  assert.equal(lines('rotor'), 16, '8 rotor spokes');
  const colors = [...svg.matchAll(/stroke="(#[0-9a-f]{6})" stroke-width="[\d.]+"\/>/gi)].map((m) => m[1].toLowerCase()).filter((c) => c !== '#8e939a'); // drop the edge color
  assert.equal(colors.filter((c) => c === SYSTEM_COLOR_HEX.Black.toLowerCase()).length, 24);
  assert.ok(svg.includes('stop-color="#7b3fb9"'), 'Purple hub');
  assert.equal(/opacity|rgba\(/i.test(svg), false, 'still no fading / alpha');
});

test('custom FRONT wheel only (front-only build): three images, unchanged', async () => {
  const { report, customer } = await reportFor('hydra2-front-28h-only');
  assert.deepEqual(cidsOf(report), ['front-rotor-only', 'front-drive-only', 'front-all-spokes']);
  assert.equal(imgTags(report.html), 3);
  assert.equal(imgTags(customer.html), 3);
});

test('BOTH wheels solid: two images in total, one per wheel; the customer email is still only built when a wheel has 2+ colors', async () => {
  const { report, customer } = await reportFor('solix-24h-wheelset-multicolor', { solid: { front: 'Orange', rear: 'Black' } });
  assert.ok(report.wheels.every((w) => !w.isMultiColor));
  assert.deepEqual(cidsOf(report), ['front-all-spokes', 'rear-all-spokes']);
  assert.deepEqual(report.images.map((i) => i.caption), ['Front wheel, all spokes (rotor side view)', 'Rear wheel, all spokes (drive side view)']);
  assert.equal(imgTags(report.html), 2);
  assert.ok(report.html.includes('Front wheel: all Orange') && report.html.includes('Rear wheel: all Black'));
  assert.equal(report.html.includes('one color, no image'), false);
  assert.equal(customer, null, 'send rule unchanged: no wheel with 2+ colors means no customer email');
});

test('BOTH wheels custom: six images, unchanged', async () => {
  const { report, customer } = await reportFor('solix-24h-wheelset-multicolor');
  assert.deepEqual(cidsOf(report), ['front-rotor-only', 'front-drive-only', 'front-all-spokes', 'rear-drive-only', 'rear-rotor-only', 'rear-all-spokes']);
  assert.equal(imgTags(report.html), 6);
  assert.equal(imgTags(customer.html), 6);
});

test('customer email with a solid wheel: nothing internal leaks in, and the text-only fallback keeps the "all Black" line without images', async () => {
  const { customer } = await reportFor('solix-24h-wheelset-front-custom-rear-solid');
  for (const forbidden of [/Spoke lengths/i, /not calculated/i, /NOTE:/, /Build ID/i, /Custom color fee/i, /one color/i, /image failed/i]) assert.equal(forbidden.test(customer.html), false, String(forbidden));
  assert.ok(customer.html.includes('Hi Alex,'));
  assert.equal(customer.fallbackHtml.includes('cid:'), false);
  assert.ok(customer.fallbackHtml.includes('Rear wheel: all Black'));
});

test('a failing renderer for a solid wheel is reported as one "image failed" line and never throws', async () => {
  const order = loadSample('system', 'solix-24h-wheelset-front-custom-rear-solid'), recipe = findSystemBuildRecipe(order).recipe;
  let n = 0;
  const report = await buildSystemReport({ recipe, orderData: order, renderPng: async () => { if (++n > 3) throw new Error('boom'); return Buffer.from('x'); } }); // front renders, the rear image fails
  assert.deepEqual(cidsOf(report), ['front-rotor-only', 'front-drive-only', 'front-all-spokes']);
  assert.deepEqual(report.imageErrors, ['Rear wheel, all spokes (drive side view): image failed: boom']);
  assert.ok(report.html.includes('image failed: boom') && report.html.includes('Rear wheel: all Black'));
});

test('through the webhook: same sends as before (internal always; customer only with the flag), now with the solid wheel image attached', async () => {
  const off = await runWebhook(INDEX, 'orders/create', loadSample('system', 'solix-24h-wheelset-front-custom-rear-solid'));
  assert.equal(off.status, 200);
  assert.equal(off.restEmails.length, 1, 'flag off: only the internal email');
  assert.deepEqual(off.restEmails[0].attachments.map((a) => a.content_id), ['front-rotor-only', 'front-drive-only', 'front-all-spokes', 'rear-all-spokes']);
  const on = await runWebhook(INDEX, 'orders/create', loadSample('system', 'solix-24h-wheelset-front-custom-rear-solid'), { env: { SYSTEM_CUSTOMER_EMAIL: 'on' } });
  assert.equal(on.restEmails.length, 2);
  assert.deepEqual(on.restEmails[1].to, ['customer@example.com']);
  assert.deepEqual(on.restEmails[1].attachments.map((a) => a.content_id), ['front-rotor-only', 'front-drive-only', 'front-all-spokes', 'rear-all-spokes']);
  assert.ok(on.restEmails[1].subject.startsWith('Your custom spoke colors'));
  assert.ok(on.note.includes('Whole wheel (24): Black ×24 (one color)'), 'the order note is unchanged');
});
