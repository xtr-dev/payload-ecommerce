# CLAUDE.md

This file provides guidance to Claude Code when working in the @xtr-dev/payload-ecommerce plugin.

## Project Overview

**@xtr-dev/payload-ecommerce** is a PayloadCMS plugin that provides e-commerce collections (products, orders, carts, categories, coupons) and server helpers. It does not process payments or send emails.

## Tech Stack

- **Framework**: PayloadCMS plugin, peer range `^3.37.0`. The dev environment and lockfile use Payload 3.94.2 / Next 16 / vitest 4; the CI job "Test (oldest supported Payload)" reinstalls 3.37.0 and runs both suites, so do not use a Payload API newer than 3.37 without a guard (see the schedule test in `dev/renamed.spec.ts`)
- **Build**: SWC for fast transpilation
- **Package Manager**: pnpm
- **Dependencies**: none at runtime. @xtr-dev/payload-billing is a dev dependency used by the demo in `dev/` (payment integration)

## Development Commands

```bash
pnpm dev              # Start dev server (Next.js app in dev/)
pnpm build            # Build for production
pnpm typecheck        # tsc --noEmit over src/, then pnpm test:types
pnpm test:types       # Compile dev/type-tests against the built declarations in dist
pnpm lint             # Run ESLint
pnpm test             # Integration tests (vitest run) on SQLite
pnpm test:mongo       # Same tests on an in-memory MongoDB replica set
pnpm test:pack        # Build, pack and import every published export
pnpm test:e2e         # Playwright tests against the demo (not in CI)
pnpm dev:generate-types    # Regenerate Payload types
```

## Plugin Architecture

### Entry Point
- `src/index.ts` - Main plugin factory function `payloadEcommerce()`

### Collections Created
- **products** - Catalog with title, slug (generated when empty), price, variants, images and optional stock tracking. `inventory.lowStockThreshold` is only a field; nothing alerts on it
- **orders** - Items, addresses (shipping: name, address1, city, country required; state/postalCode optional; billing all optional), optional `user`, `customerEmail` for guests, a generated `accessToken` for guest order links, status and payment status fields. The total is always computed (`subtotal − discount + tax + shipping`). Creating an order checks and reduces stock and counts the coupon; moving it to cancelled/refunded puts both back
- **carts** - For a user or guest session, expiring 30 days after the last change. Expired carts are ignored by the helpers and removed by `deleteExpiredCarts`
- **categories** - Name, slug (generated when empty) and an optional `parent` relationship (no tree helpers)
- **coupons** - Percentage, fixed and free-shipping codes, validated and applied when an order is created

### Exports
- `.` - Plugin, collections, `getEcommerce(payload)` server helpers and utilities (`calculateOrderTotal`, `deleteExpiredCarts`, `slugify`, `getRelationshipId`, ...)

There is only the root export: no `/client` or `/rsc` entry points, no React code and no endpoints.

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
  userCollection: 'users', // relationTo of orders.user and carts.user; owners in the access rules
  mediaCollection: 'media', // relationTo of products.images
  roundMoney: (amount) => number, // default: two decimals
  // Who manages the shop; default: user.role === 'admin' or user.roles includes 'admin'
  isAdmin: ({ req }) => boolean,
  // Registers the 'ecommerce-delete-expired-carts' jobs task; { schedule } lets Payload queue it
  cartCleanupTask: boolean | { schedule: [{ cron, queue }] },
  hooks: {
    beforeCreateOrder: async (order) => order,
    afterCreateOrder: async (order) => {}, // throwing here fails the order
    calculateTax: (orderData) => number,
  },
  disabled: boolean, // keep collections (fields + access), drop the plugin's collection hooks and the task
})
```

Every option is implemented; do not add options that nothing reads.

### Slugs
No collection slug is hardcoded. The collections are factories (`createProducts(slugs)`, ...) in `src/collections/`; `src/index.ts` builds them twice (first to learn the slug a CollectionExtender returns, then with the final slugs in every `relationTo` and hook) and records the result in `config.custom['payload-ecommerce'].slugs`. Helpers read it with `getEcommerceSlugs(payload)` (`src/lib/slugs.ts`). `dev/payload.renamed.config.ts` + `dev/renamed.spec.ts` run the plugin with every slug renamed.

### Access control
`src/lib/access.ts` builds the default `access` of every collection (products/categories: public read, admin write; coupons: admin only; orders: owner read, admin write; carts: owner read/create/update, admin all; guest carts and orders: admin only). The plugin applies it before a CollectionExtender runs. Hooks and internal bookkeeping call the Local API with an explicit `overrideAccess: true`; the `getEcommerce` helpers do too unless the caller passes `{ overrideAccess: false, user | req }`. The dev app's `users` collection has a `role` field for this.

### Where the logic lives
- `src/lib/access.ts` - default access rules, `defaultIsAdmin`, and how helpers pass `overrideAccess`/`req`/`user`
- `src/lib/money.ts` - `roundMoney` (default two decimals; `Math.round` for integer cents), read by hooks and helpers through `getRoundMoney(payload)` and applied to coupon discount, hook tax and order total
- `src/lib/ids.ts` - `toDocumentId`: every helper converts incoming ids to the collection's id type (numeric strings on SQL)
- `src/lib/totals.ts` - the only place an order total is computed
- `src/lib/coupons.ts` - coupon rules (`evaluateCoupon`), shared by `validateCoupon` and the Orders hook
- `src/lib/orderRejection.ts` - `OrderRejectedError` (a ValidationError with the cause as `rejection` and `data.rejection`) and `getOrderRejection`; every stock or coupon refusal of an order is thrown through it
- `src/lib/orderAccessToken.ts` - generation and constant-time comparison of `orders.accessToken`. The field has field access `false` for create/read/update, the Orders hook sets it on create and drops it from updates, and `getOrderByToken` (`src/lib/orders.ts`) is the lookup for guests
- `src/lib/atomic.ts` - conditional single-statement stock and coupon-usage updates (SQL via the adapter's `execute`, MongoDB via `$inc`), with a non-atomic fallback that logs a one-time warning. The "atomic updates" tests in `dev/int.spec.ts` fail when the fallback is taken
- `src/lib/cartExpiry.ts` - cart lifetime, `deleteExpiredCarts` and the optional jobs task
- `src/lib/slug.ts` - slug generation hook shared by products and categories
- `src/collections/Orders.ts` - hooks that apply the coupon, check stock, compute tax and total, take stock, and reverse on cancel/refund

Payload fills `data` with the stored value of fields an update leaves out before collection hooks run; compare with `originalDoc` to detect a change (see Orders and Carts hooks).

## Key Files

| File | Purpose |
|------|---------|
| `src/index.ts` | Plugin factory and exports |
| `src/collections/Products.ts` | Product catalog collection |
| `src/collections/Orders.ts` | Order management collection |
| `src/collections/Carts.ts` | Shopping cart collection |
| `src/collections/Categories.ts` | Product categories |
| `src/collections/Coupons.ts` | Discount codes |
| `src/lib/getEcommerce.ts` | Server helpers (`cart`, `orders`, `coupons`, `products`) |
| `src/lib/documents.ts` | Document types of the helper results (generated types or type arguments) |
| `src/lib/slugs.ts` | Resolved collection slugs (`getEcommerceSlugs`) |
| `dev/payload.config.ts` | Development configuration |

## Integration with payload-billing

Payments are not part of this plugin. The demo in `dev/` pairs it with @xtr-dev/payload-billing; the host syncs the payment status to the order itself. Setting an order to `cancelled` or `refunded` this way also puts its stock back:

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

## Tests

Integration tests are in `dev/int.spec.ts` (default slugs) and `dev/renamed.spec.ts` (every collection renamed, own database). `pnpm test` runs them against a temporary SQLite database (numeric ids, no transactions) and `pnpm test:mongo` against an in-memory MongoDB replica set (string ids, transactions); CI runs both, so a test must not assume an id type. For operations started at the same time, use the `settleConcurrently` helper in that file: it retries MongoDB's transient write conflicts. Use `getRelationshipId` / `isSameDocument` from `src/lib/relationships.ts` when comparing ids.

The spec files are not type-checked. The types of the helper results are tested in `dev/type-tests/`: each directory is a host program (generated types with default slugs, generated types with renamed slugs) compiled against `dist/*.d.ts` by `pnpm test:types`. The helper signatures in `src/lib` are written out as interfaces (`CartHelpers`, ...) because an inferred return type would be resolved when the plugin is built, before the host's generated types exist.
