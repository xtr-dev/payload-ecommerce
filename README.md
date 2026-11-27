# Payload eCommerce

> A complete eCommerce plugin for PayloadCMS 3.x

[![npm version](https://img.shields.io/npm/v/@xtr-dev/payload-ecommerce.svg)](https://www.npmjs.com/package/@xtr-dev/payload-ecommerce)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**v0.x** — minor versions may contain breaking changes until 1.0.

## Features

- 🛍️ **Products** - Variants, categories, inventory tracking, and SKUs
- 🛒 **Shopping Cart** - Session-based carts with automatic cleanup
- 📦 **Orders** - Complete order lifecycle with status tracking
- 🏷️ **Coupons** - Percentage, fixed amount, and free shipping discounts
- 📊 **Inventory** - Automatic stock deduction on purchase
- 💰 **Tax Calculation** - Configurable tax hook with support for tax services
- 🔧 **Utilities** - Server-side helpers for cart and order management

## Quick Start

### Installation

```bash
pnpm add @xtr-dev/payload-ecommerce
```

### Add to Payload Config

```typescript
import { payloadEcommerce } from '@xtr-dev/payload-ecommerce'

export default buildConfig({
  plugins: [
    payloadEcommerce({
      // Optional: customize collection slugs
      collections: {
        products: 'products',
        orders: 'orders',
        categories: 'categories',
        carts: 'carts',
        coupons: 'coupons',
      },
    }),
  ],
})
```

That's it! The plugin creates all collections automatically.

## Collections

### Products
- Title, slug, description, price, SKU
- Product variants (size, color, etc.) with individual inventory
- Categories (hierarchical)
- Inventory tracking with low-stock alerts
- Status: draft | active | archived

### Orders
- Order number, items, totals
- Shipping and billing addresses
- Payment tracking
- Status: pending | processing | shipped | delivered | cancelled | refunded

### Carts
- Session-based (no login required)
- Auto-calculated subtotals
- 30-day expiration

### Coupons
- Types: percentage | fixed | freeShipping
- Usage limits and date ranges
- Product/category restrictions

### Categories
- Hierarchical organization
- Auto-generated slugs

## Server-Side Usage

Use the `useEcommerce` helper for server-side operations:

```typescript
import { getPayload } from 'payload'
import { useEcommerce } from '@xtr-dev/payload-ecommerce'

const payload = await getPayload({ config })
const ecommerce = useEcommerce(payload)

// Add to cart
await ecommerce.cart.addToCart({
  sessionId: 'session-123',
  productId: 'product-id',
  quantity: 2,
  variant: 'SIZE-M', // optional
})

// Create order from cart
const order = await ecommerce.orders.createOrderFromCart({
  cartId: 'cart-id',
  orderData: {
    shippingAddress: { /* ... */ },
    billingAddress: { /* ... */ },
    paymentMethod: 'credit_card',
    shipping: 5,
    couponCode: 'SAVE10', // optional; validated and applied by the plugin
  },
})

// Preview a coupon (see "Coupons" below)
const result = await ecommerce.coupons.validateCoupon({
  code: 'SAVE10',
  cartTotal: 100,
  productIds: ['product-1', 'product-2'],
})
```

Document ids are strings on MongoDB and numbers on SQLite and Postgres; every helper accepts both. A relationship field holds either a bare id or the populated document, depending on `depth`. Use the exported `getRelationshipId` to read the id in both cases:

```typescript
import { getRelationshipId } from '@xtr-dev/payload-ecommerce'

const productIds = cart.items.map((item) => getRelationshipId(item.product))
```

## Example Implementation

Check the `/dev` directory for a complete Next.js storefront example with:
- Product browsing and search
- Shopping cart
- Checkout flow
- Order management
- Payment integration (via @xtr-dev/payload-billing)

Run the demo:
```bash
git clone https://github.com/xtr-dev/payload-ecommerce.git
cd payload-ecommerce
pnpm install
pnpm dev
```

Visit `http://localhost:3000`

## Extending Collections

Pass a function to extend collections with custom fields:

```typescript
payloadEcommerce({
  collections: {
    products: (baseConfig) => ({
      ...baseConfig,
      fields: [
        ...baseConfig.fields,
        {
          name: 'brand',
          type: 'text',
        },
      ],
    }),
  },
})
```

## Coupons

A coupon is applied by the plugin when an order is created with it. Pass the coupon's id as `coupon` (or its code as `orderData.couponCode` to `createOrderFromCart`); the orders collection then:

1. Checks the coupon against the order: status `active`, within `validFrom`/`validUntil`, `usageCount` below `usageLimit`, the customer's earlier orders with this coupon (cancelled and refunded ones excluded) below `customerLimit` (only for orders with a `user`), `subtotal` at least `minPurchase`, and at least one order item matching `appliesToProducts` / `appliesToCategories` when those are set. A limit of 0 or an empty restriction means no limit.
2. Rejects the order with a validation error on `coupon` when a check fails.
3. Sets `discount` — a percentage of the subtotal (capped by `maxDiscount`) or the fixed amount, never more than the subtotal. A `discount` passed together with a coupon is ignored.
4. Sets `shipping` to 0 for a `freeShipping` coupon (its `discount` is 0).
5. Increments the coupon's `usageCount`, and gives that use back when the order is cancelled or refunded (see "Inventory and Order Side Effects").

Tax and total are calculated after that, so they include the coupon's effect. Without a coupon, the caller's `discount` is used as is. Changing the coupon of an existing order does not recalculate it.

To show the effect before ordering, use `validateCoupon`, which runs the same checks without using the coupon:

```typescript
const result = await ecommerce.coupons.validateCoupon({
  code: 'save10', // matched ignoring case; codes are stored in upper case
  cartTotal: 100, // subtotal before discount, tax and shipping
  userId, // optional, for customerLimit
  productIds, // needed for product-restricted coupons
  categoryIds, // needed for category-restricted coupons
})
// { valid: true, discount: 10, freeShipping: false, coupon }
// { valid: true, discount: 0, freeShipping: true, coupon }   for a free shipping coupon
// { valid: false, discount: 0, freeShipping: false, error: 'Coupon has expired' }
```

A restricted percentage or fixed coupon discounts the whole subtotal once a matching product is in the order, not only the matching lines.

## Order Totals

An order's `total` is always computed by the plugin when the order is saved:

```
total = subtotal − discount + tax + shipping
```

- `tax` comes from the `calculateTax` hook when one is configured (a negative result is stored as 0). Without the hook it is the `tax` passed by the caller, or 0.
- The total is never negative: a discount larger than the rest of the order gives 0.
- A `total` passed by the caller is ignored, so it can be left out. On update, tax is recalculated only when the items, `subtotal`, `discount`, `shipping` or an address actually differ from the stored order, and the total only when an amount differs. A status or tracking update, or re-saving an unchanged order in the admin UI, leaves both as they were.
- `calculateOrderTotal({ subtotal, discount, tax, shipping })` is exported for showing the same total before the order exists (for example on a cart page). It removes floating point noise but does not round to currency minor units.

## Tax Configuration

Configure automatic tax calculation using the `calculateTax` hook:

```typescript
payloadEcommerce({
  hooks: {
    calculateTax: async (orderData) => {
      // Access order information
      const { items, subtotal, discount, shipping, shippingAddress, billingAddress } = orderData

      // Implement your tax logic
      const taxableAmount = subtotal - discount
      const taxRate = 0.10 // 10%

      return Math.round(taxableAmount * taxRate * 100) / 100
    },
  },
})
```

The hook receives:
- `items` - Array of order items with product, quantity, and price
- `subtotal` - Order subtotal before tax/shipping
- `discount` - Discount amount (from coupons)
- `shipping` - Shipping cost
- `shippingAddress` - Customer shipping address
- `billingAddress` - Customer billing address

**Examples:**

```typescript
// Simple fixed rate
calculateTax: async ({ subtotal, discount }) => {
  return (subtotal - discount) * 0.08875 // 8.875% NY tax
}

// Rate by state
calculateTax: async ({ subtotal, discount, shippingAddress }) => {
  const rates = {
    'CA': 0.0725,
    'NY': 0.08875,
    'TX': 0.0625,
  }
  const rate = rates[shippingAddress?.state] || 0
  return (subtotal - discount) * rate
}
```

## Inventory and Order Side Effects

Products with `inventory.trackQuantity` have stock. A variant with its own `inventory` number is tracked separately; an order line without a variant, or for a variant whose `inventory` is empty, draws from the product's `inventory.quantity`. There is no backorder option: a tracked product cannot be ordered beyond its stock.

When an order is created (any status except `cancelled` / `refunded`):

1. Stock is checked first. An order asking for more than is available is rejected with a validation error on `items` such as `Not enough stock for "Blue Shirt" (variant "M"): 3 requested, 1 available`. Lines for the same product are added up.
2. Stock is reduced and the coupon's `usageCount` is incremented, each with one conditional database statement, so concurrent orders cannot oversell the last units or take a coupon past its `usageLimit`. The order that loses such a race is rejected.
3. The `afterCreateOrder` hook runs.

If any of these steps fails, the order is not created: inside a database transaction everything is rolled back, and on a database without transactions (the SQLite adapter's default) the plugin puts back what it took and deletes the order.

The order records what it holds in two read-only fields, `inventoryReduced` and `couponUsageCounted`. When its status changes to `cancelled` or `refunded`, the stock is put back and the coupon use is given back, once; later updates do nothing more. Not handled: editing the items of an existing order does not adjust stock, and reopening a cancelled order does not take stock again.

Limits:

- The atomic statements are implemented for MongoDB and for the SQL adapters (SQLite, Postgres). With another adapter, or when the product stock or coupon usage columns have custom database names, the plugin falls back to read-then-write, which can oversell under concurrency.
- On MongoDB, concurrent orders in transactions that touch the same product can fail with MongoDB's transient "write conflict" error even when enough stock is left. Nothing is oversold; retry the order.
- Two simultaneous cancellations of the same order can both restore its stock.

The helpers `ecommerce.products.checkInventory`, `reduceInventory` (throws when stock is short) and `restoreInventory`, and `ecommerce.coupons.incrementCouponUsage` / `decrementCouponUsage` use the same atomic statements, for stock movements that are not orders. They take an optional `{ req }` as last argument to run inside a transaction.

## Development

```bash
# Install dependencies
pnpm install

# Run demo with hot reload
pnpm dev

# Build the plugin
pnpm build

# Checks run by CI and before a release
pnpm typecheck
pnpm lint
pnpm test        # integration tests (vitest)
pnpm test:pack   # build, pack and import every published export

# Browser tests against the demo (not part of CI)
pnpm test:e2e
```

## License

MIT © [xtr.dev](https://github.com/xtr-dev)
