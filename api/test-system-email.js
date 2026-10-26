// File: /api/test-system-email.js
// I9-SYSTEM: staff-only test endpoint. Builds the System build report for a sample (or a posted _build / order payload) and emails it
// to BUILDER_EMAIL_ADDRESS (never to a customer), exactly as the webhook would. Protected like api/test-calculator.js (x-internal-secret).
//
//   POST /api/test-system-email          headers: x-internal-secret: <INTERNAL_API_SECRET>, content-type: application/json
//   body: { "sample": "solix-24h-wheelset-multicolor" }                         one of samples/system/*.json
//      or { "order": { ...full Shopify order payload with the _build line... } }
//      or { "build": { ...the _build recipe object (or its JSON string)... }, "orderNumber": 12345 }
//   options: "send": false (default true) returns the report without emailing; "useShopify": true fetches the hub/rim metafields
//            from the store (default false: sample geometry only); "imageWidth": 600;
//            "customer": true renders/sends the CUSTOMER version (greeting, component details, color tables, images; no lengths or
//            warnings) and sends it ONLY to BUILDER_EMAIL_ADDRESS, never to the order's or a sample's customer address, and it ignores
//            the SYSTEM_CUSTOMER_EMAIL flag (that flag only guards the real webhook). With customer:true the internal email is not sent.
//   response: { ok, subject, wheels, images: [{ filename, bytes }], imageErrors, warnings, note, emailId, inline, html? (when send is false) }

import { timingSafeEqual } from 'node:crypto';
import { findSystemBuildRecipe, isSystemBuildRecipe } from '../_lib/system-build.js';
import { buildSystemReport, sendSystemEmail, buildCustomerEmail } from '../_lib/system-report.js';
import { SYSTEM_SAMPLES } from '../samples/index.js';

// REVIEW: constant-time secret comparison (fails closed when the env var is missing or the header is absent / not a single string).
export function secretMatches(provided, expected) {
  if (typeof expected !== 'string' || !expected || typeof provided !== 'string') return false;
  const a = Buffer.from(provided, 'utf8'), b = Buffer.from(expected, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}
// REVIEW: the render width is staff input but it sizes a native bitmap (20000 px = 1.7 GB); keep it within what an email can use.
export const IMAGE_WIDTH_RANGE = [100, 2000];
export function clampImageWidth(v) {
  const n = Number(v);
  if (!isFinite(n)) return undefined;
  return Math.min(IMAGE_WIDTH_RANGE[1], Math.max(IMAGE_WIDTH_RANGE[0], Math.round(n)));
}

const allowCors = (fn) => async (req, res) => {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, x-internal-secret');
    if (req.method === 'OPTIONS') { res.status(204).end(); return; }
    return await fn(req, res);
};

// Metafields for the recipe's components through the Admin API (same query as api/index.js fetchComponentData), optional.
async function fetchComponentMetafields(recipe) {
    const ids = [...new Set(Object.values(recipe.components || {}).map((c) => c && c.variantId).filter(Boolean))];
    if (!ids.length) return null;
    const query = `query getComponentMetafields($ids: [ID!]!) { nodes(ids: $ids) { ... on ProductVariant { id metafields(first: 50) { nodes { key namespace value } } product { id metafields(first: 50) { nodes { key namespace value } } } } } }`;
    const response = await fetch(`https://${process.env.SHOPIFY_STORE_DOMAIN}/admin/api/2024-07/graphql.json`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': process.env.SHOPIFY_ADMIN_API_TOKEN },
        body: JSON.stringify({ query, variables: { ids } })
    });
    const result = await response.json();
    if (result.errors) throw new Error(JSON.stringify(result.errors));
    const map = new Map();
    result.data.nodes.forEach((node) => {
        if (!node) return;
        const merged = {};
        (node.product?.metafields?.nodes || []).forEach((mf) => { if (mf.namespace === 'custom') merged[mf.key] = mf.value; });
        (node.metafields?.nodes || []).forEach((mf) => { if (mf.namespace === 'custom') merged[mf.key] = mf.value; });
        if (node.product?.id) merged._parent_product_id = node.product.id;
        map.set(node.id, merged);
    });
    return map;
}

async function handler(req, res) {
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Method Not Allowed' }); }
    if (!secretMatches(req.headers['x-internal-secret'], process.env.INTERNAL_API_SECRET)) return res.status(401).json({ error: 'Unauthorized' });

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
        let orderData, recipe;
        if (body.sample) {
            orderData = Object.prototype.hasOwnProperty.call(SYSTEM_SAMPLES, body.sample) ? SYSTEM_SAMPLES[body.sample] : null;
            if (!orderData) return res.status(400).json({ error: `unknown sample "${body.sample}"`, samples: Object.keys(SYSTEM_SAMPLES) });
            orderData = JSON.parse(JSON.stringify(orderData));
            recipe = findSystemBuildRecipe(orderData)?.recipe;
        } else if (body.order) {
            orderData = body.order;
            recipe = findSystemBuildRecipe(orderData)?.recipe;
            if (!recipe) return res.status(400).json({ error: 'the order has no System build (_is_custom_wheel_build line with a System _build)' });
        } else if (body.build) {
            recipe = typeof body.build === 'string' ? JSON.parse(body.build) : body.build;
            if (!isSystemBuildRecipe(recipe)) return res.status(400).json({ error: 'the _build is not a System build (spokeInterface !== "system")' });
            orderData = { order_number: body.orderNumber || 'TEST', id: null, line_items: [], note: null };
        } else {
            return res.status(400).json({ error: 'post { sample } or { order } or { build }', samples: Object.keys(SYSTEM_SAMPLES) });
        }
        if (!recipe) return res.status(400).json({ error: 'no System build recipe found' });

        let componentData = null, shopifyError = null;
        if (body.useShopify) { try { componentData = await fetchComponentMetafields(recipe); } catch (e) { shopifyError = e.message; } }

        const report = await buildSystemReport({ recipe, orderData, componentData, imageWidth: body.imageWidth != null ? clampImageWidth(body.imageWidth) : undefined });
        const summary = {
            ok: true, subject: report.subject,
            wheels: report.wheels.map((w) => ({ position: w.position, hubModel: w.hubModel, hubColor: w.hubColor, spokeCountLabel: w.spokeCountLabel, isMultiColor: w.isMultiColor, counts: w.counts, geometrySource: w.config.source, feeLines: w.feeLines })),
            images: report.images.map((i) => ({ filename: i.filename, cid: i.cid, bytes: i.png.length, caption: i.caption })),
            imageErrors: report.imageErrors, warnings: report.warnings, lengths: report.lengths, note: report.note, shopifyError
        };

        // Customer version: test sends go to the builder address only, never to the sample's / order's customer address.
        if (body.customer === true) {
            const customer = buildCustomerEmail({ wheels: report.wheels, images: report.images, orderData });
            if (!customer) return res.status(200).json({ ...summary, customer: true, sent: false, reason: 'the build has no wheels (the webhook sends no customer email for this order)' });
            const testCustomer = { ...customer, subject: `[Customer version test] ${customer.subject}` };
            const customerSummary = { ...summary, customer: true, subject: testCustomer.subject, note: undefined, warnings: undefined, lengths: undefined };
            if (body.send === false) return res.status(200).json({ ...customerSummary, sent: false, html: testCustomer.html });
            const to = process.env.BUILDER_EMAIL_ADDRESS;
            if (!to) return res.status(500).json({ ok: false, error: 'BUILDER_EMAIL_ADDRESS is not set' });
            const sent = await sendSystemEmail({ report: testCustomer, to, from: 'LoamLabs <info@loamlabsusa.com>', replyTo: 'info@loamlabsusa.com' });
            return res.status(200).json({ ...customerSummary, sent: true, emailId: sent.id, inline: sent.inline, sendError: sent.error || null, to });
        }

        if (body.send === false) return res.status(200).json({ ...summary, sent: false, html: report.html });
        const sent = await sendSystemEmail({ report, orderData });
        return res.status(200).json({ ...summary, sent: true, emailId: sent.id, inline: sent.inline, sendError: sent.error || null, to: process.env.BUILDER_EMAIL_ADDRESS });
    } catch (error) {
        console.error('test-system-email failed:', error);
        return res.status(500).json({ ok: false, error: error.message });
    }
}

export default allowCors(handler);
