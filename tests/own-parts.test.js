// OWN-PARTS: customer-supplied approved rims and I9 hubs on a System build (contract: agent-prompts/I9_OWN_PARTS_ORDER_CONTRACT.md). Real api/index.js, Shopify and Resend mocked.
//  - lengths for an approved own rim / own hub are the normal chart lookup (same numbers as the part we sell); a rim without a chart row says so in plain words;
//  - nothing is deducted for a supplied part (a System order never deducts anything); "Your Own ..." and fee lines never break the report;
//  - note and internal email name what the customer supplies and that the parts must arrive first; the customer email never shows lengths;
//  - quantity above 1 or a second build line is reported (note WARNINGS, email box, subject);
//  - orders without own parts are byte-identical to before (scripts/compare-own-parts.mjs against main, and the existing System tests).
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runWebhook, loadSample } from './helpers/webhook-harness.mjs';
import { suppliedPartsOf, suppliedSummary, suppliedWheelText, OWN_FEE_SET, OWN_FEE_SINGLE } from '../_lib/own-parts.js';

const INDEX = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'api', 'index.js');
const clone = (o) => JSON.parse(JSON.stringify(o));
const html = (r) => r.emails.map((e) => e.html).join('\n');
const text = (h) => String(h).replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const buildProp = (o) => o.line_items.flatMap((l) => l.properties || []).find((p) => p.name === '_build');
const BASE = () => loadSample('system', 'hydra2-wheelset-32f-32r');
const FUSE32 = { variantId: 'gid://shopify/ProductVariant/51797702967603', title: 'We Are One FUSE Carbon Rim (Enduro)', variantTitle: '29" / 32h / Black', vendor: 'We Are One', selectedOptions: [{ name: 'Size', value: '29"' }, { name: 'Spoke Count', value: '32h' }, { name: 'Color', value: 'Black' }] };
const OTHER = { variantId: 'gid://shopify/ProductVariant/51000000000001', title: "Stan's NoTubes Arch MK4 Rim", variantTitle: '29" / 32h / Black', vendor: "Stan's", selectedOptions: [{ name: 'Size', value: '29"' }, { name: 'Spoke Count', value: '32h' }] };
const GENERIC = { variantId: 'gid://shopify/ProductVariant/52000000000001', title: 'Your Own Rim', variantTitle: '29" / 32h', vendor: 'Your Own Component', selectedOptions: [{ name: 'Size', value: '29"' }, { name: 'Spoke Count', value: '32h' }] };
const RIMTEXT = 'ENVE M630 29" 28h';
function make({ front, rear, hubs = {}, fees, confirmed = true, quantity, extraLines = [] } = {}) {
  const o = clone(BASE()); const p = buildProp(o); const b = JSON.parse(p.value);
  b.customerSupplied = { front: { rim: false, hub: false }, rear: { rim: false, hub: false } };
  for (const [pos, rim] of [['front', front], ['rear', rear]]) {
    if (rim) { b.components[pos + 'Rim'] = { ...b.components[pos + 'Rim'], ...rim, supplied: true }; b.customerSupplied[pos].rim = true; }
    if (hubs[pos]) { b.components[pos + 'Hub'] = { ...b.components[pos + 'Hub'], supplied: true }; b.customerSupplied[pos].hub = true; }
    const Pos = pos[0].toUpperCase() + pos.slice(1);
    if (rim) o.line_items.push({ id: 15300 + (pos === 'front' ? 0 : 1), title: 'Your Own Rim', name: 'Your Own Rim - 29" / 32h', variant_title: '29" / 32h', quantity: 1, price: '1.00', product_id: 9803588370739, variant_id: 0, vendor: 'Your Own Component', properties: [{ name: '_BuildID', value: 'X' }, { name: 'Wheel', value: Pos }, { name: 'Customer Rim', value: RIMTEXT }, { name: '_Own_Rim_Variant_ID', value: String(rim.variantId).replace(/^.*\//, '') }] });
    if (hubs[pos]) o.line_items.push({ id: 15320 + (pos === 'front' ? 0 : 1), title: 'Your Own Hub', name: 'Your Own Hub', variant_title: '32h', quantity: 1, price: '1.00', product_id: 9803588370740, variant_id: 0, vendor: 'Your Own Component', properties: [{ name: '_BuildID', value: 'X' }, { name: 'Wheel', value: Pos }, { name: 'Customer Hub', value: `Industry Nine Hydra2 32h ${pos} 15x110` }, { name: '_Own_Hub_Variant_ID', value: String(b.components[pos + 'Hub'].variantId).replace(/^.*\//, '') }] });
    if ((rim || hubs[pos]) && fees !== 'none') for (let k = 0; k < (fees === 'double' ? 2 : 1); k++) o.line_items.push({ id: 15340 + k + (pos === 'front' ? 0 : 10), title: 'Assembly Service', name: 'Assembly Service', variant_title: 'Customer-supplied', quantity: 1, price: '120.00', product_id: 5, variant_id: OWN_FEE_SET, vendor: 'LoamLabs', properties: [{ name: '_BuildID', value: 'X' }, { name: 'Wheel', value: Pos }] });
  }
  p.value = JSON.stringify(b);
  const build = o.line_items.find((l) => (l.properties || []).some((x) => x.name === '_build'));
  if (confirmed) build.properties.push({ name: '_Customer_Parts_Confirmed', value: 'true' });
  if (quantity) build.quantity = quantity;
  o.line_items.push(...extraLines);
  return o;
}
const lens = (note) => (note.match(/^ {2}Spoke lengths \(System\): .*$/gm) || []).map((s) => s.trim());
const run = (o, env) => runWebhook(INDEX, 'orders/create', o, env ? { env } : undefined);

test('helpers: suppliedPartsOf reads the flags and the lines; summary and wording', () => {
  const o = make({ front: FUSE32 }); const b = JSON.parse(buildProp(o).value);
  const s = suppliedPartsOf(b, o, 'front'); assert.equal(s.rim, true); assert.equal(s.hub, false); assert.equal(s.rimText, RIMTEXT); assert.equal(s.rimApproved, true); assert.deepEqual(s.warnings, []);
  assert.equal(suppliedPartsOf(b, o, 'rear'), null, 'the other wheel has nothing');
  assert.equal(suppliedWheelText(s, 'Front'), `front rim ${RIMTEXT} (approved list)`);
  assert.equal(suppliedSummary([{ position: 'front', label: 'Front', supplied: s }, { position: 'rear', label: 'Rear' }]), `front rim ${RIMTEXT} (approved list); rear: ours`);
  assert.equal(suppliedSummary([{ position: 'front', label: 'Front' }]), null);
  assert.equal(suppliedPartsOf(null, null, 'front'), null); assert.equal(OWN_FEE_SET, 51568864887091); assert.equal(OWN_FEE_SINGLE, 51786323165491);
});

test('front own approved rim only: same chart lengths as the rim we sell, note and internal email name it, parts-must-arrive line, nothing deducted, subject unchanged', async () => {
  const base = await run(make({})); // no own parts, the sample as is
  const r = await run(make({ front: FUSE32 }));
  assert.equal(r.status, 200); assert.equal(r.inventoryAdjustments.length, 0, 'a System order never deducts stock');
  assert.ok(r.note.includes(`CUSTOMER-SUPPLIED PARTS: front rim ${RIMTEXT} (approved list); rear: ours.\nParts must arrive before the build starts.\n`));
  assert.ok(r.note.includes(`FRONT WHEEL (Hydra2, 32h (16 drive / 16 rotor))`)); assert.ok(r.note.includes(`  Customer supplies: front rim ${RIMTEXT} (approved list)\n`));
  assert.equal((r.note.match(/Customer supplies:/g) || []).length, 1, 'only the front wheel');
  const t = text(html(r)); assert.ok(t.includes(`CUSTOMER-SUPPLIED PARTS: front rim ${RIMTEXT} (approved list); rear: ours. Parts must arrive before the build starts.`)); assert.ok(t.includes('Customer supplies front rim'));
  assert.equal(r.emails[0].subject, base.emails[0].subject, 'subject unchanged');
  assert.equal(r.logs.some(([k]) => k === 'error'), false);
});

test('lengths: an approved own rim in the chart (front, rear, both) gives the numbers of the same rim sold by us, with the chart source line', async () => {
  const ours = await run(make({ front: undefined })); // sample rims are not in the chart: NOT CALCULATED
  assert.equal(lens(ours.note).length, 0);
  // the same wheel with the chart rim as a sold rim (no own flags) vs as an own rim
  const soldOrder = make({}); { const p = buildProp(soldOrder); const b = JSON.parse(p.value); b.components.frontRim = { ...b.components.frontRim, ...FUSE32 }; b.components.rearRim = { ...b.components.rearRim, ...FUSE32 }; p.value = JSON.stringify(b); }
  const sold = await run(soldOrder);
  for (const [name, order] of [['front only', make({ front: FUSE32 })], ['rear only', make({ rear: FUSE32 })], ['both', make({ front: FUSE32, rear: FUSE32 })]]) {
    const r = await run(order); const own = lens(r.note), all = lens(sold.note);
    assert.ok(own.length >= 1, `${name}: lengths printed`);
    if (name === 'both') assert.deepEqual(own, all, 'both wheels: identical lines to the sold rim');
    assert.equal(r.inventoryAdjustments.length, 0, name);
    assert.ok(r.note.includes('Source: I9 System chart 2026, row Fuse 29" 32h TR307') || r.note.includes('source: I9 System chart 2026, row Fuse 29" 32h TR307'), name);
  }
});

test('own approved rim + own hub on one wheel, one fee: still the chart lengths (the hub model and holes pick the columns); the hub is named', async () => {
  const r = await run(make({ front: FUSE32, rear: FUSE32, hubs: { front: true } }));
  assert.ok(r.note.includes(`CUSTOMER-SUPPLIED PARTS: front rim ${RIMTEXT} (approved list), hub Industry Nine Hydra2 32h front 15x110 (approved list); rear rim ${RIMTEXT} (approved list).`));
  assert.ok(lens(r.note).length === 2); assert.equal(r.inventoryAdjustments.length, 0);
  assert.equal(/NOT CALCULATED/.test(r.note), false);
});

test('mixed set: one wheel own, the other ours (its rim has no chart row here): each wheel reported on its own; the own wheel never blocks the other', async () => {
  const r = await run(make({ front: FUSE32 }));
  assert.ok(lens(r.note).length >= 1 && r.note.includes('NOT CALCULATED'), 'front has lengths, rear (sample rim) says not calculated');
  assert.ok(r.note.includes('rear: ours'));
});

test('a customer rim with NO chart row (approved list but no row yet) and the generic "Your Own Rim": plain NOT CALCULATED wording, nothing else breaks', async () => {
  const r = await run(make({ front: OTHER, rear: OTHER }));
  assert.ok(r.note.includes(`Spoke lengths for System hubs: NOT CALCULATED. The customer-supplied rim (${RIMTEXT}) is not in I9's spoke length chart. Ask I9 for the spoke lengths for this rim before ordering spokes.`));
  assert.equal(r.status, 200); assert.equal(r.inventoryAdjustments.length, 0); assert.equal(r.logs.some(([k]) => k === 'error'), false);
  const g = await run(make({ front: GENERIC }));
  assert.ok(g.note.includes('front rim') && g.note.includes('(NOT on the approved list)'), 'a generic Your Own Rim is not on the approved list');
  assert.ok(g.note.includes('NOT CALCULATED'));
  assert.ok(text(html(r)).includes('NOT CALCULATED'));
});

test('cross-checks are warnings only: missing fee line, two fee lines, missing confirmation flag, id mismatch, missing Your Own line', async () => {
  const none = await run(make({ front: FUSE32, fees: 'none', confirmed: false }));
  assert.ok(none.note.includes('NOTE: Front wheel: it has customer parts but the order has no own-parts Assembly Service fee line'));
  assert.ok(none.note.includes('missing _Customer_Parts_Confirmed')); assert.equal(none.status, 200);
  const two = await run(make({ front: FUSE32, fees: 'double' }));
  assert.ok(two.note.includes('2 own-parts Assembly Service fee lines for this wheel (one expected)'));
  const mism = make({ front: FUSE32 }); mism.line_items.find((l) => l.title === 'Your Own Rim').properties.find((p) => p.name === '_Own_Rim_Variant_ID').value = '999';
  const m = await run(mism); assert.ok(m.note.includes('says variant 999 but the build uses 51797702967603')); assert.ok(lens(m.note).length >= 1, 'lengths still from the build\'s part');
  const noLine = make({ front: FUSE32 }); noLine.line_items = noLine.line_items.filter((l) => l.title !== 'Your Own Rim');
  const nl = await run(noLine); assert.ok(nl.note.includes('has no "Your Own Rim" line for it'));
  const ok = await run(make({ front: FUSE32 })); assert.equal(/NOTE: Front wheel: it has customer parts|_Customer_Parts_Confirmed|variant \d+ but/.test(ok.note), false, 'a correct order has no such warning');
});

test('the customer email never shows lengths or the internal parts lines (flag on)', async () => {
  const r = await run(make({ front: FUSE32, rear: FUSE32 }), { SYSTEM_CUSTOMER_EMAIL: 'on' });
  assert.ok(r.emails.length >= 2, 'the internal email and the customer email were both sent (mock)');
  for (const e of r.emails.filter((x) => x !== r.emails[0])) { const t = text(e.html); assert.equal(/Spoke lengths|NOT CALCULATED|mm\b.*Source|CUSTOMER-SUPPLIED PARTS/.test(t), false); }
});

test('quantity 2 on a System build line, and a second build line: warned in the note, the email and the subject; lengths unchanged', async () => {
  const one = await run(make({ front: FUSE32, rear: FUSE32 }));
  const q = await run(make({ front: FUSE32, rear: FUSE32, quantity: 2 }));
  const Q = 'The wheel build line has quantity 2. The report and the spoke deduction cover ONE wheelset; deduct the spokes for the other 1 by hand.';
  assert.ok(q.note.includes(`WARNINGS:\n- ${Q}`)); assert.ok(html(q).includes(`<strong>Check this order by hand:</strong> ${Q}</p>`));
  assert.equal(q.emails[0].subject, `ACTION REQUIRED: ${one.emails[0].subject}`); assert.deepEqual(lens(q.note), lens(one.note));
  const two = make({ front: FUSE32, rear: FUSE32 }); const second = clone(two.line_items.find((l) => (l.properties || []).some((p) => p.name === '_build'))); second.id = 99999; two.line_items.push(second);
  const t = await run(two); assert.ok(t.note.includes('This order has 2 wheel build lines. Only the FIRST was calculated')); assert.match(t.emails[0].subject, /^ACTION REQUIRED: /);
  assert.equal(/WARNINGS|Check this order by hand/.test(one.note + html(one)), false, 'quantity 1 has no warning');
});

test('"Your Own" lines, fee lines and odd properties never break a System order', async () => {
  const o = make({ front: FUSE32 });
  o.line_items.push({ id: 1, title: 'Your Own Rim', quantity: 1, properties: [] }, { id: 2, title: 'Your Own Hub', quantity: 1 }, { id: 3, title: 'Assembly Service', variant_id: OWN_FEE_SINGLE, quantity: 1, properties: [{ name: 'Wheel', value: 'Rear' }] }, { id: 4, title: 'Orange Seal', quantity: 5, properties: null });
  const r = await run(o); assert.equal(r.status, 200); assert.equal(r.emails.length >= 1, true); assert.equal(r.inventoryAdjustments.length, 0); assert.equal(r.logs.some(([k]) => k === 'error'), false);
});
