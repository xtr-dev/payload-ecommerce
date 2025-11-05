# Payload Ecommerce Plugin - Demo Application

This demo application showcases the complete functionality of the Payload CMS Ecommerce Plugin with a fully functional customer-facing storefront and admin dashboard.

## Features

### 🛍️ Customer Storefront

- **Home Page**: Beautiful landing page with featured products and categories
- **Product Catalog**: Browse all products with search and category filtering
- **Product Details**: Detailed product pages with variants, pricing, and inventory
- **Shopping Cart**: Add, update, and remove items from your cart
- **Checkout**: Complete checkout flow with shipping and billing information
- **Categories**: Browse products by category
- **Order Confirmation**: Beautiful order confirmation page with order details

### 🎨 Design Features

- Modern, responsive design built with Tailwind CSS
- Clean and intuitive user interface
- Mobile-friendly layout
- Professional color scheme with primary brand colors

### 🔧 Admin Dashboard

Access the Payload CMS admin dashboard to manage:

- **Products**: Add, edit, and manage product inventory
- **Categories**: Organize products into categories
- **Orders**: View and manage customer orders
- **Carts**: Monitor active shopping carts
- **Coupons**: Create and manage discount codes

### 📦 Demo Data

The demo includes pre-seeded data:

**Products** (6 items):
- Wireless Headphones Pro - $199.99 (Electronics)
- Organic Cotton T-Shirt - $29.99 (Clothing, with size/color variants)
- Smart LED Light Bulb - $24.99 (Electronics, Home & Garden)
- Ceramic Plant Pot Set - $39.99 (Home & Garden)
- Running Shoes - Performance Series - $129.99 (Clothing, with size variants)
- Portable Bluetooth Speaker - $79.99 (Electronics)

**Categories** (3):
- Electronics
- Clothing
- Home & Garden

**Discount Coupons** (3):
- `WELCOME10` - 10% off your first order
- `SAVE20` - $20 off orders over $100
- `FREESHIP` - Free shipping on all orders

## Getting Started

### Prerequisites

- Node.js 18.20.2+ or 20.9.0+
- pnpm 9 or 10
- MongoDB (or use the included in-memory database for testing)

### Installation

1. Install dependencies:
```bash
pnpm install
```

2. Start the development server:
```bash
pnpm dev
```

3. Open your browser to:
   - **Storefront**: http://localhost:3000
   - **Admin Dashboard**: http://localhost:3000/admin

### Admin Access

Login to the admin dashboard with these credentials:
- **Email**: dev@payloadcms.com
- **Password**: test

## Demo Walkthrough

### Customer Experience

1. **Browse Products**: Visit the home page and explore featured products
2. **Filter by Category**: Click on a category or use the products page filters
3. **View Product Details**: Click on any product to see full details
4. **Add to Cart**: Select quantity and add items to your cart
5. **Review Cart**: Navigate to the cart page to review items
6. **Apply Coupon**: Enter a coupon code (try `WELCOME10`)
7. **Checkout**: Fill in shipping information and place your order
8. **Confirmation**: View your order confirmation with order number

### Admin Experience

1. **Login**: Access /admin and login with credentials above
2. **Manage Products**:
   - View all products in the Products collection
   - Edit product details, pricing, and inventory
   - Add new products with rich text descriptions
3. **Manage Orders**:
   - View all customer orders
   - Update order status (pending → processing → shipped → delivered)
   - Track payment status
4. **Manage Coupons**:
   - Create new discount codes
   - Set usage limits and expiration dates
   - Choose discount types (percentage, fixed amount, free shipping)
5. **Categories**:
   - Organize products into categories
   - Create nested category hierarchies

## Project Structure

```
dev/
├── app/
│   ├── (storefront)/          # Customer-facing pages
│   │   ├── layout.tsx         # Storefront layout with nav
│   │   ├── page.tsx           # Home page
│   │   ├── products/          # Product pages
│   │   ├── categories/        # Category pages
│   │   ├── cart/              # Shopping cart
│   │   ├── checkout/          # Checkout flow
│   │   └── order-confirmation/ # Order success
│   ├── (payload)/             # Admin dashboard
│   │   ├── admin/             # Payload admin UI
│   │   └── api/               # API routes
│   └── globals.css            # Tailwind styles
├── seed.ts                    # Demo data seeder
├── payload.config.ts          # Payload configuration
├── tailwind.config.ts         # Tailwind configuration
└── postcss.config.mjs         # PostCSS configuration
```

## Technology Stack

- **Framework**: Next.js 15.4.4 with App Router
- **CMS**: Payload CMS 3.37.0
- **Database**: MongoDB (with in-memory option for testing)
- **Styling**: Tailwind CSS 4.x
- **Rich Text**: Lexical Editor
- **Image Processing**: Sharp
- **Language**: TypeScript

## API Endpoints

The plugin provides several API endpoints:

### Products
- `GET /api/products` - List all products
- `GET /api/products/:id` - Get product details

### Cart
- `GET /api/carts/me` - Get current user's cart
- `POST /api/cart/add` - Add item to cart
- `POST /api/cart/update` - Update item quantity
- `POST /api/cart/remove` - Remove item from cart

### Orders
- `GET /api/orders/me` - Get user's orders
- `POST /api/orders` - Create new order
- `GET /api/orders/:id` - Get order details

### Coupons
- `POST /api/coupons/validate` - Validate and apply coupon

## Development

### Running Tests

```bash
# Run all tests
pnpm test

# Integration tests
pnpm test:int

# E2E tests
pnpm test:e2e
```

### Linting

```bash
# Check for issues
pnpm lint

# Auto-fix issues
pnpm lint:fix
```

### Type Generation

```bash
pnpm generate:types
```

## Customization

### Styling

Edit `dev/tailwind.config.ts` to customize colors, fonts, and other design tokens:

```typescript
theme: {
  extend: {
    colors: {
      primary: {
        // Customize your brand colors here
      },
    },
  },
}
```

### Adding Products

Use the admin dashboard or modify `dev/seed.ts` to add more demo products.

### Custom Features

The plugin is fully extensible. Add custom hooks, modify collections, or create new endpoints by editing the plugin source in `src/`.

## Deployment

To deploy this demo:

1. Build the project:
```bash
pnpm build
```

2. Set up your MongoDB instance

3. Configure environment variables:
```env
PAYLOAD_SECRET=your-secret-key
DATABASE_URI=your-mongodb-connection-string
```

4. Deploy to your preferred platform (Vercel, Railway, etc.)

## Support

For issues, questions, or contributions:
- View the main README.md
- Check the plugin source code in `src/`
- Review the tests in `dev/*.spec.ts`

## License

MIT
