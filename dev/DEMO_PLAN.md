# Demo App Implementation Plan

## Overview

This document outlines the implementation plan for a comprehensive demo application that showcases all features of the **payload-ecommerce** plugin. The demo will be a fully functional online store built with Next.js 15 and Payload CMS 3.x.

## Plugin Architecture Summary

### Collections

The plugin provides 5 core collections:

1. **Products** (`src/collections/Products.ts`)
   - Fields: title, slug, description, price, compareAtPrice, SKU, barcode
   - Inventory tracking: trackQuantity, quantity, lowStockThreshold
   - Relationships: images (media), categories
   - Variants: name, SKU, price override, inventory
   - Status: draft, active, archived
   - Auto-generated slugs from titles

2. **Categories** (`src/collections/Categories.ts`)
   - Hierarchical product organization
   - Fields: name, slug, description, parent (self-referential)

3. **Orders** (`src/collections/Orders.ts`)
   - Auto-generated order numbers (ORD-{timestamp}-{random})
   - Order items with product references, quantities, prices
   - Pricing: subtotal, tax, shipping, discount, total
   - Status tracking: pending, processing, shipped, delivered, cancelled, refunded
   - Payment tracking: status, method, transaction ID
   - Shipping/billing addresses
   - Coupon support
   - Tracking numbers and URLs
   - Hooks: beforeCreateOrder, afterCreateOrder (reduces inventory, increments coupon usage)

4. **Carts** (`src/collections/Carts.ts`)
   - User or session-based carts
   - Items with product references, variants, quantities
   - Auto-calculated subtotal
   - 30-day expiration
   - Inventory validation

5. **Coupons** (`src/collections/Coupons.ts`)
   - Discount types: percentage, fixed, freeShipping
   - Validation: min purchase, max discount, usage limits
   - Date range validity
   - Product/category restrictions

### Utilities

**Server-side** (`src/lib/useEcommerce.ts`):
- `cart` helpers: addToCart, updateCartItem, getCart, removeFromCart
- `orders` helpers: createOrderFromCart, updateOrderStatus, getUserOrders
- `products` helpers: getProduct, getProducts, checkInventory, reduceInventory
- `coupons` helpers: validateCoupon, incrementCouponUsage

**Client-side** (`src/exports/client.tsx`):
- `useCart()` - React hook for cart operations
- `useProducts()` - React hook for product queries
- `useOrders()` - React hook for order management

## Demo App Structure

```
dev/
├── app/
│   ├── (storefront)/              # Customer-facing pages
│   │   ├── layout.tsx              # Storefront layout with nav/footer
│   │   ├── page.tsx                # Homepage
│   │   ├── products/
│   │   │   ├── page.tsx            # Products listing
│   │   │   └── [slug]/
│   │   │       └── page.tsx        # Product detail
│   │   ├── categories/
│   │   │   └── [slug]/
│   │   │       └── page.tsx        # Category products
│   │   ├── cart/
│   │   │   └── page.tsx            # Shopping cart
│   │   ├── checkout/
│   │   │   └── page.tsx            # Checkout flow
│   │   ├── account/
│   │   │   └── orders/
│   │   │       ├── page.tsx        # Orders list
│   │   │       └── [id]/
│   │   │           └── page.tsx    # Order detail
│   │   └── orders/
│   │       └── [id]/
│   │           └── confirmation/
│   │               └── page.tsx    # Order confirmation
│   ├── (payload)/                 # Payload admin (existing)
│   │   └── ...
│   ├── api/
│   │   ├── cart/
│   │   │   ├── add/route.ts
│   │   │   ├── update/route.ts
│   │   │   ├── remove/route.ts
│   │   │   └── me/route.ts
│   │   ├── checkout/
│   │   │   └── create-order/route.ts
│   │   ├── coupons/
│   │   │   └── validate/route.ts
│   │   └── products/
│   │       └── search/route.ts
│   └── components/                # Shared components
│       ├── storefront/
│       │   ├── ProductCard.tsx
│       │   ├── CartWidget.tsx
│       │   ├── Navigation.tsx
│       │   ├── Footer.tsx
│       │   ├── ProductGrid.tsx
│       │   ├── AddressForm.tsx
│       │   ├── OrderSummary.tsx
│       │   ├── CouponInput.tsx
│       │   ├── PriceDisplay.tsx
│       │   ├── InventoryBadge.tsx
│       │   ├── OrderStatusBadge.tsx
│       │   └── LoadingSpinner.tsx
│       └── ui/
│           ├── Button.tsx
│           ├── Input.tsx
│           ├── Select.tsx
│           └── Badge.tsx
├── lib/
│   ├── cart-client.ts             # Client-side cart utilities
│   ├── formatters.ts              # Price, date formatting
│   ├── session.ts                 # Session management for guest carts
│   └── validations.ts             # Form validation schemas
├── styles/
│   └── storefront.css             # Storefront-specific styles
├── public/
│   └── products/                  # Sample product images
├── seed.ts                        # Enhanced seed data
├── seed-data/                     # Seed data utilities
│   ├── products.ts
│   ├── categories.ts
│   └── coupons.ts
├── payload.config.ts              # Existing config
└── README.md                      # Demo documentation
```

## Page Specifications

### 1. Homepage (`/`)

**Purpose**: Landing page showcasing the store

**Features**:
- Hero section with promotional banner
- Featured products carousel
- Category cards with images
- Latest products grid
- Newsletter signup (optional)

**Components**:
- `Hero` - Main banner with CTA
- `FeaturedProducts` - Carousel of featured items
- `CategoryCards` - Visual category navigation
- `ProductGrid` - Latest products

### 2. Products Listing (`/products`)

**Purpose**: Browse all products with filtering/sorting

**Features**:
- Product grid (responsive: 1-4 columns)
- Category filter sidebar
- Price range filter
- Search bar
- Sort options (price, newest, name)
- Pagination
- View toggle (grid/list)
- Results count

**Query Parameters**:
- `?category=slug` - Filter by category
- `?search=term` - Search query
- `?sort=price_asc|price_desc|newest|name`
- `?minPrice=0&maxPrice=1000`
- `?page=1`

**Components**:
- `ProductGrid` - Product display
- `FilterSidebar` - Filters
- `SortDropdown` - Sort options
- `Pagination` - Page navigation
- `ProductCard` - Individual product

### 3. Product Detail (`/products/[slug]`)

**Purpose**: View product details and add to cart

**Features**:
- Image gallery (main + thumbnails)
- Product title, price, compare-at-price
- SKU and availability
- Variant selector (if variants exist)
- Quantity selector
- Add to cart button
- Product description (rich text)
- Related products
- Breadcrumb navigation

**Components**:
- `ImageGallery` - Product images
- `VariantSelector` - Size/color selection
- `QuantityInput` - Quantity picker
- `AddToCartButton` - Add to cart
- `RelatedProducts` - Related items
- `PriceDisplay` - Price formatting
- `InventoryBadge` - Stock status

### 4. Category Page (`/categories/[slug]`)

**Purpose**: View products in a specific category

**Features**:
- Category name and description
- Subcategories (if any)
- Products in category
- Same filtering/sorting as products listing
- Breadcrumb with parent categories

**Components**:
- Reuses `ProductGrid`, `FilterSidebar`, etc.
- `CategoryHeader` - Category info
- `SubcategoryLinks` - Child categories

### 5. Shopping Cart (`/cart`)

**Purpose**: Review and manage cart items

**Features**:
- Cart items list with:
  - Product image
  - Title and variant
  - Price (unit + line total)
  - Quantity updater
  - Remove button
- Empty cart state
- Coupon code input
- Cart totals:
  - Subtotal
  - Discount (if coupon applied)
  - Tax (calculated)
  - Shipping (calculated)
  - Total
- Continue shopping button
- Proceed to checkout button

**Components**:
- `CartItem` - Individual cart item
- `CouponInput` - Coupon code field
- `CartTotals` - Price breakdown
- `EmptyCart` - Empty state

### 6. Checkout (`/checkout`)

**Purpose**: Complete order with shipping/billing info

**Features**:
- Multi-step form:
  1. **Shipping Information**
     - First/last name
     - Address (line 1, line 2)
     - City, state, postal code, country
     - Phone
  2. **Billing Information**
     - Same as shipping checkbox
     - Billing fields (if different)
  3. **Order Review**
     - Cart items summary
     - Shipping/billing addresses
     - Order totals
  4. **Payment** (mock for demo)
     - Payment method selection
     - Mock payment form
- Order summary sidebar (always visible)
- Form validation
- Step navigation
- Place order button

**Components**:
- `CheckoutSteps` - Step indicator
- `AddressForm` - Shipping/billing form
- `OrderReview` - Final review
- `PaymentMock` - Mock payment
- `OrderSummary` - Cart summary

### 7. Order Confirmation (`/orders/[id]/confirmation`)

**Purpose**: Confirm successful order placement

**Features**:
- Success message
- Order number
- Order details:
  - Items purchased
  - Quantities and prices
  - Total paid
- Shipping/billing addresses
- Payment method
- Estimated delivery
- Continue shopping button
- View order details button

**Components**:
- `OrderConfirmation` - Success message
- `OrderDetails` - Order info
- `OrderItems` - Items list

### 8. Account Orders (`/account/orders`)

**Purpose**: View order history

**Features**:
- List of user's orders
- Order cards with:
  - Order number
  - Date
  - Total
  - Status badge
  - Items preview
  - View details link
- Empty state (no orders)
- Pagination for many orders

**Components**:
- `OrderCard` - Order summary card
- `OrderStatusBadge` - Status indicator
- `EmptyOrders` - No orders state

### 9. Order Detail (`/account/orders/[id]`)

**Purpose**: View detailed order information

**Features**:
- Order number and date
- Order status with timeline
- Items list with images
- Pricing breakdown
- Shipping/billing addresses
- Payment information
- Tracking information (if shipped)
- Download invoice button (future)
- Reorder button
- Cancel order (if pending)

**Components**:
- `OrderStatus` - Status timeline
- `OrderItems` - Items list
- `OrderAddresses` - Addresses display
- `TrackingInfo` - Tracking link

## Shared Components

### UI Components

1. **Button** - Primary, secondary, outline variants
2. **Input** - Text input with validation states
3. **Select** - Dropdown selector
4. **Badge** - Status indicators
5. **Card** - Content container
6. **Modal** - Overlay dialogs
7. **Toast** - Notification messages

### Storefront Components

1. **Navigation**
   - Logo/home link
   - Category menu
   - Search bar
   - Cart widget (with item count)
   - User menu (login/account)

2. **Footer**
   - Links (About, Contact, Terms, Privacy)
   - Social media
   - Newsletter signup
   - Copyright

3. **ProductCard**
   - Product image
   - Title
   - Price (with compare-at)
   - Quick add button
   - Out of stock badge

4. **CartWidget**
   - Cart icon with badge count
   - Dropdown mini-cart preview
   - View cart / checkout buttons

5. **PriceDisplay**
   - Formatted price
   - Compare-at-price (strikethrough)
   - Discount percentage
   - Currency symbol

6. **InventoryBadge**
   - In stock (green)
   - Low stock (yellow)
   - Out of stock (red)
   - Stock count

7. **LoadingSpinner**
   - Full page loading
   - Inline loading
   - Button loading state

## API Routes

### Cart API

**POST /api/cart/add**
- Add item to cart
- Body: `{ productId, quantity, variant? }`
- Returns: Updated cart

**POST /api/cart/update**
- Update item quantity
- Body: `{ productId, quantity, variant? }`
- Returns: Updated cart

**POST /api/cart/remove**
- Remove item from cart
- Body: `{ productId, variant? }`
- Returns: Updated cart

**GET /api/cart/me**
- Get current user's cart
- Returns: Cart with items populated

### Checkout API

**POST /api/checkout/create-order**
- Create order from cart
- Body: `{ cartId, shippingAddress, billingAddress, paymentMethod }`
- Returns: Created order

### Coupon API

**POST /api/coupons/validate**
- Validate coupon code
- Body: `{ code, cartTotal, productIds, userId? }`
- Returns: `{ valid, discount, message }`

### Products API

**GET /api/products/search**
- Search products
- Query: `?q=search_term`
- Returns: Matching products

## Enhanced Seed Data

### Categories (10 items)

```typescript
const categories = [
  { name: 'Electronics', slug: 'electronics', parent: null },
  { name: 'Laptops', slug: 'laptops', parent: 'electronics' },
  { name: 'Smartphones', slug: 'smartphones', parent: 'electronics' },
  { name: 'Accessories', slug: 'accessories', parent: 'electronics' },
  { name: 'Clothing', slug: 'clothing', parent: null },
  { name: 'Men', slug: 'men', parent: 'clothing' },
  { name: 'Women', slug: 'women', parent: 'clothing' },
  { name: 'Home & Garden', slug: 'home-garden', parent: null },
  { name: 'Furniture', slug: 'furniture', parent: 'home-garden' },
  { name: 'Decor', slug: 'decor', parent: 'home-garden' },
]
```

### Products (20 items)

**Electronics:**
- MacBook Pro 16" - $2499 (with variants: M2 Pro, M2 Max)
- iPhone 15 Pro - $999 (variants: 128GB, 256GB, 512GB, colors)
- iPad Air - $599
- AirPods Pro - $249
- Magic Keyboard - $99
- USB-C Hub - $49

**Clothing:**
- Classic White T-Shirt - $29 (variants: S, M, L, XL)
- Slim Fit Jeans - $79 (variants: 30-38, colors)
- Hooded Sweatshirt - $59 (variants: S-XXL, colors)
- Running Shoes - $129 (variants: sizes 7-13)
- Leather Jacket - $299 (variants: S-XL)
- Summer Dress - $89 (variants: XS-L, colors)

**Home & Garden:**
- Office Chair - $399
- Standing Desk - $699
- Table Lamp - $79
- Throw Pillow Set - $49
- Wall Art Canvas - $129
- Plant Pot Set - $39
- Bookshelf - $249
- Area Rug - $199

### Coupons (5 items)

```typescript
const coupons = [
  {
    code: 'WELCOME10',
    type: 'percentage',
    value: 10,
    description: '10% off for new customers',
    minPurchase: 50,
    status: 'active',
  },
  {
    code: 'SAVE20',
    type: 'percentage',
    value: 20,
    description: '20% off orders over $200',
    minPurchase: 200,
    maxDiscount: 100,
    status: 'active',
  },
  {
    code: 'FREESHIP',
    type: 'freeShipping',
    description: 'Free shipping on all orders',
    minPurchase: 100,
    status: 'active',
  },
  {
    code: 'FIXED25',
    type: 'fixed',
    value: 25,
    description: '$25 off your order',
    minPurchase: 150,
    status: 'active',
  },
  {
    code: 'EXPIRED',
    type: 'percentage',
    value: 50,
    description: 'Expired coupon for testing',
    status: 'expired',
  },
]
```

### Sample Orders (3 items)

Create sample orders for the dev user to demonstrate order history.

## Styling Guidelines

### Design System

- **Colors**:
  - Primary: Blue (#3B82F6)
  - Success: Green (#10B981)
  - Warning: Yellow (#F59E0B)
  - Danger: Red (#EF4444)
  - Neutral: Gray scale

- **Typography**:
  - Headings: font-bold
  - Body: font-normal
  - Prices: font-semibold

- **Spacing**:
  - Container: max-w-7xl mx-auto px-4
  - Sections: py-8 lg:py-12
  - Cards: p-4 lg:p-6

- **Responsive Breakpoints**:
  - sm: 640px
  - md: 768px
  - lg: 1024px
  - xl: 1280px

### Component Patterns

- Cards: `bg-white rounded-lg shadow-md border`
- Buttons: `px-4 py-2 rounded-md font-medium transition`
- Inputs: `border border-gray-300 rounded-md px-3 py-2`
- Badges: `inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium`

## Implementation Phases

### Phase 1: Foundation (Days 1-2)
- [ ] Enhanced seed data with categories, products, coupons
- [ ] Basic UI components (Button, Input, Badge, Card)
- [ ] Storefront layout with navigation and footer
- [ ] Homepage with featured products

### Phase 2: Product Discovery (Days 3-4)
- [ ] Products listing page with filters
- [ ] Product detail page
- [ ] Category pages
- [ ] Search functionality
- [ ] ProductCard and ProductGrid components

### Phase 3: Shopping Cart (Days 5-6)
- [ ] Cart API routes
- [ ] Shopping cart page
- [ ] CartWidget in navigation
- [ ] Add to cart functionality
- [ ] Cart persistence (session-based)

### Phase 4: Checkout (Days 7-8)
- [ ] Checkout flow (multi-step)
- [ ] AddressForm component
- [ ] Coupon validation
- [ ] Order creation
- [ ] Order confirmation page

### Phase 5: Order Management (Days 9-10)
- [ ] Order history page
- [ ] Order detail page
- [ ] Order status tracking
- [ ] Order timeline/status badges

### Phase 6: Polish & Testing (Days 11-12)
- [ ] Responsive design refinement
- [ ] Loading states and error handling
- [ ] Form validation
- [ ] UX improvements
- [ ] End-to-end testing
- [ ] Documentation

## Testing Strategy

### User Flows to Test

1. **Browse & Search**
   - View homepage
   - Browse all products
   - Filter by category
   - Search for products
   - Sort products

2. **Product Discovery**
   - View product details
   - Select variants
   - Check inventory status
   - View related products

3. **Shopping Cart**
   - Add items to cart
   - Update quantities
   - Remove items
   - Apply coupon codes
   - View cart totals

4. **Checkout Process**
   - Enter shipping address
   - Enter billing address
   - Review order
   - Place order
   - View confirmation

5. **Order Management**
   - View order history
   - View order details
   - Track order status

### Edge Cases

- Out of stock products
- Invalid coupon codes
- Expired coupons
- Cart expiration
- Inventory changes during checkout
- Empty cart checkout attempt
- Invalid addresses
- Form validation errors

## Success Criteria

The demo app will be considered complete when:

1. ✅ All 5 collections have comprehensive seed data
2. ✅ All core pages are functional and responsive
3. ✅ Complete user flow from browse to order works end-to-end
4. ✅ All ecommerce features are demonstrated:
   - Product variants and inventory
   - Shopping cart with persistence
   - Coupon validation and application
   - Multi-step checkout
   - Order creation and tracking
5. ✅ Clean, modern UI with consistent styling
6. ✅ Proper error handling and loading states
7. ✅ Documentation explaining how to run and use the demo

## Future Enhancements (Post-MVP)

- User authentication and account creation
- Wishlist/favorites
- Product reviews and ratings
- Advanced search with filters
- Product recommendations
- Email notifications
- Payment gateway integration (Stripe)
- Admin dashboard customization
- Analytics and reporting
- Multi-currency support
- Inventory alerts
- Abandoned cart recovery

## Running the Demo

```bash
# Install dependencies
pnpm install

# Set up environment
cp dev/.env.example dev/.env

# Start dev server
pnpm dev

# Access demo
# Storefront: http://localhost:3000
# Admin: http://localhost:3000/admin

# Admin credentials
# Email: dev@payloadcms.com
# Password: test
```

## Notes

- The demo uses MongoDB Memory Server for testing (no external DB needed)
- Seed data is created automatically on startup via `onInit` hook
- All product images should be placeholder/sample images
- Payment processing is mocked (no real transactions)
- Email notifications use test adapter (logged to console)
