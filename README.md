# LoamLabs Spoke Automation

Automated spoke length calculation and inventory management system for custom bicycle wheel orders.

## Overview

This serverless function automates the critical fulfillment step of calculating precise spoke lengths for custom wheel builds. Triggered by Shopify webhooks on order creation, it processes the geometric specifications of selected components, performs calculations using industry-standard formulas, and manages inventory deductions for spoke length variants.

## Key Features

- **Webhook-Driven Architecture**: Responds to `orders/create` and `orders/cancelled` Shopify events in real-time
- **Multi-Formula Support**: Implements distinct calculation logic for steel spokes and Berd polyethylene spokes
- **Intelligent Inventory Management**: Automatically deducts stock from the correct spoke length variant using Shopify GraphQL Admin API
- **Customer-Supplied Component Handling**: Detects when customers provide their own rims/hubs and skips calculations accordingly
- **Automated Restocking**: Reverses inventory adjustments on order cancellation by parsing original calculation notes
- **Shared Calculation Library**: Core geometric formulas centralized in `_lib/calculator.js` for consistency across multiple endpoints
- **Comprehensive Reporting**: Sends detailed HTML email reports via Resend with calculated lengths and rounding recommendations

## Technical Architecture

### Core Technologies
- **Runtime**: Node.js (Vercel Serverless Functions)
- **APIs**: Shopify Admin API (GraphQL for inventory, REST for metadata)
- **Email Service**: Resend
- **Webhook Security**: HMAC signature verification

### Project Structure
```
├── api/
│   ├── index.js              # Main webhook handler
│   └── test-calculator.js    # Internal testing endpoint
├── _lib/
│   └── calculator.js         # Shared calculation functions (single source of truth)
```

### Calculation Logic

The system supports two distinct spoke types:

**Steel Spokes**: Uses classical spoke length formula accounting for:
- Rim ERD (Effective Rim Diameter)
- Hub flange diameter and offset
- Cross pattern (radial, 1-cross, 2-cross, 3-cross, 4-cross)
- Spoke hole angle

**Berd Spokes**: Applies proprietary adjustment factors for polyethylene spoke properties including elongation characteristics and specialized nipple requirements.

All calculations are performed by functions in `_lib/calculator.js`, ensuring the production webhook and internal testing tools use identical logic.

## Workflow

1. **Order Placed**: Shopify `orders/create` webhook triggers function
2. **Data Parsing**: Extracts build specifications from order line item properties
3. **Component Validation**: Checks for customer-supplied components and skips if necessary
4. **Geometric Calculation**: Fetches component metafields (ERD, PCD, flange dimensions) and calculates precise spoke lengths
5. **Inventory Update**: Uses GraphQL `inventoryAdjustQuantities` mutation to deduct stock from correct length variants
6. **Notification**: Sends detailed email report and adds comprehensive note to Shopify order
7. **Cancellation Handling**: On `orders/cancelled` webhook, parses original note and reverses inventory adjustment

## Security

- Webhook requests verified via HMAC signature using `SHOPIFY_WEBHOOK_SECRET`
- Internal test endpoint protected by `INTERNAL_API_SECRET` header requirement
- CORS configuration restricts test endpoint access to authorized domains only

## Environment Variables

Required environment variables (configured in Vercel):
- `SHOPIFY_STORE_DOMAIN`
- `SHOPIFY_ADMIN_ACCESS_TOKEN`
- `SHOPIFY_WEBHOOK_SECRET`
- `RESEND_API_KEY`
- `INTERNAL_API_SECRET`

Optional:
- `SYSTEM_CUSTOMER_EMAIL` - **off by default.** **This one switch covers both Industry Nine System orders and Standard orders built in the Standard Studio** (the `_build` recipe carries `standardStudio`; there is no separate Standard switch). Both kinds always send the internal report to `BUILDER_EMAIL_ADDRESS`. A second email with the customer's spoke colors and wheel images goes to the order's customer (`order.email`, else `customer.email`) **only when this variable is exactly `on`**. Any other value, or the variable missing, sends nothing to customers (one log line says so). Never sent on `orders/cancelled`.
- `SHOPIFY_FETCH_TIMEOUT_MS` (default 8000) and `RESEND_FETCH_TIMEOUT_MS` (default 10000) - time limits for every outbound call in the webhook path (Shopify per attempt, Resend per send). A call that hangs fails like any other network error and the existing fallbacks run (images -> text-only -> SDK send); the internal email still goes out. Leave unset in production; they exist for tests.

## Function duration

`api/index.js` and `api/test-system-email.js` export `config.maxDuration = 30` (Vercel's Node.js `/api` config export, no `vercel.json`). With Fluid compute (on by default for new Vercel projects) the Hobby default and maximum are 300 s, so 30 s is a deliberate lower cap; an older project with Fluid compute off has a shorter Hobby default (about 10 s) and 30 s is still within its limit. Do not change the Vercel dashboard setting for this; the code value wins for these two functions.

**Answer first (round 8).** For `orders/create` the webhook is answered (200) as soon as the duplicate checks are done and, for Standard orders, the inventory is adjusted. The images, the order note and the emails then run after the answer through `waitUntil` from `@vercel/functions` (the function stays alive until they end, within `maxDuration`). Where `waitUntil` is not available the work is done first and the answer comes after it, as before. If the report work fails, a plain internal email with the order number and the raw line items is sent, and the log names the order. `orders/cancelled` is unchanged (restock, then answer).

## I9 System builds

System orders (`spokeInterface: "system"` in the `_build` recipe) skip the Length Variant deduction and restock logic completely. The order note carries the color tables and the spoke length line (`not calculated (method pending)` until `_lib/system-lengths.js` is implemented). The internal email adds three wheel images per multi-color wheel (high-tension side spokes only, low-tension side spokes only, all spokes). `api/test-system-email.js` (header `x-internal-secret`) sends the internal or, with `"customer": true`, the customer version of a sample to `BUILDER_EMAIL_ADDRESS` only. `npm test` runs the tests, `npm run proof:standard` proves Standard orders are unchanged.

## Testing

The project includes an internal testing harness accessible via secure API endpoint. This allows manual calculation verification without creating test orders in production.

## Future Enhancements

- Support for additional exotic spoke types (e.g., Sapim CX-Ray aerodynamic spokes)
- Predictive spoke tension calculations
- Integration with builder visualization tools

## License

MIT License - See LICENSE file for details

---

**Built with precision for LoamLabs custom wheel building operations.**
