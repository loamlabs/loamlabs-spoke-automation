// I9-SYSTEM: writes the sample Shopify order payloads (webhook shape) used by the tests, the local render script, the test endpoint
// and the Standard before/after proof. Deterministic: run it again and the files come out the same.
//   node scripts/make-sample-payloads.mjs
// System samples: samples/system/*.json   Standard samples + Shopify mock data: samples/standard/*.json
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { geometry } from '../_lib/studio-geometry.js';
import { SYSTEM_SAMPLE_GEOMETRY, SYSTEM_HUB_MODELS, SYSTEM_FEE, sideCounts } from '../_lib/system-build.js';
import { expectedFeeVariant } from '../_lib/standard-build.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const outSystem = path.join(here, '..', 'samples', 'system'), outStandard = path.join(here, '..', 'samples', 'standard');
fs.rmSync(outSystem, { recursive: true, force: true }); fs.mkdirSync(outSystem, { recursive: true }); fs.mkdirSync(outStandard, { recursive: true });

const COLORS = ['Black', 'Blue', 'Bronze', 'Gold', 'Green', 'Lime', 'Orange', 'Pink', 'Purple', 'Red', 'Silver', 'Turquoise'];
const TIMES = '×';
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const gid = (t, n) => `gid://shopify/${t}/${n}`;

/* ------------------------------------------------------------------ System builds */

// the Studio wheel config the theme would build from its sample geometry
function cfgFor(model, pos, total) {
  const sample = SYSTEM_SAMPLE_GEOMETRY[model], n = sideCounts(SYSTEM_HUB_MODELS[model], pos, total);
  return { erd: sample.erd, rimHoles: total, drive: { n: n.drive, pcd: sample[pos].drive.pcd, cross: sample[pos].drive.cross }, rotor: { n: n.rotor, pcd: sample[pos].rotor.pcd, cross: sample[pos].rotor.cross } };
}
// paint(side, k, spoke) -> color; patterns count by vrank exactly like the Studio (see spoke-studio.js PATS)
const every = (mod, t, accent, base) => (side, k, p) => (p.vrank % mod === t ? accent : base);
const pairs = (mod, t, accent, base) => (side, k, p) => (((((p.vrank + 1 - t) % mod) + mod) % mod) < 2 ? accent : base);
const sideSolid = (which, accent, base) => (side) => (side === which ? accent : base);
const solid = (c) => () => c;

function studioValue(wheels) { // wheels: { front?: { model, total, hubColor, base, paint }, rear?: {...} }
  const v = { v: 1, hubColor: {}, base: {}, spokes: {}, accent: 'Orange' };
  for (const [pos, w] of Object.entries(wheels)) {
    const cfg = cfgFor(w.model, pos, w.total), g = geometry({ wheels: { [pos]: cfg } })[pos];
    v.hubColor[pos] = w.hubColor;
    v.base[pos] = { drive: w.base, rotor: w.base };
    v.spokes[pos] = { drive: g.drive.map((p, k) => w.paint('drive', k, p)), rotor: g.rotor.map((p, k) => w.paint('rotor', k, p)) };
  }
  return v;
}
function counts(arr) { const m = {}; arr.forEach((c) => { m[c] = (m[c] || 0) + 1; }); return m; }

let idSeq = 1;
function systemOrder(name, { buildType, model, wheels, orderNumber, note, freehub = 'XD' }) {
  const positions = buildType === 'Wheel Set' ? ['front', 'rear'] : [buildType.toLowerCase()];
  const value = studioValue(wheels);
  const buildId = `LL-${orderNumber}-SYS`;
  const brake = model === 'Solix' ? 'Centerlock' : '6-Bolt';
  const components = {};
  const specs = { brakeStyle: brake, systemHub: model, freehubType: positions.includes('rear') ? freehub : null };
  const lineItems = [];
  const baseProps = [{ name: '_BuildID', value: buildId }, { name: '_bundle_id', value: buildId }];
  const li = (title, variant_title, quantity, props, extra = {}) => lineItems.push({
    id: 15000 + idSeq++, title, name: variant_title && variant_title !== 'Default Title' ? `${title} - ${variant_title}` : title, variant_title, quantity,
    price: '0.00', sku: null, product_id: 90000 + idSeq, variant_id: 91000 + idSeq, properties: [...baseProps, ...props], ...extra
  });
  const readable = {};
  for (const pos of positions) {
    const w = wheels[pos], P = cap(pos), total = w.total, cfg = cfgFor(model, pos, total);
    const size = pos === 'front' ? '29"' : (buildType === 'Wheel Set' && model === 'Solix' ? '27.5"' : '29"');
    specs[pos + 'SpokeCount'] = `${total}h`; specs[pos + 'HubSpacing'] = pos === 'front' ? '15x110mm' : '12x148mm'; specs[pos + 'WheelSize'] = size;
    const rimTitle = model === 'Solix' ? 'We Are One Union' : 'Industry Nine Enduro S Carbon';
    components[pos + 'Rim'] = {
      variantId: gid('ProductVariant', 4000 + idSeq), title: rimTitle, variantTitle: `${size} / ${total}h${model === 'Solix' ? ' 2:1' : ''}`, sku: `RIM-${pos}`, price: 520, vendor: model === 'Solix' ? 'We Are One' : 'Industry Nine',
      selectedOptions: [{ name: 'Size', value: size }, { name: 'Spoke Count', value: `${total}h${model === 'Solix' ? ' 2:1' : ''}` }], quantityAvailable: 5, leadTimeDays: 0, weight_g: 460, rim_erd: String(cfg.erd)
    };
    const hubTitle = `Industry Nine ${model} SYSTEM ${P} Hub - ${brake}`;
    components[pos + 'Hub'] = {
      variantId: gid('ProductVariant', 5000 + idSeq), title: hubTitle, variantTitle: `${total}h / ${w.hubColor} / ${specs[pos + 'HubSpacing']}`, sku: `HUB-${pos}`, price: pos === 'front' ? 240 : 460, vendor: 'Industry Nine',
      spec_spoke_count: `${total}h`, spec_brake_interface: [brake], spec_hub_spacing: specs[pos + 'HubSpacing'], spec_freehub: pos === 'rear' ? freehub : null,
      selectedOptions: [{ name: 'Spoke Count', value: `${total}h` }, { name: 'Color', value: w.hubColor }, { name: 'Hub Spacing', value: specs[pos + 'HubSpacing'] }],
      leadTimeDays: 0, wheelModel: `Industry Nine ${model} SYSTEM`, quantityAvailable: 3, weight_g: pos === 'front' ? 150 : 290
    };
    const c = counts([...value.spokes[pos].drive, ...value.spokes[pos].rotor]);
    const names = Object.keys(c).sort((a, b) => c[b] - c[a]);
    components[pos + 'Spokes'] = {
      variantId: gid('ProductVariant', 7000 + COLORS.indexOf(w.base)), title: 'Industry Nine SYSTEM Spokes', variantTitle: `${w.base} / -`, sku: `I9-SYS-${w.base.toUpperCase().slice(0, 3)}`,
      price: 2.5 * total, unitPrice: 2.5, vendor: 'Industry Nine', selectedOptions: [{ name: 'Color', value: w.base }, { name: 'Length', value: '-' }],
      quantityAvailable: 500, leadTimeDays: 0, wheelModel: null, selectedColor: w.base, weight_g: 5.95, i9: true
    };
    components[pos + 'Nipples'] = null; components[pos + 'ValveStem'] = null; components[pos + 'AssemblyService'] = null; components[pos + 'TubelessTape'] = null;
    const custom = names.length > 1;
    components[pos + 'RequiredAddons'] = custom ? [{ name: SYSTEM_FEE.name, price: 25, variantGid: SYSTEM_FEE.variantGid, costInCents: 2500, i9Fee: true }] : [];
    // order lines, as the theme's addRawItem / spokeCartLines produce them
    li(rimTitle, components[pos + 'Rim'].variantTitle, 1, [{ name: 'Wheel', value: P }]);
    li(hubTitle, components[pos + 'Hub'].variantTitle, 1, [{ name: 'Wheel', value: P }, ...(pos === 'rear' ? [{ name: '_Freehub_Type', value: freehub }] : [])]);
    names.forEach((color) => li('Industry Nine SYSTEM Spokes', `${color} / -`, c[color], [{ name: 'Wheel', value: P }], { variant_id: 7000 + COLORS.indexOf(color), product_id: 700 }));
    if (custom) li(SYSTEM_FEE.name, 'Default Title', 1, [{ name: 'Wheel', value: P }], { variant_id: SYSTEM_FEE.variantId, product_id: 6779 });
    // readable properties (i9-system.js readableProperties)
    readable[`${P} Spoke Colors`] = names.map((n) => `${n} ${TIMES}${c[n]}`).join(', ');
    if (custom) ['drive', 'rotor'].forEach((side) => { readable[`${P} ${cap(side)} Side`] = value.spokes[pos][side].map((col, i) => `${i + 1} ${col}`).join(', '); });
  }
  if (positions.includes('rear')) components.rearComponentFreehub = null;
  readable['System Hub'] = model;
  if (positions.includes('rear')) readable['Freehub'] = freehub;
  const recipe = {
    step: 3, buildType, ridingStyle: 'trail', ridingStyleDisplay: 'Trail', spokeInterface: 'system',
    system: { v: 1, studioOpened: true, studio: value },
    customerSupplied: { front: {}, rear: {} }, specs, components, selectedOptionalAddons: {}, buildId,
    _ui: { activeVendor: {}, valveStemExplicitlyRemoved: false, step2AutoSelected: {} }
  };
  lineItems.unshift({
    id: 15000 + idSeq++, title: 'Custom Wheel Build', name: 'Custom Wheel Build', variant_title: null, quantity: 1, price: '0.00', product_id: 1, variant_id: 1,
    properties: [...baseProps, { name: '_is_custom_wheel_build', value: 'true' }, { name: '_EstLeadTime', value: '2-3 weeks' }, { name: '_build', value: JSON.stringify(recipe) },
      ...Object.entries(readable).map(([name, value]) => ({ name, value }))]
  });
  const order = {
    id: 6000000000 + orderNumber, admin_graphql_api_id: gid('Order', 6000000000 + orderNumber), order_number: orderNumber, name: `#${orderNumber}`,
    email: 'customer@example.com', customer: { first_name: 'Alex', last_name: 'Sample', email: 'customer@example.com' }, note: note || null, location_id: null, financial_status: 'paid', line_items: lineItems,
    _sample: { name, description: `Sample System order: ${name}` }
  };
  fs.writeFileSync(path.join(outSystem, name + '.json'), JSON.stringify(order, null, 2) + '\n');
  return order;
}

// Real wheels only (what a customer can build): Hydra2 front 28h / 32h, Hydra2 rear 32h only; Solix 24h front and rear.
// 1) Solix 24h 2:1 wheel set, several colors
systemOrder('solix-24h-wheelset-multicolor', {
  buildType: 'Wheel Set', model: 'Solix', orderNumber: 90001, note: 'Customer note: please match the purple hubs to my frame.',
  wheels: {
    front: { model: 'Solix', total: 24, hubColor: 'Purple', base: 'Black', paint: pairs(3, 0, 'Orange', 'Black') },          // 2 x 1 at rotation 0
    rear: { model: 'Solix', total: 24, hubColor: 'Purple', base: 'Black', paint: (side, k, p) => (side === 'rotor' ? 'Turquoise' : (p.vrank % 3 === 1 ? 'Lime' : 'Black')) } // rotor side Turquoise, Every 3rd Lime on the drive side
  }
});
// 2) Hydra2 wheel set, 28h front + 32h rear
systemOrder('hydra2-wheelset-28f-32r', {
  buildType: 'Wheel Set', model: 'Hydra2', orderNumber: 90002, freehub: 'MS',
  wheels: {
    front: { model: 'Hydra2', total: 28, hubColor: 'Black', base: 'Silver', paint: pairs(4, 0, 'Red', 'Silver') },
    rear: { model: 'Hydra2', total: 32, hubColor: 'Black', base: 'Black', paint: (side, k, p) => (side === 'rotor' ? 'Blue' : (p.vrank % 4 === 2 ? 'Gold' : 'Black')) }
  }
});
// 3) Hydra2 wheel set, 32h front + 32h rear (shows the front 32h lacing phase)
systemOrder('hydra2-wheelset-32f-32r', {
  buildType: 'Wheel Set', model: 'Hydra2', orderNumber: 90003, freehub: 'XD',
  wheels: {
    front: { model: 'Hydra2', total: 32, hubColor: 'Black', base: 'Silver', paint: pairs(4, 0, 'Red', 'Silver') },
    rear: { model: 'Hydra2', total: 32, hubColor: 'Black', base: 'Black', paint: (side, k, p) => (side === 'rotor' ? 'Blue' : (p.vrank % 4 === 2 ? 'Gold' : 'Black')) }
  }
});
// 4) front-only builds
systemOrder('hydra2-front-28h-only', {
  buildType: 'Front', model: 'Hydra2', orderNumber: 90004,
  wheels: { front: { model: 'Hydra2', total: 28, hubColor: 'Orange', base: 'Black', paint: every(4, 0, 'Green', 'Black') } }
});
systemOrder('hydra2-front-32h-only', {
  buildType: 'Front', model: 'Hydra2', orderNumber: 90005,
  wheels: { front: { model: 'Hydra2', total: 32, hubColor: 'Black', base: 'Black', paint: every(4, 1, 'Pink', 'Black') } }
});
// 5) rear-only build (Hydra2 rear is 32h only)
systemOrder('hydra2-rear-32h-only', {
  buildType: 'Rear', model: 'Hydra2', orderNumber: 90006, freehub: 'HG',
  wheels: { rear: { model: 'Hydra2', total: 32, hubColor: 'Silver', base: 'Black', paint: pairs(4, 2, 'Purple', 'Black') } }
});
// 6) a single-color wheel (text line only) next to a multi-color one
systemOrder('solix-single-color-front', {
  buildType: 'Wheel Set', model: 'Solix', orderNumber: 90007,
  wheels: {
    front: { model: 'Solix', total: 24, hubColor: 'Black', base: 'Black', paint: solid('Black') },                           // one color: text line only
    rear: { model: 'Solix', total: 24, hubColor: 'Black', base: 'Black', paint: sideSolid('drive', 'Red', 'Black') }        // drive side Red
  }
});
// 7) every spoke a different color on the Hydra2 rear 32h (12 colors cycling over 32 spokes, so neighbours always differ)
systemOrder('hydra2-rear-32h-all-different', {
  buildType: 'Rear', model: 'Hydra2', orderNumber: 90008, freehub: 'HG',
  wheels: { rear: { model: 'Hydra2', total: 32, hubColor: 'Gold', base: 'Black', paint: (side, k, p) => COLORS[p.vrank % COLORS.length] } }
});

/* ------------------------------------------------------------------ Standard builds (classic path, unchanged code) + Shopify mock data */

const mock = { metafields: {}, variantColors: ['Black', 'Silver', 'White Berd', 'Black Berd'], variantLengths: [230, 330] };
function mf(variantNum, productNum, fields) { mock.metafields[gid('ProductVariant', variantNum)] = { ...fields, _parent_product_id: gid('Product', productNum) }; }

function standardOrder(name, { buildType, orderNumber, note, specs, components }) {
  const buildId = `LL-${orderNumber}-STD`;
  const recipe = {
    step: 3, buildType, ridingStyle: 'trail', ridingStyleDisplay: 'Trail', spokeInterface: 'standard', system: null,
    customerSupplied: { front: {}, rear: {} }, specs, components, selectedOptionalAddons: {}, buildId,
    _ui: { activeVendor: {}, valveStemExplicitlyRemoved: false, step2AutoSelected: {} }
  };
  const baseProps = [{ name: '_BuildID', value: buildId }, { name: '_bundle_id', value: buildId }];
  const lineItems = [{
    id: 15000 + idSeq++, title: 'Custom Wheel Build', name: 'Custom Wheel Build', variant_title: null, quantity: 1, price: '0.00', product_id: 1, variant_id: 1,
    properties: [...baseProps, { name: '_is_custom_wheel_build', value: 'true' }, { name: '_EstLeadTime', value: '2-3 weeks' }, { name: '_build', value: JSON.stringify(recipe) }]
  }];
  Object.entries(components).forEach(([key, comp]) => {
    if (!comp || !comp.variantId) return;
    const pos = key.startsWith('front') ? 'Front' : 'Rear';
    lineItems.push({ id: 15000 + idSeq++, title: comp.title, name: comp.title, variant_title: comp.variantTitle || null, quantity: 1, price: String(comp.price || 0), product_id: 2, variant_id: Number(comp.variantId.split('/').pop()), properties: [...baseProps, { name: 'Wheel', value: pos }] });
  });
  const order = {
    id: 6000000000 + orderNumber, admin_graphql_api_id: gid('Order', 6000000000 + orderNumber), order_number: orderNumber, name: `#${orderNumber}`,
    email: 'customer@example.com', customer: { first_name: 'Alex', last_name: 'Sample', email: 'customer@example.com' }, note: note || null, location_id: null, financial_status: 'paid', line_items: lineItems,
    _sample: { name, description: `Sample Standard order: ${name}` }
  };
  fs.writeFileSync(path.join(outStandard, name + '.json'), JSON.stringify(order, null, 2) + '\n');
}

// A) steel J-bend wheel set (classic flange hubs), customer note present
mf(1001, 101, { rim_erd: '596', rim_washer_policy: 'Optional', nipple_washer_thickness: '0.6', rim_target_tension_kgf: '120', rim_spoke_hole_offset: '0' });
mf(1002, 102, { hub_type: 'Classic Flange', hub_flange_diameter_left: '58', hub_flange_diameter_right: '58', hub_flange_offset_left: '32', hub_flange_offset_right: '22', hub_spoke_hole_diameter: '2.6' });
mf(1003, 103, { spoke_cross_section_area_mm2: '2.3' });
mf(1004, 101, { rim_erd: '596', rim_washer_policy: 'Optional', nipple_washer_thickness: '0.6', rim_target_tension_kgf: '120', rim_spoke_hole_offset: '0' });
mf(1005, 104, { hub_type: 'Classic Flange', hub_flange_diameter_left: '58', hub_flange_diameter_right: '58', hub_flange_offset_left: '35', hub_flange_offset_right: '20', hub_spoke_hole_diameter: '2.6' });
mf(1006, 103, { spoke_cross_section_area_mm2: '2.3' });
standardOrder('steel-jbend-wheelset', {
  buildType: 'Wheel Set', orderNumber: 80001, note: 'Please ship by Friday.',
  specs: { brakeStyle: '6-Bolt', frontSpokeCount: '32h', rearSpokeCount: '32h', frontHubSpacing: '15x110mm', rearHubSpacing: '12x148mm', freehubType: 'XD', frontWheelSize: '29"', rearWheelSize: '29"' },
  components: {
    frontRim: { variantId: gid('ProductVariant', 1001), title: 'We Are One Union', variantTitle: '29" / 32h', vendor: 'We Are One', price: 520, selectedOptions: [{ name: 'Size', value: '29"' }, { name: 'Spoke Count', value: '32h' }] },
    frontHub: { variantId: gid('ProductVariant', 1002), title: 'Industry Nine 1/1 Classic Front Hub', variantTitle: '32h / Black / 15x110mm', vendor: 'Industry Nine', price: 200, selectedOptions: [{ name: 'Color', value: 'Black' }] },
    frontSpokes: { variantId: gid('ProductVariant', 1003), title: 'Sapim D-Light J-Bend', variantTitle: 'Black / 290mm', vendor: 'Sapim', price: 1.4, selectedOptions: [{ name: 'Color', value: 'Black' }, { name: 'Length', value: '290mm' }], selectedColor: 'Black' },
    frontNipples: { variantId: gid('ProductVariant', 1101), title: 'Sapim Polyax Brass Nipples', variantTitle: 'Black', vendor: 'Sapim', price: 0.3 },
    rearRim: { variantId: gid('ProductVariant', 1004), title: 'We Are One Union', variantTitle: '29" / 32h', vendor: 'We Are One', price: 520, selectedOptions: [{ name: 'Size', value: '29"' }, { name: 'Spoke Count', value: '32h' }] },
    rearHub: { variantId: gid('ProductVariant', 1005), title: 'Industry Nine 1/1 Classic Rear Hub', variantTitle: '32h / Black / 12x148mm', vendor: 'Industry Nine', price: 400, spec_freehub: 'XD', selectedOptions: [{ name: 'Color', value: 'Black' }] },
    rearSpokes: { variantId: gid('ProductVariant', 1006), title: 'Sapim D-Light J-Bend', variantTitle: 'Silver / 288mm', vendor: 'Sapim', price: 1.4, selectedOptions: [{ name: 'Color', value: 'Silver' }, { name: 'Length', value: '288mm' }], selectedColor: 'Silver' },
    rearNipples: { variantId: gid('ProductVariant', 1101), title: 'Sapim Polyax Brass Nipples', variantTitle: 'Black', vendor: 'Sapim', price: 0.3 }
  }
});
// B) Berd PolyLight, straight pull, front only, custom Berd color (deducts from White Berd)
mf(2001, 201, { rim_erd: '600', rim_washer_policy: 'Not Compatible', nipple_washer_thickness: '0', rim_target_tension_kgf: '110', rim_spoke_hole_offset: '2.5' });
mf(2002, 202, { hub_type: 'Straight Pull', hub_flange_diameter_left: '50', hub_flange_diameter_right: '50', hub_flange_offset_left: '34', hub_flange_offset_right: '26', hub_sp_offset_spoke_hole_left: '3.2', hub_sp_offset_spoke_hole_right: '3.2' });
mf(2003, 203, { spoke_model_group: 'PolyLight' });
standardOrder('berd-straightpull-front', {
  buildType: 'Front', orderNumber: 80002,
  specs: { brakeStyle: 'Centerlock', frontSpokeCount: '28h', frontHubSpacing: '15x110mm', frontWheelSize: '29"' },
  components: {
    frontRim: { variantId: gid('ProductVariant', 2001), title: 'Reserve 30|SL', variantTitle: '29" / 28h', vendor: 'Reserve', price: 650, selectedOptions: [{ name: 'Size', value: '29"' }, { name: 'Spoke Count', value: '28h' }] },
    frontHub: { variantId: gid('ProductVariant', 2002), title: 'DT Swiss 240 Straight Pull Front Hub', variantTitle: '28h / Black / 15x110mm', vendor: 'DT Swiss', price: 300, selectedOptions: [{ name: 'Color', value: 'Black' }] },
    frontSpokes: { variantId: gid('ProductVariant', 2003), title: 'Berd PolyLight', variantTitle: 'Orange Berd / 280mm', vendor: 'Berd', price: 6.5, selectedOptions: [{ name: 'Color', value: 'Orange Berd' }, { name: 'Length', value: '280mm' }], selectedColor: 'Orange Berd' },
    frontNipples: { variantId: gid('ProductVariant', 2101), title: 'Berd Nipples', variantTitle: 'Black', vendor: 'Berd', price: 0.5 }
  }
});
// C) rim brake 24h front (radial default) + customer-supplied rear hub (calculation skipped for the rear)
mf(3001, 301, { rim_erd: '605', rim_washer_policy: 'Optional', nipple_washer_thickness: '0.5', rim_target_tension_kgf: '115', rim_spoke_hole_offset: '0' });
mf(3002, 302, { hub_type: 'Classic Flange', hub_flange_diameter_left: '40', hub_flange_diameter_right: '40', hub_flange_offset_left: '35', hub_flange_offset_right: '35', hub_spoke_hole_diameter: '2.5' });
mf(3003, 103, { spoke_cross_section_area_mm2: '2.3' });
mf(3004, 301, { rim_erd: '605', rim_washer_policy: 'Optional', nipple_washer_thickness: '0.5', rim_target_tension_kgf: '115', rim_spoke_hole_offset: '0' });
mf(3006, 103, { spoke_cross_section_area_mm2: '2.3' });
standardOrder('rimbrake-front-own-rear-hub', {
  buildType: 'Wheel Set', orderNumber: 80003,
  specs: { brakeStyle: 'Rim Brake', frontSpokeCount: '24h', rearSpokeCount: '28h', frontHubSpacing: '100mm QR', rearHubSpacing: '130mm QR', freehubType: 'HG', frontWheelSize: '700c', rearWheelSize: '700c' },
  components: {
    frontRim: { variantId: gid('ProductVariant', 3001), title: 'H Plus Son Archetype', variantTitle: '700c / 24h', vendor: 'H Plus Son', price: 120, selectedOptions: [{ name: 'Size', value: '700c' }, { name: 'Spoke Count', value: '24h' }] },
    frontHub: { variantId: gid('ProductVariant', 3002), title: 'White Industries T11 Front Hub', variantTitle: '24h / Silver / 100mm QR', vendor: 'White Industries', price: 250, selectedOptions: [{ name: 'Color', value: 'Silver' }] },
    frontSpokes: { variantId: gid('ProductVariant', 3003), title: 'Sapim D-Light J-Bend', variantTitle: 'Silver / 296mm', vendor: 'Sapim', price: 1.4, selectedOptions: [{ name: 'Color', value: 'Silver' }, { name: 'Length', value: '296mm' }], selectedColor: 'Silver' },
    frontNipples: { variantId: gid('ProductVariant', 1101), title: 'Sapim Polyax Brass Nipples', variantTitle: 'Silver', vendor: 'Sapim', price: 0.3 },
    rearRim: { variantId: gid('ProductVariant', 3004), title: 'H Plus Son Archetype', variantTitle: '700c / 28h', vendor: 'H Plus Son', price: 120, selectedOptions: [{ name: 'Size', value: '700c' }, { name: 'Spoke Count', value: '28h' }] },
    rearHub: { variantId: gid('ProductVariant', 3005), title: 'Your Own Hub', variantTitle: 'Rear / 28h', vendor: 'Your Own Component', price: 0, selectedOptions: [] },
    rearSpokes: { variantId: gid('ProductVariant', 3006), title: 'Sapim D-Light J-Bend', variantTitle: 'Silver / 290mm', vendor: 'Sapim', price: 1.4, selectedOptions: [{ name: 'Color', value: 'Silver' }, { name: 'Length', value: '290mm' }], selectedColor: 'Silver' },
    rearNipples: { variantId: gid('ProductVariant', 1101), title: 'Sapim Polyax Brass Nipples', variantTitle: 'Silver', vendor: 'Sapim', price: 0.3 }
  }
});

// 8) Solix 24h wheel set: custom front (Orange x16 + Purple x8) and a SOLID Black rear. Generated after the Standard samples on purpose, so their ids do not move.
systemOrder('solix-24h-wheelset-front-custom-rear-solid', {
  buildType: 'Wheel Set', model: 'Solix', orderNumber: 90009,
  wheels: {
    front: { model: 'Solix', total: 24, hubColor: 'Purple', base: 'Purple', paint: pairs(3, 0, 'Orange', 'Purple') }, // 2 x 1 in Orange over a Purple base: Orange x16, Purple x8
    rear: { model: 'Solix', total: 24, hubColor: 'Purple', base: 'Black', paint: solid('Black') }                      // solid Black x24 (no fee line)
  }
});

// 9) Solix 24h wheel set with BOTH wheels one solid color (Black x24 front, Black x24 rear): no fee line, one all-spokes image per wheel. Generated after the
// Standard samples on purpose, so their ids do not move.
systemOrder('solix-24h-wheelset-both-solid-black', {
  buildType: 'Wheel Set', model: 'Solix', orderNumber: 90010,
  wheels: {
    front: { model: 'Solix', total: 24, hubColor: 'Purple', base: 'Black', paint: solid('Black') },
    rear: { model: 'Solix', total: 24, hubColor: 'Purple', base: 'Black', paint: solid('Black') }
  }
});

/* ------------------------------------------------------------------ Standard builds that carry the theme's standardStudio key */
// Built to the contract of the theme branch agent-b-standard-studio (see _lib/standard-build.js). These are ADDITIONS: the three unkeyed Standard samples
// above stay exactly as they were (they prove that an order without the key produces today's output). Generated after everything else so no id moves.
const BERD_PAINT = ['Blue Berd', 'Flamingo Pink', 'Mallard Green', 'Martin Purple', 'Oriole Orange', 'Robin Red']; // painted colors of the Berd spoke product (flag = Yes)
const STD_HEX = { Black: '#1d1f23', Silver: '#c3c8cf', 'Black Berd': '#1d1f23', 'White Berd': '#f2f2f2', 'Blue Berd': '#1f62d6', 'Flamingo Pink': '#ee5ba3', 'Mallard Green': '#1e6b4a', 'Martin Purple': '#7b3fb9', 'Oriole Orange': '#f07a1a', 'Robin Red': '#d0262b' };
const STD_LABELS = { front: { drive: 'Right side', rotor: 'Left side' }, rear: { drive: 'Drive side', rotor: 'Non-drive side' } };
// spreads { color: n } over n slots so equal colors are not all side by side
function spread(counts, n) {
  const left = { ...counts }, out = [];
  while (out.length < n) {
    const prev = out[out.length - 1];
    const pick = Object.keys(left).filter((c) => left[c] > 0).sort((a, b) => (left[b] - left[a]) || a.localeCompare(b)).find((c) => c !== prev) || Object.keys(left).find((c) => left[c] > 0);
    out.push(pick); left[pick]--;
  }
  return out;
}
const sumOf = (o) => Object.values(o).reduce((s, n) => s + n, 0);

function stdKeyedOrder(name, { orderNumber, buildType, brake, wheels, note, paintMissing = false, description }) {
  const positions = Object.keys(wheels);
  const buildId = 'LL-' + orderNumber + '-STD';
  const baseProps = [{ name: '_BuildID', value: buildId }, { name: '_bundle_id', value: buildId }];
  const components = {}, specs = { brakeStyle: brake, frontWheelSize: '29"', rearWheelSize: '29"' };
  const lineItems = [];
  const li = (title, variant_title, quantity, props, extra = {}) => lineItems.push({ id: 15000 + idSeq++, title, name: title, variant_title, quantity, price: '0.00', product_id: 90000 + idSeq, variant_id: 91000 + idSeq, properties: [...baseProps, ...props], ...extra });
  const readable = {}, colorsUsed = {}, studioSpokes = {}, studioBase = {}, studioHub = {}, paintWheels = {}, wheelCfg = {};
  let anyCustom = false;
  for (const pos of positions) {
    const w = wheels[pos], P = cap(pos), n = w.total / 2;
    const counts = w.counts || { drive: { [w.solid]: n }, rotor: { [w.solid]: n } };
    const all = {}; for (const s of ['drive', 'rotor']) for (const [c, k] of Object.entries(counts[s])) all[c] = (all[c] || 0) + k;
    const custom = Object.keys(all).length > 1;
    const base = w.base || (w.solid || Object.keys(all).sort((a, b) => all[b] - all[a])[0]);
    specs[pos + 'SpokeCount'] = w.total + 'h'; specs[pos + 'HubSpacing'] = pos === 'front' ? '15x110mm' : '12x148mm';
    if (pos === 'rear') specs.freehubType = 'XD';
    mf(w.rim.v, w.rim.p, w.rim.fields); mf(w.hub.v, w.hub.p, w.hub.fields); mf(w.spokes.v, w.spokes.p, w.spokes.fields);
    components[pos + 'Rim'] = { variantId: gid('ProductVariant', w.rim.v), title: w.rim.title, variantTitle: '29" / ' + w.total + 'h', vendor: w.rim.vendor, price: 520, selectedOptions: [{ name: 'Size', value: '29"' }, { name: 'Spoke Count', value: w.total + 'h' }] };
    components[pos + 'Hub'] = { variantId: gid('ProductVariant', w.hub.v), title: w.hub.title, variantTitle: w.total + 'h / ' + w.hub.color + ' / ' + specs[pos + 'HubSpacing'], vendor: w.hub.vendor, price: 300, spec_freehub: pos === 'rear' ? 'XD' : null, selectedOptions: [{ name: 'Color', value: w.hub.color }] };
    components[pos + 'Spokes'] = { variantId: gid('ProductVariant', w.spokes.v), title: w.spokes.title, variantTitle: base + ' / 290mm', vendor: w.spokes.vendor, price: 2, selectedOptions: [{ name: 'Color', value: base }, { name: 'Length', value: '290mm' }], selectedColor: base };
    components[pos + 'Nipples'] = { variantId: gid('ProductVariant', 1101), title: 'Sapim Polyax Brass Nipples', variantTitle: 'Black', vendor: 'Sapim', price: 0.3 };
    wheelCfg[pos] = { erd: Number(w.rim.fields.rim_erd), drive: { n, pcd: w.pcd, cross: w.cross }, rotor: { n, pcd: w.pcd, cross: w.cross }, sideLabels: STD_LABELS[pos] }; // erd (mm): the contract carries the ERD the Studio drew
    colorsUsed[w.hub.color] = STD_HEX[w.hub.color] || '#8a9099';
    Object.keys(all).forEach((c) => { colorsUsed[c] = STD_HEX[c]; });
    if (custom) {
      anyCustom = true;
      studioSpokes[pos] = { drive: spread(counts.drive, n), rotor: spread(counts.rotor, n) };
      studioBase[pos] = { drive: base, rotor: base };
    }
    studioHub[pos] = w.hub.color;
    if (!paintMissing) paintWheels[pos] = { paintColors: w.spokes.vendor === 'Berd' ? BERD_PAINT : [] };
    // cart lines: rim, hub, one spoke line per color (quantity = spokes of that color), fee line
    li(w.rim.title, components[pos + 'Rim'].variantTitle, 1, [{ name: 'Wheel', value: P }]);
    li(w.hub.title, components[pos + 'Hub'].variantTitle, 1, [{ name: 'Wheel', value: P }]);
    Object.entries(all).sort((a, b) => b[1] - a[1]).forEach(([c, k]) => li(w.spokes.title, c + ' / 290mm', k, [{ name: 'Wheel', value: P }]));
    const fee = expectedFeeVariant({ berdType: w.spokes.vendor === 'Berd', paintColors: w.spokes.vendor === 'Berd' ? BERD_PAINT : [], colorNames: Object.keys(all) });
    if (fee) li('Custom Spoke Color Configuration', fee, 1, [{ name: 'Wheel', value: P }], { variant_id: 67791816196403 + (fee === 'Mixed colors' ? 0 : fee === 'Berd painted color' ? 1 : 2) });
    readable[P + ' Spoke Colors'] = Object.entries(all).sort((a, b) => b[1] - a[1]).map(([c, k]) => c + ' ' + TIMES + k).join(', ');
    if (custom) for (const s of ['drive', 'rotor']) readable[P + ' ' + cap(s) + ' Side'] = studioSpokes[pos][s].map((c, i) => (i + 1) + ' ' + c).join(', ');
  }
  const standardStudio = {
    v: 1, studioOpened: anyCustom,
    studio: anyCustom ? { v: 1, hubColor: studioHub, base: studioBase, spokes: studioSpokes, accent: Object.keys(colorsUsed).find((c) => !Object.values(studioBase).some((b) => b.drive === c)) || null } : null,
    wheels: wheelCfg, colors: colorsUsed,
    paint: paintMissing ? undefined : { blank: 'White Berd', wheels: paintWheels }
  };
  const recipe = { step: 3, buildType, ridingStyle: 'trail', ridingStyleDisplay: 'Trail', spokeInterface: 'standard', system: null, customerSupplied: { front: {}, rear: {} }, specs, components, selectedOptionalAddons: {}, buildId, _ui: { activeVendor: {}, valveStemExplicitlyRemoved: false, step2AutoSelected: {} }, standardStudio };
  lineItems.unshift({ id: 15000 + idSeq++, title: 'Custom Wheel Build', name: 'Custom Wheel Build', variant_title: null, quantity: 1, price: '0.00', product_id: 1, variant_id: 1,
    properties: [...baseProps, { name: '_is_custom_wheel_build', value: 'true' }, { name: '_EstLeadTime', value: '2-3 weeks' }, { name: '_build', value: JSON.stringify(recipe) }, ...Object.entries(readable).map(([n, v]) => ({ name: n, value: v }))] });
  const used = new Set(Object.values(components).filter((c) => c && c.variantId).map((c) => c.variantId));
  const metafields = Object.fromEntries(Object.entries(mock.metafields).filter(([k]) => used.has(k)));
  const order = { id: 6000000000 + orderNumber, admin_graphql_api_id: gid('Order', 6000000000 + orderNumber), order_number: orderNumber, name: '#' + orderNumber, email: 'customer@example.com',
    customer: { first_name: 'Alex', last_name: 'Sample', email: 'customer@example.com' }, note: note || null, location_id: null, financial_status: 'paid', line_items: lineItems,
    _sample: { name, description: description || ('Sample Standard order with standardStudio: ' + name), metafields } };
  fs.writeFileSync(path.join(outStandard, name + '.json'), JSON.stringify(order, null, 2) + '\n');
}

const STEEL_RIM = { vendor: 'We Are One', title: 'We Are One Union', fields: { rim_erd: '596', rim_washer_policy: 'Optional', nipple_washer_thickness: '0.6', rim_target_tension_kgf: '120', rim_spoke_hole_offset: '0' } };
const STEEL_HUB = (pos) => ({ vendor: 'Hope', title: 'Hope Pro 4 ' + cap(pos) + ' Hub', fields: { hub_type: 'Classic Flange', hub_flange_diameter_left: '58', hub_flange_diameter_right: '58', hub_flange_offset_left: pos === 'front' ? '32' : '35', hub_flange_offset_right: pos === 'front' ? '22' : '20', hub_spoke_hole_diameter: '2.6' } });
const BERD_RIM = { vendor: 'Reserve', title: 'Reserve 30|SL', fields: { rim_erd: '600', rim_washer_policy: 'Not Compatible', nipple_washer_thickness: '0', rim_target_tension_kgf: '110', rim_spoke_hole_offset: '0' } };
const BERD_HUB = (pos, o) => ({ vendor: 'DT Swiss', title: 'DT Swiss 240 Straight Pull ' + cap(pos) + ' Hub', fields: { hub_type: 'Straight Pull', hub_flange_diameter_left: '50', hub_flange_diameter_right: '50', hub_flange_offset_left: String(o.l), hub_flange_offset_right: String(o.r), hub_sp_offset_spoke_hole_left: '3.2', hub_sp_offset_spoke_hole_right: '3.2' } });

// 1) a solid steel wheel set (32h/32h, 3-cross): front Silver, rear Black, Studio never opened
stdKeyedOrder('std-steel-wheelset-solid', {
  orderNumber: 91001, buildType: 'Wheel Set', brake: '6-Bolt', note: 'Customer note: ride this at the weekend, thanks.',
  description: 'Solid steel wheel set: front Silver x32, rear Black x32 (no custom colors, no fee, no paint list)',
  wheels: {
    front: { total: 32, cross: 3, pcd: 58, solid: 'Silver', rim: { v: 1001, p: 101, ...STEEL_RIM }, hub: { v: 1002, p: 102, color: 'Black', ...STEEL_HUB('front') }, spokes: { v: 1003, p: 103, title: 'Sapim D-Light J-Bend', vendor: 'Sapim', fields: { spoke_cross_section_area_mm2: '2.3' } } },
    rear: { total: 32, cross: 3, pcd: 58, solid: 'Black', rim: { v: 1004, p: 101, ...STEEL_RIM }, hub: { v: 1005, p: 104, color: 'Black', ...STEEL_HUB('rear') }, spokes: { v: 1006, p: 103, title: 'Sapim D-Light J-Bend', vendor: 'Sapim', fields: { spoke_cross_section_area_mm2: '2.3' } } }
  }
});
// 2) a custom Berd rear (24h, 2-cross): Oriole Orange x8 + Martin Purple x10 (two painted colors) + Black Berd x6
stdKeyedOrder('std-berd-rear-custom-two-painted', {
  orderNumber: 91002, buildType: 'Rear', brake: 'Centerlock',
  description: 'Custom Berd rear 24h: Oriole Orange x8 + Martin Purple x10 (painted) + Black Berd x6 (fee: Berd multi-color)',
  wheels: {
    rear: { total: 24, cross: 2, pcd: 50, base: 'Black Berd', counts: { drive: { 'Oriole Orange': 4, 'Martin Purple': 6, 'Black Berd': 2 }, rotor: { 'Oriole Orange': 4, 'Martin Purple': 4, 'Black Berd': 4 } },
      rim: { v: 6004, p: 601, ...BERD_RIM }, hub: { v: 6005, p: 602, color: 'Black', ...BERD_HUB('rear', { l: 34, r: 20 }) }, spokes: { v: 6006, p: 603, title: 'Berd PolyLight', vendor: 'Berd', fields: { spoke_model_group: 'PolyLight' } } }
  }
});
// 3) a front radial 24h rim-brake wheel in solid Martin Purple Berd (fee: Berd painted color)
stdKeyedOrder('std-berd-front-24h-radial-solid-purple', {
  orderNumber: 91003, buildType: 'Front', brake: 'Rim Brake',
  description: 'Front 24h radial (rim brake) wheel, solid Martin Purple Berd x24 (one painted color, fee: Berd painted color)',
  wheels: {
    front: { total: 24, cross: 0, pcd: 50, solid: 'Martin Purple', rim: { v: 6001, p: 601, ...BERD_RIM }, hub: { v: 6002, p: 602, color: 'Silver', ...BERD_HUB('front', { l: 36, r: 36 }) }, spokes: { v: 6003, p: 603, title: 'Berd PolyLight', vendor: 'Berd', fields: { spoke_model_group: 'PolyLight' } } }
  }
});

fs.writeFileSync(path.join(outStandard, 'mock-shopify.json'), JSON.stringify(mock, null, 2) + '\n');
console.log('wrote samples to', outSystem, 'and', outStandard);
