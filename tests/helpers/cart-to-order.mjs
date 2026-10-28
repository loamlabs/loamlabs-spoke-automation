// Turns a cart captured from the theme (cart.js 'items': properties are an object, price in cents, _build shown as an object) into the Shopify order webhook shape
// the backend reads (line_items with title / variant_title / quantity / price string / properties as [{ name, value }], _build as a JSON string).
// Also: bundleToPerColor(order) rewrites the one-line-per-wheel spoke bundle lines of such an order into the OLD format (one line per color, quantity = spokes, no
// _spoke_bundle / Spoke Colors), for comparing the two formats on the same build.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const BUNDLE_CARTS = JSON.parse(fs.readFileSync(path.join(here, '..', 'fixtures', 'system-bundle-sample-cart.json'), 'utf8')).samples;

export function cartToOrder(cart, { orderNumber, description }) {
  const clone = JSON.parse(JSON.stringify(cart));
  const line_items = clone.items.map((it, i) => ({
    id: 15000 + i, title: it.product_title || it.title, name: it.title, variant_title: it.variant_title === 'null' ? null : (it.variant_title ?? null), quantity: it.quantity,
    price: (Number(it.price) / 100).toFixed(2), sku: it.sku ?? null, product_id: it.product_id, variant_id: it.variant_id,
    properties: Object.entries(it.properties || {}).map(([name, value]) => ({ name, value: name === '_build' && typeof value === 'object' ? JSON.stringify(value) : value }))
  }));
  // the build placeholder comes first in a real order
  const ph = line_items.findIndex((li) => li.properties.some((p) => p.name === '_is_custom_wheel_build'));
  if (ph > 0) line_items.unshift(line_items.splice(ph, 1)[0]);
  return {
    id: 6000000000 + orderNumber, admin_graphql_api_id: `gid://shopify/Order/${6000000000 + orderNumber}`, order_number: orderNumber, name: `#${orderNumber}`,
    email: 'customer@example.com', customer: { first_name: 'Alex', last_name: 'Sample', email: 'customer@example.com' }, note: null, location_id: null, financial_status: 'paid', line_items,
    _sample: { name: description, description }
  };
}

// "Red ×22, Orange ×6" (or "Black" for a solid wheel with `total` spokes) -> [[color, n]]
function pairsOf(text, total) {
  return String(text).split(',').map((t) => t.trim()).filter(Boolean).map((t) => {
    const m = /^(.*\S)\s+[×x]\s*(\d+)$/i.exec(t);
    return m ? [m[1], Number(m[2])] : [t, total];
  });
}

export function bundleToPerColor(order, totals) {
  const out = JSON.parse(JSON.stringify(order));
  const lines = [];
  for (const li of out.line_items) {
    const prop = (n) => (li.properties.find((p) => p.name === n) || {}).value;
    if (prop('_spoke_bundle') !== '1') { lines.push(li); continue; }
    const wheel = String(prop('Wheel')).toLowerCase();
    for (const [color, n] of pairsOf(prop('Spoke Colors'), totals[wheel])) {
      lines.push({ ...li, variant_title: `${color} / -`, name: `${li.title} - ${color} / -`, quantity: n, price: '9.50', properties: li.properties.filter((p) => p.name !== '_spoke_bundle' && p.name !== 'Spoke Colors') });
    }
  }
  out.line_items = lines;
  return out;
}
