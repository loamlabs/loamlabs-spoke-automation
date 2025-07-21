import { createHmac } from 'crypto';

export const config = {
  api: {
    bodyParser: false,
  },
};

async function getRawBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

// --- NEW HELPER FUNCTION TO FETCH SHOPIFY DATA ---
async function fetchComponentData(buildRecipe) {
  const storeDomain = process.env.SHOPIFY_STORE_DOMAIN;
  const apiToken = process.env.SHOPIFY_ADMIN_API_TOKEN;
  const graphqlUrl = `https://${storeDomain}/admin/api/2023-07/graphql.json`;

  // 1. Collect all the unique Variant and Product GIDs from the recipe.
  const componentIds = new Set();
  Object.values(buildRecipe.components).forEach(comp => {
    if (comp && comp.variantId && comp.productId) {
      componentIds.add(comp.variantId);
      componentIds.add(comp.productId);
    }
  });

  if (componentIds.size === 0) {
    console.log('No component IDs found in recipe to fetch.');
    return null;
  }
  
  const ids = Array.from(componentIds);
  console.log(`Fetching metafields for ${ids.length} nodes...`);

  // 2. Define the GraphQL query to get all metafields for the components.
  const query = `
    query getComponentMetafields($ids: [ID!]!) {
      nodes(ids: $ids) {
        id
        ... on ProductVariant {
          # Get metafields directly on the variant
          metafields(first: 50) {
            nodes { key namespace value }
          }
        }
        ... on Product {
          # Get metafields on the parent product
          metafields(first: 50) {
            nodes { key namespace value }
          }
        }
      }
    }
  `;

  // 3. Make the API call to Shopify.
  try {
    const response = await fetch(graphqlUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': apiToken,
      },
      body: JSON.stringify({
        query: query,
        variables: { ids: ids },
      }),
    });

    if (!response.ok) {
      throw new Error(`Shopify API request failed: ${response.statusText}`);
    }

    const jsonResponse = await response.json();
    if (jsonResponse.errors) {
      throw new Error(`GraphQL Errors: ${JSON.stringify(jsonResponse.errors)}`);
    }

    // 4. Organize the fetched data into an easy-to-use map.
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

// --- MAIN HANDLER FUNCTION (UPDATED) ---
export default async function handler(req, res) {
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
        console.log('✅ Custom wheel build line item found.');
        const buildProperty = wheelBuildLineItem.properties.find(prop => prop.name === '_build');

        if (buildProperty && buildProperty.value) {
          const buildRecipe = JSON.parse(buildProperty.value);
          console.log('✅ Successfully extracted and parsed build recipe.');

          // --- CALL THE NEW FUNCTION ---
          const componentData = await fetchComponentData(buildRecipe);

          if (componentData) {
            console.log('✅ Successfully fetched component metafield data from Shopify!');
            // Log the Map object to see the result. Vercel logs might show this as {}.
            // We'll use a little trick to make it readable.
            console.log(JSON.stringify(Object.fromEntries(componentData), null, 2));
          } else {
            console.error('🚨 Failed to fetch component metafield data.');
          }

        } else {
          console.error('🚨 "_build" property is missing!');
        }
      } else {
        console.log('ℹ️ No custom wheel build found in this order.');
      }
      
      res.status(200).json({ message: 'Webhook processed.' });

    } else {
      console.error('🚨 Verification failed: HMAC mismatch.');
      return res.status(401).send('Could not verify webhook.');
    }
  } catch (error) {
    console.error('An error occurred in the webhook handler:', error);
    res.status(500).send('Internal Server Error.');
  }
}
