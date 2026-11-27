import type { CollectionConfig, Config } from 'payload'

import type { IsAdmin } from './lib/access.js'
import type { CartCleanupSchedule } from './lib/cartExpiry.js'
import type { RoundMoney } from './lib/money.js'
import type { EcommerceCustomConfig, EcommerceSlugs } from './lib/slugs.js'

import { createCarts, createCategories, createCoupons, createOrders, createProducts } from './collections/index.js'
import { createEcommerceAccess, defaultIsAdmin } from './lib/access.js'
import { createDeleteExpiredCartsTask, DELETE_EXPIRED_CARTS_TASK_SLUG } from './lib/cartExpiry.js'
import { roundToTwoDecimals } from './lib/money.js'
import { DEFAULT_ECOMMERCE_SLUGS, ECOMMERCE_CUSTOM_KEY } from './lib/slugs.js'

/**
 * Receives one of the plugin's collections, with its default access rules, and returns the
 * collection to use: add fields or hooks, replace `access`, or return another `slug` to
 * rename it. It is called twice while the config is built (once to learn the slug, once
 * with the relationships of the other collections pointing at their final slugs), so it
 * must not have side effects.
 */
export type CollectionExtender = (baseCollection: CollectionConfig) => CollectionConfig

export { useEcommerce } from './lib/useEcommerce.js'
export type { EcommerceHelperOptions, EcommerceHelpers } from './lib/useEcommerce.js'
export { createEcommerceAccess, defaultIsAdmin } from './lib/access.js'
export type { EcommerceAccess, IsAdmin } from './lib/access.js'
export { ECOMMERCE_CUSTOM_KEY, getEcommerceSlugs } from './lib/slugs.js'
export type { EcommerceSlugs } from './lib/slugs.js'
export { toDocumentId } from './lib/ids.js'
export { getRoundMoney, roundToTwoDecimals } from './lib/money.js'
export type { RoundMoney } from './lib/money.js'
export type { OrderAddress } from './lib/orders.js'
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
export type { CartCleanupSchedule, DeleteExpiredCartsOptions } from './lib/cartExpiry.js'
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
   *
   * - `true`: the task is registered but not scheduled. Queue it from your own schedule
   *   with `payload.jobs.queue({ task: 'ecommerce-delete-expired-carts', input: {} })`.
   * - `{ schedule: [{ cron: '0 3 * * *', queue: 'nightly' }] }`: Payload queues it at
   *   those times. This needs a Payload version that supports `schedule` on tasks
   *   (verified with 3.94) and a jobs runner that handles schedules and processes that queue.
   *
   * Or call the exported `deleteExpiredCarts(payload)` directly instead of using a task.
   */
  cartCleanupTask?: { schedule?: CartCleanupSchedule[] } | boolean

  /**
   * Slug of the auth collection whose users are the shop's customers. Default: `'users'`.
   * The `user` field of orders and carts relates to this collection, and the default
   * access rules let a signed-in user of it read their own orders and read and update
   * their own carts.
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

  /**
   * Rounds the amounts the plugin calculates (a coupon's discount, the result of the
   * `calculateTax` hook and an order's total) to the smallest unit you charge in.
   * Default: two decimals, for prices in major units (19.99). When your prices are integer
   * minor units (1999 cents), pass `Math.round` so 10% of 1995 becomes 200, not 199.5.
   */
  roundMoney?: RoundMoney

  /**
   * Slug of the upload collection that product `images` relate to. Default: `'media'`.
   * Your config has to provide this collection.
   */
  mediaCollection?: string

  hooks?: {
    /**
     * Called with the data of a new order after the coupon and tax were applied and before
     * the total is computed. Returns the data to save.
     */
    beforeCreateOrder?: (order: any) => Promise<any>
    /**
     * Called with a new order after its stock was taken and its coupon counted. When it
     * throws, the order is not created and both are put back.
     */
    afterCreateOrder?: (order: any) => Promise<void>
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

  /**
   * Turns the plugin's behaviour off while keeping its collections, so the database schema
   * and existing documents stay as they are. The collections keep their fields and access
   * rules, but lose the plugin's collection hooks (slugs, cart subtotal and expiry, order
   * totals, tax, coupons and stock), and the cart cleanup task is not registered.
   */
  disabled?: boolean
}

type CollectionOption = CollectionExtender | string | undefined

const applyCollectionOption = (base: CollectionConfig, option: CollectionOption): CollectionConfig => {
  if (typeof option === 'function') {
    return option(base)
  }

  return typeof option === 'string' ? { ...base, slug: option } : base
}

export const payloadEcommerce =
  (pluginOptions: PayloadEcommerceConfig = {}) =>
  (config: Config): Config => {
    const {
      collections: collectionOptions = {},
      disabled = false,
      isAdmin = defaultIsAdmin,
      mediaCollection = DEFAULT_ECOMMERCE_SLUGS.media,
      roundMoney = roundToTwoDecimals,
      userCollection = DEFAULT_ECOMMERCE_SLUGS.users,
    } = pluginOptions

    const access = createEcommerceAccess(isAdmin, userCollection)

    /**
     * Builds the five collections whose relationships point at the given slugs. The base
     * collections get the default access rules before a CollectionExtender sees them, so
     * a host can replace or widen any rule from its extender. When the plugin is
     * disabled the plugin's own collection hooks are left out; hooks an extender adds stay.
     */
    const buildCollections = (slugs: EcommerceSlugs): Record<keyof typeof collectionOptions, CollectionConfig> => {
      const base = {
        carts: { ...createCarts(slugs, access.cartOwnerField), access: access.carts },
        categories: { ...createCategories(slugs), access: access.categories },
        coupons: { ...createCoupons(slugs), access: access.coupons },
        orders: { ...createOrders(pluginOptions, slugs), access: access.orders },
        products: { ...createProducts(slugs), access: access.products },
      }

      const build = (key: keyof typeof base): CollectionConfig => {
        const { hooks, ...withoutHooks } = base[key]
        return applyCollectionOption(disabled ? withoutHooks : { ...withoutHooks, hooks }, collectionOptions[key])
      }

      return {
        carts: build('carts'),
        categories: build('categories'),
        coupons: build('coupons'),
        orders: build('orders'),
        products: build('products'),
      }
    }

    // A CollectionExtender may rename its collection, and the other collections relate to
    // it by slug. So the collections are built once to learn every final slug, and then
    // again with those slugs in their relationships and hooks.
    const hostSlugs = { media: mediaCollection, users: userCollection }
    const firstPass = buildCollections({ ...DEFAULT_ECOMMERCE_SLUGS, ...hostSlugs })
    const slugs: EcommerceSlugs = {
      ...hostSlugs,
      carts: firstPass.carts.slug,
      categories: firstPass.categories.slug,
      coupons: firstPass.coupons.slug,
      orders: firstPass.orders.slug,
      products: firstPass.products.slug,
    }
    const collections = buildCollections(slugs)

    config.collections = [
      ...(config.collections ?? []),
      collections.products,
      collections.categories,
      collections.orders,
      collections.carts,
      collections.coupons,
    ]

    // The server helpers (`useEcommerce`, `deleteExpiredCarts`) read the slugs from here,
    // and hooks and helpers the money rounding. Recorded also when the plugin is disabled,
    // because the collections still exist. `custom` is never sent to the browser, so it
    // can hold a function.
    const customConfig: EcommerceCustomConfig = { roundMoney, slugs }
    config.custom = { ...config.custom, [ECOMMERCE_CUSTOM_KEY]: customConfig }

    if (disabled) {
      return config
    }

    if (pluginOptions.cartCleanupTask) {
      const tasks = config.jobs?.tasks ?? []

      if (!tasks.some((task) => task.slug === DELETE_EXPIRED_CARTS_TASK_SLUG)) {
        config.jobs = {
          ...(config.jobs ?? {}),
          tasks: [
            ...tasks,
            createDeleteExpiredCartsTask(
              slugs.carts,
              typeof pluginOptions.cartCleanupTask === 'object' ? pluginOptions.cartCleanupTask.schedule : undefined,
            ),
          ],
        }
      }
    }

    return config
  }
