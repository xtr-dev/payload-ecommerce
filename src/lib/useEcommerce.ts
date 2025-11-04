import type { Payload } from 'payload'
import { createCartHelpers } from './cart.js'
import { createOrderHelpers } from './orders.js'
import { createCouponHelpers } from './coupons.js'
import { createProductHelpers } from './products.js'

export interface EcommerceSlugs {
  products?: string
  orders?: string
  categories?: string
  carts?: string
  coupons?: string
}

/**
 * Creates an ecommerce utilities library for interacting with the plugin
 * Use this in server-side contexts (API routes, hooks, etc.)
 */
export const useEcommerce = (payload: Payload, slugs: EcommerceSlugs = {}) => {
  const productsSlug = slugs.products || 'products'
  const ordersSlug = slugs.orders || 'orders'
  const cartsSlug = slugs.carts || 'carts'
  const couponsSlug = slugs.coupons || 'coupons'

  const cart = createCartHelpers(payload, cartsSlug)
  const orders = createOrderHelpers(payload, ordersSlug, cartsSlug, productsSlug)
  const coupons = createCouponHelpers(payload, couponsSlug, ordersSlug)
  const products = createProductHelpers(payload, productsSlug)

  return {
    cart,
    orders,
    coupons,
    products,
  }
}

export type EcommerceHelpers = ReturnType<typeof useEcommerce>
