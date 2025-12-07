// Forcing a clean Vercel build environment
import { createHmac } from 'crypto';
import { Resend } from 'resend';

import {
    applyRounding,
    calculateElongation,
    calculateSpokeLength,
    isLacingPossible,
    calculateBerdFinalLength
} from '../_lib/calculator.js';

// --- Vercel Config ---
export const config = { api: { bodyParser: false } };

async function getRawBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

async function shopifyAdminApiQuery(query, variables, retries = 3, delay = 500) {
    const storeDomain = process.env.SHOPIFY_STORE_DOMAIN;
    const apiToken = process.env.SHOPIFY_ADMIN_API_TOKEN;
    const url = `https://${storeDomain}/admin/api/2024-07/graphql.json`;

    for (let i = 0; i < retries; i++) {
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json', 
                    'X-Shopify-Access-Token': apiToken 
                },
                body: JSON.stringify({ query, variables }),
            });

            // 1. Handle HTTP Level Errors (e.g., 429 Rate Limit or 500 Server Error)
            if (!response.ok) {
                if (response.status === 429 || response.status >= 500) {
                    throw new Error(`HTTP Error ${response.status}`);
                }
            }

            const result = await response.json();
            
            // 2. Handle GraphQL Level Errors (e.g., Throttling)
            if (result.errors) {
                 const isThrottled = result.errors.some(e => e.message && e.message.includes('Throttled'));
                 if (isThrottled) throw new Error('GraphQL Throttled');
                 
                 throw new Error(`Shopify GraphQL Error: ${JSON.stringify(result.errors)}`);
            }
            
            return result.data;

        } catch (error) {
            console.warn(`⚠️ Shopify API Attempt ${i + 1} failed: ${error.message}`);
            
            // If this was the last attempt, stop trying and throw the error to the main log
            if (i === retries - 1) throw error; 
            
            // Wait before retrying (Exponential backoff: 500ms -> 1000ms -> 2000ms)
            await new Promise(res => setTimeout(res, delay * Math.pow(2, i)));
        }
    }
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

// --- CACHING LOGIC START ---
const variantCache = new Map();

async function getVariantsCached(productId) {
    // If we already fetched this product in this request, return it immediately
    if (variantCache.has(productId)) {
        console.log(`⚡ Using cached variants for product ${productId}`);
        return variantCache.get(productId);
    }
    
    // Otherwise, ask Shopify
    console.log(`🌐 Fetching variants from API for product ${productId}`);
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
        const variants = data.product.variants.nodes;
        variantCache.set(productId, variants); // Save to cache
        return variants;
    } catch (error) {
        console.error(`Error fetching variants for ${productId}:`, error);
        return [];
    }
}

async function findVariantForLengthAndColor(productId, length, color) {
    // We now use the Cached helper instead of a raw query
    const variants = await getVariantsCached(productId);
    const targetLengthStr = `${length}mm`;
    
    // Search the list we already downloaded
    const variant = variants.find(v => 
        v.title.includes(color) && v.title.includes(targetLengthStr)
    );
    
    if (variant) {
        return { variantId: variant.id, inventoryItemId: variant.inventoryItem.id };
    }
    console.warn(`Could not find variant for product ${productId} with color "${color}" and length "${targetLengthStr}"`);
    return null;
}
// --- CACHING LOGIC END ---

async function adjustInventory(inventoryItemId, quantityDelta, locationId, orderGid) {
    const mutation = `
        mutation inventoryAdjustQuantities($input: InventoryAdjustQuantitiesInput!) {
            inventoryAdjustQuantities(input: $input) {
                inventoryAdjustmentGroup { id }
                userErrors { field message }
            }
        }
    `;
    try {
        const data = await shopifyAdminApiQuery(mutation, {
            input: {
                name: "available",
                reason: "correction", 
                changes: [{
                    delta: quantityDelta,
                    inventoryItemId: inventoryItemId,
                    locationId: locationId
                }],
                referenceDocumentUri: orderGid 
            }
        });
        if (data.inventoryAdjustQuantities.userErrors.length > 0) {
            throw new Error(JSON.stringify(data.inventoryAdjustQuantities.userErrors));
        }
        console.log(`✅ Successfully adjusted inventory for ${inventoryItemId} by ${quantityDelta}.`);
        return true;
    } catch (error) {
        console.error(`🚨 Failed to adjust inventory for ${inventoryItemId}:`, error);
        return false;
    }
}

async function addNoteToOrder(orderGid, note) {
    const mutation = `mutation orderUpdate($input: OrderInput!) { orderUpdate(input: $input) { order { id } userErrors { field message } } }`;
    try {
        await shopifyAdminApiQuery(mutation, { input: { id: orderGid, note: note } });
        console.log("✅ Successfully added note to order.");
    } catch (error) { console.error("🚨 Failed to add note to order:", error); }
}

async function getPrimaryLocationId() {
    // 1. Check for Environment Variable first (FASTEST & SAFEST)
    if (process.env.SHOPIFY_PRIMARY_LOCATION_ID) {
        console.log("Using Primary Location ID from Environment Variables.");
        return process.env.SHOPIFY_PRIMARY_LOCATION_ID;
    }

    console.log("Fetching primary location ID as a fallback (API)...");
    
    // 2. If Env var is missing, try the API (Backup method)
    const query = `
        query {
            locations(first: 1, query: "is_primary:true AND status:active") {
                nodes {
                    id
                }
            }
        }
    `;
    try {
        const data = await shopifyAdminApiQuery(query, {});
        if (data.locations.nodes && data.locations.nodes.length > 0) {
            const locationGid = data.locations.nodes[0].id;
            return locationGid.split('/').pop();
        }
        return null;
    } catch (error) {
        console.error("🚨 Failed to fetch primary location ID via API:", error);
        return null;
    }
}

async function handleOrderCreate(orderData) {
    // 1. Optimized Location ID Check (Checks Env Var first to prevent timeout)
    let locationId = process.env.SHOPIFY_PRIMARY_LOCATION_ID; 
    
    if (!locationId) {
        // If Env Var is missing, check the order data
        if (orderData.location_id) {
            locationId = orderData.location_id;
        } else {
            console.warn("Env var missing and Order has no location_id. Attempting API fallback...");
            locationId = await getPrimaryLocationId();
        }
    }
    
    if (!locationId) {
        console.error("CRITICAL: Could not determine any order location ID. Aborting inventory adjustments.");
    }

    const wheelBuildLineItem = orderData.line_items.find(item => item.properties?.some(p => p.name === '_is_custom_wheel_build' && p.value === 'true'));

    if (wheelBuildLineItem) {
        const buildProperty = wheelBuildLineItem.properties.find(p => p.name === '_build');
        if (buildProperty?.value) {
            const buildRecipe = JSON.parse(buildProperty.value);
            const componentData = await fetchComponentData(buildRecipe);
            if (componentData) {
                let buildReport = runCalculationEngine(buildRecipe, componentData);
                console.log("✅ Initial Build Report:", JSON.stringify(buildReport, null, 2));

                // Clear the cache at the start of a new order to ensure fresh data
                variantCache.clear();

                for (const position of ['front', 'rear']) {
                    const wheel = buildReport[position];
                    if (!wheel || !wheel.calculationSuccessful) continue; // Skip if no wheel or calc failed.

                    const spokeComponent = buildRecipe.components[`${position}Spokes`];
                    const spokeCountPerSide = parseInt(buildRecipe.specs[`${position}SpokeCount`]?.replace('h', '')) / 2;
                    const spokeProductId = spokeComponent?.productId;
                    const colorOption = spokeComponent.selectedOptions.find(opt => opt.name === 'Color');
                    const selectedColor = colorOption ? colorOption.value : null;

                    if (!selectedColor) {
                        wheel.inventory = { left: { status: 'ACTION REQUIRED: Color not found' }, right: { status: 'ACTION REQUIRED: Color not found' } };
                        continue;
                    }
                    if (!locationId) {
                        wheel.inventory = { left: { status: 'FAILED: Location ID missing' }, right: { status: 'FAILED: Location ID missing' } };
                        continue;
                    }

                    let inventoryColor = selectedColor;
                    if (spokeComponent.vendor === 'Berd' && selectedColor !== 'Black Berd' && selectedColor !== 'White Berd') {
                        inventoryColor = 'White Berd';
                    }

                    // --- PARALLEL PROCESSING START ---
                    // We define a small helper task for a single side
                    const processSide = async (length) => {
                        const variant = await findVariantForLengthAndColor(spokeProductId, length, inventoryColor);
                        let status = "ACTION REQUIRED: Variant not found!";
                        
                        if (variant) {
                            const success = await adjustInventory(variant.inventoryItemId, -spokeCountPerSide, `gid://shopify/Location/${locationId}`, orderData.admin_graphql_api_id);
                            status = success ? "Adjusted" : "FAILED to adjust";
                        }
                        return { length, quantity: spokeCountPerSide, status };
                    };

                    // Execute both Left and Right simultaneously (Parallel)
                    const [leftResult, rightResult] = await Promise.all([
                        processSide(wheel.lengths.left.rounded),
                        processSide(wheel.lengths.right.rounded)
                    ]);

                    wheel.inventory = { left: leftResult, right: rightResult };
                    // --- PARALLEL PROCESSING END ---
                }
                
                await addNoteToOrder(orderData.admin_graphql_api_id, formatNote(buildReport));
                await sendEmailReport(buildReport, orderData, buildRecipe);
            }
        }
    } else {
        console.log('ℹ️ No custom wheel build found in this order.');
    }
}

async function handleOrderCancelled(orderData) {

    const wheelBuildLineItem = orderData.line_items.find(item => item.properties?.some(p => p.name === '_is_custom_wheel_build' && p.value === 'true'));
    if (!wheelBuildLineItem || !orderData.note || !orderData.note.includes("AUTOMATED SPOKE CALCULATION")) {
        console.log("This is not a wheel build with an automated note. No restock needed.");
        return;
    }

    let locationId = orderData.location_id;
    if (!locationId) {
        locationId = await getPrimaryLocationId();
    }
    if (!locationId) {
        console.error("CRITICAL: Could not determine location ID for restock. Aborting.");
        await addNoteToOrder(orderData.admin_graphql_api_id, "AUTOMATED RESTOCK FAILED: Could not determine location ID.");
        return;
    }

    const note = orderData.note;
    const regex = /(Left|Right):\s*(\d+)\s*x\s*(\d+)mm\s*\(Adjusted\)/g;
    let match;
    const restockActions = [];
    
    while ((match = regex.exec(note)) !== null) {
        restockActions.push({
            quantity: parseInt(match[2], 10),
            length: parseInt(match[3], 10),
        });
    }

    if (restockActions.length === 0) {
        console.log("No 'Adjusted' inventory lines found in the note. Nothing to restock.");
        return;
    }
    
    const buildProperty = wheelBuildLineItem?.properties.find(p => p.name === '_build');
    if (!buildProperty || !buildProperty.value) {
         console.log("Could not find the original build recipe. Aborting restock.");
         return;
    }
    const buildRecipe = JSON.parse(buildProperty.value);

    let restockNote = "AUTOMATED RESTOCK COMPLETE\n--------------------------\n";
    let actionIndex = 0;

    for (const position of ['front', 'rear']) {
        const spokeComponent = buildRecipe.components[`${position}Spokes`];
        if (!spokeComponent) continue; 

        const colorOption = spokeComponent.selectedOptions.find(opt => opt.name === 'Color');
        const selectedColor = colorOption ? colorOption.value : null;

        if (!selectedColor) {
            restockNote += `- ${position.toUpperCase()}: SKIPPED (Could not determine original color)\n`;
            continue;
        }

        // --- Smart Color Logic for Restocking ---
        let inventoryColor = selectedColor;
        if (spokeComponent.vendor === 'Berd' && selectedColor !== 'Black Berd' && selectedColor !== 'White Berd') {
            inventoryColor = 'White Berd'; // If it was a custom color, restock the 'White Berd' variant
        }
        // --- End of Logic ---

        // Process Left Side for this wheel
        if (actionIndex < restockActions.length) {
            const action = restockActions[actionIndex++];
            const variant = await findVariantForLengthAndColor(spokeComponent.productId, action.length, inventoryColor);
            if (variant) {
                const success = await adjustInventory(variant.inventoryItemId, action.quantity, `gid://shopify/Location/${locationId}`); // Positive number
                const status = success ? "Restocked" : "FAILED";
                restockNote += `- Left (${position}): ${action.quantity} x ${action.length}mm (${inventoryColor}) - ${status}\n`;
            } else {
                restockNote += `- Left (${position}): ${action.quantity} x ${action.length}mm (${inventoryColor}) - FAILED (Variant not found)\n`;
            }
        }
        // Process Right Side for this wheel
        if (actionIndex < restockActions.length) {
            const action = restockActions[actionIndex++];
            const variant = await findVariantForLengthAndColor(spokeComponent.productId, action.length, inventoryColor);
            if (variant) {
                const success = await adjustInventory(variant.inventoryItemId, action.quantity, `gid://shopify/Location/${locationId}`); // Positive number
                const status = success ? "Restocked" : "FAILED";
                restockNote += `- Right (${position}): ${action.quantity} x ${action.length}mm (${inventoryColor}) - ${status}\n`;
            } else {
                restockNote += `- Right (${position}): ${action.quantity} x ${action.length}mm (${inventoryColor}) - FAILED (Variant not found)\n`;
            }
        }
    }

    await addNoteToOrder(orderData.admin_graphql_api_id, restockNote);
}

function runCalculationEngine(buildRecipe, componentData) {
    console.log("--- RUNNING CALCULATION ENGINE V4 (with FINAL buildType fix) ---");

    const results = { front: null, rear: null, errors: [] };

    const getMeta = (variantId, productId, key, isNumber = false, defaultValue = 0) => {
        const variantMeta = componentData.get(variantId) || {};
        const productMeta = componentData.get(productId) || {};
        const value = variantMeta[key] ?? productMeta[key];
        if (value === undefined || value === null || value === '') { return isNumber ? defaultValue : null; }
        if (isNumber) {
            const num = parseFloat(value);
            return isNaN(num) ? defaultValue : num;
        }
        return value;
    };

        const calculateForPosition = (position) => {
        const rim = buildRecipe.components[`${position}Rim`];
        const hub = buildRecipe.components[`${position}Hub`];
        const spokes = buildRecipe.components[`${position}Spokes`];
        const spokeCount = parseInt(buildRecipe.specs[`${position}SpokeCount`]?.replace('h', ''), 10);

        if (!rim || !hub || !spokes || !spokeCount) { 
            return { calculationSuccessful: false, error: `Skipping ${position} wheel: Missing component.` }; 
        }
        
        let rimTitleWithSize = rim.title;
        const sizeOption = rim.selectedOptions?.find(opt => opt.name === 'Size');
        if (sizeOption && sizeOption.value) {
            rimTitleWithSize = `${rim.title} - ${sizeOption.value}`;
        }

        if (hub.title.includes('Your Own')) {
            return { calculationSuccessful: false, error: `Skipping calculation: Customer is supplying their own ${position} hub.` };
        }
        if (rim.title.includes('Your Own')) {
            return { calculationSuccessful: false, error: `Skipping calculation: Customer is supplying their own ${position} rim.` };
        }

        let crossL, crossR;
        let lacingAlert = null;

        const hubLacingPolicy = getMeta(hub.variantId, hub.productId, 'hub_lacing_policy');
        const manualCrossOverride = getMeta(hub.variantId, hub.productId, 'hub_manual_cross_value', true, 0);

        if (hubLacingPolicy === 'Use Manual Override Field' && manualCrossOverride > 0) {
            lacingAlert = `Hub policy override applied. Using ${manualCrossOverride}-cross.`;
            crossL = manualCrossOverride;
            crossR = manualCrossOverride;
        } else {
            const defaultCross = (spokeCount >= 28) ? 3 : 2;
            crossL = defaultCross;
            crossR = defaultCross;
        }
        
        const hubType = getMeta(hub.variantId, hub.productId, 'hub_type');

        const hubDimensions = {
            hubType: hubType,
            pcd_l: getMeta(hub.variantId, hub.productId, 'hub_flange_diameter_left', true),
            pcd_r: getMeta(hub.variantId, hub.productId, 'hub_flange_diameter_right', true),
            flange_l: getMeta(hub.variantId, hub.productId, 'hub_flange_offset_left', true),
            flange_r: getMeta(hub.variantId, hub.productId, 'hub_flange_offset_right', true),
            shd: getMeta(hub.variantId, hub.productId, 'hub_spoke_hole_diameter', true, 2.6),
            spo_l: getMeta(hub.variantId, hub.productId, 'hub_sp_offset_spoke_hole_left', true),
            spo_r: getMeta(hub.variantId, hub.productId, 'hub_sp_offset_spoke_hole_right', true)
        };
        
        // --- Calculate effective flanges early to use for BOTH spoke types ---
        const rimAsymmetry = getMeta(rim.variantId, rim.productId, 'rim_spoke_hole_offset', true);
        const rawFlangeL = getMeta(hub.variantId, hub.productId, 'hub_flange_offset_left', true);
        const rawFlangeR = getMeta(hub.variantId, hub.productId, 'hub_flange_offset_right', true);

        let effectiveFlangeL, effectiveFlangeR;
        if (position === 'front') {
            effectiveFlangeL = rawFlangeL + rimAsymmetry;
            effectiveFlangeR = rawFlangeR - rimAsymmetry;
        } else { // 'rear'
            effectiveFlangeL = rawFlangeL - rimAsymmetry;
            effectiveFlangeR = rawFlangeR + rimAsymmetry;
        }
            
        if (spokes.vendor === 'Berd') {
            const baseErd = getMeta(rim.variantId, rim.productId, 'rim_erd', true);
            const washerThickness = getMeta(rim.variantId, rim.productId, 'nipple_washer_thickness', true);
            const finalErd = baseErd + (2 * washerThickness);
            
            const metalLengthL = calculateSpokeLength({ isLeft: true, hubType, baseCrossPattern: crossL, spokeCount, finalErd, hubFlangeDiameter: getMeta(hub.variantId, hub.productId, 'hub_flange_diameter_left', true), flangeOffset: effectiveFlangeL, spOffset: getMeta(hub.variantId, hub.productId, 'hub_sp_offset_spoke_hole_left', true), hubSpokeHoleDiameter: getMeta(hub.variantId, hub.productId, 'hub_spoke_hole_diameter', true, 2.6) });
            const metalLengthR = calculateSpokeLength({ isLeft: false, hubType, baseCrossPattern: crossR, spokeCount, finalErd, hubFlangeDiameter: getMeta(hub.variantId, hub.productId, 'hub_flange_diameter_right', true), flangeOffset: effectiveFlangeR, spOffset: getMeta(hub.variantId, hub.productId, 'hub_sp_offset_spoke_hole_right', true), hubSpokeHoleDiameter: getMeta(rim.variantId, rim.productId, 'hub_spoke_hole_diameter', true, 2.6) });
            const berdContext = { flangeL: effectiveFlangeL, flangeR: effectiveFlangeR, metalLengthL, metalLengthR };
            const finalBerdLengthL = calculateBerdFinalLength(metalLengthL, hubType, true, berdContext);
            const finalBerdLengthR = calculateBerdFinalLength(metalLengthR, hubType, false, berdContext);
            
            return {
                calculationSuccessful: true,
                crossPattern: { left: crossL, right: crossR },
                alert: lacingAlert,
                lengths: {
                    left: { geo: finalBerdLengthL.toFixed(2), rounded: applyRounding(finalBerdLengthL, 'Berd') },
                    right: { geo: finalBerdLengthR.toFixed(2), rounded: applyRounding(finalBerdLengthR, 'Berd') }
                },
                inputs: { rim: rimTitleWithSize, hub: hub.title, spokes: spokes.title, rimAsymmetry: rimAsymmetry, erd: baseErd, washerPolicy: "Mandatory (Berd)", washerThickness: washerThickness, finalErd: finalErd.toFixed(2), targetTension: getMeta(rim.variantId, rim.productId, 'rim_target_tension_kgf', true, 120), hubDimensions: hubDimensions }
            };
        } else { // Steel spoke logic
            let erd = getMeta(rim.variantId, rim.productId, 'rim_erd', true); 
            const washerPolicy = getMeta(rim.variantId, rim.productId, 'rim_washer_policy');
            const washerThickness = getMeta(rim.variantId, rim.productId, 'nipple_washer_thickness', true);
            let finalErd = erd;
            if (washerPolicy !== 'Not Compatible') {
                finalErd += (2 * washerThickness);
            }
        
            if (!isLacingPossible(spokeCount, crossL) || !isLacingPossible(spokeCount, crossR)) {
                return { calculationSuccessful: false, error: `Lacing pattern ${crossL}/${crossR} is not geometrically possible.` };
            }
            
            const commonParams = { hubType, spokeCount, finalErd, hubSpokeHoleDiameter: getMeta(hub.variantId, hub.productId, 'hub_spoke_hole_diameter', true, 2.6) };
            const paramsLeft = { ...commonParams, isLeft: true, baseCrossPattern: crossL, hubFlangeDiameter: getMeta(hub.variantId, hub.productId, 'hub_flange_diameter_left', true), flangeOffset: effectiveFlangeL, spOffset: getMeta(hub.variantId, hub.productId, 'hub_sp_offset_spoke_hole_left', true) };
            const paramsRight = { ...commonParams, isLeft: false, baseCrossPattern: crossR, hubFlangeDiameter: getMeta(hub.variantId, hub.productId, 'hub_flange_diameter_right', true), flangeOffset: effectiveFlangeR, spOffset: getMeta(hub.variantId, hub.productId, 'hub_sp_offset_spoke_hole_right', true) };
            
            const lengthL = calculateSpokeLength(paramsLeft);
            const lengthR = calculateSpokeLength(paramsRight);
            
            const tensionKgf = getMeta(rim.variantId, rim.productId, 'rim_target_tension_kgf', true, 120);
            const crossArea = getMeta(spokes.variantId, spokes.productId, 'spoke_cross_section_area_mm2', true);
            
            return {
                calculationSuccessful: true,
                crossPattern: { left: crossL, right: crossR },
                alert: lacingAlert,
                lengths: {
                    left: { geo: lengthL.toFixed(2), stretch: calculateElongation(lengthL, tensionKgf, crossArea).toFixed(2), rounded: applyRounding(lengthL, 'Steel') },
                    right: { geo: lengthR.toFixed(2), stretch: calculateElongation(lengthR, tensionKgf, crossArea).toFixed(2), rounded: applyRounding(lengthR, 'Steel') }
                },
                inputs: { rim: rimTitleWithSize, hub: hub.title, spokes: spokes.title, rimAsymmetry: rimAsymmetry, erd: erd, washerPolicy: washerPolicy, washerThickness: washerThickness, finalErd: finalErd.toFixed(2), targetTension: tensionKgf, hubDimensions: hubDimensions }
            };
        }
    };
    
    try {
        if (buildRecipe.buildType === 'Front') { 
            results.front = calculateForPosition('front');
        } else if (buildRecipe.buildType === 'Rear') {
            results.rear = calculateForPosition('rear');
        } else if (buildRecipe.buildType === 'Wheel Set') {
            results.front = calculateForPosition('front');
            results.rear = calculateForPosition('rear');
        } else {
            results.errors.push(`Unknown buildType: ${buildRecipe.buildType}`);
        }
    } catch (e) {
        results.errors.push(e.message);
    }

    return results;
}

function formatNote(report) {
    let note = "AUTOMATED SPOKE CALCULATION & INVENTORY\n";
    const formatSide = (wheel, position) => {
        if (!wheel) return ``;
        if (!wheel.calculationSuccessful) return `\n${position.toUpperCase()} WHEEL: CALC FAILED - ${wheel.error}`;
        
        let crossText = (typeof wheel.crossPattern === 'object') 
            ? `L:${wheel.crossPattern.left}-Cross, R:${wheel.crossPattern.right}-Cross`
            : `${wheel.crossPattern}-Cross`;

        let wheelNote = `\n${position.toUpperCase()} WHEEL (${crossText}):\n`;
        
        if (wheel.alert) {
            wheelNote += `  ALERT: ${wheel.alert}\n`;
        }

        let rimLine = `  Rim: ${wheel.inputs.rim}`;
        if (wheel.inputs.rimAsymmetry && wheel.inputs.rimAsymmetry > 0) {
            rimLine += ` (Asym: ${wheel.inputs.rimAsymmetry.toFixed(1)} mm)`;
        }
        
        let erdNote = `  ERD: ${wheel.inputs.erd} mm`;
        const totalWasherThickness = 2 * wheel.inputs.washerThickness;
        if (wheel.inputs.washerPolicy !== 'Not Compatible' && totalWasherThickness > 0) {
            erdNote += ` + (2x) ${wheel.inputs.washerThickness.toFixed(1)} mm Washers (Policy: ${wheel.inputs.washerPolicy}) = ${wheel.inputs.finalErd} mm Final`;
        } else {
            erdNote += ` (Final: ${wheel.inputs.finalErd} mm)`;
        }

        wheelNote += `${rimLine}\n` + 
               `${erdNote}\n` + 
               `  Hub: ${wheel.inputs.hub}\n` +
               `  Spokes: ${wheel.inputs.spokes}\n` +
               `  Target Tension: ${wheel.inputs.targetTension} kgf\n` +
               `  --- Calculated Lengths ---\n`;

        if (wheel.inputs.spokes.includes("Berd")) {
            wheelNote += `  Left (Raw BERD): ${wheel.lengths.left.geo} mm\n` +
                         `  Right (Raw BERD): ${wheel.lengths.right.geo} mm\n`;
        } else {
            wheelNote += `  Left (Geo):  ${wheel.lengths.left.geo} mm (Stretch: ${wheel.lengths.left.stretch} mm)\n` +
                         `  Right (Geo): ${wheel.lengths.right.geo} mm (Stretch: ${wheel.lengths.right.stretch} mm)\n`;
        }
        
        wheelNote += `  --- Inventory Adjustments ---\n` +
               `  Left: ${wheel.inventory.left.quantity} x ${wheel.inventory.left.length}mm (${wheel.inventory.left.status})\n` +
               `  Right: ${wheel.inventory.right.quantity} x ${wheel.inventory.right.length}mm (${wheel.inventory.right.status})`;
        
        return wheelNote;
    };
    note += formatSide(report.front, 'Front');
    note += formatSide(report.rear, 'Rear');
    if (report.errors && report.errors.length > 0) { note += `\n\nWARNINGS:\n- ${report.errors.join('\n- ')}`; }
    return note;
}

async function sendEmailReport(report, orderData, buildRecipe) {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const recipientEmail = process.env.BUILDER_EMAIL_ADDRESS;
    const orderNumber = orderData.order_number;
    const orderAdminUrl = `https://${process.env.SHOPIFY_STORE_DOMAIN}/admin/orders/${orderData.id}`;

    if (!recipientEmail) {
        console.error("CRITICAL: BUILDER_EMAIL_ADDRESS environment variable is not set. Cannot send email.");
        return;
    }

    // --- Helper to generate the HTML for one wheel ---
    const generateWheelHtml = (wheel, position) => {
    if (!wheel) return '';
    if (!wheel.calculationSuccessful) {
        return `
            <h3>${position.toUpperCase()} WHEEL REPORT</h3>
            <p style="color: #D8000C; background-color: #FFD2D2; padding: 10px; border-radius: 3px;">
                <strong>CALCULATION FAILED:</strong> ${wheel.error}
            </p>
        `;
    }
    
    let crossText = (typeof wheel.crossPattern === 'object') 
        ? `L:${wheel.crossPattern.left}-Cross, R:${wheel.crossPattern.right}-Cross`
        : `${wheel.crossPattern}-Cross`;

        // --- Generate the Hub Dimensions table ---
        let hubDimensionsHtml = '';
        const hubDims = wheel.inputs.hubDimensions;
        if (hubDims) {
            hubDimensionsHtml = `
                <h4>Hub Dimensions</h4>
                <table class="data-table">
                    <tr><td>Hub Type</td><td>${hubDims.hubType || 'N/A'}</td></tr>
                    <tr><td>PCD (L/R)</td><td>${hubDims.pcd_l} mm / ${hubDims.pcd_r} mm</td></tr>
                    <tr><td>Flange Offset (L/R)</td><td>${hubDims.flange_l} mm / ${hubDims.flange_r} mm</td></tr>
            `;
            if (hubDims.hubType === 'Classic Flange') {
                hubDimensionsHtml += `<tr><td>Spoke Hole Diameter</td><td>${hubDims.shd} mm</td></tr>`;
            }
            if (hubDims.hubType === 'Straight Pull') {
                hubDimensionsHtml += `<tr><td>Spoke Offset (L/R)</td><td>${hubDims.spo_l} mm / ${hubDims.spo_r} mm</td></tr>`;
            }
            hubDimensionsHtml += '</table>';
        }
        
    // --- Build Rim and ERD HTML with all data ---
    let rimHtml = wheel.inputs.rim;
    if (wheel.inputs.rimAsymmetry && wheel.inputs.rimAsymmetry > 0) {
        rimHtml += ` (Asym: ${wheel.inputs.rimAsymmetry.toFixed(1)} mm)`;
    }

    const totalWasherThickness = 2 * wheel.inputs.washerThickness;
    let erdBreakdownHtml = `Base: ${wheel.inputs.erd} mm`;
    if (wheel.inputs.washerPolicy !== 'Not Compatible' && totalWasherThickness > 0) {
        erdBreakdownHtml += `<br/>+ (2x) ${wheel.inputs.washerThickness.toFixed(1)} mm Washers (${wheel.inputs.washerPolicy})`;
    }
    erdBreakdownHtml += `<br/><strong>Final: ${wheel.inputs.finalErd} mm</strong>`;
        
    return `
        <div class="wheel-section">
            <h3>${position.toUpperCase()} WHEEL DETAILS</h3>
            
            <h4>Lacing Decision</h4>
            <p>Final pattern used: <strong>${crossText}</strong>.</p>
            ${wheel.alert ? `<p class="alert"><strong>NOTE:</strong> ${wheel.alert}</p>` : (wheel.inputs.spokes.includes("Berd") ? '' : '<p>The default lacing pattern passed the interference check.</p>')}

            <h4>Key Inputs</h4>
            <table class="data-table">
                <tr><td>Rim</td><td>${rimHtml}</td></tr>
                <tr><td>Hub</td><td>${wheel.inputs.hub}</td></tr>
                <tr><td>Spokes</td><td>${wheel.inputs.spokes}</td></tr>
                <tr><td>ERD Breakdown</td><td>${erdBreakdownHtml}</td></tr>
                <tr><td>Target Tension</td><td>${wheel.inputs.targetTension} kgf</td></tr>
            </table>

            ${hubDimensionsHtml}

            <h4>Calculated Lengths (Pre-Rounding)</h4>
            <table class="data-table">
                ${wheel.inputs.spokes.includes("Berd") ? `
                    <tr><td>Left (Raw BERD)</td><td>${wheel.lengths.left.geo} mm</td></tr>
                    <tr><td>Right (Raw BERD)</td><td>${wheel.lengths.right.geo} mm</td></tr>
                ` : `
                    <tr><td>Left (Geo)</td><td>${wheel.lengths.left.geo} mm (Stretch: ${wheel.lengths.left.stretch} mm)</td></tr>
                    <tr><td>Right (Geo)</td><td>${wheel.lengths.right.geo} mm (Stretch: ${wheel.lengths.right.stretch} mm)</td></tr>
                `}
            </table>

            <h4>Inventory Adjustments (Final Lengths)</h4>
            <table class="data-table">
                <tr><td>Left</td><td><strong>${wheel.inventory.left.quantity} x ${wheel.inventory.left.length}mm</strong> (${wheel.inventory.left.status})</td></tr>
                <tr><td>Right</td><td><strong>${wheel.inventory.right.quantity} x ${wheel.inventory.right.length}mm</strong> (${wheel.inventory.right.status})</td></tr>
            </table>
        </div>
    `;
};
    
    // --- Main HTML Structure ---
    const emailHtml = `
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #333; line-height: 1.6; }
                .container { max-width: 600px; margin: 20px auto; padding: 20px; border: 1px solid #ddd; border-radius: 5px; }
                h1, h2, h3, h4 { color: #111; }
                a { color: #007bff; text-decoration: none; }
                .summary-box { background-color: #f4f4f7; padding: 15px; border-radius: 5px; margin-bottom: 20px; }
                .summary-box h3 { margin-top: 0; }
                .summary-box p { margin: 5px 0; font-size: 1.1em; }
                .wheel-section { margin-top: 20px; border-top: 1px solid #eee; padding-top: 20px; }
                .data-table { border-collapse: collapse; width: 100%; margin-bottom: 15px; }
                .data-table td { padding: 8px; border: 1px solid #ddd; }
                .data-table td:first-child { font-weight: bold; background-color: #f9f9f9; width: 150px; }
                .alert { color: #9F6000; background-color: #FEEFB3; padding: 10px; border-radius: 3px; }
            </style>
        </head>
        <body>
            <div class="container">
                <h2>Spoke Report for Order #${orderNumber}</h2>
                <p>Build ID: ${buildRecipe.buildId} | <a href="${orderAdminUrl}"><strong>View Order in Shopify →</strong></a></p>

                <!-- At-a-Glance Summary Box -->
                <div class="summary-box">
    <h3>Final Spoke Lengths</h3>
    ${report.front && report.front.calculationSuccessful ? `
        <p><strong>Front Wheel (${typeof report.front.crossPattern === 'object' ? `L:${report.front.crossPattern.left}, R:${report.front.crossPattern.right}` : report.front.crossPattern}-Cross):</strong></p>
        <p style="margin-left: 20px;">Left: ${report.front.inventory.left.quantity} x ${report.front.inventory.left.length}mm</p>
        <p style="margin-left: 20px;">Right: ${report.front.inventory.right.quantity} x ${report.front.inventory.right.length}mm</p>
    ` : ''}
    ${report.rear && report.rear.calculationSuccessful ? `
        <p><strong>Rear Wheel (${typeof report.rear.crossPattern === 'object' ? `L:${report.rear.crossPattern.left}, R:${report.rear.crossPattern.right}` : report.rear.crossPattern}-Cross):</strong></p>
        <p style="margin-left: 20px;">Left: ${report.rear.inventory.left.quantity} x ${report.rear.inventory.left.length}mm</p>
        <p style="margin-left: 20px;">Right: ${report.rear.inventory.right.quantity} x ${report.rear.inventory.right.length}mm</p>
    ` : ''}
</div>

                <!-- Full Details -->
                ${generateWheelHtml(report.front, 'Front')}
                ${generateWheelHtml(report.rear, 'Rear')}
            </div>
        </body>
        </html>
    `;

    try {
        const { data, error } = await resend.emails.send({
            from: 'Spoke Calculator <calculator@loamlabsusa.com>',
            to: [recipientEmail],
            reply_to: 'LoamLabs Support <info@loamlabsusa.com>',
            subject: `Spoke Calculation Complete for Order #${orderNumber}`,
            html: emailHtml,
        });

        if (error) {
            console.error("🚨 Failed to send email report. Resend API returned an error:", error);
            return;
        }

        console.log(`✅ Successfully sent email report to ${recipientEmail}. Resend ID: ${data.id}`);

    } catch (error) {
        console.error("🚨 A critical error occurred while trying to send the email:", error);
    }
}

// --- MAIN HANDLER FUNCTION with Event Routing ---
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
    const eventTopic = req.headers['x-shopify-topic'];

    switch (eventTopic) {
        case 'orders/create':
            console.log(`Handling new order: #${orderData.order_number}`);
            await handleOrderCreate(orderData);
            break;
        case 'orders/cancelled':
            console.log(`Handling cancelled order: #${orderData.order_number}`);
            await handleOrderCancelled(orderData);
            break;
        default:
            console.log(`Received unhandled event topic: ${eventTopic}`);
    }
    
    return res.status(200).json({ message: 'Webhook processed.' });

  } catch (error) {
    console.error('An error occurred in the webhook handler:', error);
    return res.status(500).send('Internal Server Error.');
  }
}
