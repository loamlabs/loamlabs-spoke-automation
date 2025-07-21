import { createHmac } from 'crypto';

// --- Vercel Config ---
export const config = { api: { bodyParser: false } };

// --- Helper Functions (Defined Once) ---

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
    if (!crossSectionalArea || crossSectionalArea === 0) return 0;
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

function isLacingPossible(spokeCount, crossPattern) {
    if (crossPattern === 0) return true;
    const angleBetweenHoles = 360 / (spokeCount / 2);
    const lacingAngle = crossPattern * angleBetweenHoles;
    return lacingAngle < 90;
}

async function findVariantForLengthAndColor(productId, length, color) {
    const query = `
      query getProductVariants($id: ID!) {
        product(id: $id) {
          variants(first: 250) {
            nodes {
              id
              title
              inventoryItem { id }
            }
          }
        }
      }
    `;
    try {
        const data = await shopifyAdminApiQuery(query, { id: productId });
        const targetLengthStr = `${length}mm`;
        const variant = data.product.variants.nodes.find(v => 
            v.title.includes(color) && v.title.includes(targetLengthStr)
        );
        if (variant) {
            return { variantId: variant.id, inventoryItemId: variant.inventoryItem.id };
        }
        console.warn(`Could not find variant for product ${productId} with color "${color}" and length "${targetLengthStr}"`);
        return null;
    } catch (error) {
        console.error(`Error finding variant for product ${productId}:`, error);
        return null;
    }
}

async function adjustInventory(inventoryItemId, quantityDelta) {
    const mutation = `
        mutation inventoryAdjustQuantity($input: InventoryAdjustQuantityInput!) {
            inventoryAdjustQuantity(input: $input) {
                inventoryLevel { id }
                userErrors { field message }
            }
        }
    `;
    try {
        const data = await shopifyAdminApiQuery(mutation, {
            input: { inventoryItemId: inventoryItemId, availableDelta: quantityDelta }
        });
        if (data.inventoryAdjustQuantity.userErrors.length > 0) {
            throw new Error(JSON.stringify(data.inventoryAdjustQuantity.userErrors));
        }
        console.log(`✅ Successfully adjusted inventory for ${inventoryItemId} by ${quantityDelta}.`);
        return true;
    } catch (error) {
        console.error(`🚨 Failed to adjust inventory for ${inventoryItemId}:`, error);
        return false;
    }
}

// --- "SMART" CALCULATION ENGINE with BERD EXCLUSION ---
function runCalculationEngine(buildRecipe, componentData) {
    const results = { front: null, rear: null, errors: [] };
    const getMeta = (variantId, productId, key, isNumber = false, defaultValue = 0) => {
        const variantMeta = componentData.get(variantId) || {};
        const productMeta = componentData.get(productId) || {};
        const value = variantMeta[key] ?? productMeta[key];
        if (value === undefined || value === null || value === '') { return isNumber ? defaultValue : null; }
        return isNumber ? parseFloat(value) : value;
    };

    const calculateForPosition = (position) => {
        const rim = buildRecipe.components[`${position}Rim`];
        const hub = buildRecipe.components[`${position}Hub`];
        const spokes = buildRecipe.components[`${position}Spokes`];
        const spokeCount = parseInt(buildRecipe.specs[`${position}SpokeCount`]?.replace('h', ''), 10);
        if (!rim || !hub || !spokes || !spokeCount) { return { calculationSuccessful: false, error: `Skipping ${position} wheel: Missing component.` }; }

        // --- NEW: BERD SPOKE CHECK ---
        if (spokes.vendor === 'Berd') {
            return { calculationSuccessful: false, error: 'Calculation not applicable for Berd spokes.' };
        }

        const hubType = getMeta(hub.variantId, hub.productId, 'hub_type');
        if (hubType === 'Hook Flange') {
            return { calculationSuccessful: false, error: `Unsupported type (Hook Flange).` };
        }

        let finalErd = getMeta(rim.variantId, rim.productId, 'rim_erd', true);
        if (getMeta(rim.variantId, rim.productId, 'rim_washer_policy') !== 'Not Compatible') {
            finalErd += (2 * getMeta(rim.variantId, rim.productId, 'rim_nipple_washer_thickness_mm', true));
        }

        const hubLacingPolicy = getMeta(hub.variantId, hub.productId, 'hub_lacing_policy');
        const hubManualCrossValue = getMeta(hub.variantId, hub.productId, 'hub_manual_cross_value', true);
        let initialCrossPattern;
        if (hubLacingPolicy === 'Use Manual Override Field' && hubManualCrossValue > 0) {
            initialCrossPattern = hubManualCrossValue;
        } else {
            initialCrossPattern = (spokeCount >= 32) ? 3 : 2;
        }
        
        let finalCrossPattern = initialCrossPattern;
        let fallbackAlert = null;

        while (!isLacingPossible(spokeCount, finalCrossPattern) && finalCrossPattern > 0) {
            console.log(`Interference detected for ${finalCrossPattern}-cross. Falling back...`);
            finalCrossPattern--;
        }

        if (finalCrossPattern !== initialCrossPattern) {
            fallbackAlert = `Interference detected for ${initialCrossPattern}-cross. Automatically fell back to ${finalCrossPattern}-cross.`;
        }
        
        const commonParams = { hubType, baseCrossPattern: finalCrossPattern, spokeCount, finalErd, rimSpokeHoleOffset: getMeta(rim.variantId, rim.productId, 'rim_spoke_hole_offset', true), hubSpokeHoleDiameter: getMeta(hub.variantId, hub.productId, 'hub_spoke_hole_diameter', true) };
        const paramsLeft = { ...commonParams, isLeft: true, hubFlangeDiameter: getMeta(hub.variantId, hub.productId, 'hub_flange_diameter_left', true), flangeOffset: getMeta(hub.variantId, hub.productId, 'hub_flange_offset_left', true), spOffset: getMeta(hub.variantId, hub.productId, 'hub_sp_offset_spoke_hole_left', true) };
        const paramsRight = { ...commonParams, isLeft: false, hubFlangeDiameter: getMeta(hub.variantId, hub.productId, 'hub_flange_diameter_right', true), flangeOffset: getMeta(hub.variantId, hub.productId, 'hub_flange_offset_right', true), spOffset: getMeta(hub.variantId, hub.productId, 'hub_sp_offset_spoke_hole_right', true) };

        const lengthL = calculateSpokeLength(paramsLeft);
        const lengthR = calculateSpokeLength(paramsRight);
        const tensionKgf = getMeta(rim.variantId, rim.productId, 'rim_target_tension_kgf', true, 120);
        const crossArea = getMeta(spokes.variantId, spokes.productId, 'spoke_cross_sectional_area_mm2', true) || getMeta(spokes.variantId, spokes.productId, 'spoke_cross_section_area_mm2', true);

        return {
            calculationSuccessful: true,
            crossPattern: finalCrossPattern,
            alert: fallbackAlert,
            lengths: {
                left: { geo: lengthL.toFixed(2), stretch: calculateElongation(lengthL, tensionKgf, crossArea).toFixed(2) },
                right: { geo: lengthR.toFixed(2), stretch: calculateElongation(lengthR, tensionKgf, crossArea).toFixed(2) }
            },
            inputs: {
                rim: rim.title, hub: hub.title, spokes: spokes.title,
                targetTension: tensionKgf
            }
        };
    };
    
    try {
        results.front = calculateForPosition('front');
        if (buildRecipe.buildType === 'Wheel Set') {
            results.rear = calculateForPosition('rear');
        }
    } catch (e) { results.errors.push(e.message); }
    return results;
}

// --- FINAL Note Formatter with "mm" SUFFIX ---
function formatNote(report) {
    let note = "AUTOMATED SPOKE CALCULATION & INVENTORY\n---------------------------------------\n";
    const formatSide = (wheel, position) => {
        if (!wheel) return ``;
        if (!wheel.calculationSuccessful) return `\n${position.toUpperCase()} WHEEL: CALC FAILED - ${wheel.error}`;
        
        let wheelNote = `\n${position.toUpperCase()} WHEEL (${wheel.crossPattern}-Cross):\n` +
               `  Rim: ${wheel.inputs.rim}\n` +
               `  Hub: ${wheel.inputs.hub}\n` +
               `  Spokes: ${wheel.inputs.spokes}\n` +
               `  Target Tension: ${wheel.inputs.targetTension} kgf\n` +
               `  --- Calculated Lengths ---\n` +
               `  Left (Geo):  ${wheel.lengths.left.geo} mm (Stretch: ${wheel.lengths.left.stretch} mm)\n` +
               `  Right (Geo): ${wheel.lengths.right.geo} mm (Stretch: ${wheel.lengths.right.stretch} mm)\n` +
               `  --- Inventory Adjustments ---\n` +
               `  Left: ${wheel.inventory.left.quantity} x ${wheel.inventory.left.length}mm (${wheel.inventory.left.status})\n` +
               `  Right: ${wheel.inventory.right.quantity} x ${wheel.inventory.right.length}mm (${wheel.inventory.right.status})`;

        if (wheel.alert) {
            wheelNote += `\n  ALERT: ${wheel.alert}`;
        }
        
        return wheelNote;
    };
    note += formatSide(report.front, 'Front');
    note += formatSide(report.rear, 'Rear');
    if (report.errors && report.errors.length > 0) { note += `\n\nWARNINGS:\n- ${report.errors.join('\n- ')}`; }
    return note;
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
    const orderData = JSON.parse(rawBody.toString());
    const wheelBuildLineItem = orderData.line_items.find(item => item.properties?.some(p => p.name === '_is_custom_wheel_build' && p.value === 'true'));

    if (wheelBuildLineItem) {
        const buildProperty = wheelBuildLineItem.properties.find(p => p.name === '_build');
        if (buildProperty?.value) {
            const buildRecipe = JSON.parse(buildProperty.value);
            const componentData = await fetchComponentData(buildRecipe);
            if (componentData) {
                let buildReport = runCalculationEngine(buildRecipe, componentData);
                console.log("✅ Initial Build Report:", JSON.stringify(buildReport, null, 2));

                for (const position of ['front', 'rear']) {
                    const wheel = buildReport[position];
                    
                    if (wheel && wheel.calculationSuccessful) {
                        const spokeComponent = buildRecipe.components[`${position}Spokes`];
                        const spokeCountPerSide = parseInt(buildRecipe.specs[`${position}SpokeCount`]?.replace('h', '')) / 2;
                        const spokeProductId = spokeComponent?.productId;
                        const colorOption = spokeComponent.selectedOptions.find(opt => opt.name === 'Color');
                        const selectedColor = colorOption ? colorOption.value : null;

                        if (!selectedColor) {
                             wheel.inventory = {
                                left: { status: 'ACTION REQUIRED: Color not found' },
                                right: { status: 'ACTION REQUIRED: Color not found' }
                            };
                            continue;
                        }

                        const roundedL = Math.ceil(parseFloat(wheel.lengths.left.geo) / 2) * 2;
                        const variantL = await findVariantForLengthAndColor(spokeProductId, roundedL, selectedColor);
                        let statusL = "ACTION REQUIRED: Variant not found!";
                        if (variantL) {
                            const success = await adjustInventory(variantL.inventoryItemId, -spokeCountPerSide);
                            statusL = success ? "Adjusted" : "FAILED to adjust";
                        }

                        const roundedR = Math.ceil(parseFloat(wheel.lengths.right.geo) / 2) * 2;
                        const variantR = await findVariantForLengthAndColor(spokeProductId, roundedR, selectedColor);
                        let statusR = "ACTION REQUIRED: Variant not found!";
                        if (variantR) {
                            const success = await adjustInventory(variantR.inventoryItemId, -spokeCountPerSide);
                            statusR = success ? "Adjusted" : "FAILED to adjust";
                        }
                        
                        wheel.inventory = {
                            left: { length: roundedL, quantity: spokeCountPerSide, status: statusL },
                            right: { length: roundedR, quantity: spokeCountPerSide, status: statusR }
                        };
                    } else if (wheel && !wheel.calculationSuccessful) {
                        // Handle cases where calculation was skipped (e.g., Berd)
                        wheel.inventory = {
                            left: { status: 'N/A' },
                            right: { status: 'N/A' }
                        };
                    }
                }
                
                await addNoteToOrder(orderData.admin_graphql_api_id, formatNote(buildReport));
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
