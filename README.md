# Payload eCommerce

> A complete eCommerce solution plugin for PayloadCMS 3.x

[![npm version](https://img.shields.io/npm/v/@xtr-dev/payload-ecommerce.svg)](https://www.npmjs.com/package/@xtr-dev/payload-ecommerce)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

⚠️ **Pre-release Software** - This package is currently in active development (v0.0.x). Breaking changes may occur before v1.0.0. Not recommended for production use.

## Features

- 🛍️ **Complete Product Management** - Products with variants, categories, and inventory tracking
- 🛒 **Shopping Cart** - Persistent cart functionality with session support
- 📦 **Order Management** - Full order lifecycle from checkout to fulfillment
- 💳 **Payment Integration** - Ready for Stripe, PayPal, and other payment gateways
- 🏷️ **Discounts & Coupons** - Flexible promotion system
- 📧 **Order Notifications** - Automated email notifications for orders
- 🎨 **Customizable** - Extend collections and add custom fields
- 🔒 **TypeScript** - Full type safety with generated types
- 👤 **User Integration** - Works with your existing user/auth collection

## Installation

```bash
# npm
npm install @xtr-dev/payload-ecommerce

# pnpm
pnpm add @xtr-dev/payload-ecommerce

# yarn
yarn add @xtr-dev/payload-ecommerce
```

## Quick Start

### 1. Add to Payload Config

```typescript
import { buildConfig } from 'payload'
import { payloadEcommerce } from '@xtr-dev/payload-ecommerce'

export default buildConfig({
  plugins: [
    payloadEcommerce({
      // Optional: Customize collection slugs
      collections: {
        products: 'products',
        orders: 'orders',
        categories: 'categories',
      },
      // Specify your existing user collection
      userCollection: 'users', // or whatever your auth collection is named
      // Optional: Configure payment providers
      payments: {
        providers: ['stripe', 'paypal'],
        currency: 'USD',
      },
      // Optional: Email notifications
      emails: {
        enabled: true,
        from: 'orders@yourstore.com',
      },
    }),
  ],
  // ... rest of your config
})
```

### 2. Set Environment Variables

```env
# Payment Gateway (Stripe example)
PAYLOAD_ECOMMERCE_STRIPE_SECRET_KEY=sk_test_...
PAYLOAD_ECOMMERCE_STRIPE_PUBLISHABLE_KEY=pk_test_...

# Email (if using email notifications)
PAYLOAD_ECOMMERCE_SMTP_HOST=smtp.example.com
PAYLOAD_ECOMMERCE_SMTP_PORT=587
PAYLOAD_ECOMMERCE_SMTP_USER=your-email@example.com
PAYLOAD_ECOMMERCE_SMTP_PASS=your-password

# Store Settings
PAYLOAD_ECOMMERCE_STORE_NAME=My Store
PAYLOAD_ECOMMERCE_STORE_URL=https://mystore.com
```

### 3. Run Payload

```bash
npm run dev
```

The plugin will automatically create all required collections and relationships.

## Collections

The plugin integrates with your existing user/auth collection and creates the following collections:

### Products

Complete product management with variants and inventory.

**Fields:**
- `title` (string, required) - Product name
- `slug` (string, unique) - URL-friendly identifier
- `description` (richText) - Product description
- `price` (number, required) - Base price
- `compareAtPrice` (number) - Original price for showing discounts
- `sku` (string) - Stock keeping unit
- `barcode` (string) - Product barcode
- `inventory` (group)
  - `trackQuantity` (boolean) - Enable inventory tracking
  - `quantity` (number) - Available stock
  - `lowStockThreshold` (number) - Alert threshold
- `images` (relationship: media[]) - Product images
- `categories` (relationship: categories[]) - Product categories
- `variants` (array) - Product variants (size, color, etc.)
  - `name` (string) - Variant name
  - `sku` (string) - Variant SKU
  - `price` (number) - Variant price override
  - `inventory` (number) - Variant stock
- `status` (select) - draft | active | archived

**Hooks:**
- `beforeChange` - Auto-generate slug from title
- `beforeValidate` - Calculate discounts
- `afterChange` - Update search index

### Categories

Organize products into hierarchical categories.

**Fields:**
- `name` (string, required) - Category name
- `slug` (string, unique) - URL-friendly identifier
- `description` (textarea) - Category description
- `parent` (relationship: categories) - Parent category for nesting

### Orders

Complete order management from checkout to fulfillment.

**Fields:**
- `orderNumber` (string, unique) - Auto-generated order number
- `user` (relationship: users) - User who placed the order
- `items` (array) - Order items
  - `product` (relationship: products)
  - `variant` (string) - Selected variant
  - `quantity` (number)
  - `price` (number) - Price at time of purchase
  - `total` (number) - Line total
- `subtotal` (number) - Items total
- `tax` (number) - Tax amount
- `shipping` (number) - Shipping cost
- `discount` (number) - Discount amount
- `total` (number) - Final total
- `status` (select) - pending | processing | shipped | delivered | cancelled | refunded
- `paymentStatus` (select) - pending | paid | failed | refunded
- `paymentMethod` (string) - Payment method used
- `paymentId` (string) - Payment gateway transaction ID
- `shippingAddress` (group)
  - `firstName` (string)
  - `lastName` (string)
  - `address1` (string)
  - `address2` (string)
  - `city` (string)
  - `state` (string)
  - `postalCode` (string)
  - `country` (string)
  - `phone` (string)
- `billingAddress` (group) - Same structure as shipping
- `notes` (textarea) - Order notes
- `coupon` (relationship: coupons) - Applied coupon
- `trackingNumber` (string) - Shipment tracking
- `trackingUrl` (string) - Tracking URL

**Hooks:**
- `beforeCreate` - Generate order number, validate inventory
- `afterCreate` - Send confirmation email, reduce inventory
- `afterChange` - Send status update emails

### Carts

Persistent shopping cart functionality.

**Fields:**
- `user` (relationship: users) - Logged-in user (optional)
- `sessionId` (string) - Session ID for guest users
- `items` (array)
  - `product` (relationship: products)
  - `variant` (string)
  - `quantity` (number)
- `subtotal` (number) - Auto-calculated
- `expiresAt` (date) - Cart expiration (default: 30 days)

**Hooks:**
- `beforeChange` - Calculate totals, validate inventory
- `beforeDelete` - Cleanup expired carts

### Coupons

Flexible discount and promotion system.

**Fields:**
- `code` (string, unique, required) - Coupon code
- `description` (text) - Internal description
- `type` (select) - percentage | fixed | freeShipping
- `value` (number) - Discount value
- `minPurchase` (number) - Minimum order amount
- `maxDiscount` (number) - Maximum discount cap
- `usageLimit` (number) - Total usage limit
- `usageCount` (number) - Current usage count
- `customerLimit` (number) - Per-customer limit
- `validFrom` (date) - Start date
- `validUntil` (date) - End date
- `status` (select) - active | inactive | expired
- `appliesToProducts` (relationship: products[]) - Specific products
- `appliesToCategories` (relationship: categories[]) - Specific categories

**Hooks:**
- `beforeChange` - Validate dates, update status

## API Usage

### Creating a Product

```typescript
const product = await payload.create({
  collection: 'products',
  data: {
    title: 'Awesome T-Shirt',
    price: 29.99,
    description: {
      root: {
        children: [
          {
            type: 'paragraph',
            children: [{ text: 'A really awesome t-shirt!' }],
          },
        ],
      },
    },
    inventory: {
      trackQuantity: true,
      quantity: 100,
    },
    status: 'active',
  },
})
```

### Creating an Order

```typescript
const order = await payload.create({
  collection: 'orders',
  data: {
    user: userId, // ID from your existing user collection
    items: [
      {
        product: productId,
        quantity: 2,
        price: 29.99,
        total: 59.98,
      },
    ],
    subtotal: 59.98,
    tax: 5.40,
    shipping: 10.00,
    total: 75.38,
    status: 'pending',
    paymentStatus: 'pending',
    shippingAddress: {
      firstName: 'John',
      lastName: 'Doe',
      address1: '123 Main St',
      city: 'New York',
      state: 'NY',
      postalCode: '10001',
      country: 'US',
    },
  },
})
```

### Applying a Coupon

```typescript
const coupon = await payload.find({
  collection: 'coupons',
  where: {
    code: { equals: 'SAVE10' },
    status: { equals: 'active' },
  },
})

if (coupon.docs.length > 0) {
  const discount = calculateDiscount(cart.subtotal, coupon.docs[0])
  // Apply discount to order
}
```

### Searching Products

```typescript
const products = await payload.find({
  collection: 'products',
  where: {
    and: [
      {
        status: { equals: 'active' },
      },
      {
        or: [
          { title: { contains: 'shirt' } },
          { description: { contains: 'shirt' } },
        ],
      },
    ],
  },
  sort: '-createdAt',
  limit: 20,
})
```

## Frontend Integration

### Next.js Example

```typescript
// app/products/[slug]/page.tsx
import { getPayload } from 'payload'
import config from '@payload-config'

export async function generateStaticParams() {
  const payload = await getPayload({ config })
  const products = await payload.find({
    collection: 'products',
    where: { status: { equals: 'active' } },
  })

  return products.docs.map((product) => ({
    slug: product.slug,
  }))
}

export default async function ProductPage({
  params,
}: {
  params: { slug: string }
}) {
  const payload = await getPayload({ config })
  const product = await payload.find({
    collection: 'products',
    where: { slug: { equals: params.slug } },
  })

  if (!product.docs.length) {
    notFound()
  }

  return (
    <div>
      <h1>{product.docs[0].title}</h1>
      <p>${product.docs[0].price}</p>
      {/* Add to cart button, etc. */}
    </div>
  )
}
```

### Cart Management

```typescript
// lib/cart.ts
export async function addToCart(
  productId: string,
  quantity: number,
  sessionId: string
) {
  const payload = await getPayload({ config })

  // Find or create cart
  let cart = await payload.find({
    collection: 'carts',
    where: { sessionId: { equals: sessionId } },
  })

  if (!cart.docs.length) {
    cart = await payload.create({
      collection: 'carts',
      data: {
        sessionId,
        items: [{ product: productId, quantity }],
      },
    })
  } else {
    // Update existing cart
    const items = cart.docs[0].items
    const existingItem = items.find((item) => item.product === productId)

    if (existingItem) {
      existingItem.quantity += quantity
    } else {
      items.push({ product: productId, quantity })
    }

    cart = await payload.update({
      collection: 'carts',
      id: cart.docs[0].id,
      data: { items },
    })
  }

  return cart
}
```

## Configuration Options

```typescript
interface PayloadEcommerceConfig {
  // Your existing user/auth collection slug
  userCollection: string

  // Extend user collection with ecommerce fields
  extendUserCollection?: boolean

  // Collection slugs (customize if needed)
  collections?: {
    products?: string
    orders?: string
    categories?: string
    carts?: string
    coupons?: string
  }

  // Payment configuration
  payments?: {
    providers: ('stripe' | 'paypal' | 'square')[]
    currency: string
    testMode?: boolean
  }

  // Email notifications
  emails?: {
    enabled: boolean
    from: string
    templates?: {
      orderConfirmation?: string
      orderShipped?: string
      orderDelivered?: string
    }
  }

  // Inventory management
  inventory?: {
    trackByDefault: boolean
    allowBackorders: boolean
    lowStockThreshold: number
  }

  // Tax configuration
  tax?: {
    enabled: boolean
    rate?: number
    calculateAutomatically?: boolean
  }

  // Shipping
  shipping?: {
    enabled: boolean
    freeShippingThreshold?: number
    rates?: Array<{
      name: string
      price: number
      minOrder?: number
    }>
  }

  // Hooks for customization
  hooks?: {
    beforeCreateOrder?: (order: Order) => Promise<Order>
    afterCreateOrder?: (order: Order) => Promise<void>
    beforePayment?: (order: Order) => Promise<void>
    afterPayment?: (order: Order, paymentResult: any) => Promise<void>
  }
}
```

## Testing

The plugin includes comprehensive test coverage:

```bash
# Run all tests
pnpm test

# Run integration tests
pnpm test:int

# Run e2e tests
pnpm test:e2e

# Generate TypeScript types
pnpm generate:types
```

## Development

```bash
# Clone the repository
git clone https://github.com/xtr-dev/payload-ecommerce.git

# Install dependencies
pnpm install

# Start development server
pnpm dev

# Build the plugin
pnpm build
```

The development environment runs a full Payload instance with all collections at `http://localhost:3000`.

**Default credentials:**
- Email: `dev@payloadcms.com`
- Password: `test`

## License

MIT © [xtr.dev](https://github.com/xtr-dev)


## Related

- [PayloadCMS](https://payloadcms.com)
- [@xtr-dev/payload-mailing](https://github.com/xtr-dev/payload-mailing) - Email system for Payload
- [Payload Plugin Template](https://github.com/payloadcms/payload-plugin-template)
