import { createHmac } from 'crypto';

// --- Vercel Config ---
export const config = { api: { bodyParser: false } };

// --- Helper & Logic Functions (Each defined only ONCE) ---

async function getRawBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

async function shopifyAdminApiQuery(query, variables) {
    const storeDomain = process.env.SHOPIFY_STORE_DOMAIN;
    const apiToken = process.env.SHOPIFY_ADMIN_API_TOKEN;
    const url = `https://${storeDomain}/admin/api/2024-04/graphql.json`;
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': apiToken },
        body: JSON.stringify({ query, variables }),
    });
    const result = await response.json();
    if (result.errors) throw new Error(`Shopify API Error: ${JSON.stringify(result.errors)}`);
    return result.data;
}

async function fetchComponentData(buildRecipe) {
  const ids = new Set();
  Object.values(buildRecipe.components).forEach(comp => {
    if (comp && comp.variantId && comp.productId) {
      ids.add(comp.variantId);
      ids.add(comp.productId);
    }
  });

  if (ids.size === 0) { return null; }
  
  const query = `
    query getComponentMetafields($ids: [ID!]!) {
      nodes(ids: $ids) {
        id
        ... on ProductVariant { metafields(first: 50) { nodes { key namespace value } } }
        ... on Product { metafields(first: 50) { nodes { key namespace value } } }
      }
    }
  `;
  try {
    const data = await shopifyAdminApiQuery(query, { ids: Array.from(ids) });
    const componentDataMap = new Map();
    data.nodes.forEach(node => {
        if (node) {
            const metafields = {};
            node.metafields.nodes.forEach(mf => { if (mf.namespace === 'custom') { metafields[mf.key] = mf.value; } });
            componentDataMap.set(node.id, metafields);
        }
    });
    return componentDataMap;
  } catch (error) {
    console.error('Error fetching component data from Shopify:', error);
    return null;
  }
}

function calculateElongation(spokeLength, tensionKgf, crossSectionalArea) {
    if (!crossSectionalArea || crossSectionalArea === 0) return 0; // Prevent division by zero
    const YOUNG_MODULUS_STEEL_GPA = 210;
    const tensionN = tensionKgf * 9.80665;
    const modulusPa = YOUNG_MODULUS_STEEL_GPA * 1e9;
    const elongationMeters = (tensionN * (spokeLength / 1000)) / (modulusPa * (crossSectionalArea / 1e6));
    return elongationMeters * 1000;
}

function calculateSpokeLength(params) {
    const { isLeft, hubType, baseCrossPattern, spokeCount, finalErd, hubFlangeDiameter, flangeOffset, rimSpokeHoleOffset, spOffset, hubSpokeHoleDiameter } = params;
    const hubRadius = hubFlangeDiameter / 2;
    const rimRadius = finalErd / 2;
    let effectiveCrossPattern = baseCrossPattern;
    if (hubType === 'Straight Pull' && baseCrossPattern > 0) {
        effectiveCrossPattern += 0.5;
    }
    const angle = (2 * Math.PI * effectiveCrossPattern) / (spokeCount / 2);
    const finalZOffset = flangeOffset + (isLeft ? -rimSpokeHoleOffset : rimSpokeHoleOffset);
    const term1 = Math.pow(finalZOffset, 2);
    const term2 = Math.pow(hubRadius, 2);
    const term3 = Math.pow(rimRadius, 2);
    const term4 = 2 * hubRadius * rimRadius * Math.cos(angle);
    const geometricLength = Math.sqrt(term1 + term2 + term3 - term4);
    let finalLength;
    if (hubType === 'Classic Flange') {
        if (isNaN(hubSpokeHoleDiameter)) { throw new Error("Missing Hub Spoke Hole Diameter for Classic hub."); }
        finalLength = geometricLength - (hubSpokeHoleDiameter / 2);
    } else {
        finalLength = geometricLength + spOffset;
    }
    return finalLength;
}

function runCalculationEngine(buildRecipe, componentData) {
    const results = { front: null, rear: null, errors: [] };
    const getMeta = (variantId, productId, key, isNumber = false, defaultValue = 0) => {
        const variantMeta = componentData.get(variantId) || {};
        const productMeta = componentData.get(productId) || {};
        const value = variantMeta[key] ?? productMeta[key];
        if (value === undefined || value === null || value === '') {
            return isNumber ? defaultValue : null;
        }
        return isNumber ? parseFloat(value) : value;
    };
    const calculateForPosition = (position) => {
        const rim = buildRecipe.components[`${position}Rim`];
        const hub = buildRecipe.components[`${position}Hub`];
        const spokes = buildRecipe.components[`${position}Spokes`];
        const spokeCount = parseInt(buildRecipe.specs[`${position}SpokeCount`]?.replace('h', ''), 10);
        if (!rim || !hub || !spokes || !spokeCount) { return { error: `Skipping ${position} wheel: Missing component.` }; }
        const hubType = getMeta(hub.variantId, hub.productId, 'hub_type');
        if (hubType === 'Hook Flange' || getMeta(spokes.variantId, spokes.productId, 'spoke_type') === 'BERD') { return { error: `Unsupported type (${hubType || 'BERD'}).` }; }
        let finalErd = getMeta(rim.variantId, rim.productId, 'rim_erd', true);
        if (getMeta(rim.variantId, rim.productId, 'rim_washer_policy') !== 'Not Compatible') {
            finalErd += (2 * getMeta(rim.variantId, rim.productId, 'rim_nipple_washer_thickness_mm', true));
        }
        let baseCrossPattern;
        const hubLacingPolicy = getMeta(hub.variantId, hub.productId, 'hub_lacing_policy');
        const hubManualCrossValue = getMeta(hub.variantId, hub.productId, 'hub_manual_cross_value', true);
        if (hubLacingPolicy === 'Use Manual Override Field' && hubManualCrossValue > 0) { baseCrossPattern = hubManualCrossValue; } else { baseCrossPattern = (spokeCount >= 32) ? 3 : 2; }
        const paramsLeft = { isLeft: true, hubType, baseCrossPattern, spokeCount, finalErd, hubFlangeDiameter: getMeta(hub.variantId, hub.productId, 'hub_flange_diameter_left', true), flangeOffset: getMeta(hub.variantId, hub.productId, 'hub_flange_offset_left', true), rimSpokeHoleOffset: getMeta(rim.variantId, rim.productId, 'rim_spoke_hole_offset', true), spOffset: getMeta(hub.variantId, hub.productId, 'hub_sp_offset_spoke_hole_left', true), hubSpokeHoleDiameter: getMeta(hub.variantId, hub.productId, 'hub_spoke_hole_diameter', true) };
        const paramsRight = { isLeft: false, hubType, baseCrossPattern, spokeCount, finalErd, hubFlangeDiameter: getMeta(hub.variantId, hub.productId, 'hub_flange_diameter_right', true), flangeOffset: getMeta(hub.variantId, hub.productId, 'hub_flange_offset_right', true), rimSpokeHoleOffset: getMeta(rim.variantId, rim.productId, 'rim_spoke_hole_offset', true), spOffset: getMeta(hub.variantId, hub.productId, 'hub_sp_offset_spoke_hole_right', true), hubSpokeHoleDiameter: getMeta(hub.variantId, hub.productId, 'hub_spoke_hole_diameter', true) };
        const lengthL = calculateSpokeLength(paramsLeft);
        const lengthR = calculateSpokeLength(paramsRight);
        const tensionKgf = getMeta(rim.variantId, rim.productId, 'rim_target_tension_kgf', true, 120);
        const crossArea = getMeta(spokes.variantId, spokes.productId, 'spoke_cross_sectional_area_mm2', true) || getMeta(spokes.variantId, spokes.productId, 'spoke_cross_section_area_mm2', true);
        return { left: { geo: lengthL.toFixed(2), stretch: calculateElongation(lengthL, tensionKgf, crossArea).toFixed(2) }, right: { geo: lengthR.toFixed(2), stretch: calculateElongation(lengthR, tensionKgf, crossArea).toFixed(2) }, };
    };
    try {
        results.front = calculateForPosition('front');
        if (buildRecipe.buildType === 'Wheel Set') {
            results.rear = calculateForPosition('rear');
        }
    } catch (e) { results.errors.push(e.message); }
    return results;
}

function formatNote(results) {
    let note = "AUTOMATED SPOKE CALCULATION COMPLETE\n---------------------------------------\n";
    const formatSide = (wheel, position) => {
        if (!wheel) return `\n${position.toUpperCase()} WHEEL: Not part of build.`;
        if (wheel.error) return `\n${position.toUpperCase()} WHEEL: CALC FAILED - ${wheel.error}`;
        return `\n${position.toUpperCase()} WHEEL:\n` + `  Left (Geo):  ${wheel.left.geo} mm (Stretch: ${wheel.left.stretch} mm)\n` + `  Right (Geo): ${wheel.right.geo} mm (Stretch: ${wheel.right.stretch} mm)`;
    };
    note += formatSide(results.front, 'Front');
    note += formatSide(results.rear, 'Rear');
    if (results.errors && results.errors.length > 0) { note += `\n\nWARNINGS:\n- ${results.errors.join('\n- ')}`; }
    return note;
}

async function addNoteToOrder(orderGid, note) {
    const mutation = `mutation orderUpdate($input: OrderInput!) { orderUpdate(input: $input) { order { id } userErrors { field message } } }`;
    try {
        await shopifyAdminApiQuery(mutation, { input: { id: orderGid, note: note } });
        console.log("✅ Successfully added note to order.");
    } catch (error) { console.error("🚨 Failed to add note to order:", error); }
}

// --- MAIN HANDLER FUNCTION ---
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).end('Method Not Allowed');
  }

  try {
    const rawBody = await getRawBody(req);
    const hmacHeader = req.headers['x-shopify-hmac-sha256'];
    const secret = process.env.SHOPIFY_WEBHOOK_SECRET;

    if (!hmacHeader || !secret || createHmac('sha256', secret).update(rawBody).digest('base64') !== hmacHeader) {
        console.error('🚨 Verification failed.');
        return res.status(401).send('Could not verify webhook.');
    }
    
    console.log('✅ Verification successful!');
    console.log(`Webhook Delivery ID: ${req.headers['x-shopify-webhook-id']}`);
    const orderData = JSON.parse(rawBody.toString());
    const wheelBuildLineItem = orderData.line_items.find(item => item.properties?.some(p => p.name === '_is_custom_wheel_build' && p.value === 'true'));

    if (wheelBuildLineItem) {
        const buildProperty = wheelBuildLineItem.properties.find(p => p.name === '_build');
        if (buildProperty?.value) {
            const buildRecipe = JSON.parse(buildProperty.value);
            const componentData = await fetchComponentData(buildRecipe);
            if (componentData) {
                const finalLengths = runCalculationEngine(buildRecipe, componentData);
                console.log("✅ Final Calculation Results:", JSON.stringify(finalLengths, null, 2));
                await addNoteToOrder(orderData.admin_graphql_api_id, formatNote(finalLengths));
            }
        }
    } else {
        console.log('ℹ️ No custom wheel build found in this order.');
    }
    
    return res.status(200).json({ message: 'Webhook processed.' });

  } catch (error) {
    console.error('An error occurred in the webhook handler:', error);
    return res.status(500).send('Internal Server Error.');
  }
}
