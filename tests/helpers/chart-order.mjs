// Builds System orders for the I9 chart length tests (round 10): a wheel (set) with the rim variant, hub model and hole count of your choice, in the order shape
// the webhook receives (a "LoamLabs Custom Wheel Build" line with the hidden _build recipe, as in samples/system/*.json). Solid-color wheels (Studio not opened).
import { findSystemBuildRecipe } from '../../_lib/system-build.js';

const gid = (id) => `gid://shopify/ProductVariant/${id}`;

/**
 * @param {{ front?: Wheel, rear?: Wheel, orderNumber?: number }} o   Wheel = { rim: variantId (digits), holes: number, hub?: 'Hydra2'|'Solix' (default: Solix for 24 holes, else Hydra2), rimTitle?: string }
 */
export function chartOrder(o) {
  const positions = ['front', 'rear'].filter((p) => o[p]);
  const specs = { brakeStyle: '6-Bolt', frontWheelSize: '29"', rearWheelSize: '29"' };
  const components = {};
  let hubModel = null;
  for (const p of positions) {
    const w = o[p], model = w.hub || (w.holes === 24 ? 'Solix' : 'Hydra2');
    hubModel = hubModel || model;
    specs[p + 'SpokeCount'] = `${w.holes}h`;
    components[p + 'Rim'] = { variantId: gid(w.rim), title: w.rimTitle || 'Test rim', vendor: 'Industry Nine', variantTitle: `29" / ${w.holes}h`, selectedOptions: [] };
    components[p + 'Hub'] = { variantId: gid(9000 + (p === 'front' ? 1 : 2)), title: `Industry Nine ${model} SYSTEM ${p === 'front' ? 'Front' : 'Rear'} Hub`, variantTitle: `${w.holes}h / Black`, selectedOptions: [{ name: 'Color', value: 'Black' }] };
    components[p + 'Spokes'] = { title: 'Industry Nine SYSTEM Spokes', variantTitle: 'Black / -', selectedOptions: [{ name: 'Color', value: 'Black' }, { name: 'Length', value: '-' }], i9: true };
  }
  specs.systemHub = hubModel;
  const recipe = { step: 3, buildType: positions.length === 2 ? 'Wheel Set' : (positions[0] === 'front' ? 'Front' : 'Rear'), spokeInterface: 'system', system: { v: 1, studioOpened: false }, specs, components, buildId: `LL-${o.orderNumber || 91000}-CHART` };
  const n = o.orderNumber || 91000;
  return {
    id: 6000000000 + n, admin_graphql_api_id: `gid://shopify/Order/${6000000000 + n}`, order_number: n, name: `#${n}`,
    email: 'customer@example.com', customer: { first_name: 'Alex', last_name: 'Sample', email: 'customer@example.com' }, note: null, financial_status: 'paid',
    line_items: [{ id: 1, title: 'Custom Wheel Build', name: 'Custom Wheel Build', variant_title: null, quantity: 1, price: '0.00', properties: [{ name: '_is_custom_wheel_build', value: 'true' }, { name: '_build', value: JSON.stringify(recipe) }] }]
  };
}

export function recipeOf(order) { return findSystemBuildRecipe(order).recipe; }
