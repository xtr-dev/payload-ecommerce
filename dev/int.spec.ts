import type { Payload } from 'payload'

import config from '@payload-config'
import { getPayload } from 'payload'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

let payload: Payload

afterAll(async () => {
  await payload.destroy()
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
})
