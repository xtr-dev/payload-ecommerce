import type { Payload } from 'payload'
import type { HelperAccessOptions } from './access.js'
import { createCartHelpers } from './cart.js'
import { createOrderHelpers } from './orders.js'
import { createCouponHelpers } from './coupons.js'
import { createProductHelpers } from './products.js'
import { getEcommerceSlugs } from './slugs.js'

/** How the helpers call the Local API: with full access (default) or as a user. */
export type EcommerceHelperOptions = HelperAccessOptions

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
  // The slugs the plugin recorded in the config, so renamed collections need no arguments here.
  const slugs = getEcommerceSlugs(payload)

  const cart = createCartHelpers(payload, slugs, options)
  const orders = createOrderHelpers(payload, slugs, options)
  const coupons = createCouponHelpers(payload, slugs, options)
  const products = createProductHelpers(payload, slugs, options)

  return {
    cart,
    orders,
    coupons,
    products,
  }
}

export type EcommerceHelpers = ReturnType<typeof useEcommerce>
