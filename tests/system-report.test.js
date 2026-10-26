// I9-SYSTEM: System build parsing, color counts, images (only for multi-color wheels), the length hook wiring and failure handling.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSample } from './helpers/webhook-harness.mjs';
import { findSystemBuildRecipe, systemWheels, isSystemFeeLineItem, SYSTEM_FEE } from '../_lib/system-build.js';
import { buildSystemReport, viewsFor } from '../_lib/system-report.js';
import { SYSTEM_LENGTHS_PENDING_TEXT } from '../_lib/system-lengths.js';

const fakePng = async (svg) => Buffer.from('PNG:' + svg.length); // no native renderer needed for these tests
const recipeOf = (name) => { const o = loadSample('system', name); return { order: o, recipe: findSystemBuildRecipe(o).recipe }; };

test('System builds are recognized, Standard builds are not', () => {
  for (const n of ['solix-24h-wheelset-multicolor', 'hydra2-32h-wheelset', 'hydra2-28h-front-only', 'solix-single-color-front', 'hydra2-28h-rear-all-different']) {
    assert.ok(findSystemBuildRecipe(loadSample('system', n)), n);
  }
  for (const n of ['steel-jbend-wheelset', 'berd-straightpull-front', 'rimbrake-front-own-rear-hub']) {
    assert.equal(findSystemBuildRecipe(loadSample('standard', n)), null, n);
  }
  assert.equal(findSystemBuildRecipe({ line_items: [] }), null);
  assert.equal(findSystemBuildRecipe(null), null);
  assert.equal(findSystemBuildRecipe({ line_items: [{ properties: [{ name: '_is_custom_wheel_build', value: 'true' }, { name: '_build', value: '{not json' }] }] }), null);
});

test('Solix 24h 2:1: counts per side follow the Studio value; front rotor side has 16 spokes, rear drive side has 16', () => {
  const { order, recipe } = recipeOf('solix-24h-wheelset-multicolor');
  const wheels = systemWheels(recipe, null, order);
  assert.deepEqual(wheels.map((w) => w.position), ['front', 'rear']);
  const [front, rear] = wheels;
  assert.equal(front.config.drive.n, 8); assert.equal(front.config.rotor.n, 16);
  assert.equal(rear.config.drive.n, 16); assert.equal(rear.config.rotor.n, 8);
  assert.equal(front.hubModel, 'Solix'); assert.equal(front.hubColor, 'Purple');
  assert.equal(rear.freehub, 'XD');
  assert.ok(front.isMultiColor && rear.isMultiColor);
  // 2 x 1 at rotation 0 paints 16 of 24 spokes: a pair, then one skipped
  assert.deepEqual(front.counts.all, [{ color: 'Orange', n: 16 }, { color: 'Black', n: 8 }]);
  assert.deepEqual(rear.counts.rotor, [{ color: 'Turquoise', n: 8 }]);
  assert.equal(rear.counts.all.reduce((s, c) => s + c.n, 0), 24);
  assert.equal(front.feeLines, 1);
  assert.deepEqual(front.warnings, [], 'a consistent order has no warnings');
});

test('a single-color wheel is not multi-color; its order has no fee line', () => {
  const { order, recipe } = recipeOf('solix-single-color-front');
  const [front, rear] = systemWheels(recipe, null, order);
  assert.equal(front.isMultiColor, false);
  assert.deepEqual(front.counts.all, [{ color: 'Black', n: 24 }]);
  assert.equal(front.feeLines, 0);
  assert.equal(rear.isMultiColor, true);
  assert.deepEqual(rear.counts.drive, [{ color: 'Red', n: 16 }]);
  assert.deepEqual(rear.counts.rotor, [{ color: 'Black', n: 8 }]);
});

test('fee line detection by variant id or title; spoke-line mismatches are reported as warnings', () => {
  assert.ok(isSystemFeeLineItem({ variant_id: SYSTEM_FEE.variantId, title: 'whatever' }));
  assert.ok(isSystemFeeLineItem({ variant_id: 1, title: 'Custom Spoke Color Configuration' }));
  assert.equal(isSystemFeeLineItem({ variant_id: 1, title: 'Industry Nine SYSTEM Spokes' }), false);
  const { order, recipe } = recipeOf('hydra2-28h-front-only');
  const broken = JSON.parse(JSON.stringify(order));
  broken.line_items.filter((li) => li.title === 'Industry Nine SYSTEM Spokes')[0].quantity += 1; // one spoke too many in the cart
  broken.line_items = broken.line_items.filter((li) => !isSystemFeeLineItem(li));                 // and the fee line is gone
  const [front] = systemWheels(recipe, null, broken);
  assert.ok(front.warnings.some((w) => w.includes('cart spoke lines do not match')), front.warnings.join(' | '));
  assert.ok(front.warnings.some((w) => w.includes('no "Custom Spoke Color Configuration" line')), front.warnings.join(' | '));
});

test('report: two images per multi-color wheel in the right order, none for a single-color wheel; pending length line; note has no restock markers', async () => {
  const { order, recipe } = recipeOf('solix-single-color-front');
  const report = await buildSystemReport({ recipe, orderData: order, renderPng: fakePng });
  assert.deepEqual(viewsFor('front'), ['rotor', 'drive']);
  assert.deepEqual(viewsFor('rear'), ['drive', 'rotor']);
  assert.deepEqual(report.images.map((i) => i.cid), ['rear-drive-view', 'rear-rotor-view']);
  assert.deepEqual(report.images.map((i) => i.caption), ['Rear wheel, Drive side view', 'Rear wheel, Rotor side view']);
  assert.deepEqual(report.imageErrors, []);
  assert.ok(report.html.includes('Front wheel: all Black'));
  assert.ok(report.html.includes('src="cid:rear-drive-view"'));
  assert.ok(report.html.indexOf('FRONT WHEEL') < report.html.indexOf('REAR WHEEL'), 'front section before rear');
  assert.ok(report.html.includes(SYSTEM_LENGTHS_PENDING_TEXT));
  assert.ok(report.subject.includes('System'));
  assert.ok(report.note.startsWith('AUTOMATED SYSTEM BUILD REPORT'));
  assert.ok(report.note.includes('Drive side (16): Red ×16'));
  assert.ok(report.note.includes(SYSTEM_LENGTHS_PENDING_TEXT));
  assert.equal(report.note.includes('AUTOMATED SPOKE CALCULATION'), false, 'must not look like a Standard note');
  assert.equal(/\(Adjusted\)/.test(report.note), false, 'must not carry restock markers');
  assert.equal(report.note.includes('cid:'), false, 'no images in the note');
});

test('report: front wheel images come first (rotor then drive), then rear (drive then rotor)', async () => {
  const { order, recipe } = recipeOf('solix-24h-wheelset-multicolor');
  const report = await buildSystemReport({ recipe, orderData: order, renderPng: fakePng });
  assert.deepEqual(report.images.map((i) => i.cid), ['front-rotor-view', 'front-drive-view', 'rear-drive-view', 'rear-rotor-view']);
  const order_ = ['cid:front-rotor-view', 'cid:front-drive-view', 'cid:rear-drive-view', 'cid:rear-rotor-view'].map((c) => report.html.indexOf(c));
  assert.ok(order_.every((p, i) => p > 0 && (i === 0 || p > order_[i - 1])), 'images appear in order in the HTML');
});

test('LENGTH-CALC HOOK wiring: numbers from the hook show up in the email and the note with no other change', async () => {
  const { order, recipe } = recipeOf('hydra2-32h-wheelset');
  const fakeCalc = (wheel) => ({ left: wheel.position === 'front' ? 288 : 286, right: wheel.position === 'front' ? 288 : 284, note: 'stub' });
  const report = await buildSystemReport({ recipe, orderData: order, renderPng: fakePng, lengthCalculator: fakeCalc });
  assert.ok(report.html.includes('Left/Rotor 288 mm, Right/Drive 288 mm (stub)'));
  assert.ok(report.note.includes('Left/Rotor 286 mm, Right/Drive 284 mm (stub)'));
  assert.equal(report.html.includes(SYSTEM_LENGTHS_PENDING_TEXT), false);
  const pending = await buildSystemReport({ recipe, orderData: order, renderPng: fakePng, lengthCalculator: () => null });
  assert.ok(pending.html.includes(SYSTEM_LENGTHS_PENDING_TEXT));
  const throwing = await buildSystemReport({ recipe, orderData: order, renderPng: fakePng, lengthCalculator: () => { throw new Error('boom'); } });
  assert.ok(throwing.note.includes('calculator error: boom'));
});

test('a failing renderer never fails the report: text stays, an "image failed" line appears per image', async () => {
  const { order, recipe } = recipeOf('hydra2-28h-front-only');
  const report = await buildSystemReport({ recipe, orderData: order, renderPng: async () => { throw new Error('native binary missing'); } });
  assert.equal(report.images.length, 0);
  assert.equal(report.imageErrors.length, 2);
  assert.ok(report.imageErrors[0].startsWith('Front wheel, Rotor side view: image failed: native binary missing'));
  assert.ok(report.html.includes('image failed: native binary missing'));
  assert.ok(report.html.includes('Green'));
  assert.ok(report.note.includes('IMAGES:'));
});

test('hub metafields from Shopify override the sample geometry; the Studio value length mismatch is repaired like the Studio does', async () => {
  const { order, recipe } = recipeOf('hydra2-28h-front-only');
  const componentData = new Map();
  componentData.set(recipe.components.frontHub.variantId, { hub_flange_diameter_right: '47.5', hub_flange_diameter_left: '45', hub_flange_offset_left: '33', hub_flange_offset_right: '24' });
  componentData.set(recipe.components.frontRim.variantId, { rim_erd: '592' });
  const [front] = systemWheels(recipe, componentData, order);
  assert.equal(front.config.drive.pcd, 47.5); assert.equal(front.config.rotor.pcd, 45); assert.equal(front.config.erd, 592);
  assert.equal(front.config.source.erd, 'metafield');
  assert.deepEqual(front.geometryInput.flangeOffset, { left: 33, right: 24 });
  const broken = JSON.parse(JSON.stringify(recipe));
  broken.system.studio.spokes.front.drive = ['Green', 'Black']; // wrong length
  const [b] = systemWheels(broken, null, order);
  assert.equal(b.colors.drive.length, 14);
  assert.ok(b.colors.drive.every((c) => c === 'Black'));
  assert.ok(b.warnings.some((w) => w.includes('Studio spoke map has 2 entries')));
});
