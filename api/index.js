import { createHmac } from 'crypto';
import { Resend } from 'resend';
// --- NEW --- Import puppeteer for web scraping
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

// --- Vercel Config ---
export const config = { api: { bodyParser: false } };


// =================================================================
// START: BERD AUTOMATED AUDIT SYSTEM (Section 12.4)
// =================================================================

// --- Configuration for the Audit ---
// This is our "golden" test case. We will use these exact inputs every time.
const AUDIT_TEST_CASE = {
  hub: {
    hubType: 'Classic Flange',
    flangeDiameterLeft: 58.0,
    flangeDiameterRight: 58.0,
    flangeOffsetLeft: 35.0,
    flangeOffsetRight: 21.0,
    spokeHoleDiameter: 2.5,
    spOffsetLeft: 0,
    spOffsetRight: 0,
  },
  rim: {
    erd: 599.0,
    nippleWasherThickness: 0.5,
  },
  build: {
    spokeCount: 28,
    lacingPattern: 3,
  }
};

// This secret must be set as an Environment Variable in Vercel.
// It ensures that only Vercel's Cron Job can trigger the audit.
const CRON_SECRET = process.env.CRON_SECRET;

/**
 * --- NEW ---
 * Sends a simple alert email for the audit system.
 * @param {object} params - The email parameters.
 * @param {string} params.subject - The email subject.
 * @param {string} params.html - The HTML body of the email.
 */
async function sendAlertEmail({ subject, html }) {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const recipientEmail = process.env.BUILDER_EMAIL_ADDRESS;
    if (!recipientEmail) {
        console.error("AUDIT CRITICAL: BUILDER_EMAIL_ADDRESS is not set. Cannot send alert.");
        return;
    }
    try {
        await resend.emails.send({
            from: 'LoamLabs Automation Alert <alerts@loamlabsusa.com>',
            to: [recipientEmail],
            subject: subject,
            html: html,
        });
        console.log(`AUDIT: Successfully sent alert email with subject: "${subject}"`);
    } catch (error) {
        console.error("AUDIT CRITICAL: Failed to send alert email.", error);
    }
}

/**
 * --- FINAL, CORRECTED VERSION ---
 * Scrapes the Official BERD Calculator to get the reference spoke length.
 * This version uses the correct CSS selectors from the live site and the robust
 * launch options required for the Vercel serverless environment.
 * @returns {Promise<{left: number, right: number}|null>} The calculated spoke lengths or null on failure.
 */
async function scrapeBerdOfficialCalculator() {
  console.log('AUDIT: Launching Puppeteer to scrape official Berd site...');
  let browser;
  try {
    // This is the definitive launch configuration for Vercel
    browser = await puppeteer.launch({
      args: [
        ...chromium.args,
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-infobars',
        '--window-position=0,0',
        '--ignore-certifcate-errors',
        '--ignore-certifcate-errors-spki-list',
        '--user-agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36"'
      ],
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
      ignoreHTTPSErrors: true,
    });

    const page = await browser.newPage();
    const url = 'https://berdspokes.com/pages/calculator';
    await page.goto(url, { waitUntil: 'networkidle2' });
    console.log('AUDIT: Page loaded. Filling out FRONT WHEEL form.');

    // --- Fill out the "Front Wheel" form using correct selectors ---
    await page.click('input#j_bend_front'); // Select J-Bend for the front wheel
    await page.fill('input#erd_front', String(AUDIT_TEST_CASE.rim.erd));
    
    await page.fill('input#pcd_left_front', String(AUDIT_TEST_CASE.hub.flangeDiameterLeft));
    await page.fill('input#pcd_right_front', String(AUDIT_TEST_CASE.hub.flangeDiameterRight));
    await page.fill('input#center_to_flange_left_front', String(AUDIT_TEST_CASE.hub.flangeOffsetLeft));
    await page.fill('input#center_to_flange_right_front', String(AUDIT_TEST_CASE.hub.flangeOffsetRight));
    await page.fill('input#spoke_hole_diameter_front', String(AUDIT_TEST_CASE.hub.spokeHoleDiameter));
    
    await page.fill('input#spoke_count_front', String(AUDIT_TEST_CASE.build.spokeCount));
    await page.fill('input#lacing_pattern_left_front', String(AUDIT_TEST_CASE.build.lacingPattern));
    await page.fill('input#lacing_pattern_right_front', String(AUDIT_TEST_CASE.build.lacingPattern));

    // Wait for the calculation to happen automatically and populate the result fields.
    // We will wait until the "recommended" length field is not empty.
    const resultSelector = 'input#left_spoke_length_rec_front';
    await page.waitForFunction(
      (selector) => document.querySelector(selector).value !== '',
      {},
      resultSelector
    );
    console.log('AUDIT: Calculation results detected.');

    // Extract the results from the correct fields
    const officialLeft = await page.$eval(resultSelector, el => parseFloat(el.value));
    const officialRight = await page.$eval('input#right_spoke_length_rec_front', el => parseFloat(el.value));

    if (isNaN(officialLeft) || isNaN(officialRight)) {
        throw new Error('Could not parse official lengths from result fields.');
    }
    
    console.log(`AUDIT: Official Berd result -> Left: ${officialLeft}, Right: ${officialRight}`);
    return { left: officialLeft, right: officialRight };

  } catch (error) {
    console.error('AUDIT CRITICAL: Failed to scrape Berd calculator.', error);
    await sendAlertEmail({
        subject: 'CRITICAL ALERT: LoamLabs Berd Scraper FAILED',
        html: `
            <h1>Berd Scraper Failure</h1>
            <p>The automated audit system could not complete its check because the web scraper failed. This could be due to:</p>
            <ul>
                <li>The Berd Calculator website is down.</li>
                <li>The website's HTML structure (CSS selectors) has changed.</li>
            </ul>
            <p><strong>Action Required:</strong> Please manually check the Berd Calculator and update the selectors in <code>api/index.js</code> if necessary.</p>
            <p>Error Message: ${error.message}</p>
        `,
    });
    return null;
  } finally {
    if (browser) await browser.close();
  }
}

/**
 * --- NEW ---
 * Calculates the Berd-specific correction factors and returns the final length.
 * @returns {number} The final Berd length (pre-rounding).
 */
function calculateBerdFinalLength(metalLength, hubType, isLeft, { flangeL, flangeR, metalLengthL, metalLengthR }) {
    let hubConstant = 0.0;
    switch(hubType) {
        case 'Classic Flange': hubConstant = 9.0; break;
        case 'Straight Pull':  hubConstant = 7.5; break;
        case 'Hook Flange':    hubConstant = 2.0; break;
    }

    const angleLeft = flangeL / metalLengthL;
    const angleRight = flangeR / metalLengthR;
    let tensionPercent = (angleLeft < angleRight) ? (isLeft ? 100 : (angleLeft / angleRight * 100)) : (isLeft ? (angleRight / angleLeft * 100) : 100);
    
    const L = 2.5;
    const tensionComp = 0.000444 * Math.pow(tensionPercent, 2) - 0.1231 * tensionPercent + L;
    
    let lengthAdder = 0.0;
    if (metalLength < 200.0) lengthAdder = 4.0;
    else if (metalLength < 220.0) lengthAdder = 3.0;
    else if (metalLength < 240.0) lengthAdder = 2.0;
    else if (metalLength < 260.0) lengthAdder = 1.0;

    return metalLength + hubConstant + tensionComp + lengthAdder;
}

/**
 * --- NEW ---
 * Runs the internal Berd calculation logic with the golden test case data.
 * @returns {{left: number, right: number}} The calculated spoke lengths from our internal logic.
 */
function runInternalBerdComparison() {
    console.log('AUDIT: Running internal calculation for comparison...');
    const { hub, rim, build } = AUDIT_TEST_CASE;

    // For the audit, we assume an external nipple build, which adds washer thickness to the ERD.
    const finalErd = rim.erd + (2 * rim.nippleWasherThickness);
    
    // Calculate base metal lengths
    const metalLengthL = calculateSpokeLength({ isLeft: true, hubType: hub.hubType, baseCrossPattern: build.lacingPattern, spokeCount: build.spokeCount, finalErd, hubFlangeDiameter: hub.flangeDiameterLeft, flangeOffset: hub.flangeOffsetLeft, spOffset: hub.spOffsetLeft, hubSpokeHoleDiameter: hub.spokeHoleDiameter });
    const metalLengthR = calculateSpokeLength({ isLeft: false, hubType: hub.hubType, baseCrossPattern: build.lacingPattern, spokeCount: build.spokeCount, finalErd, hubFlangeDiameter: hub.flangeDiameterRight, flangeOffset: hub.flangeOffsetRight, spOffset: hub.spOffsetRight, hubSpokeHoleDiameter: hub.spokeHoleDiameter });

    const berdContext = { flangeL: hub.flangeOffsetLeft, flangeR: hub.flangeOffsetRight, metalLengthL, metalLengthR };
    
    const finalBerdLengthL = calculateBerdFinalLength(metalLengthL, hub.hubType, true, berdContext);
    const finalBerdLengthR = calculateBerdFinalLength(metalLengthR, hub.hubType, false, berdContext);
    
    const internalLeft = applyRounding(finalBerdLengthL, 'Berd');
    const internalRight = applyRounding(finalBerdLengthR, 'Berd');
    
    console.log(`AUDIT: Internal result -> Left: ${internalLeft}, Right: ${internalRight}`);
    return { left: internalLeft, right: internalRight };
}

/**
 * --- NEW ---
 * Main orchestrator for the Berd audit.
 */
async function runBerdAudit() {
  console.log('AUDIT: Starting Berd logic audit.');
  const officialResult = await scrapeBerdOfficialCalculator();
  if (!officialResult) {
    console.log('AUDIT: Halting audit due to scraper failure.');
    return;
  }

  const internalResult = runInternalBerdComparison();

  const isMatch = officialResult.left === internalResult.left && officialResult.right === internalResult.right;

  if (isMatch) {
    console.log('AUDIT: SUCCESS - Internal logic matches official Berd calculator.');
  } else {
    console.log('AUDIT: MISMATCH DETECTED - Sending alert email.');
    await sendAlertEmail({
        subject: 'ACTION REQUIRED: LoamLabs Berd Logic Mismatch Detected',
        html: `
            <h1>Berd Calculation Logic Mismatch</h1>
            <p>The automated audit has detected a difference between our internal calculation and the official Berd Spoke Calculator. This suggests the official formula may have changed.</p>
            <p><strong>Manual review is required to prevent incorrect spoke orders.</strong></p>
            <hr>
            <h2>Audit Details</h2>
            <h3>Test Case Inputs:</h3>
            <pre>${JSON.stringify(AUDIT_TEST_CASE, null, 2)}</pre>
            <h3>Results:</h3>
            <ul>
                <li><strong>Official Calculator Result:</strong> Left: ${officialResult.left} mm, Right: ${officialResult.right} mm</li>
                <li><strong>Our Internal Result:</strong> Left: ${internalResult.left} mm, Right: ${internalResult.right} mm</li>
            </ul>
            <hr>
            <p><strong>Action Required:</strong> Please investigate the official Berd calculator, update the formula in <code>api/index.js</code>, and re-validate.</p>
        `,
    });
  }
}

// =================================================================
// END: BERD AUTOMATED AUDIT SYSTEM
// =================================================================


// --- Helper Functions (Defined Once) ---

/**
 * --- NEW / REFACTORED ---
 * Applies the correct rounding rule based on the spoke vendor.
 * @param {number} length - The raw calculated length.
 * @param {string} vendor - The vendor of the spoke (e.g., 'Berd' or another brand).
 * @returns {number} The final, orderable length.
 */
function applyRounding(length, vendor) {
    if (vendor === 'Berd') {
        // Berd Puller Method: round to nearest whole, then subtract 2.
        return Math.round(length) - 2;
    }
    // Steel Spoke Method: round up to the nearest even number.
    return Math.ceil(length / 2) * 2;
}

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
    const url = `https://${storeDomain}/admin/api/2024-07/graphql.json`;
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
    const { isLeft, hubType, baseCrossPattern, spokeCount, finalErd, hubFlangeDiameter, flangeOffset, spOffset, hubSpokeHoleDiameter } = params;
    let effectiveCrossPattern = baseCrossPattern;
    if (hubType === 'Straight Pull' && baseCrossPattern > 0) {
        effectiveCrossPattern += 0.5;
    }
    const angle = (2 * Math.PI * effectiveCrossPattern) / (spokeCount / 2);
    const finalZOffset = flangeOffset; // Asymmetry is handled in the finalErd
    const term1 = Math.pow(finalZOffset, 2);
    const term2 = Math.pow(hubFlangeDiameter / 2, 2);
    const term3 = Math.pow(finalErd / 2, 2);
    const term4 = 2 * (hubFlangeDiameter / 2) * (finalErd / 2) * Math.cos(angle);
    const geometricLength = Math.sqrt(term1 + term2 + term3 - term4);

    let finalLength;
    if (hubType === 'Classic Flange' || hubType === 'Hook Flange') {
        finalLength = geometricLength - (hubSpokeHoleDiameter / 2);
    } else { // Straight Pull
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
                // This is the missing piece: a reference to the order that caused the change.
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
    console.log("Fetching primary location ID as a fallback...");
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
        console.error("🚨 Failed to fetch primary location ID:", error);
        return null;
    }
}

async function handleOrderCreate(orderData) {
    let locationId = orderData.location_id;
    if (!locationId) {
        console.warn("Order data did not contain a top-level location_id. Fetching primary store location as a fallback.");
        locationId = await getPrimaryLocationId();
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

        // --- NEW: Smart Color Logic for Inventory ---
        let inventoryColor = selectedColor; // Start with the selected color
        if (spokeComponent.vendor === 'Berd' && selectedColor !== 'Black Berd' && selectedColor !== 'White Berd') {
            console.log(`Custom BERD color "${selectedColor}" detected. Deducting from "White Berd" inventory.`);
            inventoryColor = 'White Berd'; // Override to deduct from White stock
        }
        // --- End of New Logic ---

        const roundedL = wheel.lengths.left.rounded;
        const variantL = await findVariantForLengthAndColor(spokeProductId, roundedL, inventoryColor);
        let statusL = "ACTION REQUIRED: Variant not found!";
        if (variantL) {
            const success = await adjustInventory(variantL.inventoryItemId, -spokeCountPerSide, `gid://shopify/Location/${locationId}`);
            statusL = success ? "Adjusted" : "FAILED to adjust";
        }

        const roundedR = wheel.lengths.right.rounded;
        const variantR = await findVariantForLengthAndColor(spokeProductId, roundedR, inventoryColor);
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
                await sendEmailReport(buildReport, orderData, buildRecipe);
            }
        }
    } else {
        console.log('ℹ️ No custom wheel build found in this order.');
    }
}

async function handleOrderCancelled(orderData) {
    // The unreliable 'if (!orderData.restock)' check has been removed.

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

    // THIS IS THE NEW, CORRECTED LOOP
    for (const position of ['front', 'rear']) {
        const spokeComponent = buildRecipe.components[`${position}Spokes`];
        if (!spokeComponent) continue; // Skip if no spokes for this position

        const colorOption = spokeComponent.selectedOptions.find(opt => opt.name === 'Color');
        const selectedColor = colorOption ? colorOption.value : null;

        if (!selectedColor) {
            restockNote += `- ${position.toUpperCase()}: SKIPPED (Could not determine original color)\n`;
            continue;
        }

        // --- NEW: Smart Color Logic for Restocking ---
        let inventoryColor = selectedColor; // Start with the selected color
        if (spokeComponent.vendor === 'Berd' && selectedColor !== 'Black Berd' && selectedColor !== 'White Berd') {
            inventoryColor = 'White Berd'; // If it was a custom color, restock the 'White Berd' variant
        }
        // --- End of New Logic ---

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

        const hubType = getMeta(hub.variantId, hub.productId, 'hub_type');

        if (spokes.vendor === 'Berd') {
            // --- MODIFIED --- Berd-specific logic now uses the new helper functions
            const nippleType = "External"; // Hardcoded for now
            let finalErd;
            if (nippleType === 'Internal') {
                finalErd = getMeta(rim.variantId, rim.productId, 'rim_erd', true) + 17.0;
            } else {
                finalErd = getMeta(rim.variantId, rim.productId, 'rim_erd', true) + (2 * getMeta(rim.variantId, rim.productId, 'rim_nipple_washer_thickness_mm', true));
            }

            const defaultCross = (spokeCount >= 28) ? 3 : 2;
            const crossL = parseInt(getMeta(hub.variantId, hub.productId, 'hub_manual_cross_value', true) || defaultCross);
            const crossR = parseInt(getMeta(hub.variantId, hub.productId, 'hub_manual_cross_value', true) || defaultCross);
            
            const metalLengthL = calculateSpokeLength({ isLeft: true, hubType, baseCrossPattern: crossL, spokeCount, finalErd, hubFlangeDiameter: getMeta(hub.variantId, hub.productId, 'hub_flange_diameter_left', true), flangeOffset: getMeta(hub.variantId, hub.productId, 'hub_flange_offset_left', true), spOffset: getMeta(hub.variantId, hub.productId, 'hub_sp_offset_spoke_hole_left', true), hubSpokeHoleDiameter: getMeta(hub.variantId, hub.productId, 'hub_spoke_hole_diameter', true) });
            const metalLengthR = calculateSpokeLength({ isLeft: false, hubType, baseCrossPattern: crossR, spokeCount, finalErd, hubFlangeDiameter: getMeta(hub.variantId, hub.productId, 'hub_flange_diameter_right', true), flangeOffset: getMeta(hub.variantId, hub.productId, 'hub_flange_offset_right', true), spOffset: getMeta(hub.variantId, hub.productId, 'hub_sp_offset_spoke_hole_right', true), hubSpokeHoleDiameter: getMeta(hub.variantId, hub.productId, 'hub_spoke_hole_diameter', true) });

            const berdContext = {
                flangeL: getMeta(hub.variantId, hub.productId, 'hub_flange_offset_left', true),
                flangeR: getMeta(hub.variantId, hub.productId, 'hub_flange_offset_right', true),
                metalLengthL,
                metalLengthR
            };

            const finalBerdLengthL = calculateBerdFinalLength(metalLengthL, hubType, true, berdContext);
            const finalBerdLengthR = calculateBerdFinalLength(metalLengthR, hubType, false, berdContext);
            
            return {
                calculationSuccessful: true,
                crossPattern: { left: crossL, right: crossR },
                alert: "BERD calculation applied.",
                lengths: {
                    left: { geo: finalBerdLengthL.toFixed(2), rounded: applyRounding(finalBerdLengthL, 'Berd') },
                    right: { geo: finalBerdLengthR.toFixed(2), rounded: applyRounding(finalBerdLengthR, 'Berd') }
                },
                inputs: { rim: rim.title, hub: hub.title, spokes: spokes.title, finalErd: finalErd.toFixed(2), targetTension: getMeta(rim.variantId, rim.productId, 'rim_target_tension_kgf', true, 120) }
            };

        } else {
            // Steel spoke logic
            if (hubType === 'Hook Flange') { return { calculationSuccessful: false, error: `Unsupported type (Hook Flange).` }; }
            
            let erd = getMeta(rim.variantId, rim.productId, 'rim_erd', true); 
            let finalErd = erd;
            if (getMeta(rim.variantId, rim.productId, 'rim_washer_policy') !== 'Not Compatible') {
                finalErd += (2 * getMeta(rim.variantId, rim.productId, 'rim_nipple_washer_thickness_mm', true));
            }
        
        const hubLacingPolicy = getMeta(hub.variantId, hub.productId, 'hub_lacing_policy');
            const hubManualCrossValue = getMeta(hub.variantId, hub.productId, 'hub_manual_cross_value', true);
            let initialCrossPattern = (hubLacingPolicy === 'Use Manual Override Field' && hubManualCrossValue > 0) ? hubManualCrossValue : ((spokeCount >= 28) ? 3 : 2);
            let finalCrossPattern = initialCrossPattern;
            let fallbackAlert = null;
            while (!isLacingPossible(spokeCount, finalCrossPattern) && finalCrossPattern > 0) {
                fallbackAlert = `Interference for ${initialCrossPattern}-cross...Fell back to ${finalCrossPattern - 1}-cross.`;
                finalCrossPattern--;
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
                    // --- MODIFIED --- Steel spoke logic now uses the new rounding helper
                    left: { geo: lengthL.toFixed(2), stretch: calculateElongation(lengthL, tensionKgf, crossArea).toFixed(2), rounded: applyRounding(lengthL, 'Steel') },
                    right: { geo: lengthR.toFixed(2), stretch: calculateElongation(lengthR, tensionKgf, crossArea).toFixed(2), rounded: applyRounding(lengthR, 'Steel') }
                },
                inputs: { rim: rim.title, hub: hub.title, spokes: spokes.title, finalErd: finalErd.toFixed(2), targetTension: tensionKgf }
            };
        }
    };
    
    try {
        results.front = calculateForPosition('front');
        if (buildRecipe.buildType === 'Wheel Set') { results.rear = calculateForPosition('rear'); }
    } catch (e) {
        results.errors.push(e.message);
    }
    return results;
}

function formatNote(report) {
    let note = "AUTOMATED SPOKE CALCULATION & INVENTORY\n---------------------------------------\n";
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
        
        wheelNote += `  Rim: ${wheel.inputs.rim}\n` +
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

    return `
        <div class="wheel-section">
            <h3>${position.toUpperCase()} WHEEL DETAILS</h3>
            
            <h4>Lacing Decision</h4>
            <p>Final pattern used: <strong>${crossText}</strong>.</p>
            ${wheel.alert ? `<p class="alert"><strong>NOTE:</strong> ${wheel.alert}</p>` : (wheel.inputs.spokes.includes("Berd") ? '' : '<p>The default lacing pattern passed the interference check.</p>')}

            <h4>Key Inputs</h4>
            <table class="data-table">
                <tr><td>Rim</td><td>${wheel.inputs.rim}</td></tr>
                <tr><td>Hub</td><td>${wheel.inputs.hub}</td></tr>
                <tr><td>Spokes</td><td>${wheel.inputs.spokes}</td></tr>
                <tr><td>Final Adjusted ERD</td><td><strong>${wheel.inputs.finalErd} mm</strong></td></tr>
                <tr><td>Target Tension</td><td>${wheel.inputs.targetTension} kgf</td></tr>
            </table>

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
  const { source } = req.query;
  const authHeader = req.headers['authorization'];

  if (source === 'cron-berd-audit') {
    if (authHeader !== `Bearer ${CRON_SECRET}`) {
      console.warn('AUDIT: Received cron request with invalid or missing secret.');
      return res.status(401).send('Unauthorized');
    }
    
    await runBerdAudit(); 
    return res.status(200).send('Berd audit completed successfully.');
  }
  // --- END of block ---

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

    // Route the request based on the event type
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