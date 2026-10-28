// Standard orders that carry the theme's standardStudio key: parse, images, side-label captions, the customer email, the painted-spoke list, the fee-rule
// cross-checks, dedupe on a re-delivered webhook, and hostile input. Orders WITHOUT the key must be untouched (also proven by npm run proof:standard).
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runWebhook, loadSample, createMock, loadMockShopify } from './helpers/webhook-harness.mjs';
import { isStandardStudioRecipe, findStandardStudioRecipe, standardWheels, standardPositions, expectedFeeVariant, standardWheelConfig, hexOfStandard } from '../_lib/standard-build.js';
import { buildStandardAdditions, paintPlanFor, paintGroupText, paintTotalText, standardLengthsOf, shortColorName } from '../_lib/standard-report.js';
import { buildCustomerEmail, imageSpecsFor } from '../_lib/system-report.js';
import { findSystemBuildRecipe } from '../_lib/system-build.js';

const INDEX = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'api', 'index.js');
const ON = { STANDARD_CUSTOMER_EMAIL: 'on' };
const png = async () => Buffer.from('PNG');
const isInternal = (e) => /^Spoke Calculation Complete/.test(e.subject);
const isCustomer = (e) => /^Your custom spoke colors/.test(e.subject);
const cids = (e) => (e.attachments || []).map((a) => a.content_id);
const text = (html) => html.replace(/<style>[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/&times;/g, 'x').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/\s+/g, ' ');
const BRAND = /System|Industry Nine|Studio/i;

// loads a Standard sample and lets a test edit its recipe (and the order); returns the edited order
function variant(sample, edit) {
  const order = loadSample('standard', sample), prop = order.line_items[0].properties.find((p) => p.name === '_build');
  const recipe = JSON.parse(prop.value);
  edit(recipe, order);
  prop.value = JSON.stringify(recipe);
  return order;
}
const recipeOf = (sample) => findStandardStudioRecipe(loadSample('standard', sample)).recipe;
const wheelsOf = (sample, componentData = null) => { const o = loadSample('standard', sample); return standardWheels(findStandardStudioRecipe(o).recipe, componentData, o); };
const REAR = 'std-berd-rear-custom-two-painted', STEEL = 'std-steel-wheelset-solid', RADIAL = 'std-berd-front-24h-radial-solid-purple';

/* ------------------------------------------------------------------ detection and parse */

test('only a Standard build that carries standardStudio is keyed; System builds, old Standard builds and parts-only orders are not', () => {
  for (const s of [REAR, STEEL, RADIAL]) assert.ok(findStandardStudioRecipe(loadSample('standard', s)), s);
  for (const s of ['steel-jbend-wheelset', 'berd-straightpull-front', 'rimbrake-front-own-rear-hub']) assert.equal(findStandardStudioRecipe(loadSample('standard', s)), null, `${s}: no key, a normal Standard order`);
  assert.equal(findStandardStudioRecipe(loadSample('system', 'solix-24h-wheelset-multicolor')), null, 'a System build is not a Standard build');
  assert.equal(isStandardStudioRecipe({ spokeInterface: 'standard', standardStudio: {} }), true, 'any object counts');
  assert.equal(isStandardStudioRecipe({ spokeInterface: 'standard', standardStudio: 'x' }), false, 'a string does not');
  assert.equal(isStandardStudioRecipe({ spokeInterface: 'standard', standardStudio: null }), false);
  assert.equal(isStandardStudioRecipe({ spokeInterface: 'standard', standardStudio: [] }), false);
  assert.equal(isStandardStudioRecipe(null), false);
});

test('parse, solid wheel set: both wheels solid in their chosen color, hub colors, side labels, counts, no warnings', () => {
  const [front, rear] = wheelsOf(STEEL);
  assert.deepEqual([front.position, rear.position], ['front', 'rear']);
  assert.equal(front.isMultiColor, false); assert.equal(rear.isMultiColor, false);
  assert.deepEqual(front.counts.all, [{ color: 'Silver', n: 32 }]);
  assert.deepEqual(rear.counts.all, [{ color: 'Black', n: 32 }]);
  assert.equal(front.colors.drive.length, 16); assert.equal(front.colors.rotor.length, 16);
  assert.deepEqual(front.sideLabels, { drive: 'Right side', rotor: 'Left side' });
  assert.deepEqual(rear.sideLabels, { drive: 'Drive side', rotor: 'Non-drive side' });
  assert.equal(front.hubColor, 'Black'); assert.equal(front.hubColorHex, '#1d1f23');
  assert.equal(rear.freehub, 'XD'); assert.equal(front.freehub, null);
  assert.equal(front.spokeCountLabel, '32h'); assert.equal(front.spokeProduct, 'Sapim D-Light J-Bend');
  assert.deepEqual([front.config.drive.cross, front.config.rotor.cross, front.config.drive.n], [3, 3, 16]);
  assert.deepEqual(front.warnings.concat(rear.warnings), [], 'a consistent order has no warnings');
});

test('parse, custom wheel: counts per side and in total follow the saved spoke map; spoke index k is kept', () => {
  const [rear] = wheelsOf(REAR);
  assert.equal(rear.isMultiColor, true);
  assert.deepEqual(rear.counts.all, [{ color: 'Martin Purple', n: 10 }, { color: 'Oriole Orange', n: 8 }, { color: 'Black Berd', n: 6 }]);
  assert.deepEqual(rear.counts.drive.map((c) => [c.color, c.n]), [['Martin Purple', 6], ['Oriole Orange', 4], ['Black Berd', 2]]);
  assert.deepEqual(rear.counts.rotor.map((c) => [c.color, c.n]), [['Black Berd', 4], ['Martin Purple', 4], ['Oriole Orange', 4]]);
  const saved = recipeOf(REAR).standardStudio.studio.spokes.rear;
  assert.deepEqual(rear.colors.drive, saved.drive); assert.deepEqual(rear.colors.rotor, saved.rotor);
  assert.equal(rear.expectedFee, 'Berd multi-color'); assert.equal(rear.feeLines, 1);
  assert.deepEqual(rear.warnings, []);
});

test('parse, rear only and front only builds list only the wheel that exists', () => {
  assert.deepEqual(wheelsOf(REAR).map((w) => w.position), ['rear']);
  assert.deepEqual(wheelsOf(RADIAL).map((w) => w.position), ['front']);
});

test('parse, radial front: crossing 0 is kept (not turned into 3), side labels for a front wheel, 24 spokes in one color', () => {
  const [front] = wheelsOf(RADIAL);
  assert.deepEqual([front.config.drive.cross, front.config.rotor.cross], [0, 0]);
  assert.deepEqual(front.counts.all, [{ color: 'Martin Purple', n: 24 }]);
  assert.deepEqual(front.sideLabels, { drive: 'Right side', rotor: 'Left side' });
  assert.equal(front.expectedFee, 'Berd painted color');
});

test('parse, wheel set with a custom steel rear and a solid front; a wheel with no spoke product (or "Your Own" spokes) is not a wheel', () => {
  const order = variant(STEEL, (r) => {
    const n = 16, studio = { v: 1, hubColor: { rear: 'Black' }, base: { rear: { drive: 'Black', rotor: 'Black' } }, spokes: { rear: { drive: Array.from({ length: n }, (_, k) => (k % 4 === 0 ? 'Silver' : 'Black')), rotor: Array(n).fill('Black') } }, accent: 'Silver' };
    r.standardStudio.studio = studio; r.standardStudio.studioOpened = true;
  });
  const recipe = findStandardStudioRecipe(order).recipe;
  const [front, rear] = standardWheels(recipe, null, order);
  assert.equal(front.isMultiColor, false); assert.equal(rear.isMultiColor, true);
  assert.deepEqual(rear.counts.all, [{ color: 'Black', n: 28 }, { color: 'Silver', n: 4 }]);
  assert.equal(rear.expectedFee, 'Mixed colors');
  assert.ok(rear.warnings.some((w) => w.includes('fee rule expects')), 'steel mixed wheel with no fee line is warned about: ' + rear.warnings.join(' | '));
  const noSpokes = variant(STEEL, (r) => { delete r.components.rearSpokes; });
  assert.deepEqual(standardPositions(findStandardStudioRecipe(noSpokes).recipe), ['front']);
  const own = variant(STEEL, (r) => { r.components.frontSpokes.title = 'Your Own Spokes'; });
  assert.deepEqual(standardPositions(findStandardStudioRecipe(own).recipe), ['rear']);
});

test('parse, studio value repairs: a wrong-length spoke array falls back to the base color with a warning; the legacy "Custom Configuration" color is ignored', () => {
  const order = variant(REAR, (r) => { r.standardStudio.studio.spokes.rear.drive = ['Oriole Orange', 'Black Berd']; r.components.rearSpokes.selectedOptions[0].value = 'Custom Configuration'; delete r.components.rearSpokes.selectedColor; });
  const [rear] = standardWheels(findStandardStudioRecipe(order).recipe, null, order);
  assert.equal(rear.colors.drive.length, 12); assert.ok(rear.colors.drive.every((c) => c === 'Black Berd'));
  assert.ok(rear.warnings.some((w) => w.includes('saved spoke map has 2 entries')));
  assert.equal(rear.counts.all.some((c) => /custom configuration/i.test(c.color)), false);
});

test('fee rule (the theme\'s rule) expectations and the cart cross-checks warn, never fail', () => {
  const E = (o) => expectedFeeVariant(o);
  assert.equal(E({ berdType: false, paintColors: [], colorNames: ['Black'] }), null);
  assert.equal(E({ berdType: false, paintColors: [], colorNames: ['Black', 'Silver'] }), 'Mixed colors');
  assert.equal(E({ berdType: true, paintColors: ['Martin Purple'], colorNames: ['Black Berd'] }), null);
  assert.equal(E({ berdType: true, paintColors: ['Martin Purple'], colorNames: ['White Berd'] }), null);
  assert.equal(E({ berdType: true, paintColors: ['Martin Purple'], colorNames: ['Black Berd', 'White Berd'] }), 'Mixed colors');
  assert.equal(E({ berdType: true, paintColors: ['Martin Purple'], colorNames: ['Martin Purple'] }), 'Berd painted color');
  assert.equal(E({ berdType: true, paintColors: ['Martin Purple', 'Oriole Orange'], colorNames: ['Oriole Orange', 'Black Berd', 'White Berd'] }), 'Berd painted color');
  assert.equal(E({ berdType: true, paintColors: ['Martin Purple', 'Oriole Orange'], colorNames: ['Oriole Orange', 'Martin Purple', 'White Berd'] }), 'Berd multi-color');
  const bad = variant(REAR, (r, o) => { o.line_items.find((l) => l.title === 'Berd PolyLight').quantity += 2; o.line_items = o.line_items.filter((l) => l.title !== 'Custom Spoke Color Configuration'); });
  const [rear] = standardWheels(findStandardStudioRecipe(bad).recipe, null, bad);
  assert.ok(rear.warnings.some((w) => w.includes('cart spoke lines do not match')), rear.warnings.join(' | '));
  assert.ok(rear.warnings.some((w) => w.includes('fee rule expects') && w.includes('Berd multi-color')));
  const wrong = variant(REAR, (r, o) => { o.line_items.find((l) => l.title === 'Custom Spoke Color Configuration').variant_title = 'Mixed colors'; });
  assert.ok(standardWheels(findStandardStudioRecipe(wrong).recipe, null, wrong)[0].warnings.some((w) => w.includes('fee line is "Mixed colors"')));
});

/* ------------------------------------------------------------------ images and captions */

test('images: one all-spokes image per solid wheel, three per custom wheel, front first; captions use the side labels', async () => {
  const solid = await buildStandardAdditions({ recipe: recipeOf(STEEL), orderData: loadSample('standard', STEEL), renderPng: png });
  assert.deepEqual(solid.images.map((i) => i.cid), ['front-all-spokes', 'rear-all-spokes']);
  assert.deepEqual(solid.images.map((i) => i.caption), ['Front wheel, all spokes (left side view)', 'Rear wheel, all spokes (drive side view)']);
  const custom = await buildStandardAdditions({ recipe: recipeOf(REAR), orderData: loadSample('standard', REAR), renderPng: png });
  assert.deepEqual(custom.images.map((i) => i.cid), ['rear-all-spokes', 'rear-drive-only', 'rear-rotor-only']);
  assert.deepEqual(custom.images.map((i) => i.caption), ['Rear wheel, all spokes (drive side view)', 'Rear wheel, drive side spokes only', 'Rear wheel, non-drive side spokes only']);
  // a custom FRONT wheel: all spokes (from the left) first, then left (high-tension rotor side), then right
  assert.deepEqual(imageSpecsFor('front', false, { drive: 'Right side', rotor: 'Left side' }).map((s) => s.caption), ['Front wheel, all spokes (left side view)', 'Front wheel, left side spokes only', 'Front wheel, right side spokes only']);
  assert.deepEqual(imageSpecsFor('front').map((s) => s.caption), ['Front wheel, all spokes (rotor side view)', 'Front wheel, rotor side spokes only', 'Front wheel, drive side spokes only'], 'System captions are unchanged');
  const radial = await buildStandardAdditions({ recipe: recipeOf(RADIAL), orderData: loadSample('standard', RADIAL), renderPng: png });
  assert.deepEqual(radial.images.map((i) => i.cid), ['front-all-spokes']);
  assert.equal(radial.imageErrors.length, 0);
});

test('images: the radial wheel is drawn radial (every spoke straight out); the images carry the customer\'s colors and hub color; no alpha anywhere', async () => {
  const a = await buildStandardAdditions({ recipe: recipeOf(RADIAL), orderData: loadSample('standard', RADIAL), renderPng: png });
  const svg = a.images[0].svg;
  const lines = [...svg.matchAll(/<line x1="([-\d.]+)" y1="([-\d.]+)" x2="([-\d.]+)" y2="([-\d.]+)" stroke="(#[0-9a-f]{6})"/gi)].filter((m) => m[5].toLowerCase() !== '#8e939a');
  assert.equal(lines.length, 24);
  for (const m of lines) { // a radial spoke lies on a line through the wheel's centre (300, 300)
    const cross = (+m[1] - 300) * (+m[4] - 300) - (+m[2] - 300) * (+m[3] - 300);
    assert.ok(Math.abs(cross) < 40, 'radial spoke passes through the centre');
    assert.equal(m[5].toLowerCase(), '#7b3fb9');
  }
  assert.ok(svg.includes('stop-color="#c3c8cf"'), 'silver hub');
  assert.equal(/opacity|rgba\(/i.test(svg), false);
});

test('images: a wheel with no usable geometry in standardStudio.wheels still gets its color tables, and says why there is no image', async () => {
  const order = variant(REAR, (r) => { delete r.standardStudio.wheels.rear; });
  const a = await buildStandardAdditions({ recipe: findStandardStudioRecipe(order).recipe, orderData: order, renderPng: png });
  assert.equal(a.images.length, 0);
  assert.ok(a.imageErrors.some((e) => e.includes('no wheel geometry')));
  assert.ok(a.warnings.some((w) => w.includes('standardStudio.wheels.rear is missing')));
  assert.ok(a.html.includes('Whole wheel (24)') && a.noteText.includes('Whole wheel (24)'));
});

/* ------------------------------------------------------------------ the painted-spoke list */

const LENGTHS = (l, r) => ({ left: l, right: r });
test('paint list: one painted color (solid radial purple) -> pull White, paint Martin Purple, one length', () => {
  const [front] = wheelsOf(RADIAL);
  const plan = paintPlanFor(front, LENGTHS(281, 281));
  assert.equal(plan.groups.length, 1);
  assert.equal(paintGroupText(plan, plan.groups[0]), 'Front, 281 mm: pull White ×24 -> paint Martin Purple ×24');
  assert.equal(paintTotalText(plan), 'Front total (24 spokes): pull White ×24 -> paint Martin Purple ×24');
});

test('paint list: two painted colors plus black -> separate lines per spoke length (drive = right, rotor = left), totals add up', () => {
  const [rear] = wheelsOf(REAR);
  const plan = paintPlanFor(rear, LENGTHS(302, 299));
  assert.deepEqual(plan.groups.map((g) => g.length), [299, 302], 'sorted by length');
  assert.equal(paintGroupText(plan, plan.groups[0]), 'Rear, 299 mm: pull White ×10, Black ×2 -> paint Martin Purple ×6, Oriole Orange ×4', 'the drive side is the right side (299 mm)');
  assert.equal(paintGroupText(plan, plan.groups[1]), 'Rear, 302 mm: pull White ×8, Black ×4 -> paint Martin Purple ×4, Oriole Orange ×4');
  assert.equal(paintTotalText(plan), 'Rear total (24 spokes): pull White ×18, Black ×6 -> paint Martin Purple ×10, Oriole Orange ×8');
  const same = paintPlanFor(rear, LENGTHS(300, 300));
  assert.equal(same.groups.length, 1, 'equal lengths on both sides are one group');
  assert.equal(paintGroupText(same, same.groups[0]), 'Rear, 300 mm: pull White ×18, Black ×6 -> paint Martin Purple ×10, Oriole Orange ×8');
});

test('paint list: White Berd spokes are pulled as White but not painted; Black Berd is black; painted + white + black together', () => {
  const order = variant(REAR, (r) => { const s = r.standardStudio.studio.spokes.rear; s.drive[0] = 'White Berd'; s.drive[1] = 'White Berd'; r.standardStudio.colors['White Berd'] = '#f2f2f2'; });
  const [rear] = standardWheels(findStandardStudioRecipe(order).recipe, null, order);
  const plan = paintPlanFor(rear, LENGTHS(302, 299));
  const total = paintTotalText(plan);
  assert.ok(/pull White ×\d+, Black ×\d+ -> paint/.test(total), total);
  const whiteSpokes = rear.counts.all.find((c) => c.color === 'White Berd').n;
  const painted = rear.counts.all.filter((c) => c.color !== 'White Berd' && c.color !== 'Black Berd').reduce((s, c) => s + c.n, 0);
  assert.equal(plan.total.pull.find((e) => e.name === 'White Berd').n, painted + whiteSpokes, 'blanks = painted spokes + spokes that stay white');
  assert.equal(plan.total.paint.reduce((s, e) => s + e.n, 0), painted);
});

test('paint list: black and white Berd only, steel, and no-paint-info wheels get no paint section', () => {
  const bw = variant(REAR, (r) => { const s = r.standardStudio.studio.spokes.rear; for (const side of ['drive', 'rotor']) s[side] = s[side].map((_, k) => (k % 2 ? 'White Berd' : 'Black Berd')); r.standardStudio.colors['White Berd'] = '#f2f2f2'; });
  assert.equal(paintPlanFor(standardWheels(findStandardStudioRecipe(bw).recipe, null, bw)[0], LENGTHS(300, 300)), null, 'black + white only');
  for (const w of wheelsOf(STEEL)) assert.equal(paintPlanFor(w, LENGTHS(290, 290)), null, 'steel');
  const missing = variant(REAR, (r) => { delete r.standardStudio.paint; });
  const [w] = standardWheels(findStandardStudioRecipe(missing).recipe, null, missing);
  assert.equal(paintPlanFor(w, LENGTHS(300, 300)), null, 'paint key missing: nothing is treated as painted');
  assert.ok(w.warnings.some((x) => x.includes('no paint information')));
  // steel with a missing paint key is not noisy
  const steelMissing = variant(STEEL, (r) => { delete r.standardStudio.paint; });
  assert.deepEqual(standardWheels(findStandardStudioRecipe(steelMissing).recipe, null, steelMissing).flatMap((x) => x.warnings), []);
});

test('paint list: no usable length -> counts without lengths and a plain statement; partial lengths split into a known and an unknown group', () => {
  const [rear] = wheelsOf(REAR);
  const none = paintPlanFor(rear, LENGTHS(null, null));
  assert.equal(none.anyUnknown, true);
  assert.equal(paintGroupText(none, none.groups[0]), 'Rear, length unknown: pull White ×18, Black ×6 -> paint Martin Purple ×10, Oriole Orange ×8 (spoke lengths could not be calculated for this wheel)');
  const part = paintPlanFor(rear, LENGTHS(302, null));
  assert.deepEqual(part.groups.map((g) => g.length), [302, null], 'known length first, unknown last');
  assert.equal(part.total.spokes, 24);
  assert.deepEqual(standardLengthsOf({ rear: { calculationSuccessful: false } }, 'rear'), { left: null, right: null });
  assert.deepEqual(standardLengthsOf({ rear: { calculationSuccessful: true, lengths: { left: { rounded: 302 }, right: { rounded: 299 } } } }, 'rear'), { left: 302, right: 299 });
  assert.equal(shortColorName('White Berd'), 'White'); assert.equal(shortColorName('Oriole Orange'), 'Oriole Orange');
});

/* ------------------------------------------------------------------ through the webhook: note, internal email, customer email, flag, dedupe */

test('webhook, custom Berd rear: today\'s report and inventory are kept, the additions follow, and the paint list is in the internal email and the note ONLY', async () => {
  const r = await runWebhook(INDEX, 'orders/create', loadSample('standard', REAR), { env: ON });
  assert.equal(r.status, 200);
  assert.equal(r.inventoryAdjustments.length, 2, 'today\'s inventory logic is unchanged: one adjustment per side');
  assert.ok(r.note.startsWith('AUTOMATED SPOKE CALCULATION & INVENTORY'));
  assert.ok(r.note.includes('Left: 12 x 302mm (Adjusted)') && r.note.includes('Right: 12 x 299mm (Adjusted)'));
  assert.ok(r.note.includes('SPOKE COLORS:') && r.note.includes('Drive side (12)') && r.note.includes('Non-drive side (12)'));
  assert.ok(r.note.includes('Rear, 299 mm: pull White ×10, Black ×2 -> paint Martin Purple ×6, Oriole Orange ×4'));
  assert.ok(r.note.includes('Rear total (24 spokes): pull White ×18, Black ×6 -> paint Martin Purple ×10, Oriole Orange ×8'));
  assert.equal(/Left: \d+ x \d+mm \(Adjusted\)/g.exec(r.note.slice(r.note.indexOf('SPOKE COLORS:'))), null, 'the additions never look like inventory lines (the cancel handler parses those)');
  const internal = r.emails.find(isInternal), customer = r.emails.find(isCustomer);
  assert.deepEqual(cids(internal), ['rear-all-spokes', 'rear-drive-only', 'rear-rotor-only']);
  assert.equal(internal.subject, 'Spoke Calculation Complete for Order #91002', 'the Standard subject is unchanged');
  const rawInternal = r.restEmails.find(isInternal);
  assert.equal(rawInternal.from, 'Spoke Calculator <calculator@loamlabsusa.com>');
  assert.equal(rawInternal.reply_to, 'LoamLabs Support <info@loamlabsusa.com>');
  assert.deepEqual(rawInternal.to, ['builder@example.com']);
  const it = text(internal.html);
  assert.ok(it.includes('Final Spoke Lengths') && it.includes('Inventory Adjustments (Final Lengths)'), 'today\'s sections are still there');
  assert.ok(it.includes('PAINTED SPOKES') && it.includes('Rear, 299 mm: pull White x10, Black x2 -> paint Martin Purple x6, Oriole Orange x4'));
  const ct = text(customer.html);
  assert.equal(/painted|paint|pull White|blank|White Berd/i.test(ct), false, 'no painted-spoke list in the customer email');
  assert.equal(/\bmm\b|length|inventory|NOTE:|Build ID|LL-91002/i.test(ct), false, 'no lengths, warnings or internal ids in the customer email');
});

test('webhook, wording: our own text never says System, Industry Nine or Studio (customer email, internal additions, note additions)', async () => {
  for (const s of [REAR, STEEL, RADIAL]) {
    const r = await runWebhook(INDEX, 'orders/create', loadSample('standard', s), { env: ON });
    const customer = r.emails.find(isCustomer), internal = r.emails.find(isInternal);
    assert.equal(BRAND.test(text(customer.html)), false, `${s}: customer email`);
    assert.equal(/rotor/i.test(text(customer.html)), false, `${s}: Standard wheels have no "rotor" wording`);
    const add = text(internal.html); const from = add.indexOf('SPOKE COLORS');
    assert.equal(BRAND.test(add.slice(from)), false, `${s}: internal additions`);
    assert.equal(BRAND.test(r.note.slice(r.note.indexOf('SPOKE COLORS:'))), false, `${s}: note additions`);
    assert.equal(BRAND.test(customer.subject), false);
  }
});

test('webhook, customer email: sent for EVERY keyed Standard order (solid or custom) when the flag is "on"; opening line; From / reply-to / subject; to the order\'s customer', async () => {
  for (const [s, n] of [[STEEL, 91001], [REAR, 91002], [RADIAL, 91003]]) {
    const r = await runWebhook(INDEX, 'orders/create', loadSample('standard', s), { env: ON });
    const customers = r.restEmails.filter(isCustomer);
    assert.equal(customers.length, 1, s);
    const c = customers[0];
    assert.deepEqual(c.to, ['customer@example.com']);
    assert.equal(c.from, 'LoamLabs <info@loamlabsusa.com>'); assert.equal(c.reply_to, 'info@loamlabsusa.com');
    assert.equal(c.subject, `Your custom spoke colors, order #${n}`);
    assert.ok(c.html.includes('<p>Hi Alex,</p>') && c.html.includes('<p>Here are the spoke colors for your wheels.</p>'), s);
    assert.equal(/you designed/i.test(c.html), false);
    assert.deepEqual(cids(c), cids(r.emails.find(isInternal)), 'the customer gets the same images as the internal email');
  }
  const solid = await runWebhook(INDEX, 'orders/create', loadSample('standard', STEEL), { env: ON });
  assert.ok(text(solid.emails.find(isCustomer).html).includes('Front wheel: all Silver') && text(solid.emails.find(isCustomer).html).includes('Rear wheel: all Black'));
});

test('webhook, flag: off, "off", "ON", "true", unset -> no customer email at all; the internal email and the note are the same', async () => {
  for (const env of [{}, { STANDARD_CUSTOMER_EMAIL: 'off' }, { STANDARD_CUSTOMER_EMAIL: 'ON' }, { STANDARD_CUSTOMER_EMAIL: 'true' }, { STANDARD_CUSTOMER_EMAIL: '' }]) {
    const r = await runWebhook(INDEX, 'orders/create', loadSample('standard', REAR), { env });
    assert.equal(r.status, 200);
    assert.equal(r.emails.filter(isCustomer).length, 0, JSON.stringify(env));
    assert.equal(r.emails.filter(isInternal).length, 1);
    assert.ok(r.note.includes('PAINTED SPOKES'));
    assert.ok(r.logs.some(([, m]) => m.includes('customer spoke-color email not sent')));
  }
});

test('webhook, missing lengths (customer supplies the hub): the internal email still goes out with the counts, "length unknown", and says why', async () => {
  const order = variant(REAR, (r) => { r.components.rearHub.title = 'Your Own Hub'; });
  const r = await runWebhook(INDEX, 'orders/create', order, { env: ON });
  assert.equal(r.status, 200);
  assert.equal(r.inventoryAdjustments.length, 0, 'today\'s behavior: no calculation, no inventory');
  assert.ok(r.note.includes('CALC FAILED'));
  assert.ok(r.note.includes('Rear, length unknown: pull White ×18, Black ×6 -> paint Martin Purple ×10, Oriole Orange ×8 (spoke lengths could not be calculated for this wheel)'));
  assert.equal(r.emails.filter(isCustomer).length, 1, 'the customer still gets their colors');
});

test('webhook, missing paint key on a Berd order: visible warning in the internal email and the note, no paint list, customer email unaffected', async () => {
  const order = variant(REAR, (r) => { delete r.standardStudio.paint; });
  const r = await runWebhook(INDEX, 'orders/create', order, { env: ON });
  const internal = r.emails.find(isInternal);
  assert.ok(text(internal.html).includes('no paint information'));
  assert.ok(r.note.includes('NOTE: Rear wheel: the order has no paint information'));
  assert.equal(text(internal.html).includes('PAINTED SPOKES'), false);
  assert.equal(r.emails.filter(isCustomer).length, 1);
  assert.equal(/paint/i.test(text(r.emails.find(isCustomer).html)), false);
});

test('webhook, a re-delivered keyed Standard order: ONE internal email, ONE customer email, one note, inventory deducted once', async () => {
  const mock = createMock(loadMockShopify());
  const first = await runWebhook(INDEX, 'orders/create', loadSample('standard', REAR), { mock, env: ON });
  assert.equal(first.emails.length, 2);
  assert.equal(first.inventoryAdjustments.length, 2);
  const second = await runWebhook(INDEX, 'orders/create', loadSample('standard', REAR), { mock, env: ON });
  assert.equal(second.status, 200);
  assert.equal(mock.calls.restEmails.filter(isInternal).length, 1);
  assert.equal(mock.calls.restEmails.filter(isCustomer).length, 1);
  assert.equal(mock.calls.notes.length, 1, 'no second note');
  assert.equal(mock.calls.inventoryAdjustments.length, 2, 'no second deduction');
  assert.ok(second.logs.some(([, m]) => m.includes('already has its spoke report in the order note')));
  // the same order twice on one instance, before the note exists in Shopify: the in-process claim stops it
  const a = await runWebhook(INDEX, 'orders/create', loadSample('standard', RADIAL), { env: ON, keepDedupe: true });
  const b = await runWebhook(INDEX, 'orders/create', loadSample('standard', RADIAL), { env: ON, keepDedupe: true });
  assert.equal(a.emails.length, 2); assert.equal(b.emails.length, 0); assert.equal(b.calls.orderNoteQueries.length, 0);
});

test('webhook, dedupe is only for keyed Standard orders: an old Standard order (no key) is processed exactly as before, twice if delivered twice', async () => {
  const mock = createMock(loadMockShopify());
  const a = await runWebhook(INDEX, 'orders/create', loadSample('standard', 'steel-jbend-wheelset'), { mock });
  const afterFirst = mock.calls.inventoryAdjustments.length;
  const b = await runWebhook(INDEX, 'orders/create', loadSample('standard', 'steel-jbend-wheelset'), { mock });
  assert.equal(afterFirst, 4); assert.equal(b.calls.inventoryAdjustments.length, 8, 'unchanged: no guard on the old path');
  assert.equal(a.calls.orderNoteQueries.length, 0);
  assert.equal(a.emails.length, 1); assert.equal(a.emails[0].via, 'sdk', 'the old path still sends through the SDK');
});

test('webhook, Resend rejecting the customer email, or the images, never affects the order note or the 200', async () => {
  const mock = createMock(loadMockShopify());
  const inner = mock.fetch;
  mock.fetch = async (url, init) => {
    if (String(url).includes('api.resend.com') && /^Your custom spoke colors/.test(JSON.parse(init.body).subject)) return { ok: false, status: 422, json: async () => ({ message: 'invalid recipient' }) };
    return inner(url, init);
  };
  const r = await runWebhook(INDEX, 'orders/create', loadSample('standard', REAR), { mock, env: ON });
  assert.equal(r.status, 200);
  assert.equal(r.emails.filter(isInternal).length, 1);
  assert.equal(r.notes.length, 1);
  assert.equal(r.inventoryAdjustments.length, 2);
  // internal email with the attachments rejected: it still goes out (text only) through the same REST path
  const mock2 = createMock(loadMockShopify()); const inner2 = mock2.fetch; let n = 0;
  mock2.fetch = async (url, init) => { if (String(url).includes('api.resend.com') && n++ === 0) return { ok: false, status: 422, json: async () => ({ message: 'too large' }) }; return inner2(url, init); };
  const r2 = await runWebhook(INDEX, 'orders/create', loadSample('standard', REAR), { mock: mock2 });
  assert.equal(r2.status, 200);
  assert.equal(r2.emails.filter(isInternal).length, 1);
  assert.ok(r2.emails.find(isInternal).html.includes('image failed: email attachment rejected'));
});

test('webhook, cancelled keyed Standard order: today\'s restock still works from its note, and nothing is emailed', async () => {
  const created = await runWebhook(INDEX, 'orders/create', loadSample('standard', REAR), { env: ON });
  const order = loadSample('standard', REAR); order.note = created.note;
  const r = await runWebhook(INDEX, 'orders/cancelled', order, { env: ON });
  assert.equal(r.status, 200);
  assert.equal(r.inventoryAdjustments.length, 2, 'both sides restocked from the "(Adjusted)" lines, not confused by the new sections');
  assert.equal(r.inventoryAdjustments.every((a) => a.changes[0].delta === 12), true);
  assert.equal(r.emails.length, 0);
});

/* ------------------------------------------------------------------ hostile input (standardStudio comes from the customer's browser) */

test('hostile standardStudio: bad hex, huge or odd numbers, prototype names, wrong types and an oversized spoke map are bounded; nothing throws', async () => {
  const order = variant(REAR, (r) => {
    const s = r.standardStudio;
    s.colors = { 'Oriole Orange': 'red;background:url(//evil)', 'Martin Purple': '#7b3fb9"><script>', 'Black Berd': { x: 1 }, __proto__: { '#': 1 } };
    s.wheels.rear.drive.pcd = 1e9; s.wheels.rear.rotor.cross = 'abc'; s.wheels.rear.sideLabels = { drive: 'A'.repeat(500), rotor: '<b>x</b>' };
    s.studio.spokes.rear.drive = Array.from({ length: 12 }, (_, k) => (k === 0 ? 'constructor' : k === 1 ? '__proto__' : 'Oriole Orange'));
    s.paint.wheels.rear.paintColors = ['Oriole Orange', 7, null, 'toString'];
  });
  const a = await buildStandardAdditions({ recipe: findStandardStudioRecipe(order).recipe, orderData: order, renderPng: png });
  assert.equal(a.wheels.length, 1);
  assert.equal(/<script|evil|url\(\/\/|background:url/i.test(a.html + a.images.map((i) => i.svg).join('') + a.noteText), false, 'no markup or style injection (the SVG\'s own url(#gradient) references are fine)');
  assert.ok(a.wheels[0].sideLabels.drive.length <= 31);
  assert.equal(a.wheels[0].hexOf('Oriole Orange'), '#8a9099', 'an invalid hex falls back to the neutral gray');
  assert.equal(a.wheels[0].hexOf('toString'), '#8a9099');
  const big = variant(REAR, (r) => { r.standardStudio.wheels.rear.drive.n = 99999999; });
  const b = await buildStandardAdditions({ recipe: findStandardStudioRecipe(big).recipe, orderData: big, renderPng: png });
  assert.equal(b.images.length, 0); assert.ok(b.imageErrors.length >= 1);
  assert.equal(standardWheelConfig(recipeOf(REAR), 'rear', null).cfg.rimHoles, 24);
  assert.equal(hexOfStandard({ standardStudio: { colors: null } }, 'x'), '#8a9099');
  // the webhook survives the same input
  const r = await runWebhook(INDEX, 'orders/create', order, { env: ON });
  assert.equal(r.status, 200); assert.equal(r.notes.length, 1);
});

test('a System order is unaffected: it never takes the Standard path even if its _build also carried a standardStudio object', async () => {
  const order = loadSample('system', 'solix-24h-wheelset-multicolor');
  const prop = order.line_items[0].properties.find((p) => p.name === '_build'); const recipe = JSON.parse(prop.value);
  recipe.standardStudio = { v: 1 }; prop.value = JSON.stringify(recipe);
  assert.equal(isStandardStudioRecipe(recipe), false);
  assert.ok(findSystemBuildRecipe(order));
  const r = await runWebhook(INDEX, 'orders/create', order, { env: ON });
  assert.ok(r.restEmails.some((e) => /^I9 System Build Report/.test(e.subject)));
  assert.equal(r.inventoryAdjustments.length, 0);
});

test('buildCustomerEmail works for Standard wheels exactly as for System ones (null only without wheels)', async () => {
  const a = await buildStandardAdditions({ recipe: recipeOf(STEEL), orderData: loadSample('standard', STEEL), renderPng: png });
  assert.ok(buildCustomerEmail({ wheels: a.wheels, images: a.images, orderData: loadSample('standard', STEEL) }));
  assert.equal(buildCustomerEmail({ wheels: [], images: [], orderData: {} }), null);
});

/* ------------------------------------------------------------------ round 2: image order, "Spokes" row, erd */

test('round 2: a custom wheel shows ALL SPOKES first, then the higher-tension side, then the lower (internal block and customer email, front before rear)', async () => {
  const a = await buildStandardAdditions({ recipe: recipeOf(REAR), orderData: loadSample('standard', REAR), renderPng: png });
  assert.deepEqual(a.images.map((i) => i.cid), ['rear-all-spokes', 'rear-drive-only', 'rear-rotor-only']);
  const pos = (html) => ['rear-all-spokes', 'rear-drive-only', 'rear-rotor-only'].map((c) => html.indexOf(`cid:${c}`));
  const c = buildCustomerEmail({ wheels: a.wheels, images: a.images, orderData: loadSample('standard', REAR) });
  const [p0, p1, p2] = pos(c.html); assert.ok(p0 > 0 && p0 < p1 && p1 < p2, 'customer email order');
  const [q0, q1, q2] = pos(a.html); assert.ok(q0 > 0 && q0 < q1 && q1 < q2, 'internal block order');
  assert.deepEqual(c.images.map((i) => i.caption), ['Rear wheel, all spokes (drive side view)', 'Rear wheel, drive side spokes only', 'Rear wheel, non-drive side spokes only'], 'captions are unchanged, only the order moved');
  const solid = await buildStandardAdditions({ recipe: recipeOf(STEEL), orderData: loadSample('standard', STEEL), renderPng: png });
  assert.deepEqual(solid.images.map((i) => i.cid), ['front-all-spokes', 'rear-all-spokes'], 'solid wheels keep their one image each, front first');
});

test('round 2: the customer email of a Standard order has a "Spokes" row (the spoke product), after the Hub rows and before "Spoke count"; internal blocks and System emails do not get it', async () => {
  for (const s of [STEEL, REAR, RADIAL]) {
    const order = loadSample('standard', s), recipe = recipeOf(s);
    const a = await buildStandardAdditions({ recipe, orderData: order, renderPng: png });
    const c = buildCustomerEmail({ wheels: a.wheels, images: a.images, orderData: order });
    for (const w of a.wheels) {
      const name = recipe.components[w.position + 'Spokes'].title;
      assert.ok(c.html.includes(`<tr><td>Spokes</td><td>${name}</td></tr>`), `${s} ${w.position}: Spokes row`);
    }
    assert.ok(c.fallbackHtml.includes('<tr><td>Spokes</td>'), 'also in the text-only version');
    const rows = text(c.html);
    assert.ok(rows.indexOf('Hub color') < rows.indexOf('Spokes') && rows.indexOf('Spokes') < rows.indexOf('Spoke count'), 'between the hub rows and the spoke count');
    assert.equal(a.html.includes('<tr><td>Spokes</td>'), false, 'internal block unchanged');
  }
  const rear = await buildStandardAdditions({ recipe: recipeOf(REAR), orderData: loadSample('standard', REAR), renderPng: png });
  const order = loadSample('standard', REAR);
  const freehub = text(buildCustomerEmail({ wheels: rear.wheels, images: rear.images, orderData: order }).html);
  assert.ok(freehub.indexOf('Freehub') < freehub.indexOf('Spokes'), 'after the Freehub row of a rear wheel');
  const sys = loadSample('system', 'solix-24h-wheelset-multicolor');
  const sr = await (await import('../_lib/system-report.js')).buildSystemReport({ recipe: findSystemBuildRecipe(sys).recipe, orderData: sys, renderPng: png });
  assert.equal(buildCustomerEmail({ wheels: sr.wheels, images: sr.images, orderData: sys }).html.includes('<td>Spokes</td>'), false, 'System rows unchanged');
});

test('round 2: standardStudio.wheels.<pos>.erd (mm) is used for the hub scaling; absent or unusable = the rim metafield / recipe / default fallback as before', () => {
  const o = loadSample('standard', REAR), recipe = findStandardStudioRecipe(o).recipe;
  assert.equal(recipe.standardStudio.wheels.rear.erd, 600, 'the sample carries an erd');
  const fromContract = standardWheelConfig({ ...recipe, standardStudio: { ...recipe.standardStudio, wheels: { rear: { ...recipe.standardStudio.wheels.rear, erd: 575.5 } } } }, 'rear', null);
  assert.equal(fromContract.cfg.erd, 575.5); assert.equal(fromContract.cfg.source.erd, 'contract');
  // a metafield disagrees with the contract: the contract wins ("exactly what the customer saw")
  const cd = new Map([[recipe.components.rearRim.variantId, { rim_erd: '590' }]]);
  assert.equal(standardWheelConfig(recipe, 'rear', cd).cfg.erd, 600);
  // no erd in the contract: today's fallback chain
  const noErd = JSON.parse(JSON.stringify(recipe)); delete noErd.standardStudio.wheels.rear.erd;
  assert.equal(standardWheelConfig(noErd, 'rear', cd).cfg.erd, 590); assert.equal(standardWheelConfig(noErd, 'rear', cd).cfg.source.erd, 'metafield');
  assert.equal(standardWheelConfig(noErd, 'rear', null).cfg.source.erd, 'default'); assert.equal(standardWheelConfig(noErd, 'rear', null).cfg.erd, 568);
  // unusable values (out of 200 to 800, text, zero, negative, hostile) fall back instead of reaching the drawing
  for (const bad of [0, -5, 'abc', 5, 5000, null, {}, [], '1e9']) {
    const r = JSON.parse(JSON.stringify(recipe)); r.standardStudio.wheels.rear.erd = bad;
    const cfg = standardWheelConfig(r, 'rear', cd).cfg;
    assert.equal(cfg.erd, 590, `erd ${JSON.stringify(bad)} ignored`); assert.notEqual(cfg.source.erd, 'contract');
  }
});

test('round 2: the contract erd changes the drawn hub size (and nothing else); without erd the picture is today\'s', async () => {
  const withErd = recipeOf(REAR), without = JSON.parse(JSON.stringify(withErd)); delete without.standardStudio.wheels.rear.erd;
  const big = JSON.parse(JSON.stringify(withErd)); big.standardStudio.wheels.rear.erd = 700;
  const order = loadSample('standard', REAR);
  const [a, b, c] = await Promise.all([withErd, without, big].map((r) => buildStandardAdditions({ recipe: r, orderData: order, renderPng: png })));
  assert.equal(a.imageErrors.length, 0);
  assert.notEqual(a.images[0].svg, c.images[0].svg, 'a different erd draws a different hub size');
  assert.deepEqual(a.images.map((i) => i.cid), b.images.map((i) => i.cid));
  assert.equal(a.noteText, b.noteText, 'text is unaffected by erd');
});
