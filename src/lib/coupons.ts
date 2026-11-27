import type { Payload, PayloadRequest } from 'payload'

import type { DocumentId } from './relationships.js'

import { adjustCouponUsage } from './atomic.js'
import { isSameDocument } from './relationships.js'

export interface ValidateCouponParams {
  code: string
  /** Order subtotal before discount, tax and shipping. */
  cartTotal: number
  /** Customer placing the order; needed to enforce the coupon's per-customer limit. */
  userId?: DocumentId
  /** Products in the cart; needed for coupons restricted to products. */
  productIds?: DocumentId[]
  /** Categories of the products in the cart; needed for coupons restricted to categories. */
  categoryIds?: DocumentId[]
}

export interface ApplyCouponResult {
  valid: boolean
  /**
   * Amount to take off the subtotal. Never more than `cartTotal`, and 0 for a free
   * shipping coupon, whose effect is reported by `freeShipping` instead.
   */
  discount: number
  /** True when the coupon is valid and of type `freeShipping`: the order ships for 0. */
  freeShipping: boolean
  error?: string
  coupon?: any
}

export interface EvaluateCouponParams extends Omit<ValidateCouponParams, 'code'> {
  /** Slug of the orders collection, used to count a customer's earlier uses. */
  ordersSlug?: string
  /** Request whose transaction the per-customer count should run in. */
  req?: PayloadRequest
}

/**
 * Order statuses in which an order no longer holds its stock or its use of a coupon.
 */
export const RELEASED_ORDER_STATUSES = ['cancelled', 'refunded']

const rejected = (error: string): ApplyCouponResult => ({
  valid: false,
  discount: 0,
  freeShipping: false,
  error,
})

/**
 * Decides whether a coupon document can be used for an order and what it does to it.
 *
 * This is the single implementation of the coupon rules. `validateCoupon` uses it to
 * preview a coupon by code, and the orders collection uses it when an order is created
 * with a coupon, so a preview and the order that follows always agree.
 *
 * Rules, in order: status must be `active`; now must be within `validFrom`/`validUntil`;
 * `usageCount` must be below `usageLimit`; the customer's orders with this coupon must be
 * below `customerLimit` (only checked when `userId` is given; cancelled and refunded orders
 * do not count); `cartTotal` must reach
 * `minPurchase`; and when the coupon is restricted to products and/or categories, the
 * cart must contain at least one matching product for each restriction that is set.
 * A limit of 0 or an empty restriction means "no limit".
 *
 * A restricted percentage or fixed coupon still discounts the whole `cartTotal`, not only
 * the matching lines.
 */
export const evaluateCoupon = async (
  payload: Payload,
  coupon: any,
  {
    cartTotal,
    userId,
    productIds = [],
    categoryIds = [],
    ordersSlug = 'orders',
    req,
  }: EvaluateCouponParams,
): Promise<ApplyCouponResult> => {
  if (!coupon) {
    return rejected('Coupon not found')
  }

  if (coupon.status !== 'active') {
    return rejected('Coupon is not active')
  }

  const now = new Date()

  if (coupon.validFrom && new Date(coupon.validFrom) > now) {
    return rejected('Coupon is not yet valid')
  }

  if (coupon.validUntil && new Date(coupon.validUntil) < now) {
    return rejected('Coupon has expired')
  }

  if (coupon.usageLimit && (coupon.usageCount || 0) >= coupon.usageLimit) {
    return rejected('Coupon usage limit reached')
  }

  if (userId !== undefined && userId !== null && coupon.customerLimit) {
    const { totalDocs } = await payload.count({
      collection: ordersSlug,
      req,
      where: {
        and: [
          { user: { equals: userId } },
          { coupon: { equals: coupon.id } },
          // A cancelled or refunded order gave its use of the coupon back.
          { status: { not_in: RELEASED_ORDER_STATUSES } },
        ],
      },
    })

    if (totalDocs >= coupon.customerLimit) {
      return rejected('Customer usage limit reached')
    }
  }

  if (coupon.minPurchase && cartTotal < coupon.minPurchase) {
    return rejected(`Minimum purchase amount of ${coupon.minPurchase} required`)
  }

  if (coupon.appliesToProducts && coupon.appliesToProducts.length > 0) {
    const hasApplicableProduct = productIds.some((id) =>
      coupon.appliesToProducts.some((product: unknown) => isSameDocument(product, id)),
    )

    if (!hasApplicableProduct) {
      return rejected('Coupon does not apply to products in cart')
    }
  }

  if (coupon.appliesToCategories && coupon.appliesToCategories.length > 0) {
    const hasApplicableCategory = categoryIds.some((id) =>
      coupon.appliesToCategories.some((category: unknown) => isSameDocument(category, id)),
    )

    if (!hasApplicableCategory) {
      return rejected('Coupon does not apply to product categories in cart')
    }
  }

  if (coupon.type === 'freeShipping') {
    return { valid: true, discount: 0, freeShipping: true, coupon }
  }

  let discount = 0

  if (coupon.type === 'percentage') {
    discount = (cartTotal * (coupon.value || 0)) / 100
    if (coupon.maxDiscount && discount > coupon.maxDiscount) {
      discount = coupon.maxDiscount
    }
  } else if (coupon.type === 'fixed') {
    discount = coupon.value || 0
  }

  // A fixed coupon worth more than the cart, or a percentage above 100, takes the
  // subtotal down to 0 at most; it never turns into credit against tax or shipping.
  discount = Math.min(Math.max(0, discount), Math.max(0, cartTotal))

  return { valid: true, discount, freeShipping: false, coupon }
}

export const createCouponHelpers = (
  payload: Payload,
  couponsSlug = 'coupons',
  ordersSlug = 'orders',
) => {
  /** Finds a coupon by its code. Codes are stored in upper case and matched ignoring case. */
  const findCouponByCode = async (code: string) => {
    const { docs } = await payload.find({
      collection: couponsSlug,
      depth: 0,
      limit: 1,
      where: {
        code: {
          equals: code.trim().toUpperCase(),
        },
      },
    })

    return docs[0] ?? null
  }

  /**
   * Previews a coupon for a cart without using it. See `evaluateCoupon` for the rules.
   * Creating an order with the returned `coupon.id` applies the same rules again.
   */
  const validateCoupon = async ({
    code,
    ...params
  }: ValidateCouponParams): Promise<ApplyCouponResult> => {
    const coupon = await findCouponByCode(code)

    return await evaluateCoupon(payload, coupon, { ...params, ordersSlug })
  }

  const applyCoupon = async (
    code: string,
    cartTotal: number,
    userId?: DocumentId,
    productIds?: DocumentId[],
    categoryIds?: DocumentId[],
  ) => {
    return await validateCoupon({ code, cartTotal, userId, productIds, categoryIds })
  }

  /**
   * Counts one use of a coupon in a single atomic step (see `adjustCouponUsage`) and
   * returns the coupon. Throws when the coupon's `usageLimit` is already reached or the
   * coupon does not exist. The orders collection calls this for every order created with a
   * coupon, so call it yourself only for uses that are not orders.
   */
  const incrementCouponUsage = async (couponId: DocumentId, options: { req?: PayloadRequest } = {}) => {
    const counted = await adjustCouponUsage(payload, {
      couponId,
      couponsSlug,
      delta: 1,
      req: options.req,
    })

    if (!counted) {
      throw new Error('Coupon not found or its usage limit is reached')
    }

    return await payload.findByID({ id: couponId, collection: couponsSlug, depth: 0, req: options.req })
  }

  /**
   * Gives back one use of a coupon (never below 0) and returns the coupon. The orders
   * collection calls this when an order with a coupon is cancelled or refunded.
   */
  const decrementCouponUsage = async (couponId: DocumentId, options: { req?: PayloadRequest } = {}) => {
    await adjustCouponUsage(payload, { couponId, couponsSlug, delta: -1, req: options.req })

    return await payload.findByID({ id: couponId, collection: couponsSlug, depth: 0, req: options.req })
  }

  return {
    findCouponByCode,
    validateCoupon,
    applyCoupon,
    incrementCouponUsage,
    decrementCouponUsage,
  }
}
