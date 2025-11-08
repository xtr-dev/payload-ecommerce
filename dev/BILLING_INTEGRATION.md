# Billing Integration with @xtr-dev/payload-billing

This demo integrates the [@xtr-dev/payload-billing](https://github.com/xtr-dev/payload-billing) plugin to handle payment processing with a fully interactive test provider.

## Overview

The billing plugin adds three new collections to the Payload CMS:
- **Payments** - Transaction records with provider data and status
- **Invoices** - Generated invoices with line items and customer details
- **Refunds** - Refund tracking and management

## Configuration

The plugin is configured in `payload.config.ts` with the **test provider** for development:

```typescript
import { billingPlugin, testProvider } from '@xtr-dev/payload-billing'

billingPlugin({
  providers: [
    testProvider({
      enabled: true,
      testModeIndicators: {
        showWarningBanners: true,
        showTestBadges: true,
        consoleWarnings: true,
      },
      customUiRoute: '/test-payment',
    }),
  ],
  collections: {
    payments: 'payments',
    invoices: {
      slug: 'invoices',
      // Use extend to add custom fields and hooks to the invoice collection
      extend: (config) => ({
        ...config,
        fields: [
          ...(config.fields || []),
          // Add a custom field to track the associated order
          {
            name: 'order',
            type: 'relationship',
            relationTo: 'orders',
            admin: {
              description: 'Associated ecommerce order',
            },
          },
        ],
        hooks: {
          ...config.hooks,
          beforeChange: [
            ...(config.hooks?.beforeChange || []),
            // Hook to auto-populate invoice from order data if order is provided
            async ({ data, req, operation }) => {
              if (operation === 'create' && data.order) {
                try {
                  const order = await req.payload.findByID({
                    collection: 'orders',
                    id: typeof data.order === 'object' ? data.order.id : data.order,
                  })

                  // Auto-populate customer info from order if not provided
                  if (!data.customerInfo && order.billingAddress) {
                    data.customerInfo = {
                      name: `${order.billingAddress.firstName} ${order.billingAddress.lastName}`,
                      email: order.user?.email || '',
                      phone: order.billingAddress.phone || '',
                    }
                  }

                  // Auto-populate billing address from order if not provided
                  if (!data.billingAddress && order.billingAddress) {
                    data.billingAddress = {
                      line1: order.billingAddress.address1,
                      line2: order.billingAddress.address2,
                      city: order.billingAddress.city,
                      state: order.billingAddress.state,
                      postalCode: order.billingAddress.postalCode,
                      country: order.billingAddress.country,
                    }
                  }
                } catch (error) {
                  req.payload.logger.error('Failed to populate invoice from order:', error)
                }
              }
              return data
            },
          ],
        },
      }),
    },
    refunds: 'refunds',
  },
})
```

### Collection Extension

The configuration demonstrates the new **collection extension** feature from `@xtr-dev/payload-billing@0.1.13`:

- **Custom Fields**: Add an `order` relationship field to invoices to link them to ecommerce orders
- **Custom Hooks**: Automatically populate invoice customer info and billing address from the associated order
- **Hook Composition**: The `extend` function properly merges custom hooks with the plugin's built-in hooks

This pattern allows you to extend the billing plugin's collections with your own fields and logic without modifying the plugin code.

## How It Works

### 1. **Checkout Flow** (`dev/app/api/checkout/create-order/route.ts`)

When a customer places an order:

1. **Cart Validation** - Verify the cart exists and has items
2. **Order Creation** - Create the order first with pending payment status
3. **Payment Creation** - Create a payment record in the `payments` collection
   - Provider: `test`
   - Amount: Total in cents (e.g., 32800 = $328.00)
   - Status: `pending`
   - Metadata: Includes order ID, order number, and return URL
4. **Redirect** - User is redirected to the test payment page
5. **Payment Processing** - User selects payment outcome on test page
6. **Return** - User returns to order confirmation with updated payment status

### 2. **Test Provider Payment Flow**

The test provider provides an interactive payment simulation:

1. **Customer Checkout** - After filling out shipping/billing info
2. **Redirect to Test Page** - `/test-payment/{paymentId}` (configured via `customUiRoute`)
3. **Choose Payment Outcome** - User can select from built-in test scenarios:
   - ✅ **Instant Success** - Payment succeeds immediately
   - ⏱️ **Delayed Success** - Payment succeeds after a delay
   - 🚫 **Cancelled Payment** - User cancels the payment
   - ❌ **Declined Payment** - Payment is declined by the provider
   - ⏰ **Expired Payment** - Payment expires before completion
   - ⏳ **Pending Payment** - Payment remains in pending state
4. **Return to Store** - Redirects back to order confirmation
5. **Status Update** - Payment status is updated based on selection

### 3. **Test Provider API Endpoints**

The plugin automatically creates these endpoints:

- **GET** `/api/payload-billing/test/payment/:id` - Display payment page with scenarios
- **POST** `/api/payload-billing/test/process` - Process payment outcome selection

### 4. **Payment Information Display**

The order confirmation page (`dev/app/(storefront)/orders/[id]/confirmation/page.tsx`) shows:

- Payment Method (e.g., credit_card)
- Payment Status (pending, paid, failed)
- Provider (TEST, STRIPE, MOLLIE)
- Provider Status (pending, succeeded, failed, cancelled)
- Transaction ID (providerId)

## Test Provider Features

### Test Mode Indicators

Visual indicators to remind developers this is a test environment:
- **Warning Banners** - Display warning banners on payment pages
- **Test Badges** - Show "TEST MODE" badges
- **Console Warnings** - Log warnings to browser console

## Production Setup

For production, replace the test provider with a real payment provider:

### Stripe Integration

```bash
pnpm add stripe
```

```typescript
import { stripeProvider } from '@xtr-dev/payload-billing'

billingPlugin({
  providers: [
    stripeProvider({
      secretKey: process.env.STRIPE_SECRET_KEY,
      webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
    }),
  ],
})
```

### Mollie Integration

```bash
pnpm add @mollie/api-client
```

```typescript
import { mollieProvider } from '@xtr-dev/payload-billing'

billingPlugin({
  providers: [
    mollieProvider({
      apiKey: process.env.MOLLIE_API_KEY,
    }),
  ],
})
```

## Webhook Endpoints

The plugin automatically creates webhook handlers:

- `/api/payload-billing/stripe/webhook` - Stripe webhooks
- `/api/payload-billing/mollie/webhook` - Mollie webhooks
- `/api/payload-billing/test/process` - Test provider payment processing

Configure these URLs in your payment provider's dashboard.

## Collections

### Payments Collection

Fields:
- `provider` - Payment provider (stripe, mollie, test)
- `providerId` - Provider's transaction ID
- `status` - Payment status (pending, processing, succeeded, failed, canceled, refunded, partially_refunded)
- `amount` - Amount in cents
- `currency` - ISO 4217 currency code (USD, EUR, etc.)
- `description` - Payment description
- `metadata` - Additional data (order ID, return URL, etc.)
- `providerData` - Raw provider response

### Invoices Collection

The invoices collection can be used to generate formal invoices for orders. It includes:
- Customer information
- Line items with quantities and prices
- Tax calculations
- Due dates
- Payment status

### Refunds Collection

Track refunds for payments:
- Original payment reference
- Refund amount
- Refund status
- Provider refund ID

## Admin Panel

Access the Payload admin panel at `/admin` to:

1. View all payments and their statuses
2. Track payment history for orders
3. Manage refunds
4. Generate and view invoices
5. Monitor transaction data from providers

## Testing the Integration

To test the billing integration:

1. **Add items to cart** at `/products`
2. **Proceed to checkout** at `/checkout`
3. **Fill in shipping/billing information**
4. **Place order** - You'll be redirected to the test payment page
5. **Choose payment outcome** from available scenarios
6. **Complete payment** - You'll return to the confirmation page
7. **View payment details** on the order confirmation page
8. **Check admin panel** under "Payments" collection to see the payment record

## Environment Variables

### Development (Test Provider)

No environment variables required - works out of the box!

### Production Providers

```env
# Stripe
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...

# Mollie
MOLLIE_API_KEY=live_...

# Base URL for return URLs
NEXT_PUBLIC_SERVER_URL=https://yourdomain.com
```

## Integration Architecture

```
Checkout Page
    ↓
Create Order API
    ↓
Create Payment (status: pending)
    ↓
Redirect to Test Payment Page (/api/payload-billing/test/payment/:id)
    ↓
User Selects Outcome (success, failed, cancelled, pending)
    ↓
Process Payment (/api/payload-billing/test/process)
    ↓
Update Payment Status
    ↓
Redirect to Order Confirmation
    ↓
Display Payment Result
```

## Notes

- The test provider simulates realistic payment flows without external services
- Payment outcomes are determined by user selection on the test page
- All payment data is stored in the database for inspection
- In production, payment status updates happen via webhooks from real providers
- The plugin handles webhook signature verification automatically
- Test mode indicators help prevent confusion in development environments

## Troubleshooting

### Payment creation fails with "Provider test not found"

**Solution:** Restart the dev server to initialize the billing plugin:
```bash
pnpm dev
```

### Redirect doesn't work

**Solution:** Ensure `NEXT_PUBLIC_SERVER_URL` is set correctly for your environment.

### Payment status doesn't update

**Solution:** Check that the test provider's process endpoint is being called. Look for console logs or check the network tab in browser dev tools.
