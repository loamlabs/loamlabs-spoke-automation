// This is the required handler function that Vercel will run.
// 'req' is the incoming request from Shopify.
// 'res' is the response we will send back.
export default function handler(req, res) {
  // First, we check if the request method is POST. Shopify webhooks are always POST.
  if (req.method === 'POST') {
    // For now, we'll just log that we received the request body.
    // The actual order data from Shopify will be in 'req.body'.
    console.log('Webhook received! Body:', req.body);

    // It's crucial to send a success response back to Shopify.
    // If you don't, Shopify will think the webhook failed and will keep retrying.
    // A 200 status code means "OK".
    res.status(200).json({ message: "Webhook received successfully!" });
  } else {
    // If someone tries to access this URL with a different method (e.g., in a browser),
    // we'll send a 405 "Method Not Allowed" error.
    res.setHeader('Allow', 'POST');
    res.status(405).end('Method Not Allowed');
  }
}
