import type { CollectionConfig, Field, Payload } from 'payload'

import { getPayload } from 'payload'
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'

import {
  DELETE_EXPIRED_CARTS_TASK_SLUG,
  deleteExpiredCarts,
  getEcommerceSlugs,
  getRelationshipId,
  payloadEcommerce,
  getEcommerce,
} from '../src/index.js'
import { adjustCouponUsage, adjustStock, claimOrderRelease } from '../src/lib/atomic.js'
import config from './payload.renamed.config.js'

/**
 * Runs the plugin with every collection renamed (see payload.renamed.config.ts) and
 * checks the plugin options that change how the config is built.
 */

let payload: Payload

const address = {
  address1: '1 Main Street',
  city: 'Amsterdam',
  country: 'NL',
  firstName: 'Test',
  lastName: 'Customer',
  postalCode: '1000 AA',
  state: 'NH',
}

/** Every `relationTo` in a list of fields, by field path, including fields nested in arrays and groups. */
const collectRelations = (fields: Field[], prefix = ''): Record<string, unknown> => {
  const relations: Record<string, unknown> = {}
  for (const field of fields) {
    const name = 'name' in field ? `${prefix}${field.name}` : prefix
    if (field.type === 'relationship' || field.type === 'upload') {
      relations[name] = field.relationTo
    }
    if ('fields' in field) {
      Object.assign(relations, collectRelations(field.fields, 'name' in field ? `${name}.` : prefix))
    }
  }
  return relations
}

const findCollection = (collections: CollectionConfig[] | undefined, slug: string): CollectionConfig => {
  const collection = collections?.find((candidate) => candidate.slug === slug)
  if (!collection) {
    throw new Error(`No collection "${slug}" in ${collections?.map((candidate) => candidate.slug).join(', ')}`)
  }
  return collection
}

beforeAll(async () => {
  payload = await getPayload({ config })
})

afterAll(async () => {
  if (typeof payload.db.destroy === 'function') {
    await payload.db.destroy()
  }
})

describe('renamed collections', () => {
  test('the collections exist under their new slugs only', () => {
    for (const slug of ['shop-products', 'shop-categories', 'shopOrders', 'baskets', 'vouchers']) {
      expect(payload.collections[slug], slug).toBeDefined()
    }
    for (const slug of ['products', 'categories', 'orders', 'carts', 'coupons', 'users', 'media']) {
      expect(payload.collections[slug], slug).toBeUndefined()
    }
  })

  test('the resolved slugs are recorded in the config for the helpers', () => {
    expect(getEcommerceSlugs(payload)).toEqual({
      carts: 'baskets',
      categories: 'shop-categories',
      coupons: 'vouchers',
      media: 'uploads',
      orders: 'shopOrders',
      products: 'shop-products',
      users: 'customers',
    })
  })

  test('every relationship points at the renamed collection', () => {
    const relations = (slug: string) => collectRelations(payload.collections[slug].config.fields)

    expect(relations('shop-products')).toEqual({ categories: 'shop-categories', images: 'uploads' })
    expect(relations('shop-categories')).toEqual({ parent: 'shop-categories' })
    expect(relations('vouchers')).toEqual({
      appliesToCategories: 'shop-categories',
      appliesToProducts: 'shop-products',
    })
    expect(relations('baskets')).toEqual({ 'items.product': 'shop-products', user: 'customers' })
    expect(relations('shopOrders')).toEqual({
      coupon: 'vouchers',
      'items.product': 'shop-products',
      user: 'customers',
    })
  })

  test('an extender that renames a collection keeps its other changes', () => {
    const fieldNames = payload.collections['shopOrders'].config.fields.map((field) =>
      'name' in field ? field.name : undefined,
    )
    expect(fieldNames).toContain('reference')
  })

  test('cart, coupon, order, stock and cancellation work through the helpers', async () => {
    const ecommerce = getEcommerce(payload)

    const category = await payload.create({ collection: 'shop-categories', data: { name: 'Renamed Category' } })
    const product = await payload.create({
      collection: 'shop-products',
      data: {
        categories: [category.id],
        inventory: { quantity: 5, trackQuantity: true },
        price: 1000,
        status: 'active',
        title: 'Renamed Product',
        variants: [{ name: 'Large', inventory: 4, price: 1200 }],
      },
    })
    const coupon = await payload.create({
      collection: 'vouchers',
      data: {
        appliesToCategories: [category.id],
        code: 'renamed10',
        status: 'active',
        type: 'percentage',
        usageLimit: 1,
        value: 10,
      },
    })

    const sessionId = 'renamed-session'
    await ecommerce.cart.addToCart({ productId: product.id, quantity: 2, sessionId })
    const cart = await ecommerce.cart.addToCart({ productId: product.id, quantity: 1, sessionId, variant: 'Large' })
    // The cart's subtotal hook loaded the product from the renamed products collection.
    expect(cart.subtotal).toBe(3200)
    expect((await ecommerce.cart.getCart(undefined, sessionId))?.id).toBe(cart.id)

    const preview = await ecommerce.coupons.validateCoupon({
      cartTotal: 3200,
      categoryIds: [category.id],
      code: 'RENAMED10',
      productIds: [product.id],
    })
    expect(preview).toMatchObject({ discount: 320, valid: true })

    const order = await ecommerce.orders.createOrderFromCart({
      cartId: cart.id,
      orderData: { couponCode: 'renamed10', shippingAddress: address },
    })
    // 21% tax on 3200 − 320 = 604.8, stored as 605 cents.
    expect(order).toMatchObject({
      couponUsageCounted: true,
      discount: 320,
      inventoryReduced: true,
      subtotal: 3200,
      tax: 605,
      total: 3485,
    })
    expect((await ecommerce.orders.getOrder(order.id)).id).toBe(order.id)
    // The access token is stored in and looked up from the renamed orders collection.
    expect(
      (await ecommerce.orders.getOrderByToken({ orderNumber: order.orderNumber, token: order.accessToken }))?.id,
    ).toBe(order.id)
    expect(await ecommerce.orders.getOrderByToken({ orderId: order.id, token: 'wrong' })).toBeNull()

    const afterOrder = await ecommerce.products.getProduct(product.id)
    expect(afterOrder.inventory.quantity).toBe(3)
    expect(afterOrder.variants[0].inventory).toBe(3)
    expect((await payload.findByID({ id: coupon.id, collection: 'vouchers' })).usageCount).toBe(1)
    expect((await ecommerce.cart.getCart(undefined, sessionId))?.items).toEqual([])

    // The coupon's limit of one use is now reached, counted in the renamed collection.
    await ecommerce.cart.addToCart({ productId: product.id, quantity: 1, sessionId })
    await expect(
      ecommerce.orders.createOrderFromCart({
        cartId: cart.id,
        orderData: { couponCode: 'renamed10', shippingAddress: address },
      }),
    ).rejects.toThrow('Coupon usage limit reached')

    await ecommerce.orders.updateOrderStatus({ orderId: order.id, status: 'cancelled' })
    const afterCancel = await ecommerce.products.getProduct(product.id)
    expect(afterCancel.inventory.quantity).toBe(5)
    expect(afterCancel.variants[0].inventory).toBe(4)
    expect((await payload.findByID({ id: coupon.id, collection: 'vouchers' })).usageCount).toBe(0)

    expect((await ecommerce.products.checkInventory(product.id, 5)).available).toBe(true)
    await ecommerce.products.reduceInventory(product.id, 5)
    expect((await ecommerce.products.checkInventory(product.id, 1)).available).toBe(false)
  })

  test('orders and carts belong to users of the configured user collection', async () => {
    const customer = await payload.create({
      collection: 'customers',
      data: { email: `customer-${Date.now()}@example.com`, password: 'renamed-test-password' },
    })
    const other = await payload.create({
      collection: 'customers',
      data: { email: `other-${Date.now()}@example.com`, password: 'renamed-test-password' },
    })
    const product = await payload.create({
      collection: 'shop-products',
      data: { price: 7, status: 'active', title: 'Renamed Customer Product' },
    })

    const ecommerce = getEcommerce(payload)
    const cart = await ecommerce.cart.addToCart({ productId: product.id, quantity: 1, userId: customer.id })
    expect(getRelationshipId(cart.user)).toBe(customer.id)

    const order = await ecommerce.orders.createOrderFromCart({
      cartId: cart.id,
      orderData: { shippingAddress: address },
    })
    expect(getRelationshipId(order.user)).toBe(customer.id)
    expect((await ecommerce.orders.getUserOrders(customer.id)).docs.map((doc) => doc.id)).toEqual([order.id])

    // The default access rules recognise a user of `customers` as the owner.
    const asCustomer = { overrideAccess: false, user: { ...customer, collection: 'customers' } }
    const own = await payload.find({ collection: 'shopOrders', ...asCustomer })
    expect(own.docs.map((doc) => doc.id)).toEqual([order.id])
    const asOther = { overrideAccess: false, user: { ...other, collection: 'customers' } }
    expect((await payload.find({ collection: 'shopOrders', ...asOther })).docs).toEqual([])
  })

  test('expired carts are deleted from the renamed collection, directly and by the jobs task', async () => {
    const expiresAt = new Date(Date.now() - 1000).toISOString()
    const createExpired = async (sessionId: string) =>
      await payload.create({ collection: 'baskets', data: { expiresAt, items: [], sessionId } })
    const exists = async (id: number | string) =>
      (await payload.count({ collection: 'baskets', where: { id: { equals: id } } })).totalDocs === 1

    const first = await createExpired('renamed-expired-1')
    expect((await deleteExpiredCarts(payload)).deleted).toBeGreaterThanOrEqual(1)
    expect(await exists(first.id)).toBe(false)

    const second = await createExpired('renamed-expired-2')
    expect((await getEcommerce(payload).cart.deleteExpiredCarts()).deleted).toBeGreaterThanOrEqual(1)
    expect(await exists(second.id)).toBe(false)

    const third = await createExpired('renamed-expired-3')
    await payload.jobs.queue({ input: {}, task: DELETE_EXPIRED_CARTS_TASK_SLUG as never })
    await payload.jobs.run()
    expect(await exists(third.id)).toBe(false)
  })

  test('the scheduled jobs task is queued by Payload and deletes expired carts', async (context) => {
    // Task schedules do not exist in the oldest Payload version the plugin supports.
    if (typeof payload.jobs.handleSchedules !== 'function') {
      context.skip()
      return
    }

    expect(
      payload.config.jobs.tasks.find((task) => task.slug === DELETE_EXPIRED_CARTS_TASK_SLUG)?.schedule,
    ).toEqual([{ cron: '* * * * * *', queue: 'cart-cleanup' }])

    const cart = await payload.create({
      collection: 'baskets',
      data: { expiresAt: new Date(Date.now() - 1000).toISOString(), items: [], sessionId: 'renamed-scheduled' },
    })
    const exists = async () =>
      (await payload.count({ collection: 'baskets', where: { id: { equals: cart.id } } })).totalDocs === 1

    // Nothing was queued by hand: handleSchedules queues the job for the next second and
    // run picks it up once that moment has passed.
    for (let attempt = 0; attempt < 20 && (await exists()); attempt += 1) {
      await payload.jobs.handleSchedules({ queue: 'cart-cleanup' })
      await payload.jobs.run({ queue: 'cart-cleanup' })
      await new Promise((resolve) => setTimeout(resolve, 250))
    }

    expect(await exists()).toBe(false)
  })

  test('stock, coupon use and order release are atomic statements on the renamed tables', async () => {
    const warn = vi.spyOn(payload.logger, 'warn')
    const update = vi.spyOn(payload, 'update')

    try {
      const product = await payload.create({
        collection: 'shop-products',
        data: {
          // One more than the tests take: the order created below holds one unit.
          inventory: { quantity: 6, trackQuantity: true },
          price: 100,
          status: 'active',
          title: 'Renamed Atomic Product',
          variants: [{ name: 'Large', inventory: 2 }],
        },
      })
      const coupon = await payload.create({
        collection: 'vouchers',
        data: { code: 'RENAMEDATOMIC', status: 'active', type: 'fixed', usageLimit: 1, value: 1 },
      })
      const order = await payload.create({
        collection: 'shopOrders',
        data: {
          items: [{ price: 100, product: product.id, quantity: 1, total: 100 }],
          shippingAddress: address,
          subtotal: 100,
        },
      })
      update.mockClear()

      expect(await adjustStock(payload, { delta: -5, productId: product.id, productsSlug: 'shop-products' })).toBe(true)
      expect(await adjustStock(payload, { delta: -1, productId: product.id, productsSlug: 'shop-products' })).toBe(false)
      expect(
        await adjustStock(payload, { delta: -2, productId: product.id, productsSlug: 'shop-products', variant: 'Large' }),
      ).toBe(true)
      expect(await adjustCouponUsage(payload, { couponId: coupon.id, couponsSlug: 'vouchers', delta: 1 })).toBe(true)
      expect(await adjustCouponUsage(payload, { couponId: coupon.id, couponsSlug: 'vouchers', delta: 1 })).toBe(false)
      expect(
        await claimOrderRelease(payload, { flag: 'inventoryReduced', orderId: order.id, ordersSlug: 'shopOrders' }),
      ).toBe(true)
      expect(
        await claimOrderRelease(payload, { flag: 'inventoryReduced', orderId: order.id, ordersSlug: 'shopOrders' }),
      ).toBe(false)

      // The fallback writes through payload.update and logs a warning; neither happened.
      expect(update).not.toHaveBeenCalled()
      expect(warn.mock.calls.filter(([message]) => String(message).includes('No atomic'))).toEqual([])

      const stored = await payload.findByID({ id: product.id, collection: 'shop-products' })
      expect(stored.inventory.quantity).toBe(0)
      expect(stored.variants[0].inventory).toBe(0)
    } finally {
      warn.mockRestore()
      update.mockRestore()
    }
  })
})

describe('integer cents with roundMoney: Math.round', () => {
  test('discount, tax and total of an order are whole cents', async () => {
    const ecommerce = getEcommerce(payload)
    const product = await payload.create({
      collection: 'shop-products',
      data: { price: 1995, status: 'active', title: 'Cents Product' },
    })
    await payload.create({
      collection: 'vouchers',
      data: { code: 'CENTS10', status: 'active', type: 'percentage', value: 10 },
    })

    // 10% of 1995 is 199.5: the preview and the order both round it to 200.
    const preview = await ecommerce.coupons.validateCoupon({ cartTotal: 1995, code: 'CENTS10' })
    expect(preview.discount).toBe(200)

    const cart = await ecommerce.cart.addToCart({ productId: product.id, quantity: 1, sessionId: 'cents-session' })
    const order = await ecommerce.orders.createOrderFromCart({
      cartId: cart.id,
      orderData: { couponCode: 'CENTS10', shipping: 495, shippingAddress: address },
    })

    // Tax: 21% of 1995 − 200 = 376.95, stored as 377.
    expect(order).toMatchObject({ discount: 200, shipping: 495, subtotal: 1995, tax: 377, total: 2667 })
    for (const amount of [order.discount, order.tax, order.total]) {
      expect(Number.isInteger(amount)).toBe(true)
    }

    // The same total, shown before the order exists.
    expect(ecommerce.orders.calculateTotal({ discount: 200, shipping: 495, subtotal: 1995, tax: 376.95 })).toBe(2667)
  })

  test('a rounded discount is never more than the cart total', async () => {
    await payload.create({
      collection: 'vouchers',
      data: { code: 'CENTSALL', status: 'active', type: 'percentage', value: 100 },
    })
    const preview = await getEcommerce(payload).coupons.validateCoupon({ cartTotal: 0.4, code: 'CENTSALL' })

    expect(preview.discount).toBe(0)
  })
})

describe('plugin options', () => {
  test('userCollection and mediaCollection decide what the user and image fields relate to', () => {
    const built = payloadEcommerce({ mediaCollection: 'assets', userCollection: 'members' })({ collections: [] })

    expect(collectRelations(findCollection(built.collections, 'orders').fields).user).toBe('members')
    expect(collectRelations(findCollection(built.collections, 'carts').fields).user).toBe('members')
    expect(collectRelations(findCollection(built.collections, 'products').fields).images).toBe('assets')
  })

  test('the defaults relate to users and media', () => {
    const built = payloadEcommerce()({ collections: [] })

    expect(collectRelations(findCollection(built.collections, 'orders').fields).user).toBe('users')
    expect(collectRelations(findCollection(built.collections, 'products').fields).images).toBe('media')
  })

  test('disabled keeps the collections, fields and access rules but adds no hooks or tasks', () => {
    const enabled = payloadEcommerce({ cartCleanupTask: true })({ collections: [] })
    const disabled = payloadEcommerce({ cartCleanupTask: true, disabled: true })({ collections: [] })

    expect(enabled.jobs?.tasks?.map((task) => task.slug)).toEqual([DELETE_EXPIRED_CARTS_TASK_SLUG])
    expect(disabled.jobs).toBeUndefined()

    for (const slug of ['products', 'categories', 'orders', 'carts', 'coupons']) {
      const withPlugin = findCollection(enabled.collections, slug)
      const withoutPlugin = findCollection(disabled.collections, slug)

      // Same schema, so switching the plugin off needs no migration.
      expect(JSON.stringify(withoutPlugin.fields), slug).toBe(JSON.stringify(withPlugin.fields))
      expect(withoutPlugin.hooks, slug).toBeUndefined()
      expect(Object.keys(withoutPlugin.access ?? {}).sort(), slug).toEqual(['create', 'delete', 'read', 'update'])
    }
    expect(findCollection(enabled.collections, 'orders').hooks?.beforeChange).toHaveLength(1)
  })

  test('disabled leaves the hooks a collection extender adds', () => {
    const hook = () => {}
    const built = payloadEcommerce({
      collections: { orders: (base) => ({ ...base, hooks: { afterChange: [hook] } }) },
      disabled: true,
    })({ collections: [] })

    expect(findCollection(built.collections, 'orders').hooks).toEqual({ afterChange: [hook] })
  })

  test('the host config keeps its own collections and custom values', () => {
    const built = payloadEcommerce()({ collections: [{ slug: 'pages', fields: [] }], custom: { mine: 1 } })

    expect(built.collections?.map((collection) => collection.slug)).toEqual([
      'pages',
      'products',
      'categories',
      'orders',
      'carts',
      'coupons',
    ])
    expect(built.custom?.mine).toBe(1)
  })
})
