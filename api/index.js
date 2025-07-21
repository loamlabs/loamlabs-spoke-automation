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

    // --- NEW: Robust Location ID Finder ---
    let locationId = orderData.location_id; // Plan A: Try the top-level ID first.
    if (!locationId) {
        console.warn("Order data did not contain a top-level location_id. Fetching primary store location as a fallback.");
        locationId = await getPrimaryLocationId(); // Plan B: Fetch it from the API.
    }
    
    if (!locationId) {
        console.error("CRITICAL: Could not determine any order location ID. Aborting inventory adjustments.");
    }
    // --- End of New Logic ---

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
                             wheel.inventory = { left: { status: 'ACTION REQUIRED: Color not found' }, right: { status: 'ACTION REQUIRED: Color not found' } };
                            continue;
                        }
                        if (!locationId) {
                            wheel.inventory = { left: { status: 'FAILED: Location ID missing' }, right: { status: 'FAILED: Location ID missing' } };
                            continue;
                        }

                        const roundedL = Math.ceil(parseFloat(wheel.lengths.left.geo) / 2) * 2;
                        const variantL = await findVariantForLengthAndColor(spokeProductId, roundedL, selectedColor);
                        let statusL = "ACTION REQUIRED: Variant not found!";
                        if (variantL) {
                            const success = await adjustInventory(variantL.inventoryItemId, -spokeCountPerSide, `gid://shopify/Location/${locationId}`);
                            statusL = success ? "Adjusted" : "FAILED to adjust";
                        }

                        const roundedR = Math.ceil(parseFloat(wheel.lengths.right.geo) / 2) * 2;
                        const variantR = await findVariantForLengthAndColor(spokeProductId, roundedR, selectedColor);
                        let statusR = "ACTION REQUIRED: Variant not found!";
                        if (variantR) {
                            const success = await adjustInventory(variantR.inventoryItemId, -spokeCountPerSide, `gid://shopify/Location/${locationId}`);
                            statusR = success ? "Adjusted" : "FAILED to adjust";
                        }
                        
                        wheel.inventory = {
                            left: { length: roundedL, quantity: spokeCountPerSide, status: statusL },
                            right: { length: roundedR, quantity: spokeCountPerSide, status: statusR }
                        };
                    } else if (wheel && !wheel.calculationSuccessful) {
                        wheel.inventory = { left: { status: 'N/A' }, right: { status: 'N/A' } };
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
