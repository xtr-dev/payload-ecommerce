# Payload Ecommerce Plugin - Demo Store

This is a fully functional demo ecommerce store built with **Next.js 15** and **Payload CMS 3.x**, showcasing all features of the **payload-ecommerce** plugin.

## 🚀 Features

This demo demonstrates a complete ecommerce solution with:

### Product Management
- ✅ Product catalog with images and variants
- ✅ Inventory tracking (quantity, low stock alerts)
- ✅ Product search and filtering
- ✅ Category organization (hierarchical)
- ✅ Price and compare-at-price support
- ✅ SKU and barcode tracking

### Shopping Experience
- ✅ Shopping cart with session persistence
- ✅ Add to cart / Update quantities / Remove items
- ✅ Coupon code validation and discounts
- ✅ Real-time inventory checking
- ✅ Product variants (sizes, colors, etc.)

### Checkout & Orders
- ✅ Multi-step checkout flow
- ✅ Shipping and billing address forms
- ✅ Order creation with automatic order numbers
- ✅ Order confirmation page
- ✅ Order history and tracking
- ✅ **Payment processing with @xtr-dev/payload-billing**
- ✅ **Test provider for local development**
- ✅ **Payment tracking and status display**

### Additional Features
- ✅ Responsive design (mobile, tablet, desktop)
- ✅ Clean, modern UI with Tailwind CSS
- ✅ SEO-friendly URLs with slugs
- ✅ Loading states and error handling
- ✅ Free shipping threshold ($100+)
- ✅ Automatic tax calculation (10%)

## 📁 Project Structure

```
dev/
├── app/
│   ├── (storefront)/              # Customer-facing pages
│   │   ├── layout.tsx              # Storefront layout with nav/footer
│   │   ├── page.tsx                # Homepage
│   │   ├── products/
│   │   │   ├── page.tsx            # Products listing
│   │   │   └── [slug]/page.tsx     # Product detail
│   │   ├── categories/
│   │   │   └── [slug]/page.tsx     # Category products
│   │   ├── cart/
│   │   │   └── page.tsx            # Shopping cart
│   │   ├── checkout/
│   │   │   └── page.tsx            # Checkout flow
│   │   ├── account/
│   │   │   └── orders/
│   │   │       ├── page.tsx        # Orders list
│   │   │       └── [id]/page.tsx   # Order detail
│   │   └── orders/
│   │       └── [id]/confirmation/
│   │           └── page.tsx        # Order confirmation
│   ├── api/
│   │   ├── cart/                   # Cart API routes
│   │   ├── checkout/               # Checkout API routes
│   │   └── coupons/                # Coupon validation
│   └── (payload)/                  # Payload admin
├── components/
│   ├── ui/                         # Reusable UI components
│   └── storefront/                 # Storefront components
├── lib/                            # Utilities
├── seed-data/                      # Seed data
└── styles/                         # CSS styles
```

## 🛠️ Technologies Used

- **Next.js 15** - React framework with App Router
- **Payload CMS 3.x** - Headless CMS
- **payload-ecommerce** - Ecommerce plugin
- **@xtr-dev/payload-billing** - Payment processing plugin
- **Tailwind CSS** - Utility-first CSS framework
- **TypeScript** - Type-safe development
- **SQLite** - Lightweight file-based database

## 🚦 Getting Started

### Prerequisites

- Node.js 18+ and pnpm
- No external database required (uses SQLite)

### Installation

1. **Install dependencies:**
   ```bash
   pnpm install
   ```

2. **Set up environment variables:**
   ```bash
   cp dev/.env.example dev/.env
   ```

3. **Start the development server:**
   ```bash
   pnpm dev
   ```

4. **Access the application:**
   - **Storefront:** http://localhost:3000
   - **Admin Panel:** http://localhost:3000/admin

5. **Login to admin:**
   - Email: `dev@payloadcms.com`
   - Password: `test`

## 📊 Seed Data

The demo automatically seeds the database on first run with:

- **10 Categories** - Electronics, Clothing, Home & Garden (with subcategories)
- **20 Products** - Including MacBook Pro, iPhone, clothing, furniture, and home decor
- **5 Coupons** - Various discount types (percentage, fixed, free shipping)

Coupon codes to try:
- `WELCOME10` - 10% off orders over $50
- `SAVE20` - 20% off orders over $200
- `FREESHIP` - Free shipping on orders over $100
- `FIXED25` - $25 off orders over $150

## 🧪 Testing User Flows

### 1. Browse Products
- Visit homepage to see featured products
- Click "Shop Now" or navigate to "All Products"
- Use category filters and sorting
- Search for products

### 2. Product Details
- Click any product to view details
- See variants (if available)
- Check inventory status
- Add to cart

### 3. Shopping Cart
- View cart items
- Update quantities
- Apply coupon codes
- See price calculations

### 4. Checkout
- Fill in shipping address
- Optionally use different billing address
- Select payment method (mock)
- Review and place order

### 5. Order Management
- View order confirmation
- Check order history at `/account/orders`
- View detailed order information

## 🎨 UI Components

### Base Components
- `Button` - Multiple variants (primary, secondary, outline, ghost, danger)
- `Input` - Form input with validation states
- `Select` - Dropdown selector
- `Badge` - Status indicators
- `Card` - Content containers

### Storefront Components
- `Navigation` - Top navigation with cart and search
- `Footer` - Site footer with links
- `ProductCard` - Product display card
- `ProductGrid` - Responsive product grid
- `PriceDisplay` - Price with discounts
- `InventoryBadge` - Stock status indicator
- `OrderStatusBadge` - Order status indicator
- `LoadingSpinner` - Loading states

## 🔌 API Routes

### Cart API
- `POST /api/cart/add` - Add item to cart
- `POST /api/cart/update` - Update cart item quantity
- `POST /api/cart/remove` - Remove item from cart
- `GET /api/cart/me` - Get current cart

### Checkout API
- `POST /api/checkout/create-order` - Create order from cart

### Coupons API
- `POST /api/coupons/validate` - Validate coupon code

## 🗂️ Collections

The demo includes these Payload collections:

### Ecommerce Collections
1. **Products** - Product catalog with variants and inventory
2. **Categories** - Hierarchical product organization
3. **Orders** - Customer orders with status tracking
4. **Carts** - Shopping carts (session-based)
5. **Coupons** - Discount codes and promotions

### Billing Collections (from @xtr-dev/payload-billing)
6. **Payments** - Payment transactions with provider data and status
7. **Invoices** - Generated invoices with line items and customer details
8. **Refunds** - Refund tracking and management

See [BILLING_INTEGRATION.md](./BILLING_INTEGRATION.md) for detailed payment processing documentation.

## ⚙️ Configuration

The ecommerce plugin is configured in `payload.config.ts`:

```typescript
import { ecommercePlugin } from 'payload-ecommerce'

export default buildConfig({
  plugins: [
    ecommercePlugin({
      // Plugin configuration
    }),
  ],
})
```

## 🔄 Hooks & Utilities

### Server-side (Plugin)
- `addToCart` - Add items to cart
- `updateCartItem` - Update quantities
- `getCart` - Retrieve cart details
- `createOrderFromCart` - Convert cart to order
- `validateCoupon` - Check coupon validity
- `checkInventory` - Verify stock availability

### Client-side (Future)
- `useCart()` - React hook for cart operations
- `useProducts()` - React hook for product queries
- `useOrders()` - React hook for order management

## 📝 Notes

- **Database:** SQLite database file is stored at `dev/payload.db`
- **Payment Processing:** Uses test provider for development - no real transactions occur
- **Billing Plugin:** Integrated with [@xtr-dev/payload-billing](https://github.com/xtr-dev/payload-billing)
- **Session-based Carts:** Currently uses session ID for guest carts
- **Sample Images:** Product images are placeholders
- **Tax Calculation:** Fixed at 10% for demo purposes
- **Shipping:** Free over $100, otherwise $10
- **Admin Panel:** View payments, invoices, and refunds at `/admin`

## 🚀 Future Enhancements

Planned features for future versions:

- User authentication and accounts
- Wishlist / favorites
- Product reviews and ratings
- Advanced search with Elasticsearch
- Product recommendations
- Email notifications
- Multi-currency support
- Inventory alerts
- Analytics dashboard
- Abandoned cart recovery
- Production payment providers (Stripe/Mollie integration ready)

## 📚 Learn More

- [Payload CMS Documentation](https://payloadcms.com/docs)
- [Next.js Documentation](https://nextjs.org/docs)
- [Plugin Source Code](../src)

## 📄 License

This demo is part of the payload-ecommerce plugin package.

---

**Built with ❤️ using Payload CMS and Next.js**
