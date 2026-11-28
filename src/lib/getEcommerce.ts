import type { Payload } from 'payload'
import type { HelperAccessOptions } from './access.js'
import type { CartHelpers } from './cart.js'
import type { CouponHelpers } from './coupons.js'
import type { EcommerceDocument, EcommerceDocumentTypes } from './documents.js'
import type { OrderHelpers } from './orders.js'
import type { ProductHelpers } from './products.js'
import { createCartHelpers } from './cart.js'
import { createOrderHelpers } from './orders.js'
import { createCouponHelpers } from './coupons.js'
import { createProductHelpers } from './products.js'
import { getEcommerceSlugs } from './slugs.js'

/** How the helpers call the Local API: with full access (default) or as a user. */
export type EcommerceHelperOptions = HelperAccessOptions

/**
 * The server helpers `getEcommerce` returns. `TDocuments` gives the document types of the
 * plugin's collections; see `getEcommerce`.
 */
export interface EcommerceHelpers<TDocuments extends EcommerceDocumentTypes = EcommerceDocumentTypes> {
  cart: CartHelpers<EcommerceDocument<TDocuments, 'carts'>>
  coupons: CouponHelpers<EcommerceDocument<TDocuments, 'coupons'>>
  orders: OrderHelpers<EcommerceDocument<TDocuments, 'orders'>>
  products: ProductHelpers<EcommerceDocument<TDocuments, 'products'>>
}

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
 *
 * The documents the helpers return have the types of the host's generated Payload types
 * for the collections `carts`, `coupons`, `orders` and `products`, and are untyped when
 * there are none. When a collection was renamed, or another collection of the host has
 * one of those slugs, name the types: `getEcommerce<{ carts: ShopCart }>(payload)`.
 *
 * It is a plain function, not a React hook: call it anywhere on the server, as often as
 * needed. Each call only reads the slugs from the config and builds closures.
 */
export const getEcommerce = <TDocuments extends EcommerceDocumentTypes = EcommerceDocumentTypes>(
  payload: Payload,
  options: EcommerceHelperOptions = {},
): EcommerceHelpers<TDocuments> => {
  // The slugs the plugin recorded in the config, so renamed collections need no arguments here.
  const slugs = getEcommerceSlugs(payload)

  return {
    cart: createCartHelpers(payload, slugs, options),
    orders: createOrderHelpers(payload, slugs, options),
    coupons: createCouponHelpers(payload, slugs, options),
    products: createProductHelpers(payload, slugs, options),
  }
}

/**
 * The name `getEcommerce` was released under in 0.1.0.
 *
 * @deprecated Use `getEcommerce`. This function is not a React hook, but a name starting
 * with `use` makes the `react-hooks/rules-of-hooks` lint rule reject every call outside a
 * component. Both names are the same function.
 */
export const useEcommerce = getEcommerce
