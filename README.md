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
