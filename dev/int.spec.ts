import type { Payload } from 'payload'

import config from '@payload-config'
import { REST_GET, REST_PATCH, REST_POST } from '@payloadcms/next/routes'
import { getPayload } from 'payload'
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'

import { createOrders as createOrdersCollection } from '../src/collections/Orders.js'
import { adjustCouponUsage, adjustStock, claimOrderRelease } from '../src/lib/atomic.js'
import { toCouponPreview } from './lib/couponPreview.js'
import { DEFAULT_ECOMMERCE_SLUGS } from '../src/lib/slugs.js'
import {
  calculateOrderTotal,
  CART_LIFETIME_DAYS,
  DELETE_EXPIRED_CARTS_TASK_SLUG,
  deleteExpiredCarts,
  getRelationshipId,
  isCartExpired,
  isSameCartLine,
  matchesOrderAccessToken,
  defaultIsAdmin,
  payloadEcommerce,
  resolveUnitPrice,
  roundToTwoDecimals,
  slugify,
  toDocumentId,
  getEcommerce,
  getOrderRejection,
  OrderRejectedError,
  useEcommerce,
} from '../src/index.js'

let payload: Payload

/** The orders collection as the plugin builds it for the default collection slugs. */
const createOrders = (options: Parameters<typeof createOrdersCollection>[0] = {}) =>
  createOrdersCollection(options, DEFAULT_ECOMMERCE_SLUGS)

/** True when the suite runs against MongoDB (`pnpm test:mongo`) instead of the default SQLite. */
const usesMongoDB = process.env.DATABASE_ADAPTER === 'mongodb'

/**
 * Tells whether an operation failed with MongoDB's transient "write conflict": two
 * transactions wrote the same document and MongoDB aborted one of them. It says nothing
 * about the outcome the operation would have had, and the documented answer is to retry.
 * It never occurs on SQLite.
 */
const isTransientWriteConflict = (error: unknown): boolean => {
  const { code, errorLabels, message } = (error ?? {}) as {
    code?: number
    errorLabels?: string[]
    message?: string
  }

  return (
    code === 112 ||
    Boolean(errorLabels?.includes('TransientTransactionError')) ||
    /write conflict/i.test(message ?? '')
  )
}

/**
 * Starts all operations at once and returns how each one ended, in the same order. An
 * operation that MongoDB aborted with a transient write conflict is run again, together
 * with the others that were aborted, until each has either succeeded or failed for a real
 * reason, the way a storefront would retry. On SQLite this is a single round.
 */
const settleConcurrently = async <T>(
  operations: Array<() => Promise<T>>,
): Promise<Array<PromiseSettledResult<T>>> => {
  const results: Array<PromiseSettledResult<T>> = new Array(operations.length)
  let pending = operations.map((_, index) => index)

  for (let round = 0; pending.length > 0; round += 1) {
    if (round === 20) {
      throw new Error('Operations kept failing with a transient write conflict after 20 rounds')
    }

    const settled = await Promise.allSettled(pending.map((index) => operations[index]()))
    const retry: number[] = []
    for (const [position, result] of settled.entries()) {
      results[pending[position]] = result
      if (result.status === 'rejected' && isTransientWriteConflict(result.reason)) {
        retry.push(pending[position])
      }
    }
    pending = retry
  }

  return results
}

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
      const ecommerce = getEcommerce(payload)
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
      const ecommerce = getEcommerce(payload)
      const coupon = await payload.create({
        collection: 'coupons',
        data: { code: ' lowercase15 ', status: 'active', type: 'percentage', value: 15 },
      })
      expect(coupon.code).toBe('LOWERCASE15')

      const result = await ecommerce.coupons.validateCoupon({ cartTotal: 200, code: 'Lowercase15' })
      expect(result).toMatchObject({ discount: 30, freeShipping: false, valid: true })
    })

    test('validateCoupon reports a free shipping coupon with freeShipping and no discount', async () => {
      const ecommerce = getEcommerce(payload)
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
      const ecommerce = getEcommerce(payload)
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
      { name: 'an inactive coupon', data: { status: 'inactive' }, error: 'not active', reason: 'inactive' },
      {
        name: 'a coupon that is not valid yet',
        data: { validFrom: new Date(Date.now() + 86_400_000).toISOString() },
        error: 'not yet valid',
        reason: 'not_yet_valid',
      },
      {
        name: 'a coupon past its end date',
        // The coupons collection marks such a coupon expired when it is saved.
        data: { validUntil: new Date(Date.now() - 86_400_000).toISOString() },
        error: 'has expired',
        reason: 'expired',
      },
      {
        name: 'a coupon whose usage limit is reached',
        data: { usageCount: 3, usageLimit: 3 },
        error: 'usage limit reached',
        reason: 'usage_limit',
      },
      {
        name: 'a cart below the minimum purchase',
        data: { minPurchase: 500 },
        error: 'Minimum purchase',
        reason: 'min_purchase',
        details: { minPurchase: 500 },
      },
      {
        name: 'a coupon with a customer limit and no customer',
        data: { customerLimit: 1 },
        error: 'signed-in customer',
        reason: 'customer_required',
      },
    ])('an order with $name is rejected and the error says why', async ({ data, details, error, name, reason }) => {
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

      const rejection = await createOrderWith(product, { coupon: coupon.id }).catch((thrown) => thrown)

      expect(rejection).toMatchObject({
        data: { errors: [{ message: expect.stringContaining(error), path: 'coupon' }] },
        name: 'ValidationError',
      })
      expect(rejection).toBeInstanceOf(OrderRejectedError)
      expect(rejection.message).toContain(error)
      expect(getOrderRejection(rejection)).toEqual({ type: 'coupon', reason, ...details })
    })

    test('an order with a coupon that does not exist is rejected with reason not_found', async () => {
      const product = await createProduct('Missing Coupon Product', 50)
      const coupon = await payload.create({
        collection: 'coupons',
        data: { code: 'DELETEDBEFOREUSE', status: 'active', type: 'fixed', value: 5 },
      })
      await payload.delete({ id: coupon.id, collection: 'coupons' })

      const rejection = await createOrderWith(product, { coupon: coupon.id }).catch((thrown) => thrown)

      expect(getOrderRejection(rejection)).toEqual({ type: 'coupon', reason: 'not_found' })
    })

    test('getOrderRejection returns undefined for anything that is not an order rejection', () => {
      expect(getOrderRejection(new Error('Not enough stock for "Lookalike"'))).toBeUndefined()
      expect(getOrderRejection(undefined)).toBeUndefined()
      expect(getOrderRejection('Coupon has expired')).toBeUndefined()
      expect(getOrderRejection({ data: { rejection: { type: 'other', reason: 'x' } } })).toBeUndefined()
      // The shape of one entry of a REST error response's `errors` array.
      expect(
        getOrderRejection({ data: { rejection: { type: 'coupon', reason: 'expired' } }, name: 'ValidationError' }),
      ).toEqual({ type: 'coupon', reason: 'expired' })
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

      // The limit cannot be counted for an order without a customer, so the coupon is
      // refused instead of being unlimited for guests.
      await expect(createOrderWith(product, { coupon: coupon.id })).rejects.toMatchObject({
        data: { errors: [{ message: expect.stringContaining('signed-in customer'), path: 'coupon' }] },
      })
    })

    test('validateCoupon names the reason of every refusal and returns the refused coupon', async () => {
      const ecommerce = getEcommerce(payload)
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
      const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
      const product = await createProduct('Refusal Reason Product', 50)
      const category = await payload.create({ collection: 'categories', data: { name: 'Refusal Reason Category' } })
      const user = await payload.create({
        collection: 'users',
        data: { email: 'refusal-reason@example.com', password: 'refusal-reason-password' },
      })

      const createCoupon = async (code: string, extra: Record<string, unknown>) =>
        await payload.create({
          collection: 'coupons',
          data: { code, status: 'active', type: 'fixed', value: 5, ...extra },
        })

      const refusals: Array<[string, Record<string, unknown>]> = [
        ['inactive', { status: 'inactive' }],
        ['not_yet_valid', { validFrom: tomorrow }],
        ['expired', { validUntil: yesterday }],
        ['usage_limit', { usageCount: 1, usageLimit: 1 }],
        ['customer_required', { customerLimit: 1 }],
        ['min_purchase', { minPurchase: 4000 }],
        ['not_applicable', { appliesToProducts: [product.id] }],
        ['not_applicable', { appliesToCategories: [category.id] }],
      ]

      for (const [index, [reason, extra]] of refusals.entries()) {
        const coupon = await createCoupon(`REFUSED${index}`, extra)
        const result = await ecommerce.coupons.validateCoupon({ cartTotal: 20, code: coupon.code })

        expect(result, reason).toMatchObject({
          coupon: { id: coupon.id, code: coupon.code },
          discount: 0,
          error: expect.any(String),
          freeShipping: false,
          reason,
          valid: false,
        })
        // The amount is only reported for the refusal it explains.
        expect(result.minPurchase, reason).toBe(reason === 'min_purchase' ? 4000 : undefined)
      }

      // A coupon is expired by its status or by its end date; both say so in the same words.
      const expiredByStatus = await createCoupon('REFUSEDEXPIREDSTATUS', { status: 'expired' })
      const expiredByDate = await createCoupon('REFUSEDEXPIREDDATE', {})
      // Written past the collection hook, which would turn the status into `expired`.
      // The whole document is passed because older SQL adapters insert-or-update the row.
      const { id: expiredByDateId, ...expiredByDateFields } = expiredByDate
      await payload.db.updateOne({
        id: expiredByDateId,
        collection: 'coupons',
        data: { ...expiredByDateFields, validUntil: yesterday },
      })
      for (const coupon of [expiredByStatus, expiredByDate]) {
        expect(
          await ecommerce.coupons.validateCoupon({ cartTotal: 20, code: coupon.code }),
        ).toMatchObject({ error: 'Coupon has expired', reason: 'expired', valid: false })
      }
      expect(
        await ecommerce.coupons.validateCoupon({ cartTotal: 20, code: 'REFUSED0' }),
      ).toMatchObject({ error: 'Coupon is not active', reason: 'inactive', valid: false })

      // No coupon has the code, so there is no document to return.
      const missing = await ecommerce.coupons.validateCoupon({ cartTotal: 20, code: 'REFUSEDMISSING' })
      expect(missing).toMatchObject({ error: 'Coupon not found', reason: 'not_found', valid: false })
      expect(missing.coupon).toBeUndefined()

      // With a customer, a per-customer coupon is usable until that customer's orders reach the limit.
      const limited = await createCoupon('REFUSEDPERCUSTOMER', { customerLimit: 1 })
      const preview = { cartTotal: 20, code: limited.code, userId: user.id }
      const allowed = await ecommerce.coupons.validateCoupon(preview)
      expect(allowed).toMatchObject({ discount: 5, valid: true })
      expect(allowed.reason).toBeUndefined()

      await createOrderWith(product, { coupon: limited.id, user: user.id })
      expect(await ecommerce.coupons.validateCoupon(preview)).toMatchObject({
        coupon: { id: limited.id },
        reason: 'customer_limit',
        valid: false,
      })
    })

    test('the demo coupon route tells the browser the outcome and nothing else about the coupon', async () => {
      const ecommerce = getEcommerce(payload)
      await payload.create({
        collection: 'coupons',
        data: {
          code: 'PREVIEWSECRET',
          description: 'Internal: for the spring campaign',
          minPurchase: 50,
          status: 'active',
          type: 'percentage',
          usageCount: 2,
          usageLimit: 7,
          value: 10,
        },
      })

      const accepted = toCouponPreview(
        await ecommerce.coupons.validateCoupon({ cartTotal: 100, code: 'previewsecret' }),
      )
      expect(accepted).toEqual({
        code: 'PREVIEWSECRET',
        discount: 10,
        freeShipping: false,
        message: 'PREVIEWSECRET',
        valid: true,
      })

      const refused = toCouponPreview(
        await ecommerce.coupons.validateCoupon({ cartTotal: 20, code: 'previewsecret' }),
      )
      expect(refused).toEqual({
        code: 'PREVIEWSECRET',
        discount: 0,
        freeShipping: false,
        message: 'Minimum purchase amount of 50 required',
        minPurchase: 50,
        reason: 'min_purchase',
        valid: false,
      })

      const unknown = toCouponPreview(await ecommerce.coupons.validateCoupon({ cartTotal: 20, code: 'NOSUCHCODE' }))
      expect(unknown).toMatchObject({ message: 'Coupon not found', reason: 'not_found', valid: false })
      expect(unknown.code).toBeUndefined()
    })

    test('createOrderFromCart applies a coupon given by code', async () => {
      const ecommerce = getEcommerce(payload)
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
      ).rejects.toSatisfy(
        (thrown: any) =>
          thrown.message === 'Coupon not found: DOESNOTEXIST' &&
          thrown.data.errors[0].path === 'coupon' &&
          getOrderRejection(thrown)?.reason === 'not_found',
      )
      // A rejected order leaves the cart as it was.
      const cartAfter = await payload.findByID({ id: secondCart.id, collection: 'carts' })
      expect(cartAfter.items).toHaveLength(1)
    })
  })

  // Stock and coupon usage are changed with one conditional database statement per order
  // line (see src/lib/atomic.ts). On SQLite the test database has no transactions, so a
  // failed order is cleaned up by the plugin itself; on MongoDB (`pnpm test:mongo`) every
  // operation runs in a transaction and a failed order is rolled back.
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

    test('a stock rejection names the product, the units requested and the units available', async () => {
      const scarce = await createProduct('Stock Reason Product', tracked(2))

      const rejection = await createOrder([
        { product: scarce, quantity: 2 },
        { product: scarce, quantity: 1 },
      ]).catch((thrown) => thrown)

      expect(rejection).toBeInstanceOf(OrderRejectedError)
      expect(rejection.rejection).toEqual(getOrderRejection(rejection))
      expect(getOrderRejection(rejection)).toEqual({
        type: 'stock',
        reason: 'out_of_stock',
        product: scarce.id,
        requested: 3,
        available: 2,
      })
    })

    test('a stock rejection names the variant only when the variant has its own stock', async () => {
      const product = await createProduct('Stock Reason Variant Product', {
        ...tracked(1),
        variants: [{ name: 'Small', inventory: 0 }, { name: 'Shared' }],
      })

      const ownStock = await createOrder([{ product, quantity: 1, variant: 'Small' }]).catch((thrown) => thrown)
      expect(getOrderRejection(ownStock)).toEqual({
        type: 'stock',
        reason: 'out_of_stock',
        product: product.id,
        variant: 'Small',
        requested: 1,
        available: 0,
      })

      const sharedStock = await createOrder([{ product, quantity: 2, variant: 'Shared' }]).catch(
        (thrown) => thrown,
      )
      expect(getOrderRejection(sharedStock)).toEqual({
        type: 'stock',
        reason: 'out_of_stock',
        product: product.id,
        requested: 2,
        available: 1,
      })
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

      const results = await settleConcurrently([
        () => createOrder([{ product, quantity: 1 }]),
        () => createOrder([{ product, quantity: 1 }]),
      ])

      expect(results.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected'])
      const rejected = results.find((result) => result.status === 'rejected') as PromiseRejectedResult
      expect(rejected.reason.data.errors[0].message).toContain(
        'Not enough stock for "Stock Last Unit Product"',
      )
      // Whether the loser failed the first check or lost the conditional update depends on
      // timing; only in the first case is there a current `available` to report.
      expect(getOrderRejection(rejected.reason)).toMatchObject({
        type: 'stock',
        reason: 'out_of_stock',
        product: product.id,
        requested: 1,
      })
      expect(await stockOf(product)).toBe(0)
      // The losing order is not left behind.
      expect(await ordersContaining(product)).toBe(1)
    })

    test('many concurrent orders never take more than the stock', async () => {
      const product = await createProduct('Stock Rush Product', tracked(3))

      const results = await settleConcurrently(
        Array.from({ length: 8 }, () => () => createOrder([{ product, quantity: 1 }])),
      )

      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(3)
      expect(await stockOf(product)).toBe(0)
      expect(await ordersContaining(product)).toBe(3)
    })

    test('an order that loses the race on its second line gives back the first line', async () => {
      const plenty = await createProduct('Stock Race Plenty Product', tracked(10))
      const last = await createProduct('Stock Race Last Product', tracked(1))

      const results = await settleConcurrently([
        () =>
          createOrder([
            { product: plenty, quantity: 2 },
            { product: last, quantity: 1 },
          ]),
        () =>
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

      const results = await settleConcurrently([
        () => createOrder([{ product, quantity: 1 }], { coupon: coupon.id }),
        () => createOrder([{ product, quantity: 1 }], { coupon: coupon.id }),
        () => createOrder([{ product, quantity: 1 }], { coupon: coupon.id }),
      ])

      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
      for (const result of results) {
        if (result.status === 'rejected') {
          expect(getOrderRejection(result.reason)).toEqual({ type: 'coupon', reason: 'usage_limit' })
        }
      }
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

    // The dev config's calculateTax hook throws for a shipping address with this address2.
    const taxFailingAddress = { ...address, address2: 'test: fail in calculateTax' }

    test('an order whose calculateTax hook fails is not created and takes nothing', async () => {
      const product = await createProduct('Failing Tax Create Product', tracked(5))
      const coupon = await payload.create({
        collection: 'coupons',
        data: { code: 'FAILINGTAX', status: 'active', type: 'fixed', value: 1 },
      })

      await expect(
        createOrder([{ product, quantity: 2 }], {
          coupon: coupon.id,
          shippingAddress: taxFailingAddress,
        }),
      ).rejects.toThrow('Order was not created: tax could not be calculated (tax service unavailable)')

      expect(await stockOf(product)).toBe(5)
      expect((await payload.findByID({ id: coupon.id, collection: 'coupons' })).usageCount).toBe(0)
      expect(await ordersContaining(product)).toBe(0)
    })

    test('createOrderFromCart fails and keeps the cart when the calculateTax hook fails', async () => {
      const ecommerce = getEcommerce(payload)
      const product = await createProduct('Failing Tax Cart Product', tracked(5))
      const cart = await ecommerce.cart.addToCart({
        productId: product.id,
        quantity: 2,
        sessionId: 'failing-tax-cart-session',
      })

      await expect(
        ecommerce.orders.createOrderFromCart({
          cartId: cart.id,
          orderData: { shippingAddress: taxFailingAddress },
        }),
      ).rejects.toThrow('tax could not be calculated')

      expect(await stockOf(product)).toBe(5)
      expect(await ordersContaining(product)).toBe(0)
      // The customer can retry: the cart still holds the line.
      expect((await payload.findByID({ id: cart.id, collection: 'carts' })).items).toHaveLength(1)
    })

    test('an update whose calculateTax hook fails changes nothing, including stock and coupon use', async () => {
      const product = await createProduct('Failing Tax Update Product', tracked(5))
      const coupon = await payload.create({
        collection: 'coupons',
        data: { code: 'FAILINGTAXUPDATE', status: 'active', type: 'fixed', value: 1 },
      })
      const order = await createOrder([{ product, quantity: 2 }], { coupon: coupon.id })
      expect(await stockOf(product)).toBe(3)

      // The address change makes the tax hook run and fail; the cancellation in the same
      // update must not go through, so the order keeps its stock and its coupon use.
      await expect(
        payload.update({
          id: order.id,
          collection: 'orders',
          data: { shippingAddress: taxFailingAddress, status: 'cancelled' },
        }),
      ).rejects.toThrow('Order was not updated: tax could not be calculated (tax service unavailable)')

      const stored = await payload.findByID({ id: order.id, collection: 'orders', depth: 0 })
      expect(stored).toMatchObject({
        couponUsageCounted: true,
        inventoryReduced: true,
        status: 'pending',
        tax: order.tax,
        total: order.total,
      })
      expect(stored.shippingAddress.address2 ?? null).toBeNull()
      expect(await stockOf(product)).toBe(3)
      expect((await payload.findByID({ id: coupon.id, collection: 'coupons' })).usageCount).toBe(1)

      // An update that changes no tax input does not call the hook, so the order can still
      // be cancelled, and that gives everything back once.
      await payload.update({ id: order.id, collection: 'orders', data: { status: 'cancelled' } })
      expect(await stockOf(product)).toBe(5)
      expect((await payload.findByID({ id: coupon.id, collection: 'coupons' })).usageCount).toBe(0)
    })

    test.each([
      { name: 'NaN', value: Number.NaN },
      { name: 'undefined', value: undefined },
      { name: 'a string', value: '4' },
    ])('a calculateTax hook that returns $name fails the order', async ({ value }) => {
      const orders = createOrders({ hooks: { calculateTax: () => value as never } })
      const beforeChange = orders.hooks?.beforeChange?.[0]

      await expect(
        beforeChange!({
          collection: payload.collections.orders.config,
          context: {},
          data: { shipping: 8, subtotal: 30, status: 'cancelled' },
          operation: 'create',
          req: { payload } as never,
        }),
      ).rejects.toThrow('tax could not be calculated (the calculateTax hook returned')
    })

    test('the error of a failing calculateTax hook keeps the original error as its cause', async () => {
      const original = new Error('rate table missing')
      const orders = createOrders({
        hooks: {
          calculateTax: () => {
            throw original
          },
        },
      })

      const failure = await orders.hooks!.beforeChange![0]({
        collection: payload.collections.orders.config,
        context: {},
        data: { subtotal: 30, status: 'cancelled' },
        operation: 'create',
        req: { payload } as never,
      }).then(
        () => undefined,
        (error: Error) => error,
      )

      expect(failure?.message).toBe('Order was not created: tax could not be calculated (rate table missing)')
      expect(failure?.cause).toBe(original)
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

    // Every update below reads the order while its flags are still set. Only the atomic
    // claim of each flag (claimOrderRelease) keeps all but one from giving the stock back.
    test.each([
      { name: 'eight simultaneous cancellations', statuses: Array.from({ length: 8 }, () => 'cancelled') },
      { name: 'a simultaneous cancellation and refund', statuses: ['cancelled', 'refunded'] },
      {
        name: 'simultaneous cancellations, refunds and an unrelated edit',
        statuses: ['cancelled', 'refunded', undefined, 'cancelled', 'refunded', undefined],
      },
    ])('$name of one order restore its stock and coupon use exactly once', async ({ name, statuses }) => {
      const product = await createProduct(`Concurrent Release Product ${name}`, {
        ...tracked(10),
        variants: [{ name: 'Blue', inventory: 5 }],
      })
      const coupon = await payload.create({
        collection: 'coupons',
        data: { code: `RELEASE-${name.length}-${statuses.length}`, status: 'active', type: 'fixed', value: 1 },
      })
      // A second order keeps the coupon's usageCount at 1 after the first is released, so
      // a use given back twice would show as 0.
      await createOrder([{ product, quantity: 1 }], { coupon: coupon.id })
      const order = await createOrder(
        [
          { product, quantity: 4 },
          { product, quantity: 2, variant: 'Blue' },
        ],
        { coupon: coupon.id },
      )
      expect(await stockOf(product)).toBe(5)
      expect(await variantStockOf(product, 'Blue')).toBe(3)
      expect((await payload.findByID({ id: coupon.id, collection: 'coupons' })).usageCount).toBe(2)

      const results = await settleConcurrently(
        statuses.map((status, index) => () =>
          payload.update({
            id: order.id,
            collection: 'orders',
            // An update without a status stands for an edit that arrives during the cancellation.
            data: status ? { status } : { notes: `edit ${index}` },
          }),
        ),
      )
      // What Payload does with simultaneous updates of one document is not the plugin's
      // to decide: on SQLite without transactions it can reject all but one (they collide
      // while rewriting the item rows), and the unrelated edit can overwrite the status
      // with the one it read, leaving the order open and still holding its stock. So
      // neither a rejection nor an order that is still open is a failure here. A final
      // cancellation makes sure the order ends up released, and what must hold is that
      // across all of these updates the stock and coupon use came back exactly once.
      for (const result of results) {
        if (result.status === 'fulfilled' && ['cancelled', 'refunded'].includes(result.value.status)) {
          expect(result.value).toMatchObject({ couponUsageCounted: false, inventoryReduced: false })
        }
      }

      await payload.update({ id: order.id, collection: 'orders', data: { status: 'cancelled' } })

      const stored = await payload.findByID({ id: order.id, collection: 'orders', depth: 0 })
      expect(stored).toMatchObject({ couponUsageCounted: false, inventoryReduced: false })
      expect(await stockOf(product)).toBe(9)
      expect(await variantStockOf(product, 'Blue')).toBe(5)
      expect((await payload.findByID({ id: coupon.id, collection: 'coupons' })).usageCount).toBe(1)
    })

    // The race itself, made deterministic: two updates that both read the order while it
    // still held its stock (previousDoc) and both saved it as cancelled reach the
    // afterChange hook together. Before the atomic claim both of them restored the stock.
    test('two cancellations that both read the order as holding stock restore it once', async () => {
      const product = await createProduct('Interleaved Release Product', {
        ...tracked(10),
        variants: [{ name: 'Blue', inventory: 5 }],
      })
      const coupon = await payload.create({
        collection: 'coupons',
        data: { code: 'INTERLEAVED', status: 'active', type: 'fixed', value: 1 },
      })
      await createOrder([{ product, quantity: 1 }], { coupon: coupon.id })
      const order = await createOrder(
        [
          { product, quantity: 4 },
          { product, quantity: 2, variant: 'Blue' },
        ],
        { coupon: coupon.id },
      )
      const held = await payload.findByID({ id: order.id, collection: 'orders', depth: 0 })
      expect(held).toMatchObject({ couponUsageCounted: true, inventoryReduced: true })

      const afterChange = payload.collections.orders.config.hooks.afterChange[0]
      const runCancellation = async (status: string) =>
        await afterChange({
          collection: payload.collections.orders.config,
          context: {},
          // What each update got back from its own write: the new status, flags still set.
          doc: { ...structuredClone(held), status },
          operation: 'update',
          previousDoc: structuredClone(held),
          req: { payload } as never,
        })

      const docs = await Promise.all([
        runCancellation('cancelled'),
        runCancellation('refunded'),
        runCancellation('cancelled'),
        runCancellation('refunded'),
      ])

      expect(await stockOf(product)).toBe(9)
      expect(await variantStockOf(product, 'Blue')).toBe(5)
      expect((await payload.findByID({ id: coupon.id, collection: 'coupons' })).usageCount).toBe(1)
      for (const doc of docs) {
        expect(doc).toMatchObject({ couponUsageCounted: false, inventoryReduced: false })
      }

      const stored = await payload.findByID({ id: order.id, collection: 'orders', depth: 0 })
      expect(stored).toMatchObject({ couponUsageCounted: false, inventoryReduced: false })
    })

    // An update must not write the flags it read: a cancellation that finishes between an
    // edit's read and its write has cleared them, and the edit would set them again.
    test('an update of an order does not write its hold flags', async () => {
      const product = await createProduct('Flag Write Product', tracked(5))
      const order = await createOrder([{ product, quantity: 1 }])
      const write = vi.spyOn(payload.db, 'updateOne')

      try {
        const updated = await payload.update({
          id: order.id,
          collection: 'orders',
          data: { couponUsageCounted: true, inventoryReduced: false, notes: 'edited' },
        })
        // The caller's values are ignored and the stored ones are returned.
        expect(updated).toMatchObject({ couponUsageCounted: false, inventoryReduced: true })

        const orderWrites = write.mock.calls
          .map(([args]) => args)
          .filter((args) => args.collection === 'orders')
        expect(orderWrites).toHaveLength(1)
        expect(orderWrites[0].data).toMatchObject({ notes: 'edited' })
        expect(orderWrites[0].data).not.toHaveProperty('inventoryReduced')
        expect(orderWrites[0].data).not.toHaveProperty('couponUsageCounted')
      } finally {
        write.mockRestore()
      }

      const stored = await payload.findByID({ id: order.id, collection: 'orders', depth: 0 })
      expect(stored).toMatchObject({ couponUsageCounted: false, inventoryReduced: true, notes: 'edited' })
    })

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
      const ecommerce = getEcommerce(payload)
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
      const ecommerce = getEcommerce(payload)
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
      const ecommerce = getEcommerce(payload)
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
      const ecommerce = getEcommerce(payload)
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
      const ecommerce = getEcommerce(payload)
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
      const ecommerce = getEcommerce(payload)
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
      const ecommerce = getEcommerce(payload)
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
      const ecommerce = getEcommerce(payload)
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
      const ecommerce = getEcommerce(payload)
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
      const ecommerce = getEcommerce(payload)
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
      const ecommerce = getEcommerce(payload)
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

  // By default these run on SQLite, where document ids are numbers. The plugin used to
  // recognise only string ids (MongoDB) as "not populated", so numeric ids were read as
  // populated documents without an `id` and the related product or coupon was lost.
  // `pnpm test:mongo` runs the same flow with string ids.
  describe('order flow with the id type of the database', () => {
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

    // Guards the assumption the rest of this block rests on: if a run used another id
    // type than expected, the tests below would pass without covering it.
    test(`document ids are ${usesMongoDB ? 'strings' : 'numbers'} in this test database`, async () => {
      const product = await createTrackedProduct('Id Type Product', 1)
      expect(typeof product.id).toBe(usesMongoDB ? 'string' : 'number')
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
      const ecommerce = getEcommerce(payload)
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
      const ecommerce = getEcommerce(payload)
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
      const ecommerce = getEcommerce(payload)
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
      const ecommerce = getEcommerce(payload)
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

  describe('default access control', () => {
    const address = {
      address1: '1 Main Street',
      city: 'Amsterdam',
      country: 'NL',
      firstName: 'Test',
      lastName: 'Customer',
      postalCode: '1000 AA',
      state: 'NH',
    }

    // Unique per run so the block can be repeated against a database that is kept.
    const run = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
    const password = 'access-test-password'

    let admin: any
    let alice: any
    let bob: any
    let activeProduct: any
    let draftProduct: any
    let coupon: any
    let aliceCart: any
    let bobCart: any
    let guestCart: any
    let aliceOrder: any
    let bobOrder: any
    let guestOrder: any

    /** Calls the REST API the way the Next.js route handler does, optionally signed in. */
    const rest = async (
      method: 'GET' | 'PATCH' | 'POST',
      path: string,
      { body, user }: { body?: unknown; user?: { email: string } } = {},
    ): Promise<{ json: any; status: number }> => {
      const headers = new Headers({ 'Content-Type': 'application/json' })
      if (user) {
        const { token } = await payload.login({
          collection: 'users',
          data: { email: user.email, password },
        })
        headers.set('Authorization', `JWT ${token}`)
      }

      const handler = { GET: REST_GET, PATCH: REST_PATCH, POST: REST_POST }[method](config)
      const [pathname] = path.split('?')
      const response = await handler(
        new Request(`http://localhost:3000/api/${path}`, {
          body: body === undefined ? undefined : JSON.stringify(body),
          headers,
          method,
        }),
        { params: Promise.resolve({ slug: pathname.split('/') }) },
      )

      return { json: await response.json().catch(() => null), status: response.status }
    }

    const ids = (docs: Array<{ id: unknown }>) => docs.map((doc) => String(doc.id))

    beforeAll(async () => {
      const createUser = async (name: string, role: 'admin' | 'customer') =>
        await payload.create({
          collection: 'users',
          data: { email: `${name}-${run}@example.com`, password, role },
        })
      admin = await createUser('admin', 'admin')
      alice = await createUser('alice', 'customer')
      bob = await createUser('bob', 'customer')

      activeProduct = await payload.create({
        collection: 'products',
        data: { price: 10, status: 'active', title: `Access Active ${run}` },
      })
      draftProduct = await payload.create({
        collection: 'products',
        data: { price: 10, status: 'draft', title: `Access Draft ${run}` },
      })
      coupon = await payload.create({
        collection: 'coupons',
        data: { code: `ACCESS${run.replace(/\D/g, '')}`, status: 'active', type: 'percentage', value: 10 },
      })

      const items = [{ product: activeProduct.id, quantity: 1 }]
      aliceCart = await payload.create({ collection: 'carts', data: { items, user: alice.id } })
      bobCart = await payload.create({ collection: 'carts', data: { items, user: bob.id } })
      guestCart = await payload.create({
        collection: 'carts',
        data: { items, sessionId: `access-guest-${run}` },
      })

      const createOrder = async (user?: unknown) =>
        await payload.create({
          collection: 'orders',
          data: {
            items: [{ price: 10, product: activeProduct.id, quantity: 1, total: 10 }],
            billingAddress: address,
            shippingAddress: address,
            subtotal: 10,
            user,
          },
        })
      aliceOrder = await createOrder(alice.id)
      bobOrder = await createOrder(bob.id)
      guestOrder = await createOrder()
    })

    test('the default admin check accepts role or roles "admin" and denies everyone else', () => {
      const check = (user: unknown) => defaultIsAdmin({ req: { user } as any })

      expect(check({ id: 1, role: 'admin' })).toBe(true)
      expect(check({ id: 1, roles: ['editor', 'admin'] })).toBe(true)
      expect(check({ id: 1, role: 'customer' })).toBe(false)
      expect(check({ id: 1, roles: ['editor'] })).toBe(false)
      // A users collection without a role field: nobody is an admin.
      expect(check({ id: 1 })).toBe(false)
      expect(check(null)).toBe(false)
    })

    test('every plugin collection defines access for create, read, update and delete', () => {
      for (const slug of ['products', 'categories', 'coupons', 'orders', 'carts']) {
        const { access } = payload.collections[slug].config
        // Payload's own default (any signed-in user) is a function named defaultAccess.
        for (const operation of ['create', 'read', 'update', 'delete'] as const) {
          expect(access[operation].name, `${slug}.${operation}`).not.toBe('defaultAccess')
        }
      }
    })

    describe('Local API with overrideAccess: false', () => {
      const as = (user: any) => ({ overrideAccess: false, user: { ...user, collection: 'users' } })

      test('anonymous visitors read active products and categories only', async () => {
        const products = await payload.find({
          collection: 'products',
          overrideAccess: false,
          where: { id: { in: [activeProduct.id, draftProduct.id] } },
        })
        expect(ids(products.docs)).toEqual([String(activeProduct.id)])

        await expect(
          payload.find({ collection: 'categories', overrideAccess: false }),
        ).resolves.toBeDefined()

        for (const collection of ['coupons', 'orders', 'carts']) {
          await expect(payload.find({ collection, overrideAccess: false }), collection).rejects.toThrow(
            /not allowed/i,
          )
        }
      })

      test('a customer cannot write products, categories or coupons, an admin can', async () => {
        const productData = { price: 1, status: 'active', title: `Access Write ${run}` }

        await expect(
          payload.create({ collection: 'products', data: productData, ...as(alice) }),
        ).rejects.toThrow(/not allowed/i)
        await expect(
          payload.update({ id: activeProduct.id, collection: 'products', data: { price: 0 }, ...as(alice) }),
        ).rejects.toThrow(/not allowed/i)
        await expect(
          payload.delete({ id: activeProduct.id, collection: 'products', ...as(alice) }),
        ).rejects.toThrow(/not allowed/i)
        await expect(
          payload.create({ collection: 'categories', data: { name: `Access ${run}` }, ...as(alice) }),
        ).rejects.toThrow(/not allowed/i)
        await expect(
          payload.create({
            collection: 'coupons',
            data: { code: `FREE${run}`, type: 'percentage', value: 100 },
            ...as(alice),
          }),
        ).rejects.toThrow(/not allowed/i)
        await expect(payload.find({ collection: 'coupons', ...as(alice) })).rejects.toThrow(/not allowed/i)

        const created = await payload.create({ collection: 'products', data: productData, ...as(admin) })
        expect(created.title).toBe(productData.title)
        const drafts = await payload.find({
          collection: 'products',
          where: { id: { equals: draftProduct.id } },
          ...as(admin),
        })
        expect(drafts.docs).toHaveLength(1)
        const coupons = await payload.find({ collection: 'coupons', ...as(admin) })
        expect(ids(coupons.docs)).toContain(String(coupon.id))
      })

      test('a customer reads only their own orders and cannot write orders', async () => {
        const orders = await payload.find({ collection: 'orders', limit: 1000, ...as(alice) })
        expect(ids(orders.docs)).toEqual([String(aliceOrder.id)])

        await expect(
          payload.findByID({ id: bobOrder.id, collection: 'orders', ...as(alice) }),
        ).rejects.toThrow()
        await expect(
          payload.findByID({ id: guestOrder.id, collection: 'orders', ...as(alice) }),
        ).rejects.toThrow()
        await expect(
          payload.update({ id: aliceOrder.id, collection: 'orders', data: { paymentStatus: 'paid' }, ...as(alice) }),
        ).rejects.toThrow(/not allowed/i)
        await expect(
          payload.create({
            collection: 'orders',
            data: {
              items: [{ price: 0, product: activeProduct.id, quantity: 1, total: 0 }],
              billingAddress: address,
              shippingAddress: address,
              subtotal: 0,
              user: alice.id,
            },
            ...as(alice),
          }),
        ).rejects.toThrow(/not allowed/i)

        const all = await payload.find({ collection: 'orders', limit: 1000, ...as(admin) })
        expect(ids(all.docs)).toEqual(
          expect.arrayContaining([String(aliceOrder.id), String(bobOrder.id), String(guestOrder.id)]),
        )
      })

      test('a customer reads and updates only their own cart; guest carts need an admin', async () => {
        const carts = await payload.find({ collection: 'carts', limit: 1000, ...as(alice) })
        expect(ids(carts.docs)).toEqual([String(aliceCart.id)])

        const updated = await payload.update({
          id: aliceCart.id,
          collection: 'carts',
          data: { items: [{ product: activeProduct.id, quantity: 3 }] },
          ...as(alice),
        })
        expect(updated.items[0].quantity).toBe(3)

        for (const cart of [bobCart, guestCart]) {
          await expect(
            payload.findByID({ id: cart.id, collection: 'carts', ...as(alice) }),
          ).rejects.toThrow()
          await expect(
            payload.update({ id: cart.id, collection: 'carts', data: { items: [] }, ...as(alice) }),
          ).rejects.toThrow()
        }

        const all = await payload.find({ collection: 'carts', limit: 1000, ...as(admin) })
        expect(ids(all.docs)).toEqual(
          expect.arrayContaining([String(aliceCart.id), String(bobCart.id), String(guestCart.id)]),
        )
      })

      test('a customer can create a cart for themselves only, and cannot give a cart away', async () => {
        const items = [{ product: activeProduct.id, quantity: 1 }]

        await expect(
          payload.create({ collection: 'carts', data: { items, user: bob.id }, ...as(alice) }),
        ).rejects.toThrow(/not allowed/i)
        await expect(
          payload.create({ collection: 'carts', data: { items, sessionId: 'someone-elses-session' }, ...as(alice) }),
        ).rejects.toThrow(/not allowed/i)
        await expect(
          payload.create({ collection: 'carts', data: { items, sessionId: 'anonymous' }, overrideAccess: false }),
        ).rejects.toThrow(/not allowed/i)

        const own = await payload.create({ collection: 'carts', data: { items, user: alice.id }, ...as(alice) })
        expect(getRelationshipId(own.user)).toBe(alice.id)

        // The owner fields are ignored on a customer's update, so the cart stays theirs.
        await payload.update({
          id: own.id,
          collection: 'carts',
          data: { sessionId: 'planted', user: bob.id },
          ...as(alice),
        })
        const stored = await payload.findByID({ id: own.id, collection: 'carts', depth: 0 })
        expect(stored.user).toBe(alice.id)
        expect(stored.sessionId ?? null).toBeNull()

        await payload.delete({ id: own.id, collection: 'carts' })
      })
    })

    describe('REST API', () => {
      test('a rejected order answers 400 with the rejection in the error data', async () => {
        const soldOut = await payload.create({
          collection: 'products',
          data: {
            inventory: { quantity: 0, trackQuantity: true },
            price: 10,
            status: 'active',
            title: `Access Sold Out ${run}`,
          },
        })

        const response = await rest('POST', 'orders', {
          body: {
            items: [{ price: 10, product: soldOut.id, quantity: 1, total: 10 }],
            shippingAddress: address,
            subtotal: 10,
          },
          user: admin,
        })

        expect(response.status).toBe(400)
        expect(response.json.errors[0].name).toBe('ValidationError')
        expect(getOrderRejection(response.json.errors[0])).toEqual({
          type: 'stock',
          reason: 'out_of_stock',
          product: soldOut.id,
          requested: 1,
          available: 0,
        })
      })

      test('anonymous visitors get active products, and nothing from coupons, orders and carts', async () => {
        const products = await rest('GET', 'products?limit=1000')
        expect(products.status).toBe(200)
        expect(ids(products.json.docs)).toContain(String(activeProduct.id))
        expect(ids(products.json.docs)).not.toContain(String(draftProduct.id))
        expect((await rest('GET', `products/${draftProduct.id}`)).status).toBe(404)

        for (const collection of ['coupons', 'orders', 'carts']) {
          expect((await rest('GET', collection)).status, collection).toBe(403)
        }
        expect((await rest('GET', `carts/${guestCart.id}`)).status).toBe(403)
        expect((await rest('GET', `orders/${guestOrder.id}`)).status).toBe(403)
        expect(
          (await rest('POST', 'products', { body: { price: 1, title: `Anonymous ${run}` } })).status,
        ).toBe(403)
      })

      test('a signed-in customer cannot write products or coupons or read coupons', async () => {
        expect(
          (await rest('POST', 'products', { body: { price: 1, title: `Customer ${run}` }, user: alice })).status,
        ).toBe(403)
        expect(
          (await rest('PATCH', `products/${activeProduct.id}`, { body: { price: 0 }, user: alice })).status,
        ).toBe(403)
        expect(
          (
            await rest('POST', 'coupons', {
              body: { code: `REST${run}`, type: 'percentage', value: 100 },
              user: alice,
            })
          ).status,
        ).toBe(403)
        expect((await rest('GET', 'coupons', { user: alice })).status).toBe(403)

        const stored = await payload.findByID({ id: activeProduct.id, collection: 'products' })
        expect(stored.price).toBe(10)
      })

      test('a signed-in customer sees their own orders and carts, not those of others or guests', async () => {
        const orders = await rest('GET', 'orders?limit=1000', { user: alice })
        expect(orders.status).toBe(200)
        expect(ids(orders.json.docs)).toEqual([String(aliceOrder.id)])

        const carts = await rest('GET', 'carts?limit=1000', { user: alice })
        expect(carts.status).toBe(200)
        expect(ids(carts.json.docs)).toEqual([String(aliceCart.id)])

        for (const path of [
          `orders/${bobOrder.id}`,
          `orders/${guestOrder.id}`,
          `carts/${bobCart.id}`,
          `carts/${guestCart.id}`,
        ]) {
          expect([403, 404], path).toContain((await rest('GET', path, { user: alice })).status)
        }

        expect(
          (await rest('PATCH', `orders/${aliceOrder.id}`, { body: { paymentStatus: 'paid' }, user: alice })).status,
        ).toBe(403)
        expect(
          [403, 404],
        ).toContain((await rest('PATCH', `carts/${bobCart.id}`, { body: { items: [] }, user: alice })).status)

        const order = await payload.findByID({ id: aliceOrder.id, collection: 'orders' })
        expect(order.paymentStatus).toBe('pending')
        const cart = await payload.findByID({ id: bobCart.id, collection: 'carts' })
        expect(cart.items).toHaveLength(1)
      })

      test('an admin reads and writes everything', async () => {
        const orders = await rest('GET', 'orders?limit=1000', { user: admin })
        expect(ids(orders.json.docs)).toEqual(
          expect.arrayContaining([String(aliceOrder.id), String(bobOrder.id), String(guestOrder.id)]),
        )
        expect((await rest('GET', `carts/${guestCart.id}`, { user: admin })).status).toBe(200)
        expect((await rest('GET', `products/${draftProduct.id}`, { user: admin })).status).toBe(200)
        expect((await rest('GET', 'coupons', { user: admin })).status).toBe(200)

        const patched = await rest('PATCH', `orders/${bobOrder.id}`, {
          body: { trackingNumber: 'TRACK-1' },
          user: admin,
        })
        expect(patched.status).toBe(200)
        expect(patched.json.doc.trackingNumber).toBe('TRACK-1')
      })
    })

    describe('coupon usage count', () => {
      const createCountedCoupon = async (name: string) =>
        await payload.create({
          collection: 'coupons',
          data: {
            code: `COUNT${name}${run.replace(/\D/g, '')}`,
            status: 'active',
            type: 'fixed',
            usageCount: 4,
            value: 1,
          },
        })
      const usageCountOf = async (coupon: { id: number | string }) =>
        (await payload.findByID({ id: coupon.id, collection: 'coupons' })).usageCount

      test('saving a coupon through REST, as the admin form does, does not overwrite the count', async () => {
        const counted = await createCountedCoupon('REST')

        // The admin form sends every field, with the count it had when the form was opened.
        const response = await rest('PATCH', `coupons/${counted.id}`, {
          body: { description: 'Edited in the admin panel', usageCount: 0 },
          user: admin,
        })

        expect(response.status).toBe(200)
        expect(response.json.doc.description).toBe('Edited in the admin panel')
        expect(await usageCountOf(counted)).toBe(4)
      })

      test('an update that leaves the count alone does not write it, a deliberate one does', async () => {
        const counted = await createCountedCoupon('LOCAL')
        const writes: unknown[] = []
        const updateOne = payload.db.updateOne
        const spy = vi.spyOn(payload.db, 'updateOne').mockImplementation(async (args) => {
          writes.push(args.data)
          return await updateOne.call(payload.db, args)
        })

        try {
          await payload.update({ id: counted.id, collection: 'coupons', data: { description: 'Unrelated' } })
          expect(writes[0]).not.toHaveProperty('usageCount')

          await payload.update({ id: counted.id, collection: 'coupons', data: { usageCount: 1 } })
          expect(writes[1]).toMatchObject({ usageCount: 1 })
        } finally {
          spy.mockRestore()
        }

        expect(await usageCountOf(counted)).toBe(1)
      })
    })

    describe('order access token', () => {
      const createOrder = async (extra: Record<string, unknown> = {}) =>
        await payload.create({
          collection: 'orders',
          data: {
            items: [{ price: 10, product: activeProduct.id, quantity: 1, total: 10 }],
            shippingAddress: address,
            subtotal: 10,
            ...extra,
          },
        })

      test('every new order gets its own random token, whatever the caller passes', async () => {
        const first = await createOrder({ accessToken: 'chosen-by-the-caller' })
        const second = await createOrder({ accessToken: 'chosen-by-the-caller' })

        // 32 random bytes as base64url.
        expect(first.accessToken).toMatch(/^[\w-]{43}$/)
        expect(second.accessToken).toMatch(/^[\w-]{43}$/)
        expect(first.accessToken).not.toBe(second.accessToken)
      })

      test('an update does not change the token', async () => {
        const order = await createOrder()

        const updated = await payload.update({
          id: order.id,
          collection: 'orders',
          data: { accessToken: 'replaced', notes: 'Leave at the door' },
        })
        expect(updated.notes).toBe('Leave at the door')

        const stored = await payload.findByID({ id: order.id, collection: 'orders' })
        expect(stored.accessToken).toBe(order.accessToken)
      })

      test('the token is not readable or usable as a filter through access control', async () => {
        expect(aliceOrder.accessToken).toBeTruthy()

        const asOwner = await payload.findByID({
          id: aliceOrder.id,
          collection: 'orders',
          overrideAccess: false,
          user: { ...alice, collection: 'users' },
        })
        expect(asOwner.id).toBe(aliceOrder.id)
        expect(asOwner).not.toHaveProperty('accessToken')

        for (const user of [alice, admin]) {
          const read = await rest('GET', `orders/${aliceOrder.id}`, { user })
          expect(read.status).toBe(200)
          expect(read.json).not.toHaveProperty('accessToken')
          expect(JSON.stringify(read.json)).not.toContain(aliceOrder.accessToken)

          // Filtering on the field would confirm a guessed prefix one character at a time.
          const filtered = await rest(
            'GET',
            `orders?where[accessToken][like]=${aliceOrder.accessToken.slice(0, 4)}`,
            { user },
          )
          expect(filtered.json?.docs ?? []).toEqual([])
        }

        const patched = await rest('PATCH', `orders/${aliceOrder.id}`, {
          body: { accessToken: 'set-through-rest' },
          user: admin,
        })
        expect(patched.status).toBe(200)
        expect(JSON.stringify(patched.json)).not.toContain(aliceOrder.accessToken)
        const stored = await payload.findByID({ id: aliceOrder.id, collection: 'orders' })
        expect(stored.accessToken).toBe(aliceOrder.accessToken)
      })

      test('getOrderByToken returns the order for its id or number and its token only', async () => {
        const { orders } = getEcommerce(payload)
        const token = guestOrder.accessToken

        const byId = await orders.getOrderByToken({ orderId: guestOrder.id, token })
        expect(byId?.id).toBe(guestOrder.id)
        // Relationships are populated, as getOrder does.
        expect(byId?.items[0].product.title).toBe(activeProduct.title)

        // The id as it arrives from a URL.
        expect((await orders.getOrderByToken({ orderId: String(guestOrder.id), token }))?.id).toBe(guestOrder.id)
        expect(
          (await orders.getOrderByToken({ orderNumber: guestOrder.orderNumber, token }))?.id,
        ).toBe(guestOrder.id)

        // Another order's token, a truncated token and no token open nothing.
        for (const wrong of [aliceOrder.accessToken, token.slice(0, -1), `${token}x`, '', undefined, null, 42, [token]]) {
          expect(await orders.getOrderByToken({ orderId: guestOrder.id, token: wrong })).toBeNull()
          expect(await orders.getOrderByToken({ orderNumber: guestOrder.orderNumber, token: wrong })).toBeNull()
        }
      })

      test('getOrderByToken answers null for orders that do not exist and for unusable input', async () => {
        const { orders } = getEcommerce(payload)
        const token = guestOrder.accessToken

        expect(await orders.getOrderByToken({ orderNumber: 'ORD-0-000', token })).toBeNull()
        expect(await orders.getOrderByToken({ orderId: 'not-an-id', token })).toBeNull()
        expect(await orders.getOrderByToken({ orderId: { not_equals: 0 }, token })).toBeNull()
        expect(await orders.getOrderByToken({ orderNumber: { like: 'ORD' }, token })).toBeNull()
        expect(await orders.getOrderByToken({ token })).toBeNull()
        // Naming the order twice is a mistake of the caller, not a way to widen the search.
        expect(
          await orders.getOrderByToken({ orderId: guestOrder.id, orderNumber: guestOrder.orderNumber, token }),
        ).toBeNull()
      })

      test('getOrderByToken works for helpers that otherwise act as a user', async () => {
        const asBob = getEcommerce(payload, { overrideAccess: false, user: { ...bob, collection: 'users' } })

        await expect(asBob.orders.getOrder(guestOrder.id)).rejects.toThrow()
        expect(
          (await asBob.orders.getOrderByToken({ orderId: guestOrder.id, token: guestOrder.accessToken }))?.id,
        ).toBe(guestOrder.id)
      })

      test('createOrderFromCart returns the token, also when the helpers act as a user', async () => {
        const asAlice = getEcommerce(payload, { overrideAccess: false, user: { ...alice, collection: 'users' } })
        await asAlice.cart.addToCart({ productId: activeProduct.id, quantity: 1, userId: alice.id })
        const cart = await asAlice.cart.getCart(alice.id)

        const order = await asAlice.orders.createOrderFromCart({
          cartId: cart.id,
          orderData: { shippingAddress: address },
        })

        expect(order.accessToken).toMatch(/^[\w-]{43}$/)
        expect((await asAlice.orders.getOrder(order.id))).not.toHaveProperty('accessToken')
        expect(
          (await asAlice.orders.getOrderByToken({ orderId: order.id, token: order.accessToken }))?.id,
        ).toBe(order.id)
      })

      test('matchesOrderAccessToken never matches an order without a token', () => {
        expect(matchesOrderAccessToken({ accessToken: 'secret' }, 'secret')).toBe(true)
        expect(matchesOrderAccessToken({ accessToken: 'secret' }, 'Secret')).toBe(false)
        expect(matchesOrderAccessToken({ accessToken: 'secret' }, 'secret-and-more')).toBe(false)
        for (const order of [{}, { accessToken: null }, { accessToken: '' }, null, undefined]) {
          for (const token of ['', undefined, null, 'secret']) {
            expect(matchesOrderAccessToken(order, token)).toBe(false)
          }
        }
      })
    })

    describe('server helpers', () => {
      test('keeps the 0.1.0 name useEcommerce as an alias of getEcommerce', () => {
        expect(useEcommerce).toBe(getEcommerce)
      })

      test('by default the helpers bypass access control, so guest carts and checkout work', async () => {
        const ecommerce = getEcommerce(payload)
        const sessionId = `access-helper-guest-${run}`

        const cart = await ecommerce.cart.addToCart({ productId: activeProduct.id, quantity: 2, sessionId })
        expect((await ecommerce.cart.getCart(undefined, sessionId))?.id).toBe(cart.id)

        const result = await ecommerce.coupons.validateCoupon({ cartTotal: 20, code: coupon.code })
        expect(result).toMatchObject({ discount: 2, valid: true })

        const order = await ecommerce.orders.createOrderFromCart({
          cartId: cart.id,
          orderData: { couponCode: coupon.code, shippingAddress: address },
        })
        expect(order.subtotal).toBe(20)
        expect(order.user ?? null).toBeNull()
        expect((await ecommerce.orders.getOrder(order.id)).id).toBe(order.id)
      })

      test('with overrideAccess: false the helpers act as the given user', async () => {
        const asAlice = getEcommerce(payload, {
          overrideAccess: false,
          user: { ...alice, collection: 'users' },
        })

        expect((await asAlice.cart.getCart(alice.id))?.id).toBe(aliceCart.id)
        // Asking for someone else's cart or a guest cart finds nothing.
        expect(await asAlice.cart.getCart(bob.id)).toBeNull()
        expect(await asAlice.cart.getCart(undefined, `access-guest-${run}`)).toBeNull()
        await expect(asAlice.cart.clearCart(bobCart.id)).rejects.toThrow()
        await expect(asAlice.orders.getOrder(bobOrder.id)).rejects.toThrow()
        expect(ids((await asAlice.orders.getUserOrders(bob.id)).docs)).toEqual([])
        await expect(
          asAlice.orders.updateOrderStatus({ orderId: aliceOrder.id, status: 'delivered' }),
        ).rejects.toThrow(/not allowed/i)
        await expect(asAlice.products.getProduct(draftProduct.id)).rejects.toThrow()

        // Coupons are admin-only, but validating a code is what the helper is for.
        expect((await asAlice.coupons.validateCoupon({ cartTotal: 20, code: coupon.code })).valid).toBe(true)

        // Checking out someone else's cart fails; their own cart becomes an order even
        // though a customer may not create orders through the API.
        await expect(
          asAlice.orders.createOrderFromCart({ cartId: bobCart.id, orderData: { shippingAddress: address } }),
        ).rejects.toThrow()
        const updated = await asAlice.cart.addToCart({ productId: activeProduct.id, quantity: 1, userId: alice.id })
        expect(updated.id).toBe(aliceCart.id)
        const order = await asAlice.orders.createOrderFromCart({
          cartId: aliceCart.id,
          orderData: { shippingAddress: address },
        })
        expect(getRelationshipId(order.user)).toBe(alice.id)
        expect((await asAlice.orders.getOrder(order.id)).id).toBe(order.id)

        const bobsCart = await payload.findByID({ id: bobCart.id, collection: 'carts' })
        expect(bobsCart.items).toHaveLength(1)
      })
    })
  })

  describe('money rounding', () => {
    const address = {
      address1: '1 Main Street',
      city: 'Amsterdam',
      country: 'NL',
      firstName: 'Test',
      lastName: 'Customer',
    }

    test('roundToTwoDecimals rounds halves up, also where floating point stores them just below', () => {
      expect(roundToTwoDecimals(3.333)).toBe(3.33)
      expect(roundToTwoDecimals(1.005)).toBe(1.01)
      expect(roundToTwoDecimals(2.675)).toBe(2.68)
      expect(roundToTwoDecimals(10)).toBe(10)
      expect(roundToTwoDecimals(0)).toBe(0)
    })

    test('calculateOrderTotal applies the rounding it is given', () => {
      const parts = { discount: 199.5, shipping: 0, subtotal: 1995, tax: 0.2 }

      expect(calculateOrderTotal(parts)).toBe(1795.7)
      expect(calculateOrderTotal(parts, Math.round)).toBe(1796)
      expect(calculateOrderTotal({ discount: 50, subtotal: 10 }, Math.round)).toBe(0)
    })

    test('by default a percentage discount, tax and total are rounded to two decimals', async () => {
      const ecommerce = getEcommerce(payload)
      const code = `ROUND${Date.now()}`
      const product = await payload.create({
        collection: 'products',
        data: { price: 33.33, status: 'active', title: `Rounding Product ${code}` },
      })
      await payload.create({
        collection: 'coupons',
        data: { code, status: 'active', type: 'percentage', value: 10 },
      })

      // 10% of 33.33 is 3.333.
      expect((await ecommerce.coupons.validateCoupon({ cartTotal: 33.33, code })).discount).toBe(3.33)

      const cart = await ecommerce.cart.addToCart({
        productId: product.id,
        quantity: 1,
        sessionId: `rounding-${code}`,
      })
      const order = await ecommerce.orders.createOrderFromCart({
        cartId: cart.id,
        orderData: { couponCode: code, shippingAddress: address },
      })

      // The dev config taxes 10% of (33.33 − 3.33) = 3.
      expect(order).toMatchObject({ discount: 3.33, subtotal: 33.33, tax: 3, total: 33 })
      expect(ecommerce.orders.calculateTotal({ discount: 3.33, subtotal: 33.33, tax: 3.004 })).toBe(33)
    })

    test('a cart subtotal and the line totals of its order carry no floating point noise', async () => {
      const ecommerce = getEcommerce(payload)
      const run = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
      const createProduct = async (price: number) =>
        await payload.create({
          collection: 'products',
          data: { price, status: 'active', title: `Float Noise Product ${price} ${run}` },
        })
      // In binary floating point 0.1 × 3 is 0.30000000000000004 and 0.7 + 0.1 + 0.3 is 1.0999999999999999.
      const dime = await createProduct(0.1)
      const seventy = await createProduct(0.7)
      const sessionId = `float-noise-${run}`

      await ecommerce.cart.addToCart({ productId: dime.id, quantity: 3, sessionId })
      await ecommerce.cart.addToCart({ productId: seventy.id, quantity: 1, sessionId })
      const cart = await ecommerce.cart.addToCart({ productId: dime.id, quantity: 1, sessionId })
      expect(cart.subtotal).toBe(1.1)

      const order = await ecommerce.orders.createOrderFromCart({
        cartId: cart.id,
        orderData: { shippingAddress: address },
      })
      expect(order.items.map((item: { total: number }) => item.total)).toEqual([0.4, 0.7])
      expect(order.subtotal).toBe(1.1)
    })

    test('a line total is rounded with the configured roundMoney before the lines are added up', async () => {
      const ecommerce = getEcommerce(payload)
      const run = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
      // A price with more decimals than the shop charges in: 3 × 0.335 is 1.005, charged as 1.01.
      const product = await payload.create({
        collection: 'products',
        data: { price: 0.335, status: 'active', title: `Fraction Price Product ${run}` },
      })

      const cart = await ecommerce.cart.addToCart({
        productId: product.id,
        quantity: 3,
        sessionId: `fraction-price-${run}`,
      })
      expect(cart.subtotal).toBe(1.01)

      const order = await ecommerce.orders.createOrderFromCart({
        cartId: cart.id,
        orderData: { shippingAddress: address },
      })
      expect(order.items[0].total).toBe(1.01)
      expect(order.subtotal).toBe(1.01)
    })
  })

  describe('ids that arrive as text', () => {
    const address = {
      address1: '1 Main Street',
      city: 'Amsterdam',
      country: 'NL',
      firstName: 'Test',
      lastName: 'Customer',
    }

    test('toDocumentId converts to the id type of the collection', () => {
      if (usesMongoDB) {
        expect(toDocumentId(payload, 'products', 12)).toBe('12')
        expect(toDocumentId(payload, 'products', '6650f0c0a1b2c3d4e5f60718')).toBe('6650f0c0a1b2c3d4e5f60718')
      } else {
        expect(toDocumentId(payload, 'products', '12')).toBe(12)
        expect(toDocumentId(payload, 'products', 12)).toBe(12)
        // Not a numeric id: left alone, for Payload to reject.
        expect(toDocumentId(payload, 'products', '12abc')).toBe('12abc')
        expect(toDocumentId(payload, 'products', '1.5')).toBe('1.5')
      }
      expect(toDocumentId(payload, 'products', undefined)).toBeUndefined()
      expect(toDocumentId(payload, 'products', null)).toBeNull()
    })

    // On SQLite every id below is a numeric string such as '12', the form in which an id
    // arrives from a URL parameter or a form; on MongoDB String() changes nothing.
    test('cart, order, coupon and product helpers accept ids as strings', async () => {
      const ecommerce = getEcommerce(payload)
      const run = `${Date.now()}`
      const user = await payload.create({
        collection: 'users',
        data: { email: `string-ids-${run}@example.com`, password: 'string-ids-password', role: 'customer' },
      })
      const product = await payload.create({
        collection: 'products',
        data: {
          inventory: { quantity: 10, trackQuantity: true },
          price: 10,
          status: 'active',
          title: `String Id Product ${run}`,
        },
      })
      const coupon = await payload.create({
        collection: 'coupons',
        data: { code: `STRINGID${run}`, customerLimit: 1, status: 'active', type: 'fixed', value: 5 },
      })

      const productId = String(product.id)
      const userId = String(user.id)

      const cart = await ecommerce.cart.addToCart({ productId, quantity: 1, userId })
      expect(getRelationshipId(cart.user)).toBe(user.id)
      expect(getRelationshipId(cart.items[0].product)).toBe(product.id)
      const cartId = String(cart.id)

      // Adding again finds the cart and the line instead of creating second ones.
      const again = await ecommerce.cart.addToCart({ productId, quantity: 1, userId })
      expect(again.id).toBe(cart.id)
      expect(again.items).toHaveLength(1)
      expect(again.items[0].quantity).toBe(2)

      expect((await ecommerce.cart.getCart(userId))?.id).toBe(cart.id)
      expect((await ecommerce.cart.updateCartItem({ cartId, productId, quantity: 3 })).items[0].quantity).toBe(3)
      expect((await ecommerce.cart.removeFromCart({ cartId, productId })).items).toHaveLength(0)
      await ecommerce.cart.addToCart({ productId, quantity: 2, userId })
      expect((await ecommerce.cart.clearCart(cartId)).items).toHaveLength(0)
      await ecommerce.cart.addToCart({ productId, quantity: 2, userId })

      expect((await ecommerce.products.getProduct(productId)).id).toBe(product.id)
      expect((await ecommerce.products.checkInventory(productId, 10)).available).toBe(true)
      expect((await ecommerce.products.reduceInventory(productId, 1)).inventory.quantity).toBe(9)
      expect((await ecommerce.products.restoreInventory(productId, 1)).inventory.quantity).toBe(10)

      const order = await ecommerce.orders.createOrderFromCart({
        cartId,
        orderData: { coupon: String(coupon.id), shippingAddress: address },
      })
      expect(getRelationshipId(order.coupon)).toBe(coupon.id)
      expect(order.discount).toBe(5)
      const orderId = String(order.id)

      expect((await ecommerce.orders.getOrder(orderId)).id).toBe(order.id)
      expect((await ecommerce.orders.getUserOrders(userId)).docs.map((doc) => doc.id)).toEqual([order.id])
      // The customer's earlier order is found, so the per-customer limit applies.
      expect(
        await ecommerce.coupons.validateCoupon({ cartTotal: 20, code: coupon.code, userId }),
      ).toMatchObject({ error: 'Customer usage limit reached', reason: 'customer_limit', valid: false })

      const cancelled = await ecommerce.orders.updateOrderStatus({ orderId, status: 'cancelled' })
      expect(cancelled.status).toBe('cancelled')
      expect((await ecommerce.products.getProduct(productId)).inventory.quantity).toBe(10)
    })
  })

  describe('addresses and guest orders', () => {
    const product = async () =>
      await payload.create({
        collection: 'products',
        data: { price: 10, status: 'active', title: `Address Product ${Date.now()}-${Math.random()}` },
      })

    // No state or province and no postal code, as in an address in Hong Kong.
    const addressWithoutStateOrPostalCode = {
      address1: '1 Queen\'s Road Central',
      city: 'Hong Kong',
      country: 'HK',
      firstName: 'Test',
      lastName: 'Customer',
    }

    test('an order needs no state, postal code or billing address', async () => {
      const { id } = await product()
      const order = await payload.create({
        collection: 'orders',
        data: {
          items: [{ price: 10, product: id, quantity: 1, total: 10 }],
          shippingAddress: addressWithoutStateOrPostalCode,
          subtotal: 10,
        },
      })

      expect(order.shippingAddress).toMatchObject(addressWithoutStateOrPostalCode)
      expect(order.shippingAddress.state ?? null).toBeNull()
      expect(order.billingAddress?.address1 ?? null).toBeNull()
    })

    test.each(['firstName', 'lastName', 'address1', 'city', 'country'])(
      'a shipping address without %s is rejected',
      async (field) => {
        const { id } = await product()
        const { [field]: _removed, ...incomplete } = addressWithoutStateOrPostalCode as Record<string, string>

        await expect(
          payload.create({
            collection: 'orders',
            data: {
              items: [{ price: 10, product: id, quantity: 1, total: 10 }],
              shippingAddress: incomplete,
              subtotal: 10,
            },
          }),
        ).rejects.toThrow(/invalid/i)
      },
    )

    test('a guest cart becomes an order without a user that carries the customer email', async () => {
      const ecommerce = getEcommerce(payload)
      const { id } = await product()
      const sessionId = `guest-order-${Date.now()}`

      const cart = await ecommerce.cart.addToCart({ productId: id, quantity: 2, sessionId })
      expect(cart.user ?? null).toBeNull()

      const order = await ecommerce.orders.createOrderFromCart({
        cartId: cart.id,
        orderData: {
          customerEmail: 'guest@example.com',
          shippingAddress: addressWithoutStateOrPostalCode,
        },
      })

      expect(order.user ?? null).toBeNull()
      expect(order.customerEmail).toBe('guest@example.com')
      expect(order.subtotal).toBe(20)
      // The billing address defaults to the shipping address.
      expect(order.billingAddress).toMatchObject(addressWithoutStateOrPostalCode)
      expect((await ecommerce.cart.getCart(undefined, sessionId))?.items).toEqual([])
    })

    test('an order with something that is not an email address as customerEmail is rejected', async () => {
      const ecommerce = getEcommerce(payload)
      const { id } = await product()
      const cart = await ecommerce.cart.addToCart({
        productId: id,
        quantity: 1,
        sessionId: `guest-bad-email-${Date.now()}`,
      })

      await expect(
        ecommerce.orders.createOrderFromCart({
          cartId: cart.id,
          orderData: { customerEmail: 'not an email', shippingAddress: addressWithoutStateOrPostalCode },
        }),
      ).rejects.toThrow(/invalid/i)
    })
  })

  // The atomic statements use parts of the database adapters that are not public API
  // (Drizzle's `execute` and table map, the Mongoose models and sessions). When a Payload
  // release changes them the plugin falls back to read-then-write, and every other test
  // would still pass, because the fallback is correct without concurrency. These tests
  // fail instead.
  describe('atomic updates', () => {
    const address = {
      address1: '1 Main Street',
      city: 'Amsterdam',
      country: 'NL',
      firstName: 'Test',
      lastName: 'Customer',
    }

    const fallbackWarnings = (warn: { mock: { calls: unknown[][] } }) =>
      warn.mock.calls.map(([message]) => String(message)).filter((message) => message.includes('No atomic'))

    const createFixtures = async (label: string) => {
      const run = `${label}-${Date.now()}`
      const product = await payload.create({
        collection: 'products',
        data: {
          // One more than the tests take: the order created below holds one unit.
          inventory: { quantity: 6, trackQuantity: true },
          price: 10,
          status: 'active',
          title: `Atomic Product ${run}`,
          variants: [{ name: 'Large', inventory: 2 }],
        },
      })
      const coupon = await payload.create({
        collection: 'coupons',
        data: { code: `ATOMIC${run}`, status: 'active', type: 'fixed', usageLimit: 1, value: 1 },
      })
      const order = await payload.create({
        collection: 'orders',
        data: {
          items: [{ price: 10, product: product.id, quantity: 1, total: 10 }],
          shippingAddress: address,
          subtotal: 10,
        },
      })

      return { coupon, order, product }
    }

    /** Spies on the adapter's own statement entry point: `execute` on SQL, the model's `updateOne` on MongoDB. */
    const spyOnNativeStatements = () => {
      const db = payload.db as any
      return usesMongoDB
        ? ['products', 'coupons', 'orders'].map((slug) => vi.spyOn(db.collections[slug], 'updateOne'))
        : [vi.spyOn(db, 'execute')]
    }

    test(`stock, coupon use and order release each run as one ${usesMongoDB ? 'MongoDB updateOne' : 'SQL statement'}, not as the fallback`, async () => {
      const { coupon, order, product } = await createFixtures('native')

      const warn = vi.spyOn(payload.logger, 'warn')
      const update = vi.spyOn(payload, 'update')
      const dbUpdateOne = vi.spyOn(payload.db, 'updateOne')
      const native = spyOnNativeStatements()
      const nativeCalls = () => native.reduce((sum, spy) => sum + spy.mock.calls.length, 0)

      try {
        expect(await adjustStock(payload, { delta: -5, productId: product.id, productsSlug: 'products' })).toBe(true)
        expect(nativeCalls()).toBe(1)
        // Fewer units left than asked for: refused by the same single statement.
        expect(await adjustStock(payload, { delta: -1, productId: product.id, productsSlug: 'products' })).toBe(false)
        expect(nativeCalls()).toBe(2)

        expect(
          await adjustStock(payload, { delta: -2, productId: product.id, productsSlug: 'products', variant: 'Large' }),
        ).toBe(true)
        expect(nativeCalls()).toBe(3)

        expect(await adjustCouponUsage(payload, { couponId: coupon.id, couponsSlug: 'coupons', delta: 1 })).toBe(true)
        expect(nativeCalls()).toBe(4)
        expect(await adjustCouponUsage(payload, { couponId: coupon.id, couponsSlug: 'coupons', delta: 1 })).toBe(false)

        const beforeClaim = nativeCalls()
        expect(
          await claimOrderRelease(payload, { flag: 'inventoryReduced', orderId: order.id, ordersSlug: 'orders' }),
        ).toBe(true)
        expect(nativeCalls()).toBe(beforeClaim + 1)
        expect(
          await claimOrderRelease(payload, { flag: 'inventoryReduced', orderId: order.id, ordersSlug: 'orders' }),
        ).toBe(false)

        // The fallback reads and writes through Payload and logs a warning. None of that happened.
        expect(update).not.toHaveBeenCalled()
        expect(dbUpdateOne).not.toHaveBeenCalled()
        expect(fallbackWarnings(warn)).toEqual([])
      } finally {
        for (const spy of [warn, update, dbUpdateOne, ...native]) {
          spy.mockRestore()
        }
      }

      const stored = await payload.findByID({ id: product.id, collection: 'products' })
      expect(stored.inventory.quantity).toBe(0)
      expect(stored.variants[0].inventory).toBe(0)
      expect((await payload.findByID({ id: coupon.id, collection: 'coupons' })).usageCount).toBe(1)
      expect((await payload.findByID({ id: order.id, collection: 'orders' })).inventoryReduced).toBe(false)
    })

    test('an order holds its stock and coupon through the atomic statements', async () => {
      const { coupon, product } = await createFixtures('order')
      const warn = vi.spyOn(payload.logger, 'warn')
      const native = spyOnNativeStatements()

      try {
        const order = await payload.create({
          collection: 'orders',
          data: {
            coupon: coupon.id,
            items: [{ price: 10, product: product.id, quantity: 2, total: 20 }],
            shippingAddress: address,
            subtotal: 20,
          },
        })
        await payload.update({ id: order.id, collection: 'orders', data: { status: 'cancelled' } })

        // Take stock, count the coupon, then on cancel: claim both flags, restore stock, give the coupon back.
        expect(native.reduce((sum, spy) => sum + spy.mock.calls.length, 0)).toBeGreaterThanOrEqual(6)
        expect(fallbackWarnings(warn)).toEqual([])
      } finally {
        for (const spy of [warn, ...native]) {
          spy.mockRestore()
        }
      }
    })

    test('without the adapter internals the fallback is used and says so once', async () => {
      const { product } = await createFixtures('fallback')
      const db = payload.db as any
      const warn = vi.spyOn(payload.logger, 'warn')

      // Makes the adapter look like one the plugin has no statement for: an unknown
      // adapter name on MongoDB, a missing `execute` on SQL.
      const original = usesMongoDB ? db.name : db.execute
      if (usesMongoDB) {
        db.name = 'unsupported-adapter'
      } else {
        db.execute = undefined
      }

      try {
        expect(await adjustStock(payload, { delta: -2, productId: product.id, productsSlug: 'products' })).toBe(true)
        expect(await adjustStock(payload, { delta: -2, productId: product.id, productsSlug: 'products' })).toBe(true)
        expect(await adjustStock(payload, { delta: -2, productId: product.id, productsSlug: 'products' })).toBe(false)

        const warnings = fallbackWarnings(warn)
        expect(warnings).toHaveLength(1)
        expect(warnings[0]).toContain('No atomic stock update for collection "products"')
        expect(warnings[0]).toContain('read-then-write')
      } finally {
        if (usesMongoDB) {
          db.name = original
        } else {
          db.execute = original
        }
        warn.mockRestore()
      }

      const stored = await payload.findByID({ id: product.id, collection: 'products' })
      expect(stored.inventory.quantity).toBe(1)
    })
  })
})
