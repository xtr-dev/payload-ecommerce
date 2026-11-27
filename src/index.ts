import type { CollectionConfig, Config } from 'payload'
import { Products } from './collections/Products.js'
import { Categories } from './collections/index.js'
import { createOrders } from './collections/Orders.js'
import { Carts } from './collections/Carts.js'
import { Coupons } from './collections/Coupons.js'

export type CollectionExtender = (baseCollection: CollectionConfig) => CollectionConfig

export { Products, Categories, Carts, Coupons }
export { useEcommerce } from './lib/useEcommerce.js'
export type { EcommerceHelpers } from './lib/useEcommerce.js'

export type PayloadEcommerceConfig = {
  collections?: {
    products?: string | CollectionExtender
    orders?: string | CollectionExtender
    categories?: string | CollectionExtender
    carts?: string | CollectionExtender
    coupons?: string | CollectionExtender
  }

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

    if (disabled) {
      return config
    }

    return config
  }
