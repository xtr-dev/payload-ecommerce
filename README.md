# Payload eCommerce

> Products, carts, orders and coupons for PayloadCMS 3.x, with server-side helpers

[![npm version](https://img.shields.io/npm/v/@xtr-dev/payload-ecommerce.svg)](https://www.npmjs.com/package/@xtr-dev/payload-ecommerce)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**v0.x** — minor versions may contain breaking changes until 1.0.

## Features

- 🛍️ **Products** - Variants, categories, SKUs, generated slugs and optional stock tracking
- 🛒 **Carts** - For users or guest sessions, with a 30-day sliding expiry and a cleanup helper / optional jobs task
- 📦 **Orders** - Status and payment status fields, totals computed by the plugin, stock and coupon use restored on cancel or refund
- 🏷️ **Coupons** - Percentage, fixed amount and free shipping, validated and applied when the order is created
- 📊 **Inventory** - Stock checked before an order is created and reduced atomically, so concurrent orders cannot oversell
- 💰 **Tax** - A `calculateTax` hook you implement (fixed rate, per region, or a call to a tax service)
- 🔧 **Helpers** - `useEcommerce(payload)` for carts, orders, coupons and products on the server

Not included: payment processing, emails and shipping rates. Payments are shown in the demo app with [@xtr-dev/payload-billing](https://github.com/xtr-dev/payload-billing); see [Not implemented yet](#not-implemented-yet).

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

The plugin adds the five collections below. Orders and carts relate to a `users` collection, and products to a `media` collection, which your config has to provide.

## Collections

### Products
- Title, slug (generated from the title when empty), description, price, compare-at price, SKU, barcode, images
- Variants (size, color, etc.), each with an optional price, SKU and own stock number. A variant's price, when filled in, replaces the product's price for cart and order lines of that variant (see [Prices](#prices))
- Categories (many per product)
- Optional stock tracking (`inventory.trackQuantity`, `inventory.quantity`). `inventory.lowStockThreshold` is a plain field for your own use; the plugin sends no low-stock alerts
- Status: draft | active | archived

### Orders
- Order number, items, subtotal, discount, tax, shipping and a computed total
- Shipping and billing addresses
- Status: pending | processing | shipped | delivered | cancelled | refunded
- Payment fields (`paymentStatus`, `paymentMethod`, `paymentId`) that your payment integration sets; the plugin takes no payments and sends no emails
- Moving an order to cancelled or refunded puts its stock and coupon use back

### Carts
- For a logged-in user or a guest session id
- Auto-calculated subtotal, each line priced with its variant's price when the variant has one
- Expire 30 days after the last change (see [Carts](#carts-1))

### Coupons
- Types: percentage | fixed | freeShipping
- Total and per-customer usage limits, date range, minimum purchase
- Product and category restrictions

### Categories
- Name, slug (generated from the name when empty), description
- An optional `parent` category. The plugin stores the relationship only; building a tree or breadcrumb from it is up to you

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
  variant: 'Medium', // optional; the `name` of one of the product's variants
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

### Prices

A cart or order line is identified by its product and, optionally, the `name` of one of that product's variants. One function decides what a unit costs, and the cart subtotal and `createOrderFromCart` both use it:

```typescript
import { resolveUnitPrice } from '@xtr-dev/payload-ecommerce'

resolveUnitPrice(product)          // product.price
resolveUnitPrice(product, 'Large') // the variant's own price when it has one, else product.price
```

A variant price of `0` is a real price (a free variant); leave the field empty to use the product's price. A variant name the product does not have is priced at the product's price. Use the same function wherever your storefront shows a line price, so it matches the subtotal.

## Example Implementation

The `/dev` directory holds a Next.js storefront built on the plugin:
- Product browsing and search
- Shopping cart with coupons
- Checkout that creates an order from the cart
- Order pages
- Payments through @xtr-dev/payload-billing's test provider, wired up in the demo's own code (API routes and a hook that syncs the payment status to the order)

The demo's cart and checkout API routes are part of the demo, not of the plugin.

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

## Slugs

Products and categories have a unique `slug`. Leave it empty and it is generated from the product's `title` or the category's `name` (`"Café Crème 250g"` → `cafe-creme-250g`); when that slug is already taken, a number is appended (`blue-shirt-2`, `blue-shirt-3`, …). A slug you enter yourself is kept as entered and is not regenerated when the title changes; if it is already in use, the save is rejected with a validation error on `slug`. Clear the slug to have it generated again. `slugify` is exported.

## Carts

A cart belongs to a user (`userId`) or a guest session (`sessionId`) and expires 30 days after it was last changed: every change to a cart moves `expiresAt` to 30 days from now, unless the change sets `expiresAt` itself.

The cart helpers treat an expired cart as absent: `getCart` returns `null`, `addToCart` starts a new cart, `updateCartItem` / `removeFromCart` / `clearCart` throw `Cart not found`, and `createOrderFromCart` throws `Cart has expired`.

Expired carts stay in the database until you delete them. Nothing does that on its own; pick one:

```typescript
import { deleteExpiredCarts } from '@xtr-dev/payload-ecommerce'

// From your own cron job, script or endpoint
const { deleted } = await deleteExpiredCarts(payload)
```

```typescript
// Or as a Payload jobs task: opt in, then queue it from your schedule
payloadEcommerce({ cartCleanupTask: true })

await payload.jobs.queue({ task: 'ecommerce-delete-expired-carts', input: {} })
```

The task is only registered, not scheduled, and it runs when your jobs runner processes the queue (`jobs.autoRun`, `payload jobs:run` or `payload.jobs.run()`).

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

## Not implemented yet

The plugin's option type also lists `payments`, `emails`, `shipping`, `userCollection`, `disabled` and the `beforePayment` / `afterPayment` hooks. They are accepted but have no effect yet. The options that work are `collections`, `cartCleanupTask` and the hooks `calculateTax`, `beforeCreateOrder` and `afterCreateOrder`.

The `@xtr-dev/payload-ecommerce/client` hooks (`useCart`, `useProducts`, `useOrders`) call cart and order endpoints that the plugin does not register; they only work against routes like the ones in the demo app.

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
