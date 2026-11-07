// OWN-PARTS: prints what the note and the internal email say for the nine mock orders of the report (front, rear, both, rim + hub, mixed, single wheel, quantity 2, no chart row, Standard).
//   node scripts/own-parts-mock.mjs
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const H = await import(pathToFileURL(path.join(root, 'tests/helpers/webhook-harness.mjs')).href);
const clone = (o) => JSON.parse(JSON.stringify(o));
const INDEX = path.join(root, 'api', 'index.js');
const text = (h) => String(h).replace(/<style[\s\S]*?<\/style>/g, '').replace(/<(\/(tr|p|div|h\d|li)|br\s*\/?)>/g, '\n').replace(/<[^>]+>/g, ' ').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n');
const FUSE32 = { variantId: 'gid://shopify/ProductVariant/51797702967603', title: 'We Are One FUSE Carbon Rim (Enduro)', variantTitle: '29" / 32h / Black', vendor: 'We Are One', selectedOptions: [{ name: 'Size', value: '29"' }, { name: 'Spoke Count', value: '32h' }, { name: 'Color', value: 'Black' }] };
const OTHER = { ...FUSE32, variantId: 'gid://shopify/ProductVariant/51000000000001', title: "Stan's NoTubes Arch MK4 Rim" };
const SETFEE = 51568864887091, SINGLEFEE = 51786323165491;
function make(sampleName, { rims = {}, hubs = {}, fee = SETFEE, quantity } = {}) {
  const o = clone(H.loadSample('system', sampleName)); const p = o.line_items.flatMap((l) => l.properties || []).find((x) => x.name === '_build'); const b = JSON.parse(p.value);
  b.customerSupplied = { front: { rim: false, hub: false }, rear: { rim: false, hub: false } };
  for (const pos of ['front', 'rear']) { const Pos = pos[0].toUpperCase() + pos.slice(1); if (!b.components[pos + 'Rim'] && !b.components[pos + 'Hub']) continue;
    if (rims[pos]) { b.components[pos + 'Rim'] = { ...b.components[pos + 'Rim'], ...rims[pos], supplied: true }; b.customerSupplied[pos].rim = true; o.line_items.push({ id: 1, title: 'Your Own Rim', variant_title: '29" / 32h', quantity: 1, price: '1.00', variant_id: 0, properties: [{ name: 'Wheel', value: Pos }, { name: 'Customer Rim', value: 'ENVE M630 29" 32h' }, { name: '_Own_Rim_Variant_ID', value: String(rims[pos].variantId).replace(/^.*\//, '') }] }); }
    if (hubs[pos]) { b.components[pos + 'Hub'] = { ...b.components[pos + 'Hub'], supplied: true }; b.customerSupplied[pos].hub = true; o.line_items.push({ id: 2, title: 'Your Own Hub', quantity: 1, price: '1.00', variant_id: 0, properties: [{ name: 'Wheel', value: Pos }, { name: 'Customer Hub', value: `Industry Nine Hydra2 32h ${pos}` }, { name: '_Own_Hub_Variant_ID', value: String(b.components[pos + 'Hub'].variantId).replace(/^.*\//, '') }] }); }
    if (rims[pos] || hubs[pos]) o.line_items.push({ id: 3, title: 'Assembly Service', quantity: 1, price: fee === SETFEE ? '120.00' : '100.00', variant_id: fee, properties: [{ name: 'Wheel', value: Pos }] }); }
  p.value = JSON.stringify(b); const bl = o.line_items.find((l) => (l.properties || []).some((x) => x.name === '_build')); bl.properties.push({ name: '_Customer_Parts_Confirmed', value: 'true' }); if (quantity) bl.quantity = quantity; return o;
}
const cases = [
  ['1 front own rim only', make('hydra2-wheelset-32f-32r', { rims: { front: FUSE32 } })],
  ['2 rear own rim only', make('hydra2-wheelset-32f-32r', { rims: { rear: FUSE32 } })],
  ['3 both own rims', make('hydra2-wheelset-32f-32r', { rims: { front: FUSE32, rear: FUSE32 } })],
  ['4 own rim + own hub (front), own rim (rear)', make('hydra2-wheelset-32f-32r', { rims: { front: FUSE32, rear: FUSE32 }, hubs: { front: true } })],
  ['5 mixed set: front own rim, rear ours', make('hydra2-wheelset-32f-32r', { rims: { front: FUSE32 } })],
  ['6 single wheel (front only), $100 fee', make('hydra2-front-32h-only', { rims: { front: FUSE32 }, fee: SINGLEFEE })],
  ['7 quantity 2', make('hydra2-wheelset-32f-32r', { rims: { front: FUSE32, rear: FUSE32 }, quantity: 2 })],
  ['8 own rim with no chart row', make('hydra2-wheelset-32f-32r', { rims: { front: OTHER, rear: OTHER } })]
];
for (const [name, o] of cases) {
  const r = await H.runWebhook(INDEX, 'orders/create', o); const mail = text(r.emails.map((e) => e.html).join('\n'));
  console.log(`\n== ${name}: status ${r.status} | subject "${r.emails[0].subject}" | stock adjustments ${r.inventoryAdjustments.length} | log errors ${r.logs.filter(([k]) => k === 'error').length}`);
  for (const l of r.note.split('\n').filter((x) => /CUSTOMER-SUPPLIED|Parts must|Customer supplies|Spoke lengths|NOT CALCULATED|WARNINGS|^- |NOTE:/.test(x))) console.log('   note:', l.trim().slice(0, 240));
  console.log('   email:', mail.split('\n').map((s) => s.trim()).filter((s) => /CUSTOMER-SUPPLIED|Check this order/.test(s)).join(' | ').slice(0, 300) || '(no parts box)');
}
// 9 a Standard order is unchanged: the same Standard sample on main and now (see scripts/compare-own-parts.mjs: 29 sample orders byte-identical)
console.log('\n== 9 Standard order: unchanged, see scripts/compare-own-parts.mjs (29 of 29 sample orders byte-identical to main)');
