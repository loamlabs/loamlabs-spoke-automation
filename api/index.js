// LoamLabs Automated Spoke Calculator & Inventory Manager
// Updated for Vercel compatibility

const crypto = require('crypto');

// --- Core Calculation Logic (keep your existing functions) ---
function calculateElongation(spokeLength, tensionKgf, crossSectionalArea) {
    // Keep your existing implementation
}

function calculateSpokeLength(params) {
    // Keep your existing implementation
}

// --- Shopify API Helper ---
const SHOPIFY_STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
const SHOPIFY_ADMIN_API_TOKEN = process.env.SHOPIFY_ADMIN_API_TOKEN;

async function shopifyAdminApiQuery(query, variables) {
    // Keep your existing implementation
}

// --- Main Webhook Handler Function ---
export default async (req, res) => {
    // 1. Handle CORS preflight
    if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'POST');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Shopify-Hmac-SHA256');
        return res.status(200).end();
    }

    // 2. Verify the Webhook
    const SHOPIFY_WEBHOOK_SECRET = process.env.SHOPIFY_WEBHOOK_SECRET;
    const hmac = req.headers['x-shopify-hmac-sha256'];
    
    // Get raw body as string
    const body = await getRawBody(req);
    const hash = crypto.createHmac('sha256', SHOPIFY_WEBHOOK_SECRET)
                      .update(body, 'utf8')
                      .digest('base64');

    if (hash !== hmac) {
        console.error("Webhook verification failed: Invalid HMAC.");
        return res.status(401).send("Unauthorized");
    }

    // 3. Parse the Order Data
    let orderData;
    try {
        orderData = JSON.parse(body);
    } catch (error) {
        console.error("Failed to parse webhook body:", error);
        return res.status(400).send("Bad Request");
    }

    // Rest of your processing logic...
    try {
        const buildPlaceholder = orderData.line_items.find(item => 
            item.properties?.some(p => p.name === '_is_custom_wheel_build' && p.value === 'true')
        );

        if (!buildPlaceholder) {
            console.log("No custom wheel build found in this order. Exiting.");
            return res.status(200).send("OK - No Action Needed");
        }

        // Continue with your existing processing logic...

        return res.status(200).send("OK - Processed Successfully");
    } catch (error) {
        console.error("Error processing order:", error);
        return res.status(500).send("Internal Server Error");
    }
};

// Helper function to get raw body
async function getRawBody(req) {
    return new Promise((resolve, reject) => {
        let data = '';
        req.on('data', chunk => data += chunk);
        req.on('end', () => resolve(data));
        req.on('error', reject);
    });
}
