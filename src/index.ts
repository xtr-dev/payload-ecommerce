import type { CollectionConfig, Config } from 'payload'
import { Products } from './collections/Products.js'
import { Categories } from './collections/index.js'
import { createOrders } from './collections/Orders.js'
import { Carts } from './collections/Carts.js'
import { Coupons } from './collections/Coupons.js'
import type { IsAdmin } from './lib/access.js'
import { createEcommerceAccess, defaultIsAdmin } from './lib/access.js'
import { createDeleteExpiredCartsTask, DELETE_EXPIRED_CARTS_TASK_SLUG } from './lib/cartExpiry.js'

export type CollectionExtender = (baseCollection: CollectionConfig) => CollectionConfig

export { Products, Categories, Carts, Coupons }
export { useEcommerce } from './lib/useEcommerce.js'
export type { EcommerceHelperOptions, EcommerceHelpers } from './lib/useEcommerce.js'
export { createEcommerceAccess, defaultIsAdmin } from './lib/access.js'
export type { EcommerceAccess, IsAdmin } from './lib/access.js'
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

  /**
   * Slug of the auth collection whose users are the shop's customers. Default: `'users'`.
   * The default access rules let a signed-in user of this collection read their own orders
   * and read and update their own carts.
   */
  userCollection?: string

  /**
   * Decides who may manage the shop: write products, categories and coupons and read and
   * change every order and cart through REST, GraphQL and the admin panel. Default: a
   * signed-in user whose `role` is `'admin'` or whose `roles` array contains `'admin'`.
   * When your users collection has neither field nobody is an admin until you pass this
   * option, for example `isAdmin: ({ req }) => req.user?.collection === 'admins'`.
   */
  isAdmin?: IsAdmin

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
    /**
     * Returns the tax amount of an order. Called for every new order, and for an update
     * that changes an item, amount or address. When it throws or returns something that is
     * not a finite number, the create or update fails and nothing is saved.
     */
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
      isAdmin = defaultIsAdmin,
    } = pluginOptions

    const Orders = createOrders(pluginOptions)
    const access = createEcommerceAccess(isAdmin, userCollection)

    // The base collections get the default access rules before a CollectionExtender sees
    // them, so a host can replace or widen any rule from its extender.
    const cartsWithAccess: CollectionConfig = {
      ...Carts,
      access: access.carts,
      fields: Carts.fields.map((field) =>
        'name' in field && (field.name === 'user' || field.name === 'sessionId')
          ? ({ ...field, access: access.cartOwnerField } as typeof field)
          : field,
      ),
    }

    config.collections.push(
      processCollection({ ...Products, access: access.products }, customCollections.products, 'products'),
      processCollection({ ...Categories, access: access.categories }, customCollections.categories, 'categories'),
      processCollection({ ...Orders, access: access.orders }, customCollections.orders, 'orders'),
      processCollection(cartsWithAccess, customCollections.carts, 'carts'),
      processCollection({ ...Coupons, access: access.coupons }, customCollections.coupons, 'coupons'),
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
