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
        console.error('Verification failed: Missing HMAC header or secret key.');
        return res.status(401).send('Could not verify webhook.');
    }

    const hash = createHmac('sha256', secret).update(rawBody).digest('base64');

    if (hash === hmacHeader) {
      console.log('✅ Verification successful! Webhook is from Shopify.');
      
      const orderData = JSON.parse(rawBody.toString());
      console.log(`Processing Order ID: ${orderData.id}`);

      // --- NEW LOGIC STARTS HERE ---

      // 1. Find the specific line item for the custom wheel build.
      // We loop through all line items in the order.
      const wheelBuildLineItem = orderData.line_items.find(item => 
        // Each item has a 'properties' array. We check if that array exists...
        item.properties && 
        // ...and then we search inside it for our specific identifier property.
        item.properties.some(prop => prop.name === '_is_custom_wheel_build' && prop.value === 'true')
      );

      // 2. Check if we found the wheel build line item.
      if (wheelBuildLineItem) {
        console.log('✅ Custom wheel build line item found.');

        // 3. Extract the '_build' property which contains the JSON recipe string.
        const buildProperty = wheelBuildLineItem.properties.find(prop => prop.name === '_build');

        if (buildProperty && buildProperty.value) {
          // 4. Parse the JSON string into a usable JavaScript object.
          const buildRecipe = JSON.parse(buildProperty.value);
          
          console.log('✅ Successfully extracted and parsed build recipe:');
          // We use JSON.stringify with formatting to make the log easy to read.
          console.log(JSON.stringify(buildRecipe, null, 2));

          // --- ALL FUTURE CALCULATION LOGIC WILL GO INSIDE THIS 'IF' BLOCK ---

        } else {
          console.error('🚨 Found wheel build item, but the vital "_build" property is missing!');
        }

      } else {
        console.log('ℹ️ No custom wheel build found in this order. Nothing to process.');
      }
      
      // --- END OF NEW LOGIC ---

      // Send a success response back to Shopify regardless of whether a build was found.
      // This prevents Shopify from resending webhooks for orders we don't need to process.
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
