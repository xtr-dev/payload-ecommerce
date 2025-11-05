import type { Payload } from 'payload'

import { devUser } from './helpers/credentials.js'

export const seed = async (payload: Payload) => {
  // Create dev user
  const { totalDocs } = await payload.count({
    collection: 'users',
    where: {
      email: {
        equals: devUser.email,
      },
    },
  })

  if (!totalDocs) {
    await payload.create({
      collection: 'users',
      data: devUser,
    })
  }

  // Check if we already have products
  const { totalDocs: productCount } = await payload.count({
    collection: 'products',
  })

  if (productCount > 0) {
    return // Already seeded
  }

  // Create categories
  const electronics = await payload.create({
    collection: 'categories',
    data: {
      name: 'Electronics',
      slug: 'electronics',
      description: 'Electronic devices and gadgets',
    },
  })

  const clothing = await payload.create({
    collection: 'categories',
    data: {
      name: 'Clothing',
      slug: 'clothing',
      description: 'Fashion and apparel',
    },
  })

  const home = await payload.create({
    collection: 'categories',
    data: {
      name: 'Home & Garden',
      slug: 'home-garden',
      description: 'Items for your home and garden',
    },
  })

  // Create products
  await payload.create({
    collection: 'products',
    data: {
      title: 'Wireless Headphones Pro',
      description: {
        root: {
          type: 'root',
          children: [
            {
              type: 'paragraph',
              children: [
                {
                  type: 'text',
                  text: 'Premium wireless headphones with active noise cancellation, 30-hour battery life, and superior sound quality. Perfect for music lovers and professionals.',
                },
              ],
            },
          ],
        },
      },
      price: 199.99,
      compareAtPrice: 249.99,
      sku: 'WHP-001',
      barcode: '1234567890123',
      inventoryQuantity: 50,
      categories: [electronics.id],
      status: 'active',
    },
  })

  await payload.create({
    collection: 'products',
    data: {
      title: 'Organic Cotton T-Shirt',
      description: {
        root: {
          type: 'root',
          children: [
            {
              type: 'paragraph',
              children: [
                {
                  type: 'text',
                  text: 'Comfortable, breathable t-shirt made from 100% organic cotton. Available in multiple colors and sizes. Perfect for everyday wear.',
                },
              ],
            },
          ],
        },
      },
      price: 29.99,
      sku: 'TSHIRT-001',
      barcode: '2234567890123',
      inventoryQuantity: 200,
      categories: [clothing.id],
      status: 'active',
      variants: [
        { name: 'Small - Black', price: 29.99, sku: 'TSHIRT-001-S-BLK' },
        { name: 'Medium - Black', price: 29.99, sku: 'TSHIRT-001-M-BLK' },
        { name: 'Large - Black', price: 29.99, sku: 'TSHIRT-001-L-BLK' },
        { name: 'Small - White', price: 29.99, sku: 'TSHIRT-001-S-WHT' },
        { name: 'Medium - White', price: 29.99, sku: 'TSHIRT-001-M-WHT' },
        { name: 'Large - White', price: 29.99, sku: 'TSHIRT-001-L-WHT' },
      ],
    },
  })

  await payload.create({
    collection: 'products',
    data: {
      title: 'Smart LED Light Bulb',
      description: {
        root: {
          type: 'root',
          children: [
            {
              type: 'paragraph',
              children: [
                {
                  type: 'text',
                  text: 'WiFi-enabled smart bulb with 16 million colors, dimming capability, and voice control support. Control from anywhere with your smartphone.',
                },
              ],
            },
          ],
        },
      },
      price: 24.99,
      sku: 'LED-001',
      barcode: '3234567890123',
      inventoryQuantity: 150,
      categories: [electronics.id, home.id],
      status: 'active',
    },
  })

  await payload.create({
    collection: 'products',
    data: {
      title: 'Ceramic Plant Pot Set',
      description: {
        root: {
          type: 'root',
          children: [
            {
              type: 'paragraph',
              children: [
                {
                  type: 'text',
                  text: 'Set of 3 handcrafted ceramic plant pots with drainage holes and saucers. Modern minimalist design perfect for indoor plants.',
                },
              ],
            },
          ],
        },
      },
      price: 39.99,
      compareAtPrice: 49.99,
      sku: 'POT-SET-001',
      barcode: '4234567890123',
      inventoryQuantity: 75,
      categories: [home.id],
      status: 'active',
    },
  })

  await payload.create({
    collection: 'products',
    data: {
      title: 'Running Shoes - Performance Series',
      description: {
        root: {
          type: 'root',
          children: [
            {
              type: 'paragraph',
              children: [
                {
                  type: 'text',
                  text: 'Lightweight running shoes with responsive cushioning and breathable mesh upper. Designed for long-distance runners.',
                },
              ],
            },
          ],
        },
      },
      price: 129.99,
      sku: 'SHOES-001',
      barcode: '5234567890123',
      inventoryQuantity: 80,
      categories: [clothing.id],
      status: 'active',
      variants: [
        { name: 'US 8', price: 129.99, sku: 'SHOES-001-8' },
        { name: 'US 9', price: 129.99, sku: 'SHOES-001-9' },
        { name: 'US 10', price: 129.99, sku: 'SHOES-001-10' },
        { name: 'US 11', price: 129.99, sku: 'SHOES-001-11' },
      ],
    },
  })

  await payload.create({
    collection: 'products',
    data: {
      title: 'Portable Bluetooth Speaker',
      description: {
        root: {
          type: 'root',
          children: [
            {
              type: 'paragraph',
              children: [
                {
                  type: 'text',
                  text: 'Waterproof portable speaker with 360-degree sound, 12-hour battery life, and built-in microphone for hands-free calls.',
                },
              ],
            },
          ],
        },
      },
      price: 79.99,
      compareAtPrice: 99.99,
      sku: 'SPEAKER-001',
      barcode: '6234567890123',
      inventoryQuantity: 120,
      categories: [electronics.id],
      status: 'active',
    },
  })

  // Create coupons
  await payload.create({
    collection: 'coupons',
    data: {
      code: 'WELCOME10',
      description: 'Welcome discount - 10% off your first order',
      type: 'percentage',
      value: 10,
      usageLimit: 100,
      timesUsed: 0,
      validFrom: new Date('2024-01-01'),
      validTo: new Date('2026-12-31'),
      status: 'active',
    },
  })

  await payload.create({
    collection: 'coupons',
    data: {
      code: 'SAVE20',
      description: '$20 off orders over $100',
      type: 'fixed',
      value: 20,
      minimumPurchase: 100,
      usageLimit: 50,
      timesUsed: 0,
      validFrom: new Date('2024-01-01'),
      validTo: new Date('2026-12-31'),
      status: 'active',
    },
  })

  await payload.create({
    collection: 'coupons',
    data: {
      code: 'FREESHIP',
      description: 'Free shipping on all orders',
      type: 'free_shipping',
      value: 0,
      usageLimit: 200,
      timesUsed: 0,
      validFrom: new Date('2024-01-01'),
      validTo: new Date('2026-12-31'),
      status: 'active',
    },
  })

  console.log('✅ Demo data seeded successfully!')
}
