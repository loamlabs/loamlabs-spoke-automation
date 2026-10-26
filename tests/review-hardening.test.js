// REVIEW (backend-review): regression tests for the hostile-_build findings. The _build line property comes from the customer's browser,
// so every value in it can be anything. These tests use the REAL renderer where the finding was a native crash.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runWebhook, loadSample, createMock, loadMockShopify } from './helpers/webhook-harness.mjs';
import { findSystemBuildRecipe, systemWheels, hexFor, hubModelOf, NEUTRAL_HEX, MAX_SPOKES, MAX_NAME_CHARS } from '../_lib/system-build.js';
import { buildSystemReport, sendSystemEmail } from '../_lib/system-report.js';
import { wheelSvg } from '../_lib/wheel-svg.js';
import { geometry } from '../_lib/studio-geometry.js';
import { secretMatches, clampImageWidth } from '../api/test-system-email.js';

const INDEX = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'api', 'index.js');
const sys = (n = 'hydra2-front-28h-only') => loadSample('system', n);
const buildProp = (o) => o.line_items[0].properties.find((p) => p.name === '_build');
const withRecipe = (o, fn) => { const p = buildProp(o); const r = JSON.parse(p.value); fn(r); p.value = JSON.stringify(r); return o; };
const fakePng = async (svg) => Buffer.from('PNG:' + svg.length);

test('rim_erd = 0.0001 in the recipe (crashed the native renderer): sample ERD is used, 3 real PNGs, no process abort', async () => {
  const order = withRecipe(sys(), (r) => { r.components.frontRim.rim_erd = '0.0001'; });
  const recipe = findSystemBuildRecipe(order).recipe;
  const report = await buildSystemReport({ recipe, orderData: order }); // real @resvg/resvg-js
  assert.equal(report.wheels[0].config.source.erd, 'sample');
  assert.equal(report.wheels[0].config.erd, 590);
  assert.deepEqual(report.imageErrors, []);
  assert.equal(report.images.length, 3);
  assert.ok(report.images.every((i) => i.png.subarray(1, 4).toString() === 'PNG'));
  for (const bad of ['1e308', '-1', '0', 'abc', '199', '801', { x: 1 }]) {
    const o = withRecipe(sys(), (r) => { r.components.frontRim.rim_erd = bad; });
    const w = systemWheels(findSystemBuildRecipe(o).recipe, null, o);
    assert.equal(w[0].config.erd, 590, `rim_erd ${JSON.stringify(bad)} ignored`);
  }
  const ok = withRecipe(sys(), (r) => { r.components.frontRim.rim_erd = '601.5'; });
  assert.equal(systemWheels(findSystemBuildRecipe(ok).recipe, null, ok)[0].config.erd, 601.5, 'a sane recipe ERD is still used');
});

test('metafield geometry out of range (typo in Shopify) is ignored too; sane values are used', () => {
  const order = sys();
  const recipe = findSystemBuildRecipe(order).recipe;
  const hubId = recipe.components.frontHub.variantId, rimId = recipe.components.frontRim.variantId;
  const bad = new Map([[hubId, { hub_flange_diameter_right: '0.5', hub_flange_diameter_left: '9999' }], [rimId, { rim_erd: '2' }]]);
  const [w] = systemWheels(recipe, bad, order);
  assert.equal(w.config.erd, 590); assert.equal(w.config.drive.pcd, 46); assert.equal(w.config.rotor.pcd, 46);
  assert.deepEqual(w.config.source, { erd: 'recipe', pcdDrive: 'sample', pcdRotor: 'sample', cross: 'sample' }, 'bad metafield ERD skipped; the sane recipe copy (590) is used');
  const good = new Map([[hubId, { hub_flange_diameter_right: '48', hub_flange_diameter_left: '47' }], [rimId, { rim_erd: '588' }]]);
  const [g] = systemWheels(recipe, good, order);
  assert.equal(g.config.erd, 588); assert.equal(g.config.drive.pcd, 48); assert.equal(g.config.rotor.pcd, 47);
  assert.equal(g.config.source.erd, 'metafield');
});

test('wheelSvg refuses non-finite or absurd coordinates with a RangeError (caught per image by the report), instead of handing them to the renderer', () => {
  const cfg = { erd: 0.0001, rimHoles: 28, drive: { n: 14, pcd: 46, cross: 2 }, rotor: { n: 14, pcd: 46, cross: 2 } };
  const geom = geometry({ wheels: { front: cfg } }).front;
  const colorsHex = { drive: new Array(14).fill('#d0262b'), rotor: new Array(14).fill('#1d1f23') };
  assert.throws(() => wheelSvg({ config: cfg, geom, colorsHex, hubHex: '#1d1f23', pov: 'drive', size: 600 }), RangeError);
  assert.throws(() => wheelSvg({ config: { ...cfg, erd: NaN }, geom, colorsHex, hubHex: '#1d1f23', pov: 'drive', size: 600 }), RangeError);
  const fine = wheelSvg({ config: { ...cfg, erd: 590 }, geom, colorsHex, hubHex: '#1d1f23', pov: 'drive', size: 600 });
  assert.ok(fine.startsWith('<svg'));
});

test('spoke count "99999999h" / "4000000000h" / "500h" (used to allocate until the process died): default count, warning, fast', async () => {
  for (const count of ['99999999h', '4000000000h', '500h', '65h', '0h', 'abc']) {
    const order = withRecipe(sys(), (r) => { r.specs.frontSpokeCount = count; });
    const t0 = Date.now();
    const report = await buildSystemReport({ recipe: findSystemBuildRecipe(order).recipe, orderData: order, renderPng: fakePng });
    assert.ok(Date.now() - t0 < 2000, `${count}: ${Date.now() - t0} ms`);
    assert.equal(report.wheels[0].total, 32, `${count}: drawn as the Hydra2 default`);
    assert.ok(report.warnings.some((w) => w.includes('spoke count') && w.includes(`1 to ${MAX_SPOKES}`)), `${count}: warning present: ${report.warnings.join(' | ')}`);
  }
  const ok = withRecipe(sys(), (r) => { r.specs.frontSpokeCount = '28h'; });
  const r = await buildSystemReport({ recipe: findSystemBuildRecipe(ok).recipe, orderData: ok, renderPng: fakePng });
  assert.equal(r.wheels[0].total, 28);
  assert.equal(r.warnings.filter((w) => w.includes('spoke count')).length, 0);
});

test('color / hub names that are Object.prototype keys draw neutral gray and "System", never a function or [object Object]', async () => {
  assert.equal(hexFor('constructor'), NEUTRAL_HEX);
  assert.equal(hexFor('__proto__'), NEUTRAL_HEX);
  assert.equal(hexFor('toString'), NEUTRAL_HEX);
  assert.equal(hexFor('Orange'), '#f07a1a');
  assert.equal(hubModelOf({ specs: { systemHub: 'constructor' } }, 'front'), null);
  assert.equal(hubModelOf({ specs: { systemHub: 'Solix' } }, 'front').label, 'Solix');
  const order = withRecipe(sys(), (r) => {
    r.system.studio.spokes.front.drive[0] = 'constructor';
    r.system.studio.spokes.front.rotor[0] = '__proto__';
    r.specs.systemHub = 'constructor';
    r.components.frontHub.selectedOptions.find((x) => x.name === 'Color').value = 'constructor';
  });
  const report = await buildSystemReport({ recipe: findSystemBuildRecipe(order).recipe, orderData: order, renderPng: fakePng });
  const styles = [...report.html.matchAll(/style="background:([^"]*)"/g)].map((m) => m[1]);
  assert.ok(styles.length > 0 && styles.every((s) => /^#[0-9a-f]{6}$/i.test(s)), `swatches are hex only: ${JSON.stringify([...new Set(styles)])}`);
  assert.equal(/function |\[object Object\]/.test(report.html), false, report.html.match(/.{0,80}(function |\[object Object\]).{0,40}/)?.[0]);
  assert.equal(/function |\[object Object\]|undefined/.test(report.note), false, report.note.match(/.{0,80}(function |\[object Object\]|undefined).{0,40}/)?.[0]);
  assert.ok(report.warnings.some((w) => w.includes('constructor (Studio 1, cart 0)')), 'cart cross-check counts a "constructor" color as absent from the cart');
  for (const img of report.images) assert.equal(/function |\[object Object\]/.test(img.svg), false);
});

test('a 1 MB color name / hub title is cut: the note and the emails stay bounded', async () => {
  const order = withRecipe(sys(), (r) => {
    r.system.studio.spokes.front.drive[0] = 'X'.repeat(1 << 20);
    r.system.studio.base.front.rotor = 'Y'.repeat(1 << 20);
    r.components.frontHub.title = 'T'.repeat(1 << 20);
    r.components.frontHub.variantTitle = 'V'.repeat(1 << 20);
    r.components.frontRim.title = 'R'.repeat(1 << 20);
  });
  const report = await buildSystemReport({ recipe: findSystemBuildRecipe(order).recipe, orderData: order, renderPng: fakePng });
  assert.ok(report.note.length < 5000, `note ${report.note.length} bytes`);
  assert.ok(report.html.length < 60000, `html ${report.html.length} bytes`);
  assert.ok(report.wheels[0].counts.all.every((c) => c.color.length <= MAX_NAME_CHARS + 1));
  assert.ok(report.wheels[0].hubTitle.length <= 201);
});

test('webhook: a recipe with components = null still produces the note and the internal email (no silent CRASH)', async () => {
  for (const fn of [(r) => { r.components = null; }, (r) => { delete r.components; }, (r) => { r.components = 'str'; }]) {
    const order = withRecipe(sys(), fn);
    const r = await runWebhook(INDEX, 'orders/create', order, { mock: createMock(loadMockShopify()) });
    assert.equal(r.status, 200);
    assert.equal(r.notes.length, 1, 'note written');
    assert.equal(r.restEmails.length, 1, 'internal email sent');
    assert.equal(r.inventoryAdjustments.length, 0);
    assert.equal(r.logs.filter(([l, m]) => l === 'error' && m.includes('CRASH')).length, 0, r.logs.filter(([l]) => l === 'error').map(([, m]) => m).join('\n'));
  }
});

test('email subject never carries a line break, whatever the order number looks like', async () => {
  const sent = [];
  const fetchImpl = async (url, init) => { sent.push(JSON.parse(init.body)); return { ok: true, status: 200, json: async () => ({ id: 'x' }) }; };
  await sendSystemEmail({ report: { subject: 'Order #1\r\nBcc: evil@example.com', html: '<p>x</p>', images: [] }, to: 'a@b.co', apiKey: 'k', fetchImpl });
  assert.equal(sent[0].subject, 'Order #1 Bcc: evil@example.com');
  assert.deepEqual(Object.keys(sent[0]).sort(), ['from', 'html', 'reply_to', 'subject', 'to']);
  assert.deepEqual(sent[0].to, ['a@b.co']);
});

test('test endpoint: constant-time secret check fails closed; render width is clamped', () => {
  assert.equal(secretMatches('abc', 'abc'), true);
  assert.equal(secretMatches('abd', 'abc'), false);
  assert.equal(secretMatches('ab', 'abc'), false);
  assert.equal(secretMatches(undefined, 'abc'), false);
  assert.equal(secretMatches('abc', undefined), false, 'env var missing');
  assert.equal(secretMatches('', ''), false, 'empty env var');
  assert.equal(secretMatches(['abc'], 'abc'), false, 'duplicate header');
  assert.equal(clampImageWidth(20000), 2000);
  assert.equal(clampImageWidth(10), 100);
  assert.equal(clampImageWidth('600'), 600);
  assert.equal(clampImageWidth('abc'), undefined);
});
