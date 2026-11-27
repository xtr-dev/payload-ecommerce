import type { Payload } from 'payload'

import config from '@payload-config'
import { getPayload } from 'payload'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { createOrders } from '../src/collections/Orders.js'
import { calculateOrderTotal, getRelationshipId, useEcommerce } from '../src/index.js'

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

  // The dev config's calculateTax hook charges 10% of (subtotal − discount), so the
  // expected totals below include that tax.
  describe('order totals', () => {
    const address = {
      address1: '1 Main Street',
      city: 'Amsterdam',
      country: 'NL',
      firstName: 'Test',
      lastName: 'Customer',
      postalCode: '1000 AA',
      state: 'NH',
    }

    const createProduct = async (title: string, price: number) =>
      await payload.create({
        collection: 'products',
        data: { price, status: 'active', title },
      })

    test('calculateOrderTotal adds tax and shipping, subtracts the discount and never goes below zero', () => {
      expect(calculateOrderTotal({ discount: 5, shipping: 4, subtotal: 50, tax: 4.5 })).toBe(53.5)
      expect(calculateOrderTotal({ subtotal: 50 })).toBe(50)
      expect(calculateOrderTotal({ discount: 80, shipping: 5, subtotal: 50 })).toBe(0)
      // 0.1 + 0.2 is 0.30000000000000004 in floating point.
      expect(calculateOrderTotal({ shipping: 0.2, subtotal: 0.1 })).toBe(0.3)
      expect(calculateOrderTotal({ discount: null, subtotal: 10, tax: undefined })).toBe(10)
    })

    test('an order created without a total gets subtotal − discount + tax + shipping', async () => {
      const product = await createProduct('Totals Direct Product', 20)

      const order = await payload.create({
        collection: 'orders',
        data: {
          billingAddress: address,
          discount: 10,
          items: [{ price: 20, product: product.id, quantity: 3, total: 60 }],
          shipping: 7.5,
          shippingAddress: address,
          subtotal: 60,
        },
      })

      expect(order.tax).toBe(5)
      expect(order.total).toBe(62.5)
    })

    test('a total passed by the caller is replaced by the computed total', async () => {
      const product = await createProduct('Totals Override Product', 20)

      const order = await payload.create({
        collection: 'orders',
        data: {
          billingAddress: address,
          items: [{ price: 20, product: product.id, quantity: 1, total: 20 }],
          shipping: 5,
          shippingAddress: address,
          subtotal: 20,
          total: 999,
        },
      })

      expect(order.total).toBe(27)
    })

    test('a discount larger than the order gives a total of zero, not a negative one', async () => {
      const product = await createProduct('Totals Negative Product', 10)

      const order = await payload.create({
        collection: 'orders',
        data: {
          billingAddress: address,
          discount: 50,
          items: [{ price: 10, product: product.id, quantity: 1, total: 10 }],
          shippingAddress: address,
          subtotal: 10,
        },
      })

      expect(order.total).toBe(0)
    })

    test('createOrderFromCart includes shipping, discount and tax in the total', async () => {
      const ecommerce = useEcommerce(payload)
      const product = await createProduct('Totals Cart Product', 25)

      const cart = await ecommerce.cart.addToCart({
        productId: product.id,
        quantity: 2,
        sessionId: 'totals-cart-session',
      })

      const order = await ecommerce.orders.createOrderFromCart({
        cartId: cart.id,
        orderData: { discount: 10, shipping: 6, shippingAddress: address },
      })

      expect(order.subtotal).toBe(50)
      expect(order.tax).toBe(4)
      expect(order.total).toBe(50)
    })

    test('updating an order recalculates tax and total only when an amount changes', async () => {
      const product = await createProduct('Totals Update Product', 40)

      const order = await payload.create({
        collection: 'orders',
        data: {
          billingAddress: address,
          items: [{ price: 40, product: product.id, quantity: 1, total: 40 }],
          shipping: 5,
          shippingAddress: address,
          subtotal: 40,
        },
      })
      expect(order.total).toBe(49)

      // A status change touches no amount; the stored tax and total must survive it.
      const shipped = await payload.update({
        id: order.id,
        collection: 'orders',
        data: { status: 'shipped' },
      })
      expect(shipped.tax).toBe(4)
      expect(shipped.total).toBe(49)

      // A changed amount recalculates tax (10% of 40) and the total.
      const reshipped = await payload.update({
        id: order.id,
        collection: 'orders',
        data: { shipping: 12 },
      })
      expect(reshipped.tax).toBe(4)
      expect(reshipped.total).toBe(56)

      const overridden = await payload.update({
        id: order.id,
        collection: 'orders',
        data: { total: 1 },
      })
      expect(overridden.total).toBe(56)
    })

    // Payload hands the hook the stored value of every field an update leaves out, so the
    // hook has to compare with the stored order to know what changed. The tax hook here
    // returns a different amount on every call, standing in for tax rules that changed
    // after the order was placed.
    test('an update that changes no tax input does not call calculateTax again', async () => {
      let calls = 0
      const orders = createOrders({
        hooks: {
          calculateTax: () => {
            calls += 1
            return calls * 100
          },
        },
      })
      const beforeChange = orders.hooks?.beforeChange?.[0]
      const storedOrder = {
        billingAddress: { ...address, phone: null },
        discount: 0,
        items: [{ id: 'row-1', price: 40, product: 1, quantity: 1, total: 40, variant: null }],
        shipping: 5,
        shippingAddress: { ...address, phone: null },
        subtotal: 40,
        tax: 4,
        total: 49,
      }
      const update = async (changes: Record<string, unknown>) =>
        await beforeChange!({
          collection: payload.collections.orders.config,
          context: {},
          // What Payload passes for an update: the changed fields over the stored order.
          data: { ...structuredClone(storedOrder), ...changes },
          operation: 'update',
          originalDoc: storedOrder,
          req: { payload } as never,
        })

      const statusOnly = await update({ status: 'shipped', trackingNumber: 'TRACK-1' })
      expect(calls).toBe(0)
      expect(statusOnly).toMatchObject({ tax: 4, total: 49 })

      // An address without the optional phone equals the stored one, where it is null.
      const sameAddress = await update({ shippingAddress: { ...address } })
      expect(calls).toBe(0)
      expect(sameAddress).toMatchObject({ tax: 4, total: 49 })

      const newShipping = await update({ shipping: 10 })
      expect(calls).toBe(1)
      expect(newShipping).toMatchObject({ tax: 100, total: 150 })

      const newAddress = await update({ shippingAddress: { ...address, country: 'BE' } })
      expect(calls).toBe(2)
      expect(newAddress).toMatchObject({ tax: 200, total: 245 })

      // A caller-supplied tax changes the total without consulting the hook.
      const newTax = await update({ tax: 9 })
      expect(calls).toBe(2)
      expect(newTax).toMatchObject({ tax: 9, total: 54 })
    })

    // The dev config always has a calculateTax hook, so the behaviour without one is
    // checked by running the hooks of an orders collection built without plugin options.
    test('without a calculateTax hook the total still includes shipping and discount', async () => {
      const orders = createOrders()
      const beforeChange = orders.hooks?.beforeChange?.[0]
      expect(beforeChange).toBeDefined()

      const created = await beforeChange!({
        collection: payload.collections.orders.config,
        context: {},
        data: { discount: 5, shipping: 8, subtotal: 30, total: 30 },
        operation: 'create',
        req: { payload } as never,
      })
      expect(created.tax).toBeUndefined()
      expect(created.total).toBe(33)

      const withCallerTax = await beforeChange!({
        collection: payload.collections.orders.config,
        context: {},
        data: { shipping: 8, subtotal: 30, tax: 3 },
        operation: 'create',
        req: { payload } as never,
      })
      expect(withCallerTax.total).toBe(41)

      const updated = await beforeChange!({
        collection: payload.collections.orders.config,
        context: {},
        data: { shipping: 10 },
        operation: 'update',
        originalDoc: { discount: 5, shipping: 8, subtotal: 30, tax: 0, total: 33 },
        req: { payload } as never,
      })
      expect(updated.total).toBe(35)
    })
  })

  // How a coupon reaches an order: the caller passes the coupon (id, or code through
  // createOrderFromCart) and the orders collection validates it and sets the discount and,
  // for a free shipping coupon, the shipping cost. The dev config taxes 10% of
  // (subtotal − discount).
  describe('coupons on orders', () => {
    const address = {
      address1: '1 Main Street',
      city: 'Amsterdam',
      country: 'NL',
      firstName: 'Test',
      lastName: 'Customer',
      postalCode: '1000 AA',
      state: 'NH',
    }

    const createProduct = async (title: string, price: number, extra: Record<string, unknown> = {}) =>
      await payload.create({
        collection: 'products',
        data: { price, status: 'active', title, ...extra },
      })

    const createOrderWith = async (
      product: { id: number | string; price: number },
      extra: Record<string, unknown>,
    ) =>
      await payload.create({
        collection: 'orders',
        data: {
          billingAddress: address,
          items: [{ price: product.price, product: product.id, quantity: 1, total: product.price }],
          shippingAddress: address,
          subtotal: product.price,
          ...extra,
        },
      })

    test('coupon codes are stored in upper case and found in any case', async () => {
      const ecommerce = useEcommerce(payload)
      const coupon = await payload.create({
        collection: 'coupons',
        data: { code: ' lowercase15 ', status: 'active', type: 'percentage', value: 15 },
      })
      expect(coupon.code).toBe('LOWERCASE15')

      const result = await ecommerce.coupons.validateCoupon({ cartTotal: 200, code: 'Lowercase15' })
      expect(result).toMatchObject({ discount: 30, freeShipping: false, valid: true })
    })

    test('validateCoupon reports a free shipping coupon with freeShipping and no discount', async () => {
      const ecommerce = useEcommerce(payload)
      await payload.create({
        collection: 'coupons',
        data: { code: 'SHIPFREE', status: 'active', type: 'freeShipping' },
      })

      const result = await ecommerce.coupons.validateCoupon({ cartTotal: 40, code: 'SHIPFREE' })
      expect(result).toMatchObject({ discount: 0, freeShipping: true, valid: true })

      const missing = await ecommerce.coupons.validateCoupon({ cartTotal: 40, code: 'NOSUCHCODE' })
      expect(missing).toMatchObject({ discount: 0, freeShipping: false, valid: false })
    })

    test('validateCoupon caps a discount at the cart total', async () => {
      const ecommerce = useEcommerce(payload)
      await payload.create({
        collection: 'coupons',
        data: { code: 'FIXED50', status: 'active', type: 'fixed', value: 50 },
      })

      const result = await ecommerce.coupons.validateCoupon({ cartTotal: 30, code: 'FIXED50' })
      expect(result).toMatchObject({ discount: 30, valid: true })
    })

    test('an order with a free shipping coupon ships for zero', async () => {
      const product = await createProduct('Free Shipping Product', 40)
      const coupon = await payload.create({
        collection: 'coupons',
        data: { code: 'SHIPFREEORDER', status: 'active', type: 'freeShipping' },
      })

      const order = await createOrderWith(product, { coupon: coupon.id, shipping: 10 })

      expect(order.shipping).toBe(0)
      expect(order.discount).toBe(0)
      expect(order.tax).toBe(4)
      expect(order.total).toBe(44)
    })

    test('an order with a coupon gets the discount computed by the plugin, not the caller', async () => {
      const product = await createProduct('Coupon Discount Product', 80)
      const coupon = await payload.create({
        collection: 'coupons',
        data: { code: 'QUARTER', maxDiscount: 15, status: 'active', type: 'percentage', value: 25 },
      })

      const order = await createOrderWith(product, { coupon: coupon.id, discount: 79, shipping: 5 })

      // 25% of 80 is 20, capped at maxDiscount 15; tax is 10% of (80 − 15).
      expect(order.discount).toBe(15)
      expect(order.tax).toBe(6.5)
      expect(order.total).toBe(76.5)
    })

    test('an order without a coupon keeps the discount passed by the caller', async () => {
      const product = await createProduct('Manual Discount Product', 80)

      const order = await createOrderWith(product, { discount: 30 })

      expect(order.discount).toBe(30)
      expect(order.total).toBe(55)
    })

    test.each([
      { name: 'an inactive coupon', data: { status: 'inactive' }, error: 'not active' },
      {
        name: 'a coupon that is not valid yet',
        data: { validFrom: new Date(Date.now() + 86_400_000).toISOString() },
        error: 'not yet valid',
      },
      {
        name: 'a coupon past its end date',
        // The coupons collection marks such a coupon expired when it is saved.
        data: { validUntil: new Date(Date.now() - 86_400_000).toISOString() },
        error: 'not active',
      },
      {
        name: 'a coupon whose usage limit is reached',
        // The coupons collection marks such a coupon expired when it is saved.
        data: { usageCount: 3, usageLimit: 3 },
        error: 'not active',
      },
      { name: 'a cart below the minimum purchase', data: { minPurchase: 500 }, error: 'Minimum purchase' },
    ])('an order with $name is rejected', async ({ data, error, name }) => {
      const product = await createProduct(`Rejected Coupon Product ${name}`, 50)
      const coupon = await payload.create({
        collection: 'coupons',
        data: {
          code: `REJECT-${name.replace(/[^a-z]/gi, '')}`,
          status: 'active',
          type: 'percentage',
          value: 10,
          ...data,
        },
      })

      await expect(createOrderWith(product, { coupon: coupon.id })).rejects.toMatchObject({
        data: { errors: [{ message: expect.stringContaining(error), path: 'coupon' }] },
        name: 'ValidationError',
      })
    })

    test('usage limit is enforced while the coupon is still active', async () => {
      const product = await createProduct('Usage Limit Product', 50)
      const coupon = await payload.create({
        collection: 'coupons',
        data: { code: 'ONCEONLY', status: 'active', type: 'fixed', usageLimit: 1, value: 5 },
      })

      const first = await createOrderWith(product, { coupon: coupon.id })
      expect(first.discount).toBe(5)

      await expect(createOrderWith(product, { coupon: coupon.id })).rejects.toThrow()
    })

    test('product and category restrictions are checked against the order items', async () => {
      const category = await payload.create({
        collection: 'categories',
        data: { name: 'Order Coupon Category' },
      })
      const inCategory = await createProduct('Order Coupon In Category', 60, {
        categories: [category.id],
      })
      const outside = await createProduct('Order Coupon Outside', 60)

      const categoryCoupon = await payload.create({
        collection: 'coupons',
        data: {
          appliesToCategories: [category.id],
          code: 'ORDERCATEGORY',
          status: 'active',
          type: 'fixed',
          value: 6,
        },
      })
      const productCoupon = await payload.create({
        collection: 'coupons',
        data: {
          appliesToProducts: [inCategory.id],
          code: 'ORDERPRODUCT',
          status: 'active',
          type: 'fixed',
          value: 6,
        },
      })

      expect((await createOrderWith(inCategory, { coupon: categoryCoupon.id })).discount).toBe(6)
      expect((await createOrderWith(inCategory, { coupon: productCoupon.id })).discount).toBe(6)

      await expect(createOrderWith(outside, { coupon: categoryCoupon.id })).rejects.toMatchObject({
        data: { errors: [{ message: expect.stringContaining('categories'), path: 'coupon' }] },
      })
      await expect(createOrderWith(outside, { coupon: productCoupon.id })).rejects.toMatchObject({
        data: { errors: [{ message: expect.stringContaining('products'), path: 'coupon' }] },
      })
    })

    test('the per-customer limit counts the earlier orders of that customer', async () => {
      const product = await createProduct('Customer Limit Product', 50)
      const user = await payload.create({
        collection: 'users',
        data: { email: 'customer-limit@example.com', password: 'customer-limit-password' },
      })
      const coupon = await payload.create({
        collection: 'coupons',
        data: { code: 'ONEPERCUSTOMER', customerLimit: 1, status: 'active', type: 'fixed', value: 5 },
      })

      await createOrderWith(product, { coupon: coupon.id, user: user.id })

      await expect(
        createOrderWith(product, { coupon: coupon.id, user: user.id }),
      ).rejects.toMatchObject({
        data: { errors: [{ message: expect.stringContaining('Customer usage limit') }] },
      })

      // An order without a customer is not held to the per-customer limit.
      const guest = await createOrderWith(product, { coupon: coupon.id })
      expect(guest.discount).toBe(5)
    })

    test('createOrderFromCart applies a coupon given by code', async () => {
      const ecommerce = useEcommerce(payload)
      const product = await createProduct('Cart Coupon Code Product', 30)
      await payload.create({
        collection: 'coupons',
        data: { code: 'CARTSHIPFREE', status: 'active', type: 'freeShipping' },
      })

      const cart = await ecommerce.cart.addToCart({
        productId: product.id,
        quantity: 2,
        sessionId: 'cart-coupon-code-session',
      })

      const order = await ecommerce.orders.createOrderFromCart({
        cartId: cart.id,
        orderData: { couponCode: 'cartshipfree', shipping: 9, shippingAddress: address },
      })

      expect(order.shipping).toBe(0)
      expect(order.total).toBe(66)
      expect(getRelationshipId(order.coupon)).toBeDefined()

      const secondCart = await ecommerce.cart.addToCart({
        productId: product.id,
        quantity: 1,
        sessionId: 'cart-coupon-code-session',
      })
      await expect(
        ecommerce.orders.createOrderFromCart({
          cartId: secondCart.id,
          orderData: { couponCode: 'DOESNOTEXIST', shippingAddress: address },
        }),
      ).rejects.toThrow('Coupon not found')
      // A rejected order leaves the cart as it was.
      const cartAfter = await payload.findByID({ id: secondCart.id, collection: 'carts' })
      expect(cartAfter.items).toHaveLength(1)
    })
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
