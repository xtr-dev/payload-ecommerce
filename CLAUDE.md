# CLAUDE.md

This file provides guidance to Claude Code when working in the @xtr-dev/payload-ecommerce plugin.

## Project Overview

**@xtr-dev/payload-ecommerce** is a PayloadCMS plugin that provides e-commerce functionality including products, orders, carts, categories, and coupons.

## Tech Stack

- **Framework**: PayloadCMS 3.37.0 plugin
- **Build**: SWC for fast transpilation
- **Package Manager**: pnpm
- **Dependencies**: none at runtime. @xtr-dev/payload-billing is a dev dependency used by the demo in `dev/` (payment integration)

## Development Commands

```bash
pnpm dev              # Start dev server (Next.js app in dev/)
pnpm build            # Build for production
pnpm typecheck        # tsc --noEmit over src/
pnpm lint             # Run ESLint
pnpm test             # Integration tests (vitest run)
pnpm test:pack        # Build, pack and import every published export
pnpm test:e2e         # Playwright tests against the demo (not in CI)
pnpm dev:generate-types    # Regenerate Payload types
```

## Plugin Architecture

### Entry Point
- `src/index.ts` - Main plugin factory function `payloadEcommerce()`

### Collections Created
- **products** - Product catalog with title, slug, description, price, inventory, images
- **orders** - Customer orders with items, addresses, status, payment status
- **carts** - Shopping carts with session tracking and expiration
- **categories** - Product categories with nesting support
- **coupons** - Discount codes with percentage/fixed/free-shipping types

### Exports
- `.` - Main plugin and collection exports
- `./client` - Client-side hooks (`useEcommerce`)
- `./rsc` - React Server Components

### Configuration Options

```typescript
payloadEcommerce({
  collections: {
    products: 'products' | CollectionExtender,
    orders: 'orders' | CollectionExtender,
    categories: 'categories' | CollectionExtender,
    carts: 'carts' | CollectionExtender,
    coupons: 'coupons' | CollectionExtender,
  },
  userCollection: 'users',
  payments: {
    providers: ['stripe', 'paypal', 'square'],
    currency: 'USD',
    testMode: boolean,
  },
  emails: { enabled: boolean, from: string, fromName: string },
  shipping: { enabled: boolean, freeShippingThreshold: number, rates: [] },
  hooks: {
    beforeCreateOrder: async (order) => order,
    afterCreateOrder: async (order) => {},
    beforePayment: async (order) => {},
    afterPayment: async (order) => {},
    calculateTax: (orderData) => number,
  },
})
```

## Key Files

| File | Purpose |
|------|---------|
| `src/index.ts` | Plugin factory and exports |
| `src/collections/Products.ts` | Product catalog collection |
| `src/collections/Orders.ts` | Order management collection |
| `src/collections/Carts.ts` | Shopping cart collection |
| `src/collections/Categories.ts` | Product categories |
| `src/collections/Coupons.ts` | Discount codes |
| `src/exports/client.tsx` | Client-side hooks |
| `dev/payload.config.ts` | Development configuration |

## Integration with payload-billing

This plugin works alongside @xtr-dev/payload-billing for payment processing:

```typescript
// Example: Extend payments collection to sync order status
billingPlugin({
  collections: {
    payments: {
      extend: (config) => ({
        hooks: {
          afterChange: [
            async ({ doc, req }) => {
              if (doc.metadata?.orderId && doc.status === 'succeeded') {
                await req.payload.update({
                  collection: 'orders',
                  id: doc.metadata.orderId,
                  data: { paymentStatus: 'paid' }
                })
              }
            }
          ]
        }
      })
    }
  }
})
```

## Client Hooks

```typescript
import { useEcommerce } from '@xtr-dev/payload-ecommerce/client'

// Use in React components
const { cart, products, orders, addToCart, checkout } = useEcommerce()
```
