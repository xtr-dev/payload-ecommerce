import type { CollectionConfig, Config } from 'payload'
import { Products } from './collections/Products.js'
import { Categories } from './collections/index.js'
import { createOrders } from './collections/Orders.js'
import { Carts } from './collections/Carts.js'
import { Coupons } from './collections/Coupons.js'
import { createDeleteExpiredCartsTask, DELETE_EXPIRED_CARTS_TASK_SLUG } from './lib/cartExpiry.js'

export type CollectionExtender = (baseCollection: CollectionConfig) => CollectionConfig

export { Products, Categories, Carts, Coupons }
export { useEcommerce } from './lib/useEcommerce.js'
export type { EcommerceHelpers } from './lib/useEcommerce.js'
export { isSameCartLine } from './lib/cart.js'
export { getRelationshipId, isSameDocument } from './lib/relationships.js'
export type { DocumentId } from './lib/relationships.js'
export {
  CART_LIFETIME_DAYS,
  createDeleteExpiredCartsTask,
  DELETE_EXPIRED_CARTS_TASK_SLUG,
  deleteExpiredCarts,
  isCartExpired,
} from './lib/cartExpiry.js'
export type { DeleteExpiredCartsOptions } from './lib/cartExpiry.js'
export { resolveUnitPrice } from './lib/pricing.js'
export type { PricedProduct } from './lib/pricing.js'
export { slugify } from './lib/slug.js'
export { calculateOrderTotal } from './lib/totals.js'
export type { OrderTotalParts } from './lib/totals.js'

export type PayloadEcommerceConfig = {
  collections?: {
    products?: string | CollectionExtender
    orders?: string | CollectionExtender
    categories?: string | CollectionExtender
    carts?: string | CollectionExtender
    coupons?: string | CollectionExtender
  }

  /**
   * Registers the `ecommerce-delete-expired-carts` jobs task, which deletes every cart
   * past its `expiresAt`. Off by default, so a host without a jobs runner is unaffected.
   * The plugin does not schedule the task: queue it from your own schedule with
   * `payload.jobs.queue({ task: 'ecommerce-delete-expired-carts', input: {} })`, or call
   * the exported `deleteExpiredCarts(payload)` directly instead of using a task.
   */
  cartCleanupTask?: boolean

  userCollection?: string

  payments?: {
    providers: ('stripe' | 'paypal' | 'square')[]
    currency: string
    testMode?: boolean
  }

  emails?: {
    enabled: boolean
    from?: string
    fromName?: string
  }

  shipping?: {
    enabled: boolean
    freeShippingThreshold?: number
    rates?: Array<{
      name: string
      price: number
      minOrder?: number
    }>
  }

  hooks?: {
    beforeCreateOrder?: (order: any) => Promise<any>
    afterCreateOrder?: (order: any) => Promise<void>
    beforePayment?: (order: any) => Promise<void>
    afterPayment?: (order: any) => Promise<void>
    calculateTax?: (orderData: {
      items: Array<{
        product: any
        variant?: string
        quantity: number
        price: number
        total: number
      }>
      subtotal: number
      discount: number
      shipping: number
      shippingAddress?: any
      billingAddress?: any
    }) => Promise<number> | number
  }

  disabled?: boolean
}

const processCollection = (
  baseCollection: CollectionConfig,
  config: string | CollectionExtender | undefined,
  defaultSlug: string,
): CollectionConfig => {
  if (typeof config === 'function') {
    return config(baseCollection)
  }

  const slug = typeof config === 'string' ? config : defaultSlug

  return {
    ...baseCollection,
    slug,
  }
}

export const payloadEcommerce =
  (pluginOptions: PayloadEcommerceConfig = {}) =>
  (config: Config): Config => {
    if (!config.collections) {
      config.collections = []
    }

    const {
      collections: customCollections = {},
      userCollection = 'users',
      disabled = false,
    } = pluginOptions

    const Orders = createOrders(pluginOptions)

    config.collections.push(
      processCollection(Products, customCollections.products, 'products'),
      processCollection(Categories, customCollections.categories, 'categories'),
      processCollection(Orders, customCollections.orders, 'orders'),
      processCollection(Carts, customCollections.carts, 'carts'),
      processCollection(Coupons, customCollections.coupons, 'coupons'),
    )

    if (pluginOptions.cartCleanupTask) {
      const cartsSlug = typeof customCollections.carts === 'string' ? customCollections.carts : 'carts'
      const tasks = config.jobs?.tasks ?? []

      if (!tasks.some((task) => task.slug === DELETE_EXPIRED_CARTS_TASK_SLUG)) {
        config.jobs = {
          ...(config.jobs ?? {}),
          tasks: [...tasks, createDeleteExpiredCartsTask(cartsSlug)],
        }
      }
    }

    if (disabled) {
      return config
    }

    return config
  }
