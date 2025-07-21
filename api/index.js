import { createHmac } from 'crypto';

// --- CONFIG AND HELPER FUNCTIONS (No Changes) ---
export const config = { api: { bodyParser: false } };

async function getRawBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

async function fetchComponentData(buildRecipe) {
  // This function remains exactly the same as our last working version.
  // It fetches all the metafields from Shopify.
  const storeDomain = process.env.SHOPIFY_STORE_DOMAIN;
  const apiToken = process.env.SHOPIFY_ADMIN_API_TOKEN;
  const graphqlUrl = `https://${storeDomain}/admin/api/2024-04/graphql.json`;

  const componentIds = new Set();
  Object.values(buildRecipe.components).forEach(comp => {
    if (comp && comp.variantId && comp.productId) {
      componentIds.add(comp.variantId);
      componentIds.add(comp.productId);
    }
  });

  if (componentIds.size === 0) { return null; }
  
  const ids = Array.from(componentIds);
  const query = `
    query getComponentMetafields($ids: [ID!]!) {
      nodes(ids: $ids) {
        id
        ... on ProductVariant {
          metafields(first: 50) { nodes { key namespace value } }
        }
        ... on Product {
          metafields(first: 50) { nodes { key namespace value } }
        }
      }
    }
  `;

  try {
    const response = await fetch(graphqlUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': apiToken },
      body: JSON.stringify({ query: query, variables: { ids: ids } }),
    });

    if (!response.ok) throw new Error(`Shopify API request failed: ${response.statusText}`);
    const jsonResponse = await response.json();
    if (jsonResponse.errors) throw new Error(`GraphQL Errors: ${JSON.stringify(jsonResponse.errors)}`);
    
    const componentDataMap = new Map();
    jsonResponse.data.nodes.forEach(node => {
        if (node) {
            const metafields = {};
            node.metafields.nodes.forEach(mf => {
                if (mf.namespace === 'custom') {
                    metafields[mf.key] = mf.value;
                }
            });
            componentDataMap.set(node.id, metafields);
        }
    });
    return componentDataMap;
  } catch (error) {
    console.error('Error fetching component data from Shopify:', error);
    return null;
  }
}


// --- *** YOUR TRUSTED CALCULATION LOGIC (from your index.js and sandbox) *** ---

function calculateElongation(spokeLength, tensionKgf, crossSectionalArea) {
    const YOUNG_MODULUS_STEEL_GPA = 210;
    const tensionN = tensionKgf * 9.80665;
    const modulusPa = YOUNG_MODULUS_STEEL_GPA * 1e9;
    const elongationMeters = (tensionN * (spokeLength / 1000)) / (modulusPa * (crossSectionalArea / 1e6));
    return elongationMeters * 1000;
}

function calculateSpokeLength(params) {
    const { 
        isLeft, hubType, baseCrossPattern, spokeCount, finalErd, 
        hubFlangeDiameter, flangeOffset, rimSpokeHoleOffset, 
        spOffset, hubSpokeHoleDiameter 
    } = params;

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
    } else { // Straight Pull
        finalLength = geometricLength + spOffset;
    }
    return finalLength;
}


// --- *** THE NEW "ADAPTER" / CALCULATION ENGINE *** ---
function runCalculationEngine(buildRecipe, componentData) {
    console.log("Starting spoke length calculation with your trusted sandbox logic...");
    const results = { front: null, rear: null, errors: [] };

    const getMeta = (variantId, productId, key, isNumber = false, defaultValue = 0) => {
        const variantMeta = componentData.get(variantId) || {};
        const productMeta = componentData.get(productId) || {};
        const value = variantMeta[key] ?? productMeta[key];
        if (value === undefined || value === null || value === '') {
            if (isNumber) return defaultValue;
            return null;
        }
        return isNumber ? parseFloat(value) : value;
    };

    const calculateForPosition = (position) => {
        const rim = buildRecipe.components[`${position}Rim`];
        const hub = buildRecipe.components[`${position}Hub`];
        const spokes = buildRecipe.components[`${position}Spokes`];
        const spokeCount = parseInt(buildRecipe.specs[`${position}SpokeCount`]?.replace('h', ''), 10);
        
        if (!rim || !hub || !spokes || !spokeCount) {
            return { error: `Skipping ${position} wheel: Missing component or spoke count.` };
        }
        
        // --- Gather Data using the Metafield Cheatsheet ---
        const hubType = getMeta(hub.variantId, hub.productId, 'hub_type');
        const spokeType = getMeta(spokes.variantId, spokes.productId, 'spoke_type');
        
        if (hubType === 'Hook Flange' || spokeType === 'BERD') {
            return { error: `Calculation aborted: Unsupported type (${hubType || spokeType}).` };
        }

        let erd = getMeta(rim.variantId, rim.productId, 'rim_erd', true);
        const rimSpokeHoleOffset = getMeta(rim.variantId, rim.productId, 'rim_spoke_hole_offset', true);
        const rimWasherPolicy = getMeta(rim.variantId, rim.productId, 'rim_washer_policy');
        const rimNippleWasherThickness = getMeta(rim.variantId, rim.productId, 'rim_nipple_washer_thickness_mm', true);
        
        const hubLacingPolicy = getMeta(hub.variantId, hub.productId, 'hub_lacing_policy');
        const hubManualCrossValue = getMeta(hub.variantId, hub.productId, 'hub_manual_cross_value', true);
        
        // --- Apply Business Rules from Sandbox & Master Notes ---
        let finalErd = erd;
        if (rimWasherPolicy === 'Mandatory' || rimWasherPolicy === 'Optional') {
             // Your sandbox formula adjusts the diameter correctly.
            finalErd += (2 * rimNippleWasherThickness);
        }

        let baseCrossPattern;
        if (hubLacingPolicy === 'Use Manual Override Field' && hubManualCrossValue > 0) {
            baseCrossPattern = hubManualCrossValue;
        } else { // Standard lacing rule from sandbox
            baseCrossPattern = (spokeCount >= 32) ? 3 : 2;
        }

        // --- Prepare Params & Run Your Calculation Functions ---
        const paramsLeft = {
            isLeft: true, hubType, baseCrossPattern, spokeCount, finalErd,
            hubFlangeDiameter: getMeta(hub.variantId, hub.productId, 'hub_flange_diameter_left', true),
            flangeOffset: getMeta(hub.variantId, hub.productId, 'hub_flange_offset_left', true),
            rimSpokeHoleOffset: rimSpokeHoleOffset,
            spOffset: getMeta(hub.variantId, hub.productId, 'hub_sp_offset_spoke_hole_left', true),
            hubSpokeHoleDiameter: getMeta(hub.variantId, hub.productId, 'hub_spoke_hole_diameter', true)
        };

        const paramsRight = {
            isLeft: false, hubType, baseCrossPattern, spokeCount, finalErd,
            hubFlangeDiameter: getMeta(hub.variantId, hub.productId, 'hub_flange_diameter_right', true),
            flangeOffset: getMeta(hub.variantId, hub.productId, 'hub_flange_offset_right', true),
            rimSpokeHoleOffset: rimSpokeHoleOffset,
            spOffset: getMeta(hub.variantId, hub.productId, 'hub_sp_offset_spoke_hole_right', true),
            hubSpokeHoleDiameter: getMeta(hub.variantId, hub.productId, 'hub_spoke_hole_diameter', true)
        };

        const lengthL = calculateSpokeLength(paramsLeft);
        const lengthR = calculateSpokeLength(paramsRight);
        
                const tensionKgf = getMeta(rim.variantId, rim.productId, 'rim_target_tension_kgf', true, 120);
        
        // --- CORRECTED LINE ---
        // Try the correct key first, then fall back to the key with the typo.
        const crossArea = getMeta(spokes.variantId, spokes.productId, 'spoke_cross_sectional_area_mm2', true) || getMeta(spokes.variantId, spokes.productId, 'spoke_cross_section_area_mm2', true);

        return {
            left: { geo: lengthL.toFixed(2), stretch: calculateElongation(lengthL, tensionKgf, crossArea).toFixed(2) },
            right: { geo: lengthR.toFixed(2), stretch: calculateElongation(rightR, tensionKgf, crossArea).toFixed(2) },
        };
    };

    try {
        results.front = calculateForPosition('front');
        if (buildRecipe.buildType === 'Wheel Set') {
            results.rear = calculateForPosition('rear');
        }
    } catch (e) {
        console.error("Error during calculation execution:", e);
        results.errors.push(e.message);
    }
    
    return results;
}

// --- MAIN HANDLER FUNCTION (Final Version) ---
export default async function handler(req, res) {
  // This part handles security and parsing, remains unchanged.
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).end('Method Not Allowed');
  }

  try {
    const rawBody = await getRawBody(req);
    const hmacHeader = req.headers['x-shopify-hmac-sha256'];
    const secret = process.env.SHOPIFY_WEBHOOK_SECRET;

    if (!hmacHeader || !secret) {
        return res.status(401).send('Could not verify webhook.');
    }

    const hash = createHmac('sha256', secret).update(rawBody).digest('base64');

    if (hash === hmacHeader) {
      console.log('✅ Verification successful!');
      
      const orderData = JSON.parse(rawBody.toString());
      console.log(`Processing Order ID: ${orderData.id}`);

      const wheelBuildLineItem = orderData.line_items.find(item => 
        item.properties && item.properties.some(prop => prop.name === '_is_custom_wheel_build' && prop.value === 'true')
      );

      if (wheelBuildLineItem) {
        const buildProperty = wheelBuildLineItem.properties.find(prop => prop.name === '_build');
        if (buildProperty && buildProperty.value) {
          const buildRecipe = JSON.parse(buildProperty.value);
          const componentData = await fetchComponentData(buildRecipe);

          if (componentData) {
            // --- *** THE FINAL CALL *** ---
            // We call our new engine, which uses YOUR calculation functions.
            const finalLengths = runCalculationEngine(buildRecipe, componentData);
            
            console.log("✅ Final Calculation Results (using your trusted sandbox logic):");
            console.log(JSON.stringify(finalLengths, null, 2));

            // NEXT STEPS: Take the 'finalLengths' object and format it for email and order notes.

          } else {
            console.error('🚨 Failed to fetch component metafield data.');
          }
        }
      } else {
        console.log('ℹ️ No custom wheel build found in this order.');
      }
      
      return res.status(200).json({ message: 'Webhook processed.' });

    } else {
      console.error('🚨 Verification failed: HMAC mismatch.');
      return res.status(401).send('Could not verify webhook.');
    }
  } catch (error) {
    console.error('An error occurred in the webhook handler:', error);
    return res.status(500).send('Internal Server Error.');
  }
}
