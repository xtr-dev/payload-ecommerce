# Payload eCommerce

> A complete eCommerce plugin for PayloadCMS 3.x

[![npm version](https://img.shields.io/npm/v/@xtr-dev/payload-ecommerce.svg)](https://www.npmjs.com/package/@xtr-dev/payload-ecommerce)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

⚠️ **Pre-release** - This package is in active development (v0.0.x). Breaking changes may occur before v1.0.0.

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
    // ... other fields
  },
})

// Validate coupon
const result = await ecommerce.coupons.validateCoupon({
  code: 'SAVE10',
  cartTotal: 100,
  productIds: ['product-1', 'product-2'],
})
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

## Inventory Tracking

Inventory is automatically decremented when orders are created:

```typescript
// Product has inventory: { trackQuantity: true, quantity: 100 }
// Customer orders quantity: 3
// After order creation: inventory.quantity = 97
```

Variants track inventory independently of the parent product.

## Development

```bash
# Install dependencies
pnpm install

# Run demo with hot reload
pnpm dev

# Build the plugin
pnpm build

# Run tests
pnpm test
```

## License

MIT © [xtr.dev](https://github.com/xtr-dev)
