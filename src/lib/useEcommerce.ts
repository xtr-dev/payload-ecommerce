import type { Payload } from 'payload'
import type { HelperAccessOptions } from './access.js'
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

/** Collection slugs (when renamed) and how the helpers call the Local API. */
export interface EcommerceHelperOptions extends EcommerceSlugs, HelperAccessOptions {}

/**
 * Creates the plugin's server helpers. Use them in server code only (server actions, route
 * handlers, hooks).
 *
 * By default they bypass access control (`overrideAccess: true`): they are how a
 * storefront reaches guest carts and creates orders, which the collections' access rules
 * do not allow through REST or GraphQL. Only pass them ids that belong to the visitor.
 *
 * Pass `{ overrideAccess: false, user }` (or `req`) to have cart, order and product reads
 * and cart and order-status writes run as that user. `createOrderFromCart` then still
 * creates the order itself, after reading the cart as the user; coupon validation and
 * the inventory helpers always run with full access.
 */
export const useEcommerce = (payload: Payload, options: EcommerceHelperOptions = {}) => {
  const { carts, categories: _categories, coupons: couponsOption, orders: ordersOption, products: productsOption, ...access } = options
  const productsSlug = productsOption || 'products'
  const ordersSlug = ordersOption || 'orders'
  const cartsSlug = carts || 'carts'
  const couponsSlug = couponsOption || 'coupons'

  const cart = createCartHelpers(payload, cartsSlug, access)
  const orders = createOrderHelpers(payload, ordersSlug, cartsSlug, productsSlug, couponsSlug, access)
  const coupons = createCouponHelpers(payload, couponsSlug, ordersSlug, access)
  const products = createProductHelpers(payload, productsSlug, access)

  return {
    cart,
    orders,
    coupons,
    products,
  }
}

export type EcommerceHelpers = ReturnType<typeof useEcommerce>
