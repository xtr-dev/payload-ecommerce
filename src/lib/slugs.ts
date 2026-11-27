import type { Payload } from 'payload'

/**
 * The slugs of the plugin's five collections and of the two host collections they relate
 * to, as they are in the running config: after `collections.*` renamed a collection (by
 * a string or by a CollectionExtender that returns another slug) and with the
 * `userCollection` and `mediaCollection` options applied.
 */
export interface EcommerceSlugs {
  carts: string
  categories: string
  coupons: string
  /** Upload collection that product images relate to. */
  media: string
  orders: string
  products: string
  /** Auth collection that orders and carts relate to through their `user` field. */
  users: string
}

export const DEFAULT_ECOMMERCE_SLUGS: EcommerceSlugs = {
  carts: 'carts',
  categories: 'categories',
  coupons: 'coupons',
  media: 'media',
  orders: 'orders',
  products: 'products',
  users: 'users',
}

/** Key under which the plugin records its resolved slugs in the Payload config's `custom`. */
export const ECOMMERCE_CUSTOM_KEY = 'payload-ecommerce'

export interface EcommerceCustomConfig {
  /** See `getRoundMoney` in money.ts. */
  roundMoney: (amount: number) => number
  slugs: EcommerceSlugs
}

/**
 * Returns the slugs the plugin was configured with, read from the Payload config where the
 * plugin recorded them. This is how the server helpers find renamed collections without
 * the caller repeating the names. Falls back to the default slugs when the plugin is not
 * in the config.
 */
export const getEcommerceSlugs = (payload: Payload): EcommerceSlugs => {
  const custom = payload.config.custom?.[ECOMMERCE_CUSTOM_KEY] as Partial<EcommerceCustomConfig> | undefined

  return { ...DEFAULT_ECOMMERCE_SLUGS, ...custom?.slugs }
}
