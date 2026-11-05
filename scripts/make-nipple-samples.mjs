// NIPPLE-REPORT: writes the five nipple sample orders in samples/standard/ (webhook shape, each with its own mock metafields in _sample.metafields).
//   node scripts/make-nipple-samples.mjs
// Real carts first: three samples are the REAL cart lines of Agent B's Release 15 runs (agent-prompts/data/release15/crn_*.json, mainCart: the real _build, the real readable order
// lines, the real "Custom Nipple Color Configuration" fee line), turned into the order shape the webhook reads:
//   std-nip-master2-front4-silver        crn_b2_nip_equiv  master 2 (Reserve 30|DH + Onyx Vesper), 4 front nipples Silver (mixed), the $15 fee on the front
//   std-nip-berd5-aluminum-matched       crn_b5_berd_equiv master 5 (DT XRC 310 + Berd Talon + PolyLightX), Aluminum nipples, 2 front spokes Blue Berd and the 2 matching nipples Blue (both fees)
//   std-nip-one-color-no-fee             crn_b2_solid      front nipples all Silver, rear all Black: one color per wheel, no nipple keys, no fee
// Two are DERIVED from the real master 2 cart crn_b2_both (front painted + front mixed nipples, both fees), because no real cart exists for them:
//   std-nip-both-wheels-painted-both-fees  the same build with the REAR wheel painted and mixed too (a second spoke fee and a second nipple fee, Wheel = Rear)
//   std-nip-none-painted                   the same build with the nipple painting and the nipple fee removed (spokes still painted): "a build with no nipples painted"
// The component metafields (rim ERD, hub flange numbers) are read from the store, READ-ONLY (GraphQL query only; credentials from .env.preview, never printed).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REL15 = path.resolve(root, '..', 'loamlabs-system-builder', 'agent-prompts', 'data', 'release15');
const OUT = path.join(root, 'samples', 'standard');
const env = {};
for (const l of fs.readFileSync(path.join(root, '.env.preview'), 'utf8').split(/\r?\n/)) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) env[m[1]] = m[2].replace(/^"|"$/g, ''); }

async function gql(query, variables) {
  for (let i = 0; i < 4; i++) {
    const res = await fetch(`https://${env.SHOPIFY_STORE_DOMAIN}/admin/api/2024-07/graphql.json`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': env.SHOPIFY_ADMIN_API_TOKEN }, body: JSON.stringify({ query, variables }) });
    const json = await res.json().catch(() => ({}));
    if (json.errors && json.errors.some((e) => /Throttled/i.test(e.message || ''))) { await new Promise((r) => setTimeout(r, 1500 * (i + 1))); continue; }
    if (json.errors) throw new Error(JSON.stringify(json.errors).slice(0, 400));
    return json.data;
  }
  throw new Error('throttled');
}
// the same merge fetchComponentData does: product custom.* then variant custom.*, plus _parent_product_id
async function metafieldsFor(build) {
  const ids = [...new Set(Object.values(build.components).map((c) => c && c.variantId).filter(Boolean))];
  const d = await gql(`query($ids:[ID!]!){nodes(ids:$ids){... on ProductVariant{id metafields(first:50){nodes{key namespace value}} product{id metafields(first:50){nodes{key namespace value}}}}}}`, { ids });
  const out = {};
  for (const n of d.nodes) {
    if (!n) continue;
    const m = {};
    for (const f of n.product.metafields.nodes) if (f.namespace === 'custom') m[f.key] = f.value;
    for (const f of n.metafields.nodes) if (f.namespace === 'custom') m[f.key] = f.value;
    m._parent_product_id = n.product.id;
    out[n.id] = m;
  }
  return out;
}

const cartOf = (file) => JSON.parse(fs.readFileSync(path.join(REL15, file + '.json'), 'utf8')).mainCart;
const buildOf = (cart) => { const bl = cart.items.find((i) => i.props && i.props._is_custom_wheel_build === 'true'); return typeof bl.props._build === 'string' ? JSON.parse(bl.props._build) : JSON.parse(JSON.stringify(bl.props._build)); };

// a compact Release 15 cart ({ title: "Title | Variant", qty, price, variant_id, props }) -> the order a Shopify webhook delivers
function orderFrom(cart, build, { orderNumber, name, description, metafields, extraLines = [], dropLines = () => false, readable }) {
  const items = [...cart.items.filter((i) => !dropLines(i)), ...extraLines];
  const line_items = items.map((it, idx) => {
    const cut = it.title.indexOf(' | '), title = cut >= 0 ? it.title.slice(0, cut) : it.title, vt = cut >= 0 ? it.title.slice(cut + 3) : null;
    let props = Object.entries(it.props || {});
    if (it.props && it.props._is_custom_wheel_build === 'true') {
      props = props.filter(([n]) => n !== '_build' && (!readable || !/^(Front|Rear) /.test(n))).map(([n, v]) => [n, v]);
      props.push(['_build', JSON.stringify(build)]);
      if (readable) for (const [n, v] of Object.entries(readable)) props.push([n, v]);
    }
    return {
      id: 15000 + idx, title, name: vt && vt !== 'null' ? `${title} - ${vt}` : title, variant_title: vt && vt !== 'null' ? vt : null, quantity: it.qty, price: String(it.price), sku: null,
      product_id: null, variant_id: it.variant_id, properties: props.map(([n, v]) => ({ name: n, value: typeof v === 'object' ? JSON.stringify(v) : String(v) }))
    };
  });
  const ph = line_items.findIndex((li) => li.properties.some((p) => p.name === '_is_custom_wheel_build'));
  if (ph > 0) line_items.unshift(line_items.splice(ph, 1)[0]); // the build placeholder comes first in a real order
  return {
    id: 6000000000 + orderNumber, admin_graphql_api_id: `gid://shopify/Order/${6000000000 + orderNumber}`, order_number: orderNumber, name: `#${orderNumber}`,
    email: 'customer@example.com', customer: { first_name: 'Alex', last_name: 'Sample', email: 'customer@example.com' }, note: null, location_id: null, financial_status: 'paid', line_items,
    _sample: { name, description, metafields }
  };
}
const readableOf = (cart) => { const bl = cart.items.find((i) => i.props && i.props._is_custom_wheel_build === 'true'); return Object.fromEntries(Object.entries(bl.props).filter(([n]) => /^(Front|Rear) /.test(n))); };
const TIMES = '×';
const countText = (arr) => { const m = new Map(); arr.forEach((c) => m.set(c, (m.get(c) || 0) + 1)); return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c} ${TIMES}${n}`).join(', '); };
const sideText = (arr) => arr.map((c, i) => `${i + 1} ${c}`).join(', ');
const write = (name, order) => { fs.writeFileSync(path.join(OUT, name + '.json'), JSON.stringify(order, null, 2) + '\n'); console.log('wrote', name, '-', order.line_items.length, 'lines'); };

// 1) master 2, 4 front nipples Silver: the real cart as is
{
  const cart = cartOf('crn_b2_nip_equiv'), build = buildOf(cart);
  write('std-nip-master2-front4-silver', orderFrom(cart, build, {
    orderNumber: 91101, name: 'std-nip-master2-front4-silver', metafields: await metafieldsFor(build),
    description: 'REAL Release 15 cart: master 2 (Reserve 30|DH + Onyx Vesper, Brass nipples) customized with 4 front nipples Silver (mixed nipples): front Nipple Color fee $15, spokes unpainted',
    readable: readableOf(cart)
  }));
}
// 2) Berd master 5 with Aluminum nipples, the nipples matched to the spokes: the real cart as is
{
  const cart = cartOf('crn_b5_berd_equiv'), build = buildOf(cart);
  write('std-nip-berd5-aluminum-matched', orderFrom(cart, build, {
    orderNumber: 91103, name: 'std-nip-berd5-aluminum-matched', metafields: await metafieldsFor(build),
    description: 'REAL Release 15 cart: master 5 (DT XRC 310 + Berd Talon + PolyLightX) with Aluminum nipples; 2 front spokes Blue Berd and the 2 matching nipples Blue (Berd painted color fee + nipple fee on the front)',
    readable: readableOf(cart)
  }));
}
// 3) one color on every nipple of a wheel: the real cart as is (front nipples all Silver, rear all Black; no nipple keys, no nipple fee)
{
  const cart = cartOf('crn_b2_solid'), build = buildOf(cart);
  write('std-nip-one-color-no-fee', orderFrom(cart, build, {
    orderNumber: 91104, name: 'std-nip-one-color-no-fee', metafields: await metafieldsFor(build),
    description: 'REAL Release 15 cart: master 2 customized so every front nipple is Silver and every rear nipple Black (one color per wheel): no nipple keys in the build, no fee line',
    readable: readableOf(cart)
  }));
}
// 4) both wheels painted and mixed (both fees on both wheels), derived from the real master 2 "both" cart
const bothCart = cartOf('crn_b2_both'), bothBuild = buildOf(bothCart);
{
  const build = JSON.parse(JSON.stringify(bothBuild)), st = build.standardStudio.studio;
  const mk = (pick) => Array.from({ length: 16 }, (_, i) => (pick(i) ? 'Silver' : 'Black'));
  const rear = { spokes: { drive: mk((i) => i % 4 === 0), rotor: mk((i) => i % 4 === 2) }, nipples: { drive: mk((i) => i % 4 === 1), rotor: mk((i) => i % 4 === 3) } };
  st.hubColor.rear = 'Black (Anodized)'; st.base.rear = { drive: 'Black', rotor: 'Black' }; st.spokes.rear = rear.spokes; st.nbase.rear = { drive: 'Black', rotor: 'Black' }; st.nipples.rear = rear.nipples;
  const readable = readableOf(bothCart);
  const rs = [...rear.spokes.drive, ...rear.spokes.rotor], rn = [...rear.nipples.drive, ...rear.nipples.rotor];
  Object.assign(readable, {
    'Rear Spoke Colors': countText(rs), 'Rear Drive Side': sideText(rear.spokes.drive), 'Rear Rotor Side': sideText(rear.spokes.rotor),
    'Rear Nipple Colors': countText(rn), 'Rear Nipples Drive Side': sideText(rear.nipples.drive), 'Rear Nipples Rotor Side': sideText(rear.nipples.rotor)
  });
  const feeLine = (re) => bothCart.items.find((i) => re.test(i.title));
  const rearFee = (it) => ({ ...it, props: { ...it.props, Wheel: 'Rear' } });
  write('std-nip-both-wheels-painted-both-fees', orderFrom(bothCart, build, {
    orderNumber: 91102, name: 'std-nip-both-wheels-painted-both-fees', metafields: await metafieldsFor(build), readable,
    extraLines: [rearFee(feeLine(/Custom Spoke Color Configuration/)), rearFee(feeLine(/Custom Nipple Color Configuration/))],
    description: 'DERIVED from the real master 2 cart (front painted + mixed nipples, both fees): the rear wheel is painted and has mixed nipples too, with its own spoke fee and nipple fee (Wheel = Rear). 4 fee lines in all'
  }));
}
// 5) painted spokes but no nipple painting (derived: the same real cart without the nipple keys and the nipple fee line)
{
  const build = JSON.parse(JSON.stringify(bothBuild)), st = build.standardStudio.studio;
  delete st.nipples; delete st.nbase; delete st.naccent;
  const readable = Object.fromEntries(Object.entries(readableOf(bothCart)).filter(([n]) => !/Nipple/.test(n)));
  write('std-nip-none-painted', orderFrom(bothCart, build, {
    orderNumber: 91105, name: 'std-nip-none-painted', metafields: await metafieldsFor(build), readable,
    dropLines: (i) => /Custom Nipple Color Configuration/.test(i.title),
    description: 'DERIVED from the real master 2 cart: front spokes painted (spoke fee Mixed colors) but no nipple painting and no nipple fee line, the nipples are the cart line (Brass Black)'
  }));
}
