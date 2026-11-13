// An in-memory stand-in for the three Supabase endpoints the order sheet store uses (database RPC + table reads through PostgREST, and the private Storage bucket), for tests.
// It behaves like the SQL in sql/order_sheets.sql: one row per (shop, order_number), created_at kept on overwrite, expiry dates 12 / 24 months after the save.
export const MONTH_MS = 30 * 24 * 3600 * 1000;

export function createFakeSupabase({ now = () => new Date('2026-11-13T09:00:00.000Z'), fail = {}, hangOn = [] } = {}) {
  const rows = new Map();      // `${shop}|${order}` -> row
  const objects = new Map();   // decoded path -> Buffer
  const calls = [];
  const json = (data, status = 200) => ({ ok: status < 400, status, json: async () => data, arrayBuffer: async () => new ArrayBuffer(0) });
  const iso = (d) => new Date(d).toISOString();
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(String(url)), method = (init.method || 'GET').toUpperCase(), p = decodeURIComponent(u.pathname);
    calls.push({ method, path: p, search: u.search, body: init.body, headers: init.headers });
    const key = `${method} ${p.replace(/\/order-sheet-images\/.*/, '/order-sheet-images/*')}`;
    if (hangOn.some((h) => key.includes(h) || p.includes(h))) return new Promise((_, rej) => { const keep = setInterval(() => {}, 20); init.signal && init.signal.addEventListener('abort', () => { clearInterval(keep); rej(init.signal.reason || new Error('aborted')); }); });
    const hit = Object.entries(fail).find(([k]) => key.includes(k) || p.includes(k));
    if (hit) { if (hit[1] === 'network') throw new Error('network down'); return json({ message: 'simulated failure' }, hit[1]); }
    if (method === 'POST' && p === '/rest/v1/rpc/save_order_sheet') {
      const b = JSON.parse(init.body), k = `${b.p_shop}|${b.p_order_number}`, prev = rows.get(k), t = now();
      rows.set(k, { shop: b.p_shop, order_number: b.p_order_number, kind: b.p_kind, numbering_version: b.p_numbering_version, sheet: b.p_sheet, images: b.p_images || [],
        created_at: prev ? prev.created_at : iso(t), updated_at: iso(t), images_expire_at: iso(+t + 12 * MONTH_MS), expires_at: iso(+t + 24 * MONTH_MS) });
      return json(null, 204);
    }
    if (method === 'POST' && p.startsWith('/storage/v1/object/order-sheet-images/')) {
      const path = p.replace('/storage/v1/object/order-sheet-images/', '');
      if (objects.has(path) && String((init.headers || {})['x-upsert']) !== 'true') return json({ message: 'exists' }, 409);
      objects.set(path, Buffer.from(init.body));
      return json({ Key: path });
    }
    if (method === 'GET' && p.startsWith('/storage/v1/object/authenticated/order-sheet-images/')) {
      const b = objects.get(p.replace('/storage/v1/object/authenticated/order-sheet-images/', ''));
      if (!b) return json({ message: 'not found' }, 404);
      return { ok: true, status: 200, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) };
    }
    if (method === 'DELETE' && p === '/storage/v1/object/order-sheet-images') { for (const x of JSON.parse(init.body).prefixes) objects.delete(x); return json([]); }
    if (p === '/rest/v1/order_sheets') {
      const q = u.searchParams, eq = (n) => { const v = q.get(n); return v && v.startsWith('eq.') ? v.slice(3) : null; };
      let list = [...rows.values()].filter((r) => (eq('shop') == null || r.shop === eq('shop')) && (eq('order_number') == null || r.order_number === eq('order_number')));
      for (const col of ['expires_at', 'images_expire_at']) { const v = q.get(col); if (v && v.startsWith('gt.')) list = list.filter((r) => r[col] > v.slice(3)); if (v && v.startsWith('lt.')) list = list.filter((r) => r[col] < v.slice(3)); }
      if (method === 'GET') return json(list.map((r) => ({ ...r })));
      if (method === 'PATCH') { const patch = JSON.parse(init.body); list.forEach((r) => Object.assign(r, patch)); return json(null, 204); }
      if (method === 'DELETE') { list.forEach((r) => rows.delete(`${r.shop}|${r.order_number}`)); return json(null, 204); }
    }
    return json({ message: `fake supabase: unexpected ${method} ${p}` }, 404);
  };
  return { fetchImpl, rows, objects, calls, isSupabase: (url) => /\/(rest|storage)\/v1\//.test(String(url)) };
}
export const SB_ENV = { SUPABASE_URL: 'https://fake-project.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service-key-for-tests', SHOPIFY_STORE_DOMAIN: 'test-store.myshopify.com' };
