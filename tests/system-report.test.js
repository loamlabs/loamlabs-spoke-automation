// I9-SYSTEM: System build parsing, color counts, the 3-image set per multi-color wheel (no fading), the length hook wiring, the customer
// email content and failure handling.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSample } from './helpers/webhook-harness.mjs';
import { findSystemBuildRecipe, systemWheels, isSystemFeeLineItem, SYSTEM_FEE } from '../_lib/system-build.js';
import { buildSystemReport, buildCustomerEmail, imageSpecsFor, customerRecipient, customerFirstName } from '../_lib/system-report.js';
import * as wheelSvgModule from '../_lib/wheel-svg.js';
import { SYSTEM_LENGTHS_PENDING_TEXT } from '../_lib/system-lengths.js';
import { SYSTEM_SAMPLES } from '../samples/index.js';

const fakePng = async (svg) => Buffer.from('PNG:' + svg.length); // no native renderer needed for most tests
const recipeOf = (name) => { const o = loadSample('system', name); return { order: o, recipe: findSystemBuildRecipe(o).recipe }; };
const SYSTEM_SAMPLE_NAMES = ['solix-24h-wheelset-multicolor', 'hydra2-wheelset-28f-32r', 'hydra2-wheelset-32f-32r', 'hydra2-front-28h-only', 'hydra2-front-32h-only', 'hydra2-rear-32h-only', 'solix-single-color-front', 'hydra2-rear-32h-all-different', 'solix-24h-wheelset-front-custom-rear-solid', 'solix-24h-wheelset-both-solid-black'];

test('System builds are recognized, Standard builds are not; the sample list is the real-wheel list (no Hydra2 28h rear)', () => {
  const BUNDLE_SAMPLE_NAMES = ['hydra2-bundle-front-custom-rear-solid', 'solix-bundle-24h-both-solid-black']; // round 6: the spokes as one bundle line per wheel (tests/system-spoke-bundle.test.js)
  assert.deepEqual(Object.keys(SYSTEM_SAMPLES).sort(), [...SYSTEM_SAMPLE_NAMES, ...BUNDLE_SAMPLE_NAMES].sort());
  for (const n of [...SYSTEM_SAMPLE_NAMES, ...BUNDLE_SAMPLE_NAMES]) assert.ok(findSystemBuildRecipe(loadSample('system', n)), n);
  for (const n of ['steel-jbend-wheelset', 'berd-straightpull-front', 'rimbrake-front-own-rear-hub']) {
    assert.equal(findSystemBuildRecipe(loadSample('standard', n)), null, n);
  }
  assert.equal(findSystemBuildRecipe({ line_items: [] }), null);
  assert.equal(findSystemBuildRecipe(null), null);
  assert.equal(findSystemBuildRecipe({ line_items: [{ properties: [{ name: '_is_custom_wheel_build', value: 'true' }, { name: '_build', value: '{not json' }] }] }), null);
});

test('every System sample is a combination a customer can build: Hydra2 front 28h/32h, Hydra2 rear 32h only, Solix 24h front and rear', () => {
  for (const n of SYSTEM_SAMPLE_NAMES) {
    const { order, recipe } = recipeOf(n);
    for (const w of systemWheels(recipe, null, order)) {
      const key = `${w.hubModel} ${w.position} ${w.total}h`;
      assert.ok(['Hydra2 front 28h', 'Hydra2 front 32h', 'Hydra2 rear 32h', 'Solix front 24h', 'Solix rear 24h'].includes(key), `${n}: ${key} is not a real wheel`);
    }
  }
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
  assert.equal(front.counts.all.reduce((s, c) => s + c.n, 0), 24);
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
  const { order, recipe } = recipeOf('hydra2-front-28h-only');
  const broken = JSON.parse(JSON.stringify(order));
  broken.line_items.filter((li) => li.title === 'Industry Nine SYSTEM Spokes')[0].quantity += 1; // one spoke too many in the cart
  broken.line_items = broken.line_items.filter((li) => !isSystemFeeLineItem(li));                 // and the fee line is gone
  const [front] = systemWheels(recipe, null, broken);
  assert.ok(front.warnings.some((w) => w.includes('cart spoke lines do not match')), front.warnings.join(' | '));
  assert.ok(front.warnings.some((w) => w.includes('no "Custom Spoke Color Configuration" line')), front.warnings.join(' | '));
});

/* ------------------------------------------------------------------ the 3-image set */

test('image specs: a) all spokes from the high side, b) high-tension side only, c) low-tension side only; captions and ids per wheel', () => {
  assert.deepEqual(imageSpecsFor('front').map((s) => [s.cid, s.caption, s.sides, s.pov]), [
    ['front-all-spokes', 'Front wheel, all spokes (rotor side view)', ['drive', 'rotor'], 'rotor'],
    ['front-rotor-only', 'Front wheel, rotor side spokes only', ['rotor'], 'rotor'],
    ['front-drive-only', 'Front wheel, drive side spokes only', ['drive'], 'drive']
  ]);
  assert.deepEqual(imageSpecsFor('rear').map((s) => [s.cid, s.caption, s.sides, s.pov]), [
    ['rear-all-spokes', 'Rear wheel, all spokes (drive side view)', ['drive', 'rotor'], 'drive'],
    ['rear-drive-only', 'Rear wheel, drive side spokes only', ['drive'], 'drive'],
    ['rear-rotor-only', 'Rear wheel, rotor side spokes only', ['rotor'], 'rotor']
  ]);
});

test('report: 3 images per multi-color wheel in order a, b, c (all spokes first), front wheel first; none for a single-color wheel; pending length line', async () => {
  const { order, recipe } = recipeOf('solix-24h-wheelset-multicolor');
  const report = await buildSystemReport({ recipe, orderData: order, renderPng: fakePng });
  assert.deepEqual(report.images.map((i) => i.cid), ['front-all-spokes', 'front-rotor-only', 'front-drive-only', 'rear-all-spokes', 'rear-drive-only', 'rear-rotor-only']);
  assert.deepEqual(report.images.map((i) => i.caption), [
    'Front wheel, all spokes (rotor side view)', 'Front wheel, rotor side spokes only', 'Front wheel, drive side spokes only',
    'Rear wheel, all spokes (drive side view)', 'Rear wheel, drive side spokes only', 'Rear wheel, rotor side spokes only'
  ]);
  const pos = report.images.map((i) => report.html.indexOf(`cid:${i.cid}`));
  assert.ok(pos.every((p, i) => p > 0 && (i === 0 || p > pos[i - 1])), 'images appear in this order in the HTML');
  assert.ok(report.html.indexOf('FRONT WHEEL') < report.html.indexOf('REAR WHEEL'), 'front section before rear');
  assert.deepEqual(report.imageErrors, []);
  assert.ok(report.html.includes(SYSTEM_LENGTHS_PENDING_TEXT));
  assert.ok(report.subject.includes('System'));

  const single = recipeOf('solix-single-color-front');
  const r2 = await buildSystemReport({ recipe: single.recipe, orderData: single.order, renderPng: fakePng });
  assert.deepEqual(r2.images.map((i) => i.cid), ['front-all-spokes', 'rear-all-spokes', 'rear-drive-only', 'rear-rotor-only'], 'the solid front wheel gets ONE all-spokes image, the custom rear wheel three');
  assert.ok(r2.html.includes('Front wheel: all Black'));
});

test('SVG: every spoke at full opacity, no fading and no alpha anywhere; FAR_SIDE_OPACITY is gone', async () => {
  assert.equal('FAR_SIDE_OPACITY' in wheelSvgModule, false, 'FAR_SIDE_OPACITY must be removed');
  for (const n of SYSTEM_SAMPLE_NAMES) {
    const { order, recipe } = recipeOf(n);
    const report = await buildSystemReport({ recipe, orderData: order, renderPng: fakePng });
    for (const img of report.images) {
      assert.equal(/opacity/i.test(img.svg), false, `${n}/${img.cid}: the SVG must not contain any opacity attribute`);
      assert.equal(/rgba\(|hsla\(|#[0-9a-f]{8}\b/i.test(img.svg), false, `${n}/${img.cid}: the SVG must not use alpha colors`);
    }
  }
});

test('SVG content per image: spokes-only draws one side, all-spokes draws both; white background; hub in the customer hub color; stem present', async () => {
  const { order, recipe } = recipeOf('hydra2-wheelset-32f-32r');
  const report = await buildSystemReport({ recipe, orderData: order, renderPng: fakePng });
  const byId = Object.fromEntries(report.images.map((i) => [i.cid, i.svg]));
  const lines = (svg, side) => { const m = new RegExp(`<g data-side="${side}">([\\s\\S]*?)</g>`).exec(svg); return m ? (m[1].match(/<line /g) || []).length : 0; };
  // 32h Hydra2: 16 spokes per side, each spoke = edge line + color line
  assert.equal(lines(byId['front-rotor-only'], 'rotor'), 32); assert.equal(lines(byId['front-rotor-only'], 'drive'), 0);
  assert.equal(lines(byId['front-drive-only'], 'drive'), 32); assert.equal(lines(byId['front-drive-only'], 'rotor'), 0);
  assert.equal(lines(byId['front-all-spokes'], 'drive'), 32); assert.equal(lines(byId['front-all-spokes'], 'rotor'), 32);
  assert.equal(lines(byId['rear-drive-only'], 'drive'), 32); assert.equal(lines(byId['rear-drive-only'], 'rotor'), 0);
  assert.equal(lines(byId['rear-rotor-only'], 'rotor'), 32); assert.equal(lines(byId['rear-rotor-only'], 'drive'), 0);
  for (const svg of Object.values(byId)) {
    assert.ok(svg.includes('<rect width="600" height="600" fill="#ffffff"/>'), 'white background');
    assert.ok(svg.includes('fill="url(#stem)"'), 'valve stem');
  }
  // Black hub: the hub gradient stops are built from the customer's hub color (#1d1f23)
  assert.ok(byId['front-all-spokes'].includes('stop-color="#1d1f23"'));
  // the all-spokes image is mirrored for the rotor view: the same drive spoke ends at a different x than in a drive-side image
  assert.notEqual(byId['front-rotor-only'], byId['front-drive-only']);
});

test('LENGTH-CALC HOOK wiring: numbers from the hook show up in the email and the note with no other change', async () => {
  const { order, recipe } = recipeOf('hydra2-wheelset-32f-32r');
  const fakeCalc = (wheel) => ({ left: wheel.position === 'front' ? 288 : 286, right: wheel.position === 'front' ? 288 : 284, note: 'stub' });
  const report = await buildSystemReport({ recipe, orderData: order, renderPng: fakePng, lengthCalculator: fakeCalc });
  assert.ok(report.html.includes('Left/Rotor 288 mm, Right/Drive 288 mm (stub)'));
  assert.ok(report.note.includes('Left/Rotor 286 mm, Right/Drive 284 mm (stub)'));
  assert.equal(report.html.includes(SYSTEM_LENGTHS_PENDING_TEXT), false);
  const pending = await buildSystemReport({ recipe, orderData: order, renderPng: fakePng, lengthCalculator: () => null });
  assert.ok(pending.html.includes(SYSTEM_LENGTHS_PENDING_TEXT));
  assert.ok(pending.note.includes(SYSTEM_LENGTHS_PENDING_TEXT));
  const throwing = await buildSystemReport({ recipe, orderData: order, renderPng: fakePng, lengthCalculator: () => { throw new Error('boom'); } });
  assert.ok(throwing.note.includes('calculator error: boom'));
});

test('a failing renderer never fails the report: text stays, an "image failed" line appears per image (3 per wheel)', async () => {
  const { order, recipe } = recipeOf('hydra2-front-28h-only');
  const report = await buildSystemReport({ recipe, orderData: order, renderPng: async () => { throw new Error('native binary missing'); } });
  assert.equal(report.images.length, 0);
  assert.equal(report.imageErrors.length, 3);
  assert.ok(report.imageErrors[0].startsWith('Front wheel, all spokes (rotor side view): image failed: native binary missing'));
  assert.ok(report.html.includes('image failed: native binary missing'));
  assert.ok(report.html.includes('Green'));
  assert.ok(report.note.includes('IMAGES:'));
});

test('hub metafields from Shopify override the sample geometry; the Studio value length mismatch is repaired like the Studio does', async () => {
  const { order, recipe } = recipeOf('hydra2-front-28h-only');
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

/* ------------------------------------------------------------------ the order note */

test('order note: text only, carries the length line (pending text, or the numbers once the hook returns them), no images, no customer wording', async () => {
  const { order, recipe } = recipeOf('hydra2-wheelset-28f-32r');
  const pending = await buildSystemReport({ recipe, orderData: order, renderPng: fakePng });
  assert.equal((pending.note.match(/Spoke lengths for System hubs: not calculated \(method pending\)/g) || []).length, 2, 'one length line per wheel');
  const numbers = await buildSystemReport({ recipe, orderData: order, renderPng: fakePng, lengthCalculator: () => ({ left: 280, right: 282 }) });
  assert.equal((numbers.note.match(/Left\/Rotor 280 mm, Right\/Drive 282 mm/g) || []).length, 2);
  for (const note of [pending.note, numbers.note]) {
    assert.ok(note.startsWith('AUTOMATED SYSTEM BUILD REPORT'));
    assert.ok(note.includes('Drive side (14): ') && note.includes('Rotor side (16): '));
    assert.equal(/cid:|<img|\.png|Hi |Here are the spoke colors/i.test(note), false, 'no images or customer wording in the note');
    assert.equal(note.includes('AUTOMATED SPOKE CALCULATION'), false, 'must not look like a Standard note');
    assert.equal(/\(Adjusted\)/.test(note), false, 'must not carry restock markers');
  }
});

/* ------------------------------------------------------------------ customer email */

test('customer email: greeting, one sentence, component details, color tables, the same 3 images per wheel; NO lengths, warnings, fee/mismatch/sample text, build id', async () => {
  const { order, recipe } = recipeOf('hydra2-wheelset-28f-32r');
  // make the internal report noisy on purpose: a spoke-line mismatch and a missing fee line produce warnings
  const noisy = JSON.parse(JSON.stringify(order));
  noisy.line_items.filter((li) => li.title === 'Industry Nine SYSTEM Spokes')[0].quantity += 1;
  noisy.line_items = noisy.line_items.filter((li) => !isSystemFeeLineItem(li));
  const report = await buildSystemReport({ recipe, orderData: noisy, renderPng: fakePng, lengthCalculator: () => ({ left: 281, right: 283, note: 'stub' }) });
  assert.ok(report.warnings.length > 0 && report.html.includes('NOTE:'), 'the internal email is noisy');
  const c = buildCustomerEmail({ wheels: report.wheels, images: report.images, orderData: noisy });
  assert.equal(c.subject, 'Your custom spoke colors, order #90002');
  const html = c.html;
  assert.ok(html.includes('<p>Hi Alex,</p>'));
  assert.ok(html.includes('Here are the spoke colors for your wheels.'));
  for (const w of ['<td>Rim</td>', '<td>Hub</td>', '<td>Hub color</td>', '<td>Freehub</td>', '<td>Spoke count</td>', 'Drive side (14)', 'Rotor side (14)', 'Drive side (16)', 'Rotor side (16)']) assert.ok(html.includes(w), w);
  assert.ok(html.includes('Freehub') && html.includes('MS'));
  assert.deepEqual([...html.matchAll(/src="cid:([a-z-]+)"/g)].map((m) => m[1]), report.images.map((i) => i.cid), 'same images, same order');
  assert.ok(html.indexOf('FRONT WHEEL') < html.indexOf('REAR WHEEL'));
  for (const forbidden of [/Spoke lengths/i, /not calculated/i, /method pending/i, /Left\/Rotor/, /stub/, /NOTE:/, /class="alert"/, /class="failed"/, /does not match|do not match/i,
    /Custom color fee/i, /Custom Spoke Color Configuration/i, /sample/i, /geometry/i, /inventory/i, /Length Variant/i, /Build ID/i, /LL-90002-SYS/, /admin\/orders/, /\bmm\b/]) {
    assert.equal(forbidden.test(html), false, `customer email must not match ${forbidden}`);
  }
  assert.equal(/image failed/i.test(c.fallbackHtml), false);
  assert.equal(c.fallbackHtml.includes('cid:'), false, 'the fallback (text-only) version has no images');
  assert.ok(c.fallbackHtml.includes('Here are the spoke colors for your wheels.'));
});

test('customer email: built for every System build (solid wheels included), null only without wheels; a solid wheel keeps its text line; no name -> "Hi,"', async () => {
  const solo = recipeOf('hydra2-front-32h-only'), single = recipeOf('solix-single-color-front');
  const report = await buildSystemReport({ recipe: single.recipe, orderData: single.order, renderPng: fakePng });
  const c = buildCustomerEmail({ wheels: report.wheels, images: report.images, orderData: single.order });
  assert.ok(c.html.includes('Front wheel: all Black'));
  assert.equal(c.html.includes('one color, no image'), false, 'internal wording stays out of the customer email');
  const allSingle = JSON.parse(JSON.stringify(single.recipe));
  allSingle.system.studio.spokes.rear.drive = allSingle.system.studio.spokes.rear.drive.map(() => 'Black');
  const o2 = JSON.parse(JSON.stringify(single.order));
  const wheels = systemWheels(allSingle, null, o2);
  assert.ok(wheels.every((w) => !w.isMultiColor));
  const both = buildCustomerEmail({ wheels, images: [], orderData: o2 });
  assert.ok(both && both.html.includes('Front wheel: all Black') && both.html.includes('Rear wheel: all Black'), 'both wheels solid -> the customer email is still built');
  assert.equal(buildCustomerEmail({ wheels: [], images: [], orderData: o2 }), null, 'only a build without wheels gets none');
  const nameless = JSON.parse(JSON.stringify(solo.order)); delete nameless.customer.first_name;
  const r2 = await buildSystemReport({ recipe: solo.recipe, orderData: nameless, renderPng: fakePng });
  assert.ok(buildCustomerEmail({ wheels: r2.wheels, images: r2.images, orderData: nameless }).html.includes('<p>Hi,</p>'));
});

test('customer recipient: order.email, else customer.email; first name from the customer, then billing / shipping', () => {
  assert.equal(customerRecipient({ email: ' a@b.co ', customer: { email: 'c@d.co' } }), 'a@b.co');
  assert.equal(customerRecipient({ email: '', customer: { email: 'c@d.co' } }), 'c@d.co');
  assert.equal(customerRecipient({ email: null, customer: null }), null);
  assert.equal(customerRecipient({ email: 'not-an-address' }), null);
  assert.equal(customerFirstName({ customer: { first_name: 'Sam' }, billing_address: { first_name: 'Bill' } }), 'Sam');
  assert.equal(customerFirstName({ billing_address: { first_name: 'Bill' } }), 'Bill');
  assert.equal(customerFirstName({ shipping_address: { first_name: 'Ship' } }), 'Ship');
  assert.equal(customerFirstName({}), null);
});
