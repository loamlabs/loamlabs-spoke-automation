// A fake "preconfigured master variant" order for the webhook tests (names changed, ids invented). Shape copied from a real preconfigured order (a Reserve wheelset,
// May 2026): ONE line item, the master variant, carrying the readable spec lines, _is_custom_wheel_build, _EstLeadTime, _build and _Preconfigured_Rule.
// There are NO separate rim, hub or spoke lines on the order. Metafield values are the ones the real components carry in the store (read-only copy, no personal data).
import { loadMockShopify } from './webhook-harness.mjs';

export const PRE = {
  frontRim: 'gid://shopify/ProductVariant/9101', rearRim: 'gid://shopify/ProductVariant/9102',
  frontHub: 'gid://shopify/ProductVariant/9103', rearHub: 'gid://shopify/ProductVariant/9104',
  spokes: 'gid://shopify/ProductVariant/9105', nipples: 'gid://shopify/ProductVariant/9106'
};

const comp = (variantId, title, variantTitle, extra = {}) => ({ variantId, title, variantTitle, sku: null, price: 1000, vendor: 'Test Brand', selectedOptions: [], ...extra });

export function preconfiguredBuild() {
  return {
    step: 3, buildType: 'Wheel Set', ridingStyle: 'gravelroad', ridingStyleDisplay: 'Gravel / Road',
    customerSupplied: { front: { rim: false, hub: false }, rear: { rim: false, hub: false } },
    specs: { frontWheelSize: '700c', rearWheelSize: '700c', frontSpokeCount: '24h', rearSpokeCount: '24h', brakeStyle: 'Centerlock', frontHubSpacing: '12x100mm', rearHubSpacing: '12x142mm', freehubType: 'MS' },
    components: {
      frontRim: comp(PRE.frontRim, 'Test Rim 40 GR 700c Carbon Rim', '700c / 24h / Black', { selectedOptions: [{ name: 'Size', value: '700c' }, { name: 'Spoke Count', value: '24h' }, { name: 'Color', value: 'Black' }], rim_erd: '560.0' }),
      rearRim: comp(PRE.rearRim, 'Test Rim 44 GR 700c Carbon Rim', '700c / 24h / Black', { selectedOptions: [{ name: 'Size', value: '700c' }, { name: 'Spoke Count', value: '24h' }, { name: 'Color', value: 'Black' }], rim_erd: '552.0' }),
      frontHub: comp(PRE.frontHub, 'Test Hub 240 SP Front Hub - Centerlock - 12x100mm', '24h / Black'),
      rearHub: comp(PRE.rearHub, 'Test Hub 240 EXP SP Rear Hub - Centerlock - 12x142mm', '24h / Black'),
      frontSpokes: comp(PRE.spokes, 'Test Spoke CX Straight Pull', 'Black / -', { vendor: 'Test Spokes', selectedOptions: [{ name: 'Color', value: 'Black' }, { name: 'Length', value: '-' }] }),
      rearSpokes: comp(PRE.spokes, 'Test Spoke CX Straight Pull', 'Black / -', { vendor: 'Test Spokes', selectedOptions: [{ name: 'Color', value: 'Black' }, { name: 'Length', value: '-' }] }),
      frontNipples: comp(PRE.nipples, 'Test Aluminum Nipples', 'Black'), rearNipples: comp(PRE.nipples, 'Test Aluminum Nipples', 'Black'),
      frontRequiredAddons: [], rearRequiredAddons: []
    },
    selectedOptionalAddons: {}, buildId: '900001'
  };
}

export function preconfiguredOrder({ rule = 'Test 40/44 with Test Hub 240 and CX', build = preconfiguredBuild(), orderNumber = 90301 } = {}) {
  const props = [
    ['_BuildID', '900001'], ['_bundle_id', '900001'],
    ['Front Rim', 'Test Rim 40 GR 700c Carbon Rim (700c / 24h / Black)'], ['Rear Rim', 'Test Rim 44 GR 700c Carbon Rim (700c / 24h / Black)'],
    ['Front Hub', 'Test Hub 240 SP Front Hub - Centerlock - 12x100mm (24h / Black)'], ['Rear Hub', 'Test Hub 240 EXP SP Rear Hub - Centerlock - 12x142mm (24h / Black)'],
    ['Freehub Body', 'MS'], ['Front Spokes', 'Test Spoke CX Straight Pull (Black / -)'], ['Rear Spokes', 'Test Spoke CX Straight Pull (Black / -)'],
    ['Front Nipples', 'Test Aluminum Nipples (Black)'], ['Rear Nipples', 'Test Aluminum Nipples (Black)'],
    ['_is_custom_wheel_build', 'true'], ['_EstLeadTime', 'Approx. 1 Week'], ['_build', JSON.stringify(build)]
  ];
  if (rule) props.push(['_Preconfigured_Rule', rule]);
  return {
    id: 6000000000 + orderNumber, admin_graphql_api_id: `gid://shopify/Order/${6000000000 + orderNumber}`, order_number: orderNumber, name: `#${orderNumber}`,
    email: 'customer@example.com', customer: { first_name: 'Alex', last_name: 'Sample', email: 'customer@example.com' }, note: null, location_id: null, financial_status: 'paid',
    line_items: [{ id: 15100, title: 'Test Brand 40|44 GR Carbon Gravel Wheelset', name: 'Test Brand 40|44 GR Carbon Gravel Wheelset', variant_title: 'Test Hub 240 / CX - BLACK / HG11', quantity: 1, price: '2400', product_id: 5, variant_id: 9100, vendor: 'Test Brand',
      properties: props.map(([name, value]) => ({ name, value })) }]
  };
}

// Metafields of the components as the store has them (values copied read-only from the real components of the order the shape came from).
export function preconfiguredMetafields() {
  const rim = (erd, off) => ({ rim_erd: erd, rim_washer_policy: 'Mandatory', nipple_washer_thickness: '0.3', rim_target_tension_kgf: '115', rim_spoke_hole_offset: off });
  const hub = (dl, dr, ol, or, sl, sr) => ({ hub_type: 'Straight Pull', hub_flange_diameter_left: dl, hub_flange_diameter_right: dr, hub_flange_offset_left: ol, hub_flange_offset_right: or, hub_spoke_hole_diameter: '2.6',
    hub_sp_offset_spoke_hole_left: sl, hub_sp_offset_spoke_hole_right: sr, hub_lacing_policy: 'Use Manual Override Field', hub_manual_cross_value: '2.0' });
  return {
    [PRE.frontRim]: { ...rim('560.0', '0.0'), _parent_product_id: 'gid://shopify/Product/801' },
    [PRE.rearRim]: { ...rim('552.0', '2.7'), _parent_product_id: 'gid://shopify/Product/802' },
    [PRE.frontHub]: { ...hub('37.2', '37.0', '22.1', '35.2', '1.5', '1.75'), _parent_product_id: 'gid://shopify/Product/803' },
    [PRE.rearHub]: { ...hub('37.3', '44.2', '33.6', '17.6', '1.4', '0.4'), _parent_product_id: 'gid://shopify/Product/804' },
    [PRE.spokes]: { spoke_cross_section_area_mm2: '1.767', spoke_type: 'Steel', spoke_hub_interface: 'Straight Pull', _parent_product_id: 'gid://shopify/Product/805' },
    [PRE.nipples]: { _parent_product_id: 'gid://shopify/Product/806' }
  };
}

// mock-shopify data with those metafields; the spoke product has Black variants in 1 mm steps (the mock builds "<color> / <length>mm" titles)
export function preconfiguredMock(metafields = preconfiguredMetafields()) {
  const base = loadMockShopify();
  return { ...base, metafields, variantColors: ['Black'], variantLengths: [250, 310] };
}
