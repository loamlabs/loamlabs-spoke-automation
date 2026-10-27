// READ-ONLY look at the store catalog (GraphQL queries only, no mutations, nothing is written anywhere in Shopify).
// Credentials come from the project's own .env.preview (the same SHOPIFY_STORE_DOMAIN / SHOPIFY_ADMIN_API_TOKEN the webhook uses); they are never printed.
//   node scripts/shopify-readonly-catalog.mjs types            -> product types and counts
//   node scripts/shopify-readonly-catalog.mjs hubs|rims|spokes -> the Standard hubs / rims / spoke products with their metafields (JSON on stdout)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = {};
for (const l of fs.readFileSync(path.join(root, '.env.preview'), 'utf8').split(/\r?\n/)) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) env[m[1]] = m[2].replace(/^"|"$/g, ''); }
const url = `https://${env.SHOPIFY_STORE_DOMAIN}/admin/api/2024-07/graphql.json`;
async function gql(query, variables = {}) {
  for (let i = 0; i < 4; i++) {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': env.SHOPIFY_ADMIN_API_TOKEN }, body: JSON.stringify({ query, variables }) });
    const json = await res.json().catch(() => ({}));
    if (res.status === 401 || res.status === 403) throw new Error(`Shopify says ${res.status}: ${JSON.stringify(json.errors || json).slice(0, 300)}`);
    if (json.errors && json.errors.some((e) => /Throttled/i.test(e.message || ''))) { await new Promise((r) => setTimeout(r, 1500 * (i + 1))); continue; }
    if (json.errors) throw new Error(JSON.stringify(json.errors).slice(0, 500));
    return json.data;
  }
  throw new Error('throttled');
}
async function allProducts(fields, search) {
  const out = []; let after = null;
  for (;;) {
    const d = await gql(`query($after:String,$q:String){ products(first:50, after:$after, query:$q){ pageInfo{hasNextPage endCursor} nodes{ ${fields} } } }`, { after, q: search || null });
    out.push(...d.products.nodes);
    if (!d.products.pageInfo.hasNextPage) break;
    after = d.products.pageInfo.endCursor;
  }
  return out;
}
const mode = process.argv[2] || 'types';
if (mode === 'types') {
  const ps = await allProducts('id title vendor productType status tags');
  const by = {};
  for (const p of ps) { const k = `${p.productType || '(none)'} | ${p.status}`; by[k] = (by[k] || 0) + 1; }
  console.log(JSON.stringify({ total: ps.length, byType: by }, null, 1));
} else {
  const type = { hubs: 'Hub', rims: 'Rim', spokes: 'Spoke' }[mode];
  const search = process.argv[3] || `product_type:${type}*`;
  const ps = await allProducts(`id title vendor productType status tags metafields(first:60){ nodes{ namespace key value } } variants(first:100){ nodes{ id title selectedOptions{name value} metafields(first:60){ nodes{ namespace key value } } } }`, search);
  console.log(JSON.stringify(ps.map((p) => ({ id: p.id, title: p.title, vendor: p.vendor, productType: p.productType, status: p.status, tags: p.tags,
    productMeta: Object.fromEntries(p.metafields.nodes.filter((m) => m.namespace === 'custom').map((m) => [m.key, m.value])),
    variants: p.variants.nodes.map((v) => ({ id: v.id, title: v.title, options: Object.fromEntries(v.selectedOptions.map((o) => [o.name, o.value])), meta: Object.fromEntries(v.metafields.nodes.filter((m) => m.namespace === 'custom').map((m) => [m.key, m.value])) })) })), null, 1));
}
