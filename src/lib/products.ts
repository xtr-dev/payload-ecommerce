import type { PaginatedDocs, Payload, PayloadRequest } from 'payload'

import type { HelperAccessOptions } from './access.js'
import type { UntypedDocument } from './documents.js'
import type { DocumentId } from './relationships.js'
import type { EcommerceSlugs } from './slugs.js'

import { resolveLocalApiAccess } from './access.js'
import { adjustStock } from './atomic.js'
import { toDocumentId } from './ids.js'

export interface GetProductsParams {
  category?: DocumentId
  status?: 'draft' | 'active' | 'archived'
  minPrice?: number
  maxPrice?: number
  search?: string
  limit?: number
  page?: number
}

export interface InventoryOptions {
  /** Request whose transaction the stock read and write should run in. */
  req?: PayloadRequest
}

export interface StockTarget {
  /** False when the product does not track its quantity; stock is then unlimited. */
  tracked: boolean
  /** Set when the stock is the named variant's own `inventory` number. */
  variant?: string
  /** Units in stock for this target; `Infinity` when not tracked. */
  available: number
}

/**
 * Decides which stock number an order line for `product` (optionally in `variant`) draws
 * from. Only products with `inventory.trackQuantity` have stock at all. For those, a
 * variant that has its own `inventory` number is tracked on its own; a line without a
 * variant, with an unknown variant name, or with a variant whose `inventory` is left empty
 * draws from the product's `inventory.quantity`.
 */
export const resolveStockTarget = (product: any, variant?: null | string): StockTarget => {
  if (!product?.inventory?.trackQuantity) {
    return { available: Infinity, tracked: false }
  }

  if (variant) {
    const variantData = (product.variants || []).find(
      (candidate: { name?: string }) => candidate.name === variant,
    )
    if (variantData && typeof variantData.inventory === 'number') {
      return { available: variantData.inventory, tracked: true, variant }
    }
  }

  return { available: product.inventory.quantity || 0, tracked: true }
}

/**
 * The message shown when an order asks for more units than are in stock. `available` is
 * left out when the number that was read may be out of date, which is the case after
 * losing a race against another order.
 */
export const describeStockShortage = (
  product: any,
  variant: null | string | undefined,
  requested: number,
  available?: number,
): string => {
  const name = product?.title ? `"${product.title}"` : `product ${product?.id}`
  const variantPart = variant ? ` (variant "${variant}")` : ''
  const availablePart = available === undefined ? '' : `, ${available} available`

  return `Not enough stock for ${name}${variantPart}: ${requested} requested${availablePart}`
}

/** The helpers of `getEcommerce(payload).products`. `TProduct` is the type of a product document. */
export interface ProductHelpers<TProduct = UntypedDocument> {
  /**
   * Tells whether `quantity` units can be ordered, and how many are in stock (`Infinity`
   * for a product that does not track its quantity). This is a read, so two concurrent
   * callers can both be told "available" for the last unit; `reduceInventory` decides.
   */
  checkInventory: (
    productId: DocumentId,
    quantity: number,
    variant?: string,
    options?: InventoryOptions,
  ) => Promise<{ available: boolean; quantity: number }>
  /** Returns the product with its relationships populated (depth 2). Throws when it does not exist. */
  getProduct: (id: DocumentId) => Promise<TProduct>
  /** Returns a page of products; only `active` ones unless `status` is given. */
  getProducts: (params?: GetProductsParams) => Promise<PaginatedDocs<TProduct>>
  /**
   * Takes `quantity` units out of stock in one atomic step and returns the product.
   * Throws when fewer units are left, leaving the stock untouched. Does nothing for a
   * product that does not track its quantity.
   */
  reduceInventory: (
    productId: DocumentId,
    quantity: number,
    variant?: string,
    options?: InventoryOptions,
  ) => Promise<TProduct>
  /**
   * Puts `quantity` units back in stock in one atomic step and returns the product. Does
   * nothing for a product that does not track its quantity.
   */
  restoreInventory: (
    productId: DocumentId,
    quantity: number,
    variant?: string,
    options?: InventoryOptions,
  ) => Promise<TProduct>
}

export const createProductHelpers = <TProduct = UntypedDocument>(
  payload: Payload,
  slugs: EcommerceSlugs,
  accessOptions: HelperAccessOptions = {},
): ProductHelpers<TProduct> => {
  const productsSlug = slugs.products
  /** A product id in the type the products collection stores, also when it arrived as text. */
  const productIdOf = (id: DocumentId): DocumentId => toDocumentId(payload, productsSlug, id)
  // getProduct and getProducts read on behalf of the caller; the inventory helpers are
  // stock bookkeeping and always bypass access control.
  const { caller, trusted } = resolveLocalApiAccess(accessOptions)

  const getProduct = async (id: DocumentId) => {
    return await payload.findByID({
      ...caller,
      collection: productsSlug,
      id: productIdOf(id),
      depth: 2,
    })
  }

  const getProducts = async (params: GetProductsParams = {}) => {
    const { category, status, minPrice, maxPrice, search, limit = 10, page = 1 } = params

    const where: any = {}

    if (category) {
      where.categories = { contains: toDocumentId(payload, slugs.categories, category) }
    }

    if (status) {
      where.status = { equals: status }
    } else {
      where.status = { equals: 'active' }
    }

    if (minPrice !== undefined || maxPrice !== undefined) {
      where.price = {}
      if (minPrice !== undefined) {
        where.price.greater_than_equal = minPrice
      }
      if (maxPrice !== undefined) {
        where.price.less_than_equal = maxPrice
      }
    }

    if (search) {
      where.or = [
        {
          title: {
            contains: search,
          },
        },
        {
          description: {
            contains: search,
          },
        },
        {
          sku: {
            contains: search,
          },
        },
      ]
    }

    return await payload.find({
      ...caller,
      collection: productsSlug,
      where,
      limit,
      page,
      depth: 2,
    })
  }

  const loadProduct = async (productId: DocumentId, req?: PayloadRequest) => {
    const product = await payload.findByID({
      ...trusted,
      id: productIdOf(productId),
      collection: productsSlug,
      depth: 0,
      disableErrors: true,
      req: req ?? trusted.req,
    })

    if (!product) {
      throw new Error(`Product not found: ${productId}`)
    }

    return product
  }

  /**
   * Tells whether `quantity` units can be ordered. A product that does not track its
   * quantity is always available. This is a read, so two concurrent callers can both be
   * told "available" for the last unit; `reduceInventory` is what decides.
   */
  const checkInventory = async (
    productId: DocumentId,
    quantity: number,
    variant?: string,
    options: InventoryOptions = {},
  ) => {
    const target = resolveStockTarget(await loadProduct(productId, options.req), variant)

    return { available: !target.tracked || target.available >= quantity, quantity: target.available }
  }

  /**
   * Takes `quantity` units out of stock in one atomic step (see `adjustStock`) and returns
   * the product. Throws when fewer units are left, leaving the stock untouched. Does
   * nothing for a product that does not track its quantity.
   */
  const reduceInventory = async (
    productId: DocumentId,
    quantity: number,
    variant?: string,
    options: InventoryOptions = {},
  ) => {
    const product = await loadProduct(productId, options.req)
    const target = resolveStockTarget(product, variant)

    if (!target.tracked) {
      return product
    }

    const reduced = await adjustStock(payload, {
      delta: -quantity,
      productId: productIdOf(productId),
      productsSlug,
      req: options.req ?? trusted.req,
      variant: target.variant,
    })

    if (!reduced) {
      throw new Error(describeStockShortage(product, variant, quantity, target.available))
    }

    return await loadProduct(productId, options.req)
  }

  /**
   * Puts `quantity` units back in stock in one atomic step and returns the product. Does
   * nothing for a product that does not track its quantity.
   */
  const restoreInventory = async (
    productId: DocumentId,
    quantity: number,
    variant?: string,
    options: InventoryOptions = {},
  ) => {
    const product = await loadProduct(productId, options.req)
    const target = resolveStockTarget(product, variant)

    if (!target.tracked) {
      return product
    }

    await adjustStock(payload, {
      delta: quantity,
      productId: productIdOf(productId),
      productsSlug,
      req: options.req ?? trusted.req,
      variant: target.variant,
    })

    return await loadProduct(productId, options.req)
  }

  const helpers: ProductHelpers = {
    getProduct,
    getProducts,
    checkInventory,
    reduceInventory,
    restoreInventory,
  }

  // The Local API only knows the products slug as a string, so it returns untyped documents.
  // The object above is checked against the helper signatures with that untyped
  // document; which document type the collection really has is the caller's word.
  return helpers as unknown as ProductHelpers<TProduct>
}
