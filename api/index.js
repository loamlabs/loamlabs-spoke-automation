import { createHmac } from 'crypto';

// This special "config" export tells Vercel to not parse the request body.
// We need the raw, unparsed body to be able to verify the Shopify webhook signature.
export const config = {
  api: {
    bodyParser: false,
  },
};

// A helper function to read the raw request body from the stream.
async function getRawBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

// This is our main function that Vercel runs.
export default async function handler(req, res) {
  // We only process POST requests.
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).end('Method Not Allowed');
  }

  console.log('Webhook received. Starting verification...');

  try {
    // 1. Read the raw body and the Shopify signature from the headers.
    const rawBody = await getRawBody(req);
    const hmacHeader = req.headers['x-shopify-hmac-sha256'];
    
    // 2. Get our secret key from Vercel's environment variables.
    const secret = process.env.SHOPIFY_WEBHOOK_SECRET;

    // 3. If either of these are missing, we can't verify.
    if (!hmacHeader || !secret) {
        console.error('Verification failed: Missing HMAC header or secret key.');
        return res.status(401).send('Could not verify webhook.');
    }

    // 4. Create a hash using our secret key and the raw body.
    const hash = createHmac('sha256', secret)
      .update(rawBody)
      .digest('base64');

    // 5. Compare our generated hash with the one Shopify sent.
    if (hash === hmacHeader) {
      console.log('✅ Verification successful! Webhook is from Shopify.');
      
      // Now that we've verified, we can safely parse the body as JSON.
      const orderData = JSON.parse(rawBody.toString());
      
      // --- YOUR SPOKE CALCULATION LOGIC WILL GO HERE ---
      console.log('Order Topic:', req.headers['x-shopify-topic']);
      console.log('Order ID:', orderData.id);
      // --------------------------------------------------

      // Send a success response back to Shopify.
      res.status(200).json({ message: 'Webhook processed successfully.' });

    } else {
      console.error('🚨 Verification failed: HMAC mismatch.');
      // The hashes don't match, this request is not from Shopify.
      return res.status(401).send('Could not verify webhook.');
    }
  } catch (error) {
    console.error('An error occurred in the webhook handler:', error);
    res.status(500).send('Internal Server Error.');
  }
}
