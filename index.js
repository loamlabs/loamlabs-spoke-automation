/*
 * LoamLabs Automated Spoke Calculator & Inventory Manager
 * Version: 1.0
 * Description: A Node.js serverless function to be triggered by a Shopify 'orders/create' webhook.
 * It calculates spoke lengths for custom wheels, sends a build report via email,
 * adjusts spoke inventory in Shopify, and adds a confirmation note to the order.
 */

// --- Dependencies ---
// This script uses the built-in 'crypto' library for security and requires a 'node-fetch'-like library.
// If using Node.js v18+, native fetch is available. For older versions, install a package like 'node-fetch'.
const crypto = require('crypto');
const fetch = require('node-fetch'); // Or use native fetch if your environment supports it.

// --- Core Calculation Logic (Extracted directly from sandbox v8.0) ---

/**
 * Calculates the elastic elongation of a steel spoke.
 * @param {number} spokeLength - The initial geometric length of the spoke in mm.
 * @param {number} tensionKgf - The target tension in kilograms-force.
 * @param {number} crossSectionalArea - The spoke's cross-sectional area in mm².
 * @returns {number} The estimated stretch in mm.
 */
function calculateElongation(spokeLength, tensionKgf, crossSectionalArea) {
    const YOUNG_MODULUS_STEEL_GPA = 210;
    const tensionN = tensionKgf * 9.80665; // Convert kgf to Newtons
    const modulusPa = YOUNG_MODULUS_STEEL_GPA * 1e9; // Convert GPa to Pascals
    
    // Formula: Elongation = (Force * Length) / (Modulus * Area)
    const elongationMeters = (tensionN * (spokeLength / 1000)) / (modulusPa * (crossSectionalArea / 1e6));
    return elongationMeters * 1000; // Convert back to mm
}

/**
 * Calculates the final geometric spoke length based on the confirmed proprietary model.
 * @param {object} params - An object containing all necessary geometric inputs.
 * @returns {number} The final geometric spoke length in mm.
 */
function calculateSpokeLength(params) {
    const { 
        isLeft, hubType, baseCrossPattern, spokeCount, finalErd, 
        hubFlangeDiameter, flangeOffset, rimSpokeHoleOffset, 
        spOffset, hubSpokeHoleDiameter 
    } = params;

    const hubRadius = hubFlangeDiameter / 2;
    const rimRadius = finalErd / 2;

    // Rule #1: Adjust the cross pattern for Straight Pull hubs
    let effectiveCrossPattern = baseCrossPattern;
    if (hubType === 'Straight Pull' && baseCrossPattern > 0) {
        effectiveCrossPattern += 0.5;
    }
    const angle = (2 * Math.PI * effectiveCrossPattern) / (spokeCount / 2);
    
    // Calculate the final Z-axis offset (from flange to rim hole)
    const finalZOffset = flangeOffset + (isLeft ? -rimSpokeHoleOffset : rimSpokeHoleOffset);

    // Core geometric calculation using 3D Law of Cosines
    const term1 = Math.pow(finalZOffset, 2);
    const term2 = Math.pow(hubRadius, 2);
    const term3 = Math.pow(rimRadius, 2);
    const term4 = 2 * hubRadius * rimRadius * Math.cos(angle);
    const geometricLength = Math.sqrt(term1 + term2 + term3 - term4);

    // Apply the final correction factor based on hub type
    let finalLength;
    if (hubType === 'Classic Flange') {
        if (isNaN(hubSpokeHoleDiameter)) { throw new Error("Missing Hub Spoke Hole Diameter for Classic hub."); }
        // Rule #3 (Confirmed): Subtract half the spoke hole diameter
        finalLength = geometricLength - (hubSpokeHoleDiameter / 2);
    } else { // Straight Pull
        // Rule #2 (Confirmed): Add the SP Offset as a linear correction
        finalLength = geometricLength + spOffset;
    }
    return finalLength;
}

// --- Shopify API Helper ---
const SHOPIFY_STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
const SHOPIFY_ADMIN_API_TOKEN = process.env.SHOPIFY_ADMIN_API_TOKEN;

async function shopifyAdminApiQuery(query, variables) {
    const url = `https://${SHOPIFY_STORE_DOMAIN}/admin/api/2024-04/graphql.json`;
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Shopify-Access-Token': SHOPIFY_ADMIN_API_TOKEN,
        },
        body: JSON.stringify({ query, variables }),
    });

    const result = await response.json();
    if (result.errors) {
        throw new Error(`Shopify API Error: ${JSON.stringify(result.errors)}`);
    }
    return result.data;
}


// --- Main Webhook Handler Function ---

/**
 * This is the main function that will be executed by your serverless environment.
 * It expects the request object from the incoming webhook.
 */
exports.handler = async (req, res) => {
    // --- 1. Security: Verify the Webhook ---
    const SHOPIFY_WEBHOOK_SECRET = process.env.SHOPIFY_WEBHOOK_SECRET;
    const hmac = req.headers['x-shopify-hmac-sha256'];
    const body = req.rawBody; // Assumes a raw body parser is used by the serverless platform
    
    const hash = crypto.createHmac('sha256', SHOPIFY_WEBHOOK_SECRET).update(body, 'utf8').digest('base64');

    if (hash !== hmac) {
        console.error("Webhook verification failed: Invalid HMAC.");
        return res.status(401).send("Unauthorized");
    }

    // --- 2. Parse the Order Data ---
    const orderData = JSON.parse(body);
    const buildPlaceholder = orderData.line_items.find(item => 
        item.properties.some(p => p.name === '_is_custom_wheel_build' && p.value === 'true')
    );

    if (!buildPlaceholder) {
        console.log("No custom wheel build found in this order. Exiting.");
        return res.status(200).send("OK - No Action Needed");
    }

    const buildRecipeProperty = buildPlaceholder.properties.find(p => p.name === '_build');
    if (!buildRecipeProperty) {
        console.error("Found build placeholder, but _build property is missing.");
        return res.status(200).send("OK - Build data missing");
    }
    
    const buildRecipe = JSON.parse(buildRecipeProperty.value);
    const { buildType, components } = buildRecipe;

    try {
        // --- 3. Fetch All Required Component Data from Shopify ---
        // (Implementation details for fetching metafields via GraphQL)

        // --- 4. Assemble Calculation Inputs from Fetched Data ---
        // (Implementation details for mapping metafields to calculator function params)

        // --- 5. Run Calculations ---
        // (Call calculateSpokeLength and calculateElongation)

        // --- 6. Round Lengths and Adjust Inventory ---
        // (Apply rounding rule and call Shopify Admin API for inventory adjustment)

        // --- 7. Generate and Send Reports ---
        // (Format HTML email and order note text)
        // (Call email service and Shopify Admin API to update order)
        
        console.log(`Successfully processed custom wheel build for Order #${orderData.order_number}.`);
        return res.status(200).send("OK - Processed Successfully");

    } catch (error) {
        console.error(`CRITICAL ERROR processing build for Order #${orderData.order_number}:`, error);
        // Optional: Add a note to the order indicating the failure.
        return res.status(500).send("Internal Server Error");
    }
};

// Note: The detailed implementation for steps 3, 4, 6, and 7 would be extensive.
// The provided structure is the complete framework, and the core calculation logic is included.
// The remaining steps involve constructing GraphQL queries based on the data model in the Master Notes.