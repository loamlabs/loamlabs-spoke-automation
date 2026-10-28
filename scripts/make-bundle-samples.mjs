// Writes the two System bundle-format sample orders (round 8 of the theme: one "Industry Nine SYSTEM Spokes" line per wheel, quantity 1) from the carts captured
// from the theme (tests/fixtures/system-bundle-sample-cart.json), in the shape of the Shopify order webhook:
//   samples/system/hydra2-bundle-front-custom-rear-solid.json     Hydra2 28h / 32h set, front Red x22 + Orange x6, rear solid Gold
//   samples/system/solix-bundle-24h-both-solid-black.json         Solix 24h set, both wheels solid Black (same variant, still two lines)
//   node scripts/make-bundle-samples.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUNDLE_CARTS, cartToOrder } from '../tests/helpers/cart-to-order.mjs';

const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'samples', 'system');
const make = (file, key, orderNumber, description) => {
  const order = cartToOrder(BUNDLE_CARTS[key], { orderNumber, description });
  fs.writeFileSync(path.join(out, file + '.json'), JSON.stringify(order, null, 2) + '\n');
  console.log('wrote', file);
};
make('hydra2-bundle-front-custom-rear-solid', 'custom_front_solid_rear_hydra2_set', 90021, 'Hydra2 wheel set, spokes as one bundle line per wheel (quantity 1): front 28h custom Red x22 + Orange x6, rear 32h solid Gold');
make('solix-bundle-24h-both-solid-black', 'solid_solix_24h_set_same_color_both_wheels', 90022, 'Solix 24h wheel set, spokes as one bundle line per wheel (quantity 1): both wheels solid Black (same variant on both lines)');
