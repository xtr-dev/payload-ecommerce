import type { Payload } from 'payload'

import config from '@payload-config'
import { getPayload } from 'payload'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { createOrders } from '../src/collections/Orders.js'
import {
  calculateOrderTotal,
  CART_LIFETIME_DAYS,
  DELETE_EXPIRED_CARTS_TASK_SLUG,
  deleteExpiredCarts,
  getRelationshipId,
  isCartExpired,
  isSameCartLine,
  payloadEcommerce,
  resolveUnitPrice,
  slugify,
  useEcommerce,
} from '../src/index.js'

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
        data: { usageCount: 3, usageLimit: 3 },
        error: 'usage limit reached',
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

  // Stock and coupon usage are changed with one conditional database statement per order
  // line (see src/lib/atomic.ts). The test database is SQLite without transactions, so a
  // failed order is cleaned up by the plugin itself rather than by a rollback.
  describe('order side effects', () => {
    const address = {
      address1: '1 Main Street',
      city: 'Amsterdam',
      country: 'NL',
      firstName: 'Test',
      lastName: 'Customer',
      postalCode: '1000 AA',
      state: 'NH',
    }

    const createProduct = async (title: string, extra: Record<string, unknown> = {}) =>
      await payload.create({
        collection: 'products',
        data: { price: 10, status: 'active', title, ...extra },
      })

    const tracked = (quantity: number) => ({ inventory: { quantity, trackQuantity: true } })

    type Line = { product: { id: number | string }; quantity: number; variant?: string }

    const createOrder = async (lines: Line[], extra: Record<string, unknown> = {}) =>
      await payload.create({
        collection: 'orders',
        data: {
          billingAddress: address,
          items: lines.map(({ product, quantity, variant }) => ({
            price: 10,
            product: product.id,
            quantity,
            total: 10 * quantity,
            variant,
          })),
          shippingAddress: address,
          subtotal: lines.reduce((sum, line) => sum + 10 * line.quantity, 0),
          ...extra,
        },
      })

    const stockOf = async (product: { id: number | string }) =>
      (await payload.findByID({ id: product.id, collection: 'products' })).inventory.quantity

    const variantStockOf = async (product: { id: number | string }, name: string) =>
      (await payload.findByID({ id: product.id, collection: 'products' })).variants.find(
        (variant: { name: string }) => variant.name === name,
      ).inventory

    const ordersContaining = async (product: { id: number | string }) =>
      (
        await payload.count({
          collection: 'orders',
          where: { 'items.product': { equals: product.id } },
        })
      ).totalDocs

    test('an order for more than the stock is rejected, names the product and changes nothing', async () => {
      const plenty = await createProduct('Stock Plenty Product', tracked(5))
      const scarce = await createProduct('Stock Scarce Product', tracked(2))

      await expect(
        createOrder([
          { product: plenty, quantity: 1 },
          { product: scarce, quantity: 3 },
        ]),
      ).rejects.toMatchObject({
        data: {
          errors: [
            {
              message: 'Not enough stock for "Stock Scarce Product": 3 requested, 2 available',
              path: 'items',
            },
          ],
        },
        name: 'ValidationError',
      })

      expect(await stockOf(plenty)).toBe(5)
      expect(await stockOf(scarce)).toBe(2)
      expect(await ordersContaining(scarce)).toBe(0)
    })

    test('two lines for the same product are checked together', async () => {
      const product = await createProduct('Stock Split Lines Product', tracked(3))

      await expect(
        createOrder([
          { product, quantity: 2 },
          { product, quantity: 2 },
        ]),
      ).rejects.toThrow('4 requested, 3 available')
      expect(await stockOf(product)).toBe(3)

      const order = await createOrder([
        { product, quantity: 2 },
        { product, quantity: 1 },
      ])
      expect(order.inventoryReduced).toBe(true)
      expect(await stockOf(product)).toBe(0)
    })

    test('a product that does not track its quantity can always be ordered', async () => {
      const product = await createProduct('Stock Untracked Product', {
        inventory: { quantity: 0, trackQuantity: false },
      })

      const order = await createOrder([{ product, quantity: 50 }])

      expect(order.inventoryReduced).toBe(false)
      expect(await stockOf(product)).toBe(0)
    })

    test('a variant with its own inventory is checked and reduced on its own', async () => {
      const product = await createProduct('Stock Variant Product', {
        ...tracked(10),
        variants: [
          { name: 'Small', inventory: 1 },
          { name: 'Large', inventory: 4 },
          // No inventory number of its own: draws from the product's quantity.
          { name: "Collector's" },
        ],
      })

      await expect(createOrder([{ product, quantity: 2, variant: 'Small' }])).rejects.toThrow(
        'Not enough stock for "Stock Variant Product" (variant "Small"): 2 requested, 1 available',
      )

      await createOrder([
        { product, quantity: 3, variant: 'Large' },
        { product, quantity: 2, variant: "Collector's" },
      ])

      expect(await variantStockOf(product, 'Small')).toBe(1)
      expect(await variantStockOf(product, 'Large')).toBe(1)
      expect(await stockOf(product)).toBe(8)
    })

    test('two concurrent orders for the last unit: exactly one succeeds', async () => {
      const product = await createProduct('Stock Last Unit Product', tracked(1))

      const results = await Promise.allSettled([
        createOrder([{ product, quantity: 1 }]),
        createOrder([{ product, quantity: 1 }]),
      ])

      expect(results.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected'])
      const rejected = results.find((result) => result.status === 'rejected') as PromiseRejectedResult
      expect(rejected.reason.data.errors[0].message).toContain(
        'Not enough stock for "Stock Last Unit Product"',
      )
      expect(await stockOf(product)).toBe(0)
      // The losing order is not left behind.
      expect(await ordersContaining(product)).toBe(1)
    })

    test('many concurrent orders never take more than the stock', async () => {
      const product = await createProduct('Stock Rush Product', tracked(3))

      const results = await Promise.allSettled(
        Array.from({ length: 8 }, () => createOrder([{ product, quantity: 1 }])),
      )

      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(3)
      expect(await stockOf(product)).toBe(0)
      expect(await ordersContaining(product)).toBe(3)
    })

    test('an order that loses the race on its second line gives back the first line', async () => {
      const plenty = await createProduct('Stock Race Plenty Product', tracked(10))
      const last = await createProduct('Stock Race Last Product', tracked(1))

      const results = await Promise.allSettled([
        createOrder([
          { product: plenty, quantity: 2 },
          { product: last, quantity: 1 },
        ]),
        createOrder([
          { product: plenty, quantity: 2 },
          { product: last, quantity: 1 },
        ]),
      ])

      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
      expect(await stockOf(plenty)).toBe(8)
      expect(await stockOf(last)).toBe(0)
    })

    test('concurrent orders cannot take a coupon past its usage limit', async () => {
      const product = await createProduct('Coupon Race Product', tracked(10))
      const coupon = await payload.create({
        collection: 'coupons',
        data: { code: 'RACEONCE', status: 'active', type: 'fixed', usageLimit: 1, value: 1 },
      })

      const results = await Promise.allSettled([
        createOrder([{ product, quantity: 1 }], { coupon: coupon.id }),
        createOrder([{ product, quantity: 1 }], { coupon: coupon.id }),
        createOrder([{ product, quantity: 1 }], { coupon: coupon.id }),
      ])

      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
      const couponAfter = await payload.findByID({ id: coupon.id, collection: 'coupons' })
      expect(couponAfter.usageCount).toBe(1)
      // The rejected orders gave their stock back and were removed.
      expect(await stockOf(product)).toBe(9)
      expect(await ordersContaining(product)).toBe(1)
    })

    // The dev config's afterCreateOrder hook throws for this note.
    test('an order whose afterCreateOrder hook fails is not created and takes nothing', async () => {
      const product = await createProduct('Failing Hook Product', tracked(5))
      const coupon = await payload.create({
        collection: 'coupons',
        data: { code: 'FAILINGHOOK', status: 'active', type: 'fixed', value: 1 },
      })

      await expect(
        createOrder([{ product, quantity: 2 }], {
          coupon: coupon.id,
          notes: 'test: fail in afterCreateOrder',
        }),
      ).rejects.toThrow('afterCreateOrder failed')

      expect(await stockOf(product)).toBe(5)
      expect((await payload.findByID({ id: coupon.id, collection: 'coupons' })).usageCount).toBe(0)
      expect(await ordersContaining(product)).toBe(0)
    })

    test.each(['cancelled', 'refunded'] as const)(
      'moving an order to %s restores stock and the coupon use exactly once',
      async (status) => {
        const product = await createProduct(`Restore Product ${status}`, {
          ...tracked(10),
          variants: [{ name: 'Blue', inventory: 5 }],
        })
        const coupon = await payload.create({
          collection: 'coupons',
          data: { code: `RESTORE-${status}`, status: 'active', type: 'fixed', usageLimit: 1, value: 1 },
        })

        const order = await createOrder(
          [
            { product, quantity: 4 },
            { product, quantity: 2, variant: 'Blue' },
          ],
          { coupon: coupon.id },
        )
        expect(order).toMatchObject({ couponUsageCounted: true, inventoryReduced: true })
        expect(await stockOf(product)).toBe(6)
        expect(await variantStockOf(product, 'Blue')).toBe(3)

        // An update that keeps the order open changes nothing.
        await payload.update({ id: order.id, collection: 'orders', data: { status: 'processing' } })
        expect(await stockOf(product)).toBe(6)

        const released = await payload.update({
          id: order.id,
          collection: 'orders',
          data: { status },
        })
        expect(released).toMatchObject({ couponUsageCounted: false, inventoryReduced: false })
        expect(await stockOf(product)).toBe(10)
        expect(await variantStockOf(product, 'Blue')).toBe(5)
        expect((await payload.findByID({ id: coupon.id, collection: 'coupons' })).usageCount).toBe(0)

        // Later updates, including a second cancellation or a refund of the cancelled
        // order, must not put the stock back again.
        await payload.update({ id: order.id, collection: 'orders', data: { notes: 'called customer' } })
        await payload.update({ id: order.id, collection: 'orders', data: { status: 'refunded' } })
        await payload.update({ id: order.id, collection: 'orders', data: { status: 'cancelled' } })
        // A caller cannot make the order look like it holds stock again.
        await payload.update({
          id: order.id,
          collection: 'orders',
          data: { inventoryReduced: true, status: 'cancelled' },
        })
        // Reopening does not take stock again, so cancelling once more gives nothing back.
        await payload.update({ id: order.id, collection: 'orders', data: { status: 'pending' } })
        await payload.update({ id: order.id, collection: 'orders', data: { status: 'cancelled' } })

        expect(await stockOf(product)).toBe(10)
        expect(await variantStockOf(product, 'Blue')).toBe(5)
        expect((await payload.findByID({ id: coupon.id, collection: 'coupons' })).usageCount).toBe(0)

        // The coupon use that was given back can be used by another order.
        const next = await createOrder([{ product, quantity: 1 }], { coupon: coupon.id })
        expect(next.couponUsageCounted).toBe(true)
      },
    )

    test('an order whose stock was never reduced restores nothing when cancelled', async () => {
      const product = await createProduct('Never Reduced Product', tracked(5))

      // Created as cancelled: it never held stock, even with a caller claiming it did.
      const order = await createOrder([{ product, quantity: 2 }], {
        inventoryReduced: true,
        status: 'cancelled',
      })
      expect(order.inventoryReduced).toBe(false)
      expect(await stockOf(product)).toBe(5)

      await payload.update({ id: order.id, collection: 'orders', data: { status: 'refunded' } })
      expect(await stockOf(product)).toBe(5)
    })

    test('reduceInventory throws instead of clamping at zero, restoreInventory adds back', async () => {
      const ecommerce = useEcommerce(payload)
      const product = await createProduct('Helper Stock Product', tracked(2))

      await expect(ecommerce.products.reduceInventory(product.id, 3)).rejects.toThrow(
        'Not enough stock for "Helper Stock Product": 3 requested, 2 available',
      )
      expect(await stockOf(product)).toBe(2)

      const reduced = await ecommerce.products.reduceInventory(product.id, 2)
      expect(reduced.inventory.quantity).toBe(0)
      expect(await ecommerce.products.checkInventory(product.id, 1)).toEqual({
        available: false,
        quantity: 0,
      })

      const restored = await ecommerce.products.restoreInventory(product.id, 4)
      expect(restored.inventory.quantity).toBe(4)
    })
  })

  describe('cart expiry', () => {
    const address = {
      address1: '1 Main Street',
      city: 'Amsterdam',
      country: 'NL',
      firstName: 'Test',
      lastName: 'Customer',
      postalCode: '1000 AA',
      state: 'NH',
    }
    const dayInMs = 86_400_000
    const daysFromNow = (days: number) => new Date(Date.now() + days * dayInMs).toISOString()
    const daysUntil = (date: string) => (new Date(date).getTime() - Date.now()) / dayInMs

    const createProduct = async (title: string) =>
      await payload.create({ collection: 'products', data: { price: 10, status: 'active', title } })

    // Passing an expiresAt that differs from the stored one is how a caller sets it.
    const expire = async (cartId: number | string) =>
      await payload.update({ id: cartId, collection: 'carts', data: { expiresAt: daysFromNow(-1) } })

    test('a new cart expires 30 days from now', async () => {
      const ecommerce = useEcommerce(payload)
      const product = await createProduct('Expiry New Cart Product')

      const cart = await ecommerce.cart.addToCart({
        productId: product.id,
        quantity: 1,
        sessionId: 'expiry-new-session',
      })

      expect(daysUntil(cart.expiresAt)).toBeGreaterThan(CART_LIFETIME_DAYS - 0.01)
      expect(daysUntil(cart.expiresAt)).toBeLessThanOrEqual(CART_LIFETIME_DAYS)
      expect(isCartExpired(cart)).toBe(false)
    })

    test('changing a cart moves its expiry to 30 days from now', async () => {
      const ecommerce = useEcommerce(payload)
      const product = await createProduct('Expiry Sliding Product')
      const sessionId = 'expiry-sliding-session'

      const cart = await ecommerce.cart.addToCart({ productId: product.id, quantity: 1, sessionId })
      // Two days left: still usable, but close to expiring.
      const closing = await payload.update({
        id: cart.id,
        collection: 'carts',
        data: { expiresAt: daysFromNow(2) },
      })
      expect(daysUntil(closing.expiresAt)).toBeLessThan(2.01)

      const updated = await ecommerce.cart.addToCart({ productId: product.id, quantity: 1, sessionId })
      expect(updated.id).toBe(cart.id)
      expect(updated.items[0].quantity).toBe(2)
      expect(daysUntil(updated.expiresAt)).toBeGreaterThan(CART_LIFETIME_DAYS - 0.01)
    })

    test('an expired cart is treated as absent and a new cart is created', async () => {
      const ecommerce = useEcommerce(payload)
      const product = await createProduct('Expiry Absent Product')
      const sessionId = 'expiry-absent-session'

      const cart = await ecommerce.cart.addToCart({ productId: product.id, quantity: 3, sessionId })
      const expired = await expire(cart.id)
      expect(isCartExpired(expired)).toBe(true)

      expect(await ecommerce.cart.getCart(undefined, sessionId)).toBeNull()
      await expect(
        ecommerce.cart.updateCartItem({ cartId: cart.id, productId: product.id, quantity: 1 }),
      ).rejects.toThrow('Cart not found')
      await expect(
        ecommerce.cart.removeFromCart({ cartId: cart.id, productId: product.id }),
      ).rejects.toThrow('Cart not found')
      await expect(ecommerce.cart.clearCart(cart.id)).rejects.toThrow('Cart not found')

      const fresh = await ecommerce.cart.addToCart({ productId: product.id, quantity: 1, sessionId })
      expect(fresh.id).not.toBe(cart.id)
      expect(fresh.items).toHaveLength(1)
      expect(fresh.items[0].quantity).toBe(1)
      expect((await ecommerce.cart.getCart(undefined, sessionId)).id).toBe(fresh.id)
    })

    test('an expired cart cannot be turned into an order', async () => {
      const ecommerce = useEcommerce(payload)
      const product = await createProduct('Expiry Order Product')

      const cart = await ecommerce.cart.addToCart({
        productId: product.id,
        quantity: 1,
        sessionId: 'expiry-order-session',
      })
      await expire(cart.id)

      await expect(
        ecommerce.orders.createOrderFromCart({
          cartId: cart.id,
          orderData: { shippingAddress: address },
        }),
      ).rejects.toThrow('Cart has expired')
      expect(
        (
          await payload.count({
            collection: 'orders',
            where: { 'items.product': { equals: product.id } },
          })
        ).totalDocs,
      ).toBe(0)
    })

    test('deleteExpiredCarts deletes expired carts only', async () => {
      const ecommerce = useEcommerce(payload)
      const product = await createProduct('Expiry Cleanup Product')

      const expired = await ecommerce.cart.addToCart({
        productId: product.id,
        quantity: 1,
        sessionId: 'expiry-cleanup-expired',
      })
      const active = await ecommerce.cart.addToCart({
        productId: product.id,
        quantity: 1,
        sessionId: 'expiry-cleanup-active',
      })
      await expire(expired.id)

      const { deleted } = await deleteExpiredCarts(payload)
      // Earlier tests in this file left expired carts behind as well.
      expect(deleted).toBeGreaterThanOrEqual(1)

      const remaining = await payload.find({
        collection: 'carts',
        where: { id: { in: [expired.id, active.id] } },
      })
      expect(remaining.docs.map((cart) => cart.id)).toEqual([active.id])
      expect(await deleteExpiredCarts(payload)).toEqual({ deleted: 0 })
    })

    // The dev config sets cartCleanupTask, which registers the task without scheduling it.
    test('the opt-in jobs task deletes expired carts when the host queues and runs it', async () => {
      const ecommerce = useEcommerce(payload)
      const product = await createProduct('Expiry Task Product')

      expect(
        payload.config.jobs.tasks.filter((task) => task.slug === DELETE_EXPIRED_CARTS_TASK_SLUG),
      ).toHaveLength(1)

      const cart = await ecommerce.cart.addToCart({
        productId: product.id,
        quantity: 1,
        sessionId: 'expiry-task-session',
      })
      await expire(cart.id)

      await payload.jobs.queue({ input: {}, task: DELETE_EXPIRED_CARTS_TASK_SLUG as never })
      await payload.jobs.run()

      const { totalDocs } = await payload.count({
        collection: 'carts',
        where: { id: { equals: cart.id } },
      })
      expect(totalDocs).toBe(0)
    })

    test('the jobs task is not registered unless the plugin option asks for it', () => {
      const withoutOption = payloadEcommerce()({ collections: [] })
      expect(withoutOption.jobs).toBeUndefined()

      const existingTask = { slug: 'host-task', handler: () => ({ output: {} }) }
      const withOption = payloadEcommerce({ cartCleanupTask: true })({
        collections: [],
        jobs: { tasks: [existingTask] },
      })
      expect(withOption.jobs?.tasks?.map((task) => task.slug)).toEqual([
        'host-task',
        DELETE_EXPIRED_CARTS_TASK_SLUG,
      ])
    })
  })

  describe('slugs', () => {
    test('slugify lower-cases, strips accents and collapses other characters to dashes', () => {
      expect(slugify('Blue Shirt')).toBe('blue-shirt')
      expect(slugify('  Café Crème — 250g!  ')).toBe('cafe-creme-250g')
      expect(slugify('***')).toBe('')
    })

    test.each([
      { collection: 'products', field: 'title', extra: { price: 5 } },
      { collection: 'categories', field: 'name', extra: {} },
    ] as const)(
      '$collection: an empty slug is generated from the $field, with a suffix when taken',
      async ({ collection, extra, field }) => {
        const create = async (data: Record<string, unknown>) =>
          await payload.create({ collection, data: { ...extra, ...data } })

        const first = await create({ [field]: 'Slug Über Test' })
        expect(first.slug).toBe('slug-uber-test')

        const second = await create({ [field]: 'Slug Über Test' })
        expect(second.slug).toBe('slug-uber-test-2')

        const third = await create({ [field]: 'slug uber test' })
        expect(third.slug).toBe('slug-uber-test-3')

        // A slug entered by the user is kept as entered, and is not regenerated when the
        // title changes.
        const custom = await create({ [field]: 'Slug Custom', slug: 'My_Own-Slug' })
        expect(custom.slug).toBe('My_Own-Slug')
        const renamed = await payload.update({
          id: custom.id,
          collection,
          data: { [field]: 'Slug Custom Renamed' },
        })
        expect(renamed.slug).toBe('My_Own-Slug')

        // A user-entered slug that is taken is rejected with a validation error, not altered.
        await expect(create({ [field]: 'Slug Duplicate', slug: 'slug-uber-test' })).rejects.toMatchObject({
          data: { errors: [{ path: 'slug' }] },
          message: 'The slug "slug-uber-test" is already in use',
          name: 'ValidationError',
        })
        await expect(
          payload.update({ id: custom.id, collection, data: { slug: 'slug-uber-test-2' } }),
        ).rejects.toThrow('The slug "slug-uber-test-2" is already in use')

        // Clearing the slug generates it again; the document's own old slug is not "taken".
        const cleared = await payload.update({ id: first.id, collection, data: { slug: '' } })
        expect(cleared.slug).toBe('slug-uber-test')

        // A title without letters or digits gives no slug.
        const symbols = await create({ [field]: '***' })
        expect(symbols.slug ?? null).toBeNull()
      },
    )
  })

  // The tests below run on SQLite, where document ids are numbers. The plugin used to
  // recognise only string ids (MongoDB) as "not populated", so numeric ids were read as
  // populated documents without an `id` and the related product or coupon was lost.
  describe('variant prices', () => {
    const address = {
      address1: '1 Main Street',
      city: 'Amsterdam',
      country: 'NL',
      firstName: 'Test',
      lastName: 'Customer',
      postalCode: '1000 AA',
      state: 'NH',
    }

    // Base price 10; "Large" overrides it, "Small" leaves its price empty, "Sample" is free.
    const createProductWithVariants = async (title: string) =>
      await payload.create({
        collection: 'products',
        data: {
          price: 10,
          status: 'active',
          title,
          variants: [
            { name: 'Large', price: 15 },
            { name: 'Small' },
            { name: 'Sample', price: 0 },
          ],
        },
      })

    test('resolveUnitPrice uses the variant price when it is filled in and the product price otherwise', () => {
      const product = {
        price: 10,
        variants: [
          { name: 'Large', price: 15 },
          { name: 'Small', price: null },
          { name: 'Sample', price: 0 },
        ],
      }

      expect(resolveUnitPrice(product)).toBe(10)
      expect(resolveUnitPrice(product, 'Large')).toBe(15)
      expect(resolveUnitPrice(product, 'Small')).toBe(10)
      expect(resolveUnitPrice(product, 'Sample')).toBe(0)
      expect(resolveUnitPrice(product, 'Unknown')).toBe(10)
      expect(resolveUnitPrice({ price: null }, 'Large')).toBe(0)
      expect(resolveUnitPrice(undefined)).toBe(0)
    })

    test('the cart subtotal prices each line at its variant price', async () => {
      const ecommerce = useEcommerce(payload)
      const product = await createProductWithVariants('Variant Price Cart Product')
      const sessionId = 'variant-price-cart-session'

      await ecommerce.cart.addToCart({ productId: product.id, quantity: 2, sessionId, variant: 'Large' })
      await ecommerce.cart.addToCart({ productId: product.id, quantity: 1, sessionId, variant: 'Small' })
      await ecommerce.cart.addToCart({ productId: product.id, quantity: 3, sessionId, variant: 'Sample' })
      const cart = await ecommerce.cart.addToCart({ productId: product.id, quantity: 1, sessionId })

      // 2 × 15 (Large) + 1 × 10 (Small, no own price) + 3 × 0 (Sample) + 1 × 10 (no variant)
      expect(cart.subtotal).toBe(50)
    })

    test('the cart subtotal uses the variant price when the saved items hold populated products', async () => {
      const product = await createProductWithVariants('Variant Price Populated Product')
      const cart = await payload.create({
        collection: 'carts',
        data: {
          items: [{ product: product.id, quantity: 1, variant: 'Large' }],
          sessionId: 'variant-price-populated-session',
        },
      })

      // Saving the items as they were read at depth 1 passes the populated product to the hook.
      const populated = await payload.findByID({ id: cart.id, collection: 'carts', depth: 1 })
      const updated = await payload.update({
        id: cart.id,
        collection: 'carts',
        data: {
          items: populated.items.map((item: { quantity: number }) => ({ ...item, quantity: 2 })),
        },
      })

      expect(updated.subtotal).toBe(30)
    })

    test('createOrderFromCart prices each line at its variant price, matching the cart subtotal', async () => {
      const ecommerce = useEcommerce(payload)
      const product = await createProductWithVariants('Variant Price Order Product')
      const sessionId = 'variant-price-order-session'

      await ecommerce.cart.addToCart({ productId: product.id, quantity: 2, sessionId, variant: 'Large' })
      const cart = await ecommerce.cart.addToCart({ productId: product.id, quantity: 1, sessionId })
      expect(cart.subtotal).toBe(40)

      const order = await ecommerce.orders.createOrderFromCart({
        cartId: cart.id,
        orderData: { shippingAddress: address },
      })

      const stored = await payload.findByID({ id: order.id, collection: 'orders', depth: 0 })
      expect(stored.items).toHaveLength(2)
      expect(stored.items[0]).toMatchObject({ price: 15, quantity: 2, total: 30, variant: 'Large' })
      expect(stored.items[1]).toMatchObject({ price: 10, quantity: 1, total: 10 })
      expect(stored.subtotal).toBe(40)
    })
  })

  describe('cart lines are identified by product and variant', () => {
    const createCartWithThreeLines = async (name: string) => {
      const ecommerce = useEcommerce(payload)
      const product = await payload.create({
        collection: 'products',
        data: { price: 10, status: 'active', title: `Cart Line Product ${name}`, variants: [{ name: 'Large' }, { name: 'Small' }] },
      })
      const sessionId = `cart-line-session-${name}`

      // Insertion order matters: the variant lines come before the line without a variant,
      // so matching on the product alone would pick the "Large" line.
      await ecommerce.cart.addToCart({ productId: product.id, quantity: 1, sessionId, variant: 'Large' })
      await ecommerce.cart.addToCart({ productId: product.id, quantity: 2, sessionId, variant: 'Small' })
      const cart = await ecommerce.cart.addToCart({ productId: product.id, quantity: 3, sessionId })

      return { cart, ecommerce, product }
    }

    const quantities = (cart: { items: Array<{ quantity: number; variant?: null | string }> }) =>
      Object.fromEntries(cart.items.map((item) => [item.variant || 'none', item.quantity]))

    test('isSameCartLine compares product and variant, treating an empty variant as none', () => {
      expect(isSameCartLine({ product: 1, variant: 'Large' }, '1', 'Large')).toBe(true)
      expect(isSameCartLine({ product: { id: 1 }, variant: 'Large' }, 1, 'Small')).toBe(false)
      expect(isSameCartLine({ product: 1, variant: 'Large' }, 1)).toBe(false)
      expect(isSameCartLine({ product: 1, variant: null }, 1, undefined)).toBe(true)
      expect(isSameCartLine({ product: 1, variant: '' }, 1, null)).toBe(true)
      expect(isSameCartLine({ product: 1 }, 1, 'Large')).toBe(false)
      expect(isSameCartLine({ product: 2 }, 1)).toBe(false)
    })

    test('addToCart keeps one line per product and variant', async () => {
      const { cart } = await createCartWithThreeLines('add')

      expect(cart.items).toHaveLength(3)
      expect(quantities(cart)).toEqual({ Large: 1, none: 3, Small: 2 })
    })

    test('updateCartItem changes only the line of the given variant', async () => {
      const { cart, ecommerce, product } = await createCartWithThreeLines('update')

      const updated = await ecommerce.cart.updateCartItem({
        cartId: cart.id,
        productId: product.id,
        quantity: 7,
        variant: 'Small',
      })
      expect(quantities(updated)).toEqual({ Large: 1, none: 3, Small: 7 })
    })

    test('updateCartItem without a variant changes the line that has no variant', async () => {
      const { cart, ecommerce, product } = await createCartWithThreeLines('update-none')

      const updated = await ecommerce.cart.updateCartItem({
        cartId: cart.id,
        productId: product.id,
        quantity: 9,
      })
      expect(quantities(updated)).toEqual({ Large: 1, none: 9, Small: 2 })
    })

    test('updateCartItem with quantity 0 removes only the line of the given variant', async () => {
      const { cart, ecommerce, product } = await createCartWithThreeLines('update-zero')

      const updated = await ecommerce.cart.updateCartItem({
        cartId: cart.id,
        productId: product.id,
        quantity: 0,
        variant: 'Large',
      })
      expect(quantities(updated)).toEqual({ none: 3, Small: 2 })
    })

    test('updateCartItem throws when the cart has no line for that product and variant', async () => {
      const ecommerce = useEcommerce(payload)
      const product = await payload.create({
        collection: 'products',
        data: { price: 10, status: 'active', title: 'Cart Line Product missing', variants: [{ name: 'Large' }] },
      })
      const cart = await ecommerce.cart.addToCart({
        productId: product.id,
        quantity: 1,
        sessionId: 'cart-line-session-missing',
        variant: 'Large',
      })

      // The cart only holds the "Large" line, so neither "no variant" nor "Small" matches.
      await expect(
        ecommerce.cart.updateCartItem({ cartId: cart.id, productId: product.id, quantity: 2 }),
      ).rejects.toThrow('Item not found in cart')
      await expect(
        ecommerce.cart.updateCartItem({ cartId: cart.id, productId: product.id, quantity: 2, variant: 'Small' }),
      ).rejects.toThrow('Item not found in cart')

      const unchanged = await payload.findByID({ id: cart.id, collection: 'carts' })
      expect(unchanged.items[0].quantity).toBe(1)
    })

    test('removeFromCart removes only the line of the given variant', async () => {
      const { cart, ecommerce, product } = await createCartWithThreeLines('remove')

      const withoutSmall = await ecommerce.cart.removeFromCart({
        cartId: cart.id,
        productId: product.id,
        variant: 'Small',
      })
      expect(quantities(withoutSmall)).toEqual({ Large: 1, none: 3 })

      const withoutPlain = await ecommerce.cart.removeFromCart({ cartId: cart.id, productId: product.id })
      expect(quantities(withoutPlain)).toEqual({ Large: 1 })
    })
  })

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
