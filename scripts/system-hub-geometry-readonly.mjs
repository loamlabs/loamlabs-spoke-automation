// READ-ONLY (GraphQL queries only, nothing is written in Shopify). Lists the Industry Nine SYSTEM hub variants with the metafields the length work needs
// (flange diameters and offsets per side, spoke hole diameter) so the chart side mapping (round 10) can be checked against real hub geometry.
// Credentials come from .env.preview (never printed).   node scripts/system-hub-geometry-readonly.mjs > out/system-hub-geometry.json
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = {};
for (const l of fs.readFileSync(path.join(root, '.env.preview'), 'utf8').split(/\r?\n/)) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) env[m[1]] = m[2].replace(/^"|"$/g, ''); }
const url = `https://${env.SHOPIFY_STORE_DOMAIN}/admin/api/2024-07/graphql.json`;
const KEYS = ['hub_flange_diameter_left', 'hub_flange_diameter_right', 'hub_flange_offset_left', 'hub_flange_offset_right', 'hub_spoke_hole_diameter', 'hub_type', 'front_or_rear'];
async function gql(query, variables = {}) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': env.SHOPIFY_ADMIN_API_TOKEN }, body: JSON.stringify({ query, variables }) });
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors).slice(0, 400));
  return json.data;
}
const out = []; let after = null;
for (;;) {
  const d = await gql(`query($after:String){ products(first:25, after:$after, query:"title:*SYSTEM* AND title:*Hub*"){ pageInfo{hasNextPage endCursor} nodes{ id title metafields(first:50, namespace:"custom"){ nodes{ key value } } variants(first:100){ nodes{ id title metafields(first:50, namespace:"custom"){ nodes{ key value } } } } } } }`, { after });
  for (const p of d.products.nodes) {
    const pm = Object.fromEntries(p.metafields.nodes.filter((m) => KEYS.includes(m.key)).map((m) => [m.key, m.value]));
    for (const v of p.variants.nodes) {
      const vm = Object.fromEntries(v.metafields.nodes.filter((m) => KEYS.includes(m.key)).map((m) => [m.key, m.value]));
      out.push({ product: p.title, variant: v.title, variantId: v.id.split('/').pop(), ...pm, ...vm });
    }
  }
  if (!d.products.pageInfo.hasNextPage) break;
  after = d.products.pageInfo.endCursor;
}
console.log(JSON.stringify(out, null, 1));
