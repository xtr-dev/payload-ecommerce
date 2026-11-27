import type { Payload } from 'payload'

import config from '@payload-config'
import { getPayload } from 'payload'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { useEcommerce } from '../src/index.js'

let payload: Payload

afterAll(async () => {
  // Payload 3.37 has no payload.destroy(); closing the database adapter is what releases
  // the SQLite file handle so the vitest worker can exit.
  if (typeof payload.db.destroy === 'function') {
    await payload.db.destroy()
  }
})

beforeAll(async () => {
  payload = await getPayload({ config })
})

describe('Ecommerce Plugin integration tests', () => {
  test('should create ecommerce collections', () => {
    expect(payload.collections['products']).toBeDefined()
    expect(payload.collections['categories']).toBeDefined()
    expect(payload.collections['orders']).toBeDefined()
    expect(payload.collections['carts']).toBeDefined()
    expect(payload.collections['coupons']).toBeDefined()
  })

  test('can create a product', async () => {
    const product = await payload.create({
      collection: 'products',
      data: {
        title: 'Test Product',
        price: 29.99,
        status: 'active',
      },
    })

    expect(product.title).toBe('Test Product')
    expect(product.price).toBe(29.99)
    expect(product.status).toBe('active')
    expect(product.slug).toBeDefined()
  })

  test('can create a category', async () => {
    const category = await payload.create({
      collection: 'categories',
      data: {
        name: 'Test Category',
      },
    })

    expect(category.name).toBe('Test Category')
    expect(category.slug).toBeDefined()
  })

  test('can create a cart', async () => {
    const product = await payload.create({
      collection: 'products',
      data: {
        title: 'Cart Test Product',
        price: 19.99,
        status: 'active',
      },
    })

    const cart = await payload.create({
      collection: 'carts',
      data: {
        sessionId: 'test-session',
        items: [
          {
            product: product.id,
            quantity: 2,
          },
        ],
      },
    })

    expect(cart.items).toHaveLength(1)
    expect(cart.items[0].quantity).toBe(2)
    expect(cart.subtotal).toBeGreaterThan(0)
  })

  test('can create a coupon', async () => {
    const coupon = await payload.create({
      collection: 'coupons',
      data: {
        code: 'TEST10',
        type: 'percentage',
        value: 10,
        status: 'active',
      },
    })

    expect(coupon.code).toBe('TEST10')
    expect(coupon.type).toBe('percentage')
    expect(coupon.value).toBe(10)
    expect(coupon.status).toBe('active')
  })

  // The dev app's checkout creates a payment through @xtr-dev/payload-billing's test provider
  // and redirects to /test-payment/<providerId>, so the billing plugin has to load in the dev
  // config and assign a provider id on create.
  test('billing test provider initialises a payment', async () => {
    const payment = await payload.create({
      collection: 'payments',
      data: {
        amount: 2999,
        currency: 'USD',
        provider: 'test',
        status: 'pending',
      },
    })

    expect(payment.providerId).toBeTruthy()
    expect(payment.status).toBe('pending')
  })

  // The tests below run on SQLite, where document ids are numbers. The plugin used to
  // recognise only string ids (MongoDB) as "not populated", so numeric ids were read as
  // populated documents without an `id` and the related product or coupon was lost.
  describe('order flow with numeric ids', () => {
    const address = {
      address1: '1 Main Street',
      city: 'Amsterdam',
      country: 'NL',
      firstName: 'Test',
      lastName: 'Customer',
      postalCode: '1000 AA',
      state: 'NH',
    }

    const createTrackedProduct = async (title: string, quantity: number, price = 10) =>
      await payload.create({
        collection: 'products',
        data: {
          inventory: { quantity, trackQuantity: true },
          price,
          status: 'active',
          title,
        },
      })

    const createCouponWithCode = async (code: string, extra: Record<string, unknown> = {}) =>
      await payload.create({
        collection: 'coupons',
        data: { code, type: 'percentage', status: 'active', value: 10, ...extra },
      })

    test('document ids are numbers in this test database', async () => {
      const product = await createTrackedProduct('Id Type Product', 1)
      expect(typeof product.id).toBe('number')
    })

    // depth 0 keeps relationships as bare ids in the document the afterChange hook sees;
    // the default depth populates them. Both have to reduce stock and count the coupon.
    test.each([
      { name: 'bare ids (depth 0)', depth: 0 },
      { name: 'populated relationships (default depth)', depth: undefined },
    ])(
      'creating an order with $name keeps products, reduces inventory and counts the coupon',
      async ({ depth }) => {
        const first = await createTrackedProduct(`Order Product A ${depth}`, 10)
        const second = await createTrackedProduct(`Order Product B ${depth}`, 5)
        const coupon = await createCouponWithCode(`ORDER${depth ?? 'DEFAULT'}`)

        const order = await payload.create({
          collection: 'orders',
          data: {
            coupon: coupon.id,
            items: [
              { price: 10, product: first.id, quantity: 3, total: 30 },
              { price: 10, product: second.id, quantity: 2, total: 20 },
            ],
            billingAddress: address,
            shippingAddress: address,
            subtotal: 50,
            total: 50,
          },
          depth,
        })

        const stored = await payload.findByID({ id: order.id, collection: 'orders', depth: 0 })
        expect(stored.items.map((item: { product: unknown }) => item.product)).toEqual([
          first.id,
          second.id,
        ])
        expect(stored.coupon).toBe(coupon.id)

        const firstAfter = await payload.findByID({ id: first.id, collection: 'products' })
        const secondAfter = await payload.findByID({ id: second.id, collection: 'products' })
        expect(firstAfter.inventory.quantity).toBe(7)
        expect(secondAfter.inventory.quantity).toBe(3)

        const couponAfter = await payload.findByID({ id: coupon.id, collection: 'coupons' })
        expect(couponAfter.usageCount).toBe(1)
      },
    )

    test('createOrderFromCart copies cart items with their product, price and stock change', async () => {
      const ecommerce = useEcommerce(payload)
      const product = await createTrackedProduct('Cart Order Product', 8, 12.5)
      const coupon = await createCouponWithCode('CARTORDER')

      const cart = await ecommerce.cart.addToCart({
        productId: product.id,
        quantity: 2,
        sessionId: 'order-from-cart-session',
      })

      const order = await ecommerce.orders.createOrderFromCart({
        cartId: cart.id,
        orderData: { coupon: coupon.id, shippingAddress: address },
      })

      const stored = await payload.findByID({ id: order.id, collection: 'orders', depth: 0 })
      expect(stored.items).toHaveLength(1)
      expect(stored.items[0]).toMatchObject({
        price: 12.5,
        product: product.id,
        quantity: 2,
        total: 25,
      })
      expect(stored.subtotal).toBe(25)

      const productAfter = await payload.findByID({ id: product.id, collection: 'products' })
      expect(productAfter.inventory.quantity).toBe(6)

      const couponAfter = await payload.findByID({ id: coupon.id, collection: 'coupons' })
      expect(couponAfter.usageCount).toBe(1)

      const cartAfter = await payload.findByID({ id: cart.id, collection: 'carts' })
      expect(cartAfter.items).toHaveLength(0)
    })

    test('cart helpers find an existing item by product id', async () => {
      const ecommerce = useEcommerce(payload)
      const product = await createTrackedProduct('Cart Helper Product', 20, 5)
      const sessionId = 'cart-helper-session'

      await ecommerce.cart.addToCart({ productId: product.id, quantity: 1, sessionId })
      // The id is passed as a string here, as it arrives from a URL or form field.
      const cart = await ecommerce.cart.addToCart({
        productId: String(product.id),
        quantity: 2,
        sessionId,
      })

      expect(cart.items).toHaveLength(1)
      expect(cart.items[0].quantity).toBe(3)
      expect(cart.subtotal).toBe(15)

      const updated = await ecommerce.cart.updateCartItem({
        cartId: cart.id,
        productId: product.id,
        quantity: 5,
      })
      expect(updated.items[0].quantity).toBe(5)
      expect(updated.subtotal).toBe(25)

      const emptied = await ecommerce.cart.removeFromCart({
        cartId: cart.id,
        productId: product.id,
      })
      expect(emptied.items).toHaveLength(0)
    })

    test('a coupon limited to products applies only to carts containing one of them', async () => {
      const ecommerce = useEcommerce(payload)
      const included = await createTrackedProduct('Coupon Included Product', 1)
      const excluded = await createTrackedProduct('Coupon Excluded Product', 1)
      await createCouponWithCode('PRODUCTONLY', { appliesToProducts: [included.id] })

      const applies = await ecommerce.coupons.validateCoupon({
        cartTotal: 100,
        code: 'PRODUCTONLY',
        productIds: [included.id],
      })
      expect(applies).toMatchObject({ discount: 10, valid: true })

      const appliesToStringId = await ecommerce.coupons.validateCoupon({
        cartTotal: 100,
        code: 'PRODUCTONLY',
        productIds: [String(included.id)],
      })
      expect(appliesToStringId.valid).toBe(true)

      const doesNotApply = await ecommerce.coupons.validateCoupon({
        cartTotal: 100,
        code: 'PRODUCTONLY',
        productIds: [excluded.id],
      })
      expect(doesNotApply.valid).toBe(false)
    })

    test('a coupon limited to categories applies only to carts containing one of them', async () => {
      const ecommerce = useEcommerce(payload)
      const included = await payload.create({
        collection: 'categories',
        data: { name: 'Coupon Included Category' },
      })
      const excluded = await payload.create({
        collection: 'categories',
        data: { name: 'Coupon Excluded Category' },
      })
      await createCouponWithCode('CATEGORYONLY', { appliesToCategories: [included.id] })

      const applies = await ecommerce.coupons.validateCoupon({
        cartTotal: 100,
        categoryIds: [included.id],
        code: 'CATEGORYONLY',
      })
      expect(applies.valid).toBe(true)

      const doesNotApply = await ecommerce.coupons.validateCoupon({
        cartTotal: 100,
        categoryIds: [excluded.id],
        code: 'CATEGORYONLY',
      })
      expect(doesNotApply.valid).toBe(false)
    })
  })
})
