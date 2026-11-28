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
- 🔧 **Helpers** - `getEcommerce(payload)` for carts, orders, coupons and products on the server

Not included: payment processing, emails and shipping rates. Payments are shown in the demo app with [@xtr-dev/payload-billing](https://github.com/xtr-dev/payload-billing); see [Not included](#not-included).

## Quick Start

### Installation

```bash
pnpm add @xtr-dev/payload-ecommerce
```

Requires `payload` `^3.37.0`. The plugin is developed and tested on Payload 3.94 (Next.js 16), and CI also runs the tests on 3.37, with SQLite and MongoDB.

### Add to Payload Config

```typescript
import { payloadEcommerce } from '@xtr-dev/payload-ecommerce'

export default buildConfig({
  plugins: [
    payloadEcommerce({
      // All options are optional; see "Options" below
    }),
  ],
})
```

The plugin adds the five collections below. Orders and carts relate to your users collection and product images to your media collection; your config has to provide both (`users` and `media` unless you set `userCollection` / `mediaCollection`).

### Options

| Option | Default | What it does |
|--------|---------|--------------|
| `collections.products` / `categories` / `orders` / `carts` / `coupons` | default slugs | A string renames the collection; a function extends it (see [Extending Collections](#extending-collections)) |
| `userCollection` | `'users'` | Auth collection the `user` field of orders and carts relates to, and whose users own their carts and orders |
| `mediaCollection` | `'media'` | Upload collection product `images` relate to |
| `isAdmin` | `role === 'admin'` or `roles` includes `'admin'` | Who manages the shop (see [Access control](#access-control)) |
| `roundMoney` | two decimals | Rounds the discount, tax and total the plugin calculates; pass `Math.round` for integer cents (see [Money](#money)) |
| `cartCleanupTask` | `false` | `true` registers the jobs task that deletes expired carts; `{ schedule }` also schedules it (see [Carts](#carts-1)) |
| `hooks.calculateTax` | – | Returns the tax of an order (see [Tax Configuration](#tax-configuration)) |
| `hooks.beforeCreateOrder` | – | Receives and returns the data of a new order, after coupon and tax and before the total is computed |
| `hooks.afterCreateOrder` | – | Runs after a new order took its stock; throwing fails the order |
| `disabled` | `false` | Keeps the collections (fields and access rules, so the database schema does not change) but removes the plugin's collection hooks and does not register the cart cleanup task |

Renaming works everywhere: relationships between the collections, hooks and the server helpers all follow the configured slugs, so `getEcommerce(payload)` needs no slug arguments. `getEcommerceSlugs(payload)` returns the slugs in use.

The collections are locked down by default: only an admin can manage them, and by default an admin is a user with `role: 'admin'`. Read [Access control](#access-control) before you open the admin panel.

## Access control

Every collection gets access rules, which apply to REST, GraphQL, the admin panel and Local API calls made with `overrideAccess: false`:

| Collection | Everyone | Signed-in user | Admin |
|------------|----------|----------------|-------|
| products | read `active` products | same | read and write all |
| categories | read | same | read and write all |
| coupons | – | – | read and write all |
| orders | – | read their own (`user` is them) | read and write all |
| carts | – | read, create and update their own (`user` is them) | read and write all |

- Guest carts (`sessionId`) and guest orders are not reachable through the API without an admin. A storefront reaches them on the server through `getEcommerce(payload)`.
- Orders are created on the server (`createOrderFromCart`), not by customers through the API: whoever creates an order decides its prices.
- Coupons cannot be listed or read by customers. Validate a code on the server with `ecommerce.coupons.validateCoupon`.
- On a cart, only an admin can change `user` and `sessionId` after it is created.
- An order's `accessToken` is not readable or writable through the API by anyone, admins included (see [Order access tokens](#order-access-tokens)).
- "Signed-in user" is a user of `userCollection` (default `'users'`).

**Who is an admin** is decided by the `isAdmin` option. The default accepts a signed-in user whose `role` is `'admin'` or whose `roles` array contains `'admin'`. If your users collection has neither field, nobody is an admin and the collections cannot be managed until you pass your own check:

```typescript
payloadEcommerce({
  // Everyone in a separate `admins` auth collection manages the shop
  isAdmin: ({ req }) => req.user?.collection === 'admins',
})
```

If you rely on a `role` field, protect it with field access so customers cannot change their own role.

To change a rule for one collection, set `access` in a collection extender; it receives the collection with the defaults already applied:

```typescript
payloadEcommerce({
  collections: {
    products: (base) => ({ ...base, access: { ...base.access, read: () => true } }),
  },
})
```

## Collections

### Products
- Title, slug (generated from the title when empty), description, price, compare-at price, SKU, barcode, images
- Variants (size, color, etc.), each with an optional price, SKU and own stock number. A variant's price, when filled in, replaces the product's price for cart and order lines of that variant (see [Prices](#prices))
- Categories (many per product)
- Optional stock tracking (`inventory.trackQuantity`, `inventory.quantity`). `inventory.lowStockThreshold` is a plain field for your own use; the plugin sends no low-stock alerts
- Status: draft | active | archived

### Orders
- Order number, items, subtotal, discount, tax, shipping and a computed total
- A shipping address (first name, last name, address line, city and country are required; `state` and `postalCode` are optional, since not every country has them) and an optional billing address
- An optional `user`, and a `customerEmail` to reach the customer of a guest order
- An `accessToken` generated by the plugin, for a link that lets a guest see their order (see [Order access tokens](#order-access-tokens))
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

Use the `getEcommerce` helper for server-side operations:

> `getEcommerce` was called `useEcommerce` in 0.1.0. The old name still works but is deprecated: it is not a React hook, and the `use` prefix makes the `react-hooks/rules-of-hooks` lint rule reject calls from server actions and route handlers.

```typescript
import { getPayload } from 'payload'
import { getEcommerce } from '@xtr-dev/payload-ecommerce'

const payload = await getPayload({ config })
// Trusted server code: bypasses access control (see "Helpers and access control" below)
const ecommerce = getEcommerce(payload)

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

Document ids are strings on MongoDB and numbers on SQLite and Postgres. Every helper accepts both, and converts an id to the type its collection uses, so a numeric id that arrives as text (`'5'` from a URL, a form or a JSON body) works on SQL databases. `toDocumentId(payload, collectionSlug, id)` is exported for your own Local API calls. A relationship field holds either a bare id or the populated document, depending on `depth`. Use the exported `getRelationshipId` to read the id in both cases:

```typescript
import { getRelationshipId } from '@xtr-dev/payload-ecommerce'

const productIds = cart.items.map((item) => getRelationshipId(item.product))
```

### Typed results

With [generated types](https://payloadcms.com/docs/typescript/generating-types) and the default collection slugs, the helpers return your generated document types without casts:

```typescript
const cart = await ecommerce.cart.getCart(user.id) // Cart | null
const order = await ecommerce.orders.createOrderFromCart({ cartId, orderData }) // Order
const { docs } = await ecommerce.products.getProducts() // Product[]

const result = await ecommerce.coupons.validateCoupon({ code, cartTotal })
if (result.valid) {
  result.coupon // Coupon
} else {
  result.reason // CouponRefusalReason
  result.coupon // Coupon | undefined
}
```

The types are those of your collections named `carts`, `coupons`, `orders` and `products`. If you renamed a collection, name its type yourself; collections you leave out keep the default:

```typescript
import type { ShopCart, ShopOrder } from './payload-types'

const ecommerce = getEcommerce<{ carts: ShopCart; orders: ShopOrder }>(payload)
```

Do the same when one of those four slugs belongs to a collection of your own that is not the plugin's, because the default would be that collection's type. Without generated types, and for a renamed collection without a type argument, documents are untyped (`JsonObject & TypeWithID`).

`getCart`, `findCouponByCode` and `getOrderByToken` return `null` when there is nothing to find. `getOrder` and `getProduct` throw Payload's `NotFound` instead. The helper types are exported as `EcommerceHelpers`, `CartHelpers`, `OrderHelpers`, `CouponHelpers`, `ProductHelpers` and `ApplyCouponResult`; each takes the document type as a type argument.

### Helpers and access control

`getEcommerce(payload)` bypasses the collections' access rules (`overrideAccess: true`). That is what a storefront needs for guest carts and for creating orders, and it means your server code decides whose cart or order is touched: only pass ids (`userId`, `sessionId`, `cartId`, `orderId`) that belong to the visitor, for example a session id read from your own cookie.

To have the helpers enforce the access rules for a signed-in user instead, pass the user (or the request) with `overrideAccess: false`:

```typescript
const ecommerce = getEcommerce(payload, { overrideAccess: false, user })
// or: getEcommerce(payload, { overrideAccess: false, req })

await ecommerce.cart.getCart(user.id)       // their cart
await ecommerce.orders.getOrder(orderId)    // throws unless it is their order
```

In that mode cart, order and product reads, cart changes and `updateOrderStatus` run as that user. `createOrderFromCart` reads the cart as the user, so it only works on their own cart, and then creates the order with full access. Coupon validation and the inventory helpers always run with full access. A `req` passed without `overrideAccess: false` is only used to join its transaction.

### Guest checkout

A cart belongs to a user (`userId`) or to a guest session (`sessionId`, any string you keep in a cookie). An order created from a guest cart has no `user`, so pass the address to reach the customer at:

```typescript
const cart = await ecommerce.cart.addToCart({ sessionId, productId, quantity: 1 })

const order = await ecommerce.orders.createOrderFromCart({
  cartId: cart.id,
  orderData: {
    customerEmail: 'guest@example.com', // stored on the order as `customerEmail`
    shippingAddress: { firstName, lastName, address1, city, country }, // state and postalCode optional
  },
})
```

`customerEmail` is optional and can also be set on the order of a signed-in user. The billing address defaults to the shipping address. Guest carts and guest orders are only reachable through these helpers or as an admin (see [Access control](#access-control)). To show a guest their order afterwards, use its [access token](#order-access-tokens).

### Order access tokens

A guest has no account to sign in to, so the default access rules give them no way back to their order, and an order id or number is too easy to guess to serve as a key on its own. Every order therefore gets an `accessToken` when it is created: 32 random bytes as 43 URL-safe characters. Put it in the link you give the customer (the confirmation redirect, the confirmation email), and look the order up with it:

```typescript
const order = await ecommerce.orders.createOrderFromCart({ cartId, orderData })
redirect(`/orders/${order.orderNumber}?token=${order.accessToken}`)

// On the order page, with values straight from the URL:
const order = await ecommerce.orders.getOrderByToken({ orderNumber, token }) // or { orderId, token }
if (!order) notFound()
```

`getOrderByToken` returns the order (relationships populated, depth 2) only when the token is that order's token, and `null` otherwise. A wrong token, an order that does not exist, an order without a token and input that is not a string all give the same `null`, so order numbers cannot be probed, and the token is compared in constant time. Pass exactly one of `orderId` and `orderNumber`. It reads with full access also for helpers created with `overrideAccess: false`, because holding the token is the permission; combine it with your own check when signed-in customers or admins should reach the page without a token.

About the field:

- The plugin generates the token on create and never changes it. A value passed by a caller is replaced, and an update cannot set it.
- It cannot be read, written or used in a `where` filter through REST, GraphQL, the admin panel or the Local API with `overrideAccess: false`, by admins either. Server code reads it with the Local API's default `overrideAccess: true`: the order `createOrderFromCart` returns, `payload.create`, `payload.findByID`. An order document read that way contains the token, so pick fields before sending one to a browser that is not the customer's.
- Whoever has the link can see the order, like any emailed order link. The plugin does not expire or rotate tokens.
- Orders created before the field existed have no token and are never returned by `getOrderByToken`. If you need links for them, write your own values to `accessToken` in a migration, directly through the database adapter.
- `matchesOrderAccessToken(order, token)` is exported for comparing in constant time against an order you already loaded.

### Money

The plugin stores amounts as plain numbers and does not care whether they are major units (`19.99`) or integer minor units (`1999` cents), as long as you use one of them everywhere. What it calculates itself — a cart's subtotal, the line totals and subtotal of an order made with `createOrderFromCart`, a coupon's discount, the result of your `calculateTax` hook and the order total — it rounds with the `roundMoney` option:

```typescript
payloadEcommerce({
  roundMoney: Math.round, // prices in integer cents: 10% of 1995 is 200, not 199.5
})
```

The default rounds to two decimals, which suits prices in major units. Amounts you pass in yourself (prices, `shipping`, a manual `discount`) are stored as given. `getRoundMoney(payload)` returns the configured function.

### Prices

A cart or order line is identified by its product and, optionally, the `name` of one of that product's variants. One function decides what a unit costs, and the cart subtotal and `createOrderFromCart` both use it:

```typescript
import { resolveUnitPrice } from '@xtr-dev/payload-ecommerce'

resolveUnitPrice(product)          // product.price
resolveUnitPrice(product, 'Large') // the variant's own price when it has one, else product.price
```

A variant price of `0` is a real price (a free variant); leave the field empty to use the product's price. A variant name the product does not have is priced at the product's price. Use the same function wherever your storefront shows a line price, so it matches the subtotal.

### Cart lines

A cart holds one line per product + variant combination, so two variants of one product are two lines. `addToCart`, `updateCartItem` and `removeFromCart` all take the variant to say which line is meant; leaving it out means the line without a variant, never "any line of this product":

```typescript
// Sets the quantity of the "Medium" line only (0 or less removes that line)
await ecommerce.cart.updateCartItem({ cartId, productId, variant: 'Medium', quantity: 3 })

// Removes the "Medium" line only
await ecommerce.cart.removeFromCart({ cartId, productId, variant: 'Medium' })
```

`updateCartItem` throws `Item not found in cart` when the cart has no line for that combination. The exported `isSameCartLine(item, productId, variant)` is the comparison the helpers use.

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

Pass a function to extend a collection with custom fields, hooks or access rules. It may also return another `slug` to rename the collection. The function is called twice while the config is built, so it should only return a new collection and have no side effects:

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

```typescript
// Or let Payload queue the task on a schedule (needs a Payload version with task schedules)
payloadEcommerce({
  cartCleanupTask: { schedule: [{ cron: '0 3 * * *', queue: 'nightly' }] },
})
```

With `true` the task is only registered, not scheduled. With a `schedule` Payload queues it at those times, provided your jobs runner handles schedules for that queue (`jobs.autoRun`, or `payload.jobs.handleSchedules()` from your own cron). Either way it runs when your jobs runner processes the queue (`jobs.autoRun`, `payload jobs:run` or `payload.jobs.run()`). Task schedules are a feature of newer Payload releases (verified with 3.94); on a Payload version without them the `schedule` is ignored.

## Coupons

A coupon is applied by the plugin when an order is created with it. Pass the coupon's id as `coupon` (or its code as `orderData.couponCode` to `createOrderFromCart`); the orders collection then:

1. Checks the coupon against the order: status `active`, within `validFrom`/`validUntil`, `usageCount` below `usageLimit`, the customer's earlier orders with this coupon (cancelled and refunded ones excluded) below `customerLimit` (an order without a `user` cannot use a coupon that has a `customerLimit`), `subtotal` at least `minPurchase`, and at least one order item matching `appliesToProducts` / `appliesToCategories` when those are set. A limit of 0 or an empty restriction means no limit.
2. Rejects the order with a validation error on `coupon` when a check fails. The error carries the refusal's `reason` (see [When an order is rejected](#when-an-order-is-rejected)).
3. Sets `discount` — a percentage of the subtotal (capped by `maxDiscount`) or the fixed amount, rounded with [`roundMoney`](#money) and never more than the subtotal. A `discount` passed together with a coupon is ignored.
4. Sets `shipping` to 0 for a `freeShipping` coupon (its `discount` is 0).
5. Increments the coupon's `usageCount`, and gives that use back when the order is cancelled or refunded (see "Inventory and Order Side Effects"). The count is the plugin's to keep: an update through the admin panel, REST or GraphQL cannot change `usageCount`, so saving a coupon never overwrites uses counted in the meantime. To correct it yourself, update it through the Local API.

Tax and total are calculated after that, so they include the coupon's effect. Without a coupon, the caller's `discount` is used as is. Changing the coupon of an existing order does not recalculate it.

To show the effect before ordering, use `validateCoupon`, which runs the same checks without using the coupon:

```typescript
const result = await ecommerce.coupons.validateCoupon({
  code: 'save10', // matched ignoring case; codes are stored in upper case
  cartTotal: 100, // subtotal before discount, tax and shipping
  userId, // the signed-in customer; a coupon with a customerLimit is refused without it
  productIds, // needed for product-restricted coupons
  categoryIds, // needed for category-restricted coupons
})
// { valid: true, discount: 10, freeShipping: false, coupon }
// { valid: true, discount: 0, freeShipping: true, coupon }   for a free shipping coupon
// { valid: false, discount: 0, freeShipping: false, reason: 'expired', error: 'Coupon has expired', coupon }
```

A refusal has a `reason` to word your own message from. `error` is an English description meant for logs.

| `reason` | The coupon is refused because |
| --- | --- |
| `not_found` | no coupon has this code (the only refusal without `coupon`) |
| `inactive` | its status is `inactive` |
| `not_yet_valid` | `validFrom` is in the future |
| `expired` | `validUntil` has passed, or its status is `expired` |
| `usage_limit` | `usageCount` has reached `usageLimit` |
| `customer_required` | it has a `customerLimit` and no `userId` was given, so the limit cannot be counted; ask the visitor to sign in |
| `customer_limit` | the customer's orders with it have reached `customerLimit` |
| `min_purchase` | `cartTotal` is below `minPurchase`; the result also has `minPurchase`, the stored amount, to format as your shop formats money |
| `not_applicable` | it is restricted to products or categories and the cart has none of them |

The checks run in this order and the first one that fails is reported. `error` is `Coupon has expired` for both ways a coupon expires (0.2.0 said `Coupon is not active` for the status). The types are exported as `ApplyCouponResult` and `CouponRefusalReason`. `coupon` is the whole coupon document (usage count, limits, restrictions, your internal description), also on a refusal, so pick the fields you need before sending a result to the browser; `dev/lib/couponPreview.ts` in this repository shows one way.

A restricted percentage or fixed coupon discounts the whole subtotal once a matching product is in the order, not only the matching lines.

## Order Totals

An order's `total` is always computed by the plugin when the order is saved:

```
total = subtotal − discount + tax + shipping
```

- `tax` comes from the `calculateTax` hook when one is configured (rounded with [`roundMoney`](#money); a negative result is stored as 0). Without the hook it is the `tax` passed by the caller, or 0. A hook that fails makes the order fail (see [Tax Configuration](#tax-configuration)).
- The total is never negative: a discount larger than the rest of the order gives 0.
- A `total` passed by the caller is ignored, so it can be left out. On update, tax is recalculated only when the items, `subtotal`, `discount`, `shipping` or an address actually differ from the stored order, and the total only when an amount differs. A status or tracking update, or re-saving an unchanged order in the admin UI, leaves both as they were.
- The total is rounded with [`roundMoney`](#money).
- To show the same total before the order exists (for example on a cart page), use `ecommerce.orders.calculateTotal({ subtotal, discount, tax, shipping })`, which rounds the same way. The exported `calculateOrderTotal(parts, roundMoney?)` is the function behind it; without its second argument it only removes floating point noise.

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

      // No need to round: the plugin rounds the result with `roundMoney`
      return taxableAmount * taxRate
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

### When the hook fails

An order is never saved without the tax the hook was supposed to calculate. When `calculateTax` throws, or returns something that is not a finite number, the create or update fails with:

```
Order was not created: tax could not be calculated (<the hook's error message>)
```

(`not updated` for an update.) The hook's own error is on the thrown error's `cause`. Tax is calculated before anything is written, so a failed create leaves no order, takes no stock and counts no coupon use, `createOrderFromCart` leaves the cart as it was, and a failed update changes nothing — a cancellation in that same update does not happen either. The error is a server error (HTTP 500 through the REST API), not a validation error.

Because the hook only runs on an update that changes an item, amount or address, a status or tracking update still works while your tax service is down. If you would rather accept orders without tax in that case, catch the error inside your hook and return a fallback amount.

## Inventory and Order Side Effects

Products with `inventory.trackQuantity` have stock. A variant with its own `inventory` number is tracked separately; an order line without a variant, or for a variant whose `inventory` is empty, draws from the product's `inventory.quantity`. There is no backorder option: a tracked product cannot be ordered beyond its stock.

When an order is created (any status except `cancelled` / `refunded`):

1. Stock is checked first. An order asking for more than is available is rejected with a validation error on `items` such as `Not enough stock for "Blue Shirt" (variant "M"): 3 requested, 1 available`. Lines for the same product are added up. The error also carries the product, variant and quantities as data (see [When an order is rejected](#when-an-order-is-rejected)).
2. Stock is reduced and the coupon's `usageCount` is incremented, each with one conditional database statement, so concurrent orders cannot oversell the last units or take a coupon past its `usageLimit`. The order that loses such a race is rejected.
3. The `afterCreateOrder` hook runs.

If any of these steps fails, the order is not created: inside a database transaction everything is rolled back, and on a database without transactions (the SQLite adapter's default) the plugin puts back what it took and deletes the order.

The order records what it holds in two read-only fields, `inventoryReduced` and `couponUsageCounted`. When its status changes to `cancelled` or `refunded`, the stock is put back and the coupon use is given back, once; later updates do nothing more. "Once" also holds when the order is cancelled and refunded at the same moment, or cancelled twice by a double submit: each flag is cleared with one conditional database statement, and only the update that clears it gives anything back. The flags are written when the order is created and by that statement only; an update never writes them, so a value passed by a caller is ignored. Not handled: editing the items of an existing order does not adjust stock, and reopening a cancelled order does not take stock again.

Limits:

- The atomic statements are implemented for MongoDB and for the SQL adapters (SQLite, Postgres). With another adapter, or when the product stock, coupon usage or order flag columns have custom database names, the plugin falls back to read-then-write, which can oversell or restore twice under concurrency. It logs a warning the first time that happens (`[payload-ecommerce] No atomic … update …`), because the statements use parts of the adapters that are not public API. The plugin's tests assert that the atomic statements are used on SQLite and MongoDB on Payload 3.37 and 3.94; if you see the warning after a Payload upgrade, please open an issue.
- On MongoDB, concurrent orders in transactions that touch the same product can fail with MongoDB's transient "write conflict" error even when enough stock is left. Nothing is oversold; retry the order.
- Simultaneous updates of the same order are otherwise handled by Payload and the database, not by the plugin: without transactions (the SQLite adapter's default) Payload can reject all but one of them, and an edit that was read before a cancellation and written after it can put the old status back. In both cases the order's stock and coupon use are still given back at most once, and an order left open that way still holds them.

### When an order is rejected

An order that is refused for its stock or its coupon fails with an `OrderRejectedError`, whether it was created with `createOrderFromCart`, the Local API, REST or the admin panel. It is a Payload `ValidationError` (HTTP 400, reported on `items` or `coupon`) whose `message` is the English reason, and it carries the cause as data, so you do not have to match on the text. `getOrderRejection(error)` returns that cause, or `undefined` for any other error:

```typescript
import { getOrderRejection } from '@xtr-dev/payload-ecommerce'

try {
  order = await ecommerce.orders.createOrderFromCart({ cartId, orderData })
} catch (error) {
  const rejection = getOrderRejection(error)
  if (!rejection) throw error // not a refusal: a missing address, a failing hook, the database

  if (rejection.type === 'stock') {
    // { type: 'stock', reason: 'out_of_stock', product, variant?, requested, available? }
    return { error: 'Some items in your cart are sold out', product: rejection.product }
  }
  // { type: 'coupon', reason: CouponRefusalReason, minPurchase? }
  return { error: couponMessages[rejection.reason] }
}
```

| `type` | `reason` | Other fields |
| --- | --- | --- |
| `stock` | `out_of_stock` | `product`: id of the product that is short. `variant`: the variant's name, when the variant has its own stock number and that is what is short. `requested`: units the order asks for, added up over its lines for that stock. `available`: units in stock when the order was checked |
| `coupon` | a [`CouponRefusalReason`](#coupons-1), the same value `validateCoupon` gives | `minPurchase` when the reason is `min_purchase` |

`available` is absent when the order passed the stock check and then lost the last units to a simultaneous order, because the number it read is out of date by then; read the product again if you want to show one. A coupon whose last use was taken the same way is rejected with `usage_limit`. `createOrderFromCart` with a `couponCode` that no coupon has is rejected with `not_found`.

The same object is on the error as `error.rejection` and `error.data.rejection`. Payload sends `data` in REST and GraphQL error responses, so a client of those can pass `errors[0]` of the response body to `getOrderRejection`. The types are exported as `OrderRejection`, `StockOrderRejection` and `CouponOrderRejection`, and the class as `OrderRejectedError`. `getOrderRejection` is the safer check of the two: `instanceof` fails when a bundler ends up with two copies of the plugin.

The helpers `ecommerce.products.checkInventory`, `reduceInventory` (throws when stock is short) and `restoreInventory`, and `ecommerce.coupons.incrementCouponUsage` / `decrementCouponUsage` use the same atomic statements, for stock movements that are not orders. They take an optional `{ req }` as last argument to run inside a transaction.

## Not included

- Payments, emails and shipping rates. Set `paymentStatus`, `shipping` and the like from your own integration (the demo uses @xtr-dev/payload-billing).
- REST endpoints for carts and checkout, and React hooks or components. Call `getEcommerce(payload)` from your own server actions or route handlers, as the demo does.

## Development

```bash
# Install dependencies
pnpm install

# Run demo with hot reload
pnpm dev

# Build the plugin
pnpm build

# Checks run by CI and before a release
pnpm typecheck   # src, then the helper result types against the built declarations (dev/type-tests)
pnpm lint
pnpm test        # integration tests (vitest) on a temporary SQLite database
pnpm test:mongo  # the same tests on an in-memory MongoDB replica set
pnpm test:pack   # build, pack and import every published export

# Browser tests against the demo (not part of CI)
pnpm test:e2e
```

`pnpm test:mongo` downloads a MongoDB server binary on its first run (`mongodb-memory-server`). The demo itself runs on MongoDB when `DATABASE_ADAPTER=mongodb` and `DATABASE_URI` (a MongoDB connection string) are set; SQLite is the default.

## License

MIT © [xtr.dev](https://github.com/xtr-dev)
