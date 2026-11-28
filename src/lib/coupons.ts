import type { Payload, PayloadRequest } from 'payload'

import type { HelperAccessOptions } from './access.js'
import type { EcommerceDocument, EcommerceDocumentTypes, UntypedDocument } from './documents.js'
import type { DocumentId } from './relationships.js'
import type { EcommerceSlugs } from './slugs.js'

import { resolveLocalApiAccess } from './access.js'
import { adjustCouponUsage } from './atomic.js'
import { toDocumentId } from './ids.js'
import { getRoundMoney } from './money.js'
import { isSameDocument } from './relationships.js'

export interface ValidateCouponParams {
  code: string
  /** Order subtotal before discount, tax and shipping. */
  cartTotal: number
  /**
   * Customer placing the order. A coupon with a `customerLimit` can only be used by a
   * known customer, so without it such a coupon is refused with `customer_required`.
   */
  userId?: DocumentId
  /** Products in the cart; needed for coupons restricted to products. */
  productIds?: DocumentId[]
  /** Categories of the products in the cart; needed for coupons restricted to categories. */
  categoryIds?: DocumentId[]
}

/**
 * Why a coupon was refused, for code that words its own message or reacts to the cause:
 *
 * - `not_found`: no coupon has this code.
 * - `inactive`: the coupon's status is `inactive`.
 * - `not_yet_valid`: `validFrom` is in the future.
 * - `expired`: `validUntil` has passed, or the coupon's status is `expired`.
 * - `usage_limit`: `usageCount` has reached `usageLimit`.
 * - `customer_required`: the coupon has a `customerLimit` and no customer was given, so
 *   the limit cannot be checked. Ask the visitor to sign in.
 * - `customer_limit`: the customer's orders with this coupon have reached `customerLimit`.
 * - `min_purchase`: the subtotal is below `minPurchase` (also reported on the result).
 * - `not_applicable`: the coupon is restricted to products or categories and the cart
 *   has none of them.
 */
export type CouponRefusalReason =
  | 'customer_limit'
  | 'customer_required'
  | 'expired'
  | 'inactive'
  | 'min_purchase'
  | 'not_applicable'
  | 'not_found'
  | 'not_yet_valid'
  | 'usage_limit'

/**
 * What a coupon does to a cart, or why it is refused. `valid` tells the two apart, and
 * narrows the type: an accepted coupon always has `coupon`, a refusal always has `reason`.
 *
 * `TCoupon` is the type of a coupon document. It defaults to the type the host's
 * generated Payload types give the `coupons` collection.
 */
export type ApplyCouponResult<TCoupon = EcommerceDocument<EcommerceDocumentTypes, 'coupons'>> =
  | AcceptedCouponResult<TCoupon>
  | RefusedCouponResult<TCoupon>

export interface AcceptedCouponResult<TCoupon = UntypedDocument> {
  valid: true
  /**
   * Amount to take off the subtotal, rounded with the plugin's `roundMoney` option (two
   * decimals by default). Never more than `cartTotal`, and 0 for a free
   * shipping coupon, whose effect is reported by `freeShipping` instead.
   */
  discount: number
  /** True when the coupon is of type `freeShipping`: the order ships for 0. */
  freeShipping: boolean
  /** The coupon document. */
  coupon: TCoupon
  // The refusal fields are declared as absent, so code that reads them without checking
  // `valid` first still compiles.
  error?: undefined
  reason?: undefined
  minPurchase?: undefined
}

export interface RefusedCouponResult<TCoupon = UntypedDocument> {
  valid: false
  /** Always 0. */
  discount: number
  /** Always false. */
  freeShipping: boolean
  /**
   * English description of the refusal, for logs. To show a customer a message, word it
   * from `reason`.
   */
  error: string
  reason: CouponRefusalReason
  /**
   * The coupon's minimum subtotal, as stored (in the shop's money unit). Only set when
   * `reason` is `min_purchase`, so a message can name the amount in the shop's own format.
   */
  minPurchase?: number
  /**
   * The coupon document, for every reason except `not_found`, so a refusal can be worded
   * without looking the coupon up again.
   */
  coupon?: TCoupon
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

const rejected = (
  reason: CouponRefusalReason,
  error: string,
  details: Pick<RefusedCouponResult<any>, 'coupon' | 'minPurchase'> = {},
): RefusedCouponResult<any> => ({
  valid: false,
  discount: 0,
  freeShipping: false,
  error,
  reason,
  ...details,
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
 * below `customerLimit` (cancelled and refunded orders do not count; without a `userId`
 * the orders cannot be counted, so a coupon with a `customerLimit` is refused);
 * `cartTotal` must reach
 * `minPurchase`; and when the coupon is restricted to products and/or categories, the
 * cart must contain at least one matching product for each restriction that is set.
 * A limit of 0 or an empty restriction means "no limit".
 *
 * A refusal carries the first rule that failed as `reason` (see `CouponRefusalReason`).
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
): Promise<ApplyCouponResult<any>> => {
  if (!coupon) {
    return rejected('not_found', 'Coupon not found')
  }

  // The coupons collection sets the status to `expired` when a coupon is saved after its
  // `validUntil`, so that status is the same refusal as the date check below, with the
  // same reason and message.
  if (coupon.status === 'expired') {
    return rejected('expired', 'Coupon has expired', { coupon })
  }

  if (coupon.status !== 'active') {
    return rejected('inactive', 'Coupon is not active', { coupon })
  }

  const now = new Date()

  if (coupon.validFrom && new Date(coupon.validFrom) > now) {
    return rejected('not_yet_valid', 'Coupon is not yet valid', { coupon })
  }

  if (coupon.validUntil && new Date(coupon.validUntil) < now) {
    return rejected('expired', 'Coupon has expired', { coupon })
  }

  if (coupon.usageLimit && (coupon.usageCount || 0) >= coupon.usageLimit) {
    return rejected('usage_limit', 'Coupon usage limit reached', { coupon })
  }

  if (coupon.customerLimit) {
    // A per-customer limit is counted over the customer's orders. A guest has no orders
    // to count, so letting the coupon through would make the limit unlimited for anyone
    // who is not signed in.
    if (userId === undefined || userId === null) {
      return rejected('customer_required', 'Coupon can only be used by a signed-in customer', { coupon })
    }

    const { totalDocs } = await payload.count({
      collection: ordersSlug,
      // Counts all of the customer's orders, whoever is asking.
      overrideAccess: true,
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
      return rejected('customer_limit', 'Customer usage limit reached', { coupon })
    }
  }

  if (coupon.minPurchase && cartTotal < coupon.minPurchase) {
    return rejected('min_purchase', `Minimum purchase amount of ${coupon.minPurchase} required`, {
      coupon,
      minPurchase: coupon.minPurchase,
    })
  }

  if (coupon.appliesToProducts && coupon.appliesToProducts.length > 0) {
    const hasApplicableProduct = productIds.some((id) =>
      coupon.appliesToProducts.some((product: unknown) => isSameDocument(product, id)),
    )

    if (!hasApplicableProduct) {
      return rejected('not_applicable', 'Coupon does not apply to products in cart', { coupon })
    }
  }

  if (coupon.appliesToCategories && coupon.appliesToCategories.length > 0) {
    const hasApplicableCategory = categoryIds.some((id) =>
      coupon.appliesToCategories.some((category: unknown) => isSameDocument(category, id)),
    )

    if (!hasApplicableCategory) {
      return rejected('not_applicable', 'Coupon does not apply to product categories in cart', { coupon })
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
  // The amount is rounded to the shop's money unit before it is capped, so that rounding
  // up can never make the discount larger than the cart.
  discount = Math.min(Math.max(0, getRoundMoney(payload)(discount)), Math.max(0, cartTotal))

  return { valid: true, discount, freeShipping: false, coupon }
}

/** The helpers of `getEcommerce(payload).coupons`. `TCoupon` is the type of a coupon document. */
export interface CouponHelpers<TCoupon = UntypedDocument> {
  /** `validateCoupon` with positional arguments. */
  applyCoupon: (
    code: string,
    cartTotal: number,
    userId?: DocumentId,
    productIds?: DocumentId[],
    categoryIds?: DocumentId[],
  ) => Promise<ApplyCouponResult<TCoupon>>
  /**
   * Gives back one use of a coupon (never below 0) and returns the coupon. The orders
   * collection calls this when an order with a coupon is cancelled or refunded.
   */
  decrementCouponUsage: (id: DocumentId, options?: { req?: PayloadRequest }) => Promise<TCoupon>
  /**
   * Finds a coupon by its code, or returns null when no coupon has it. Codes are stored
   * in upper case and matched ignoring case.
   */
  findCouponByCode: (code: string) => Promise<null | TCoupon>
  /**
   * Counts one use of a coupon in a single atomic step and returns the coupon. Throws
   * when the coupon's `usageLimit` is already reached or the coupon does not exist. The
   * orders collection calls this for every order created with a coupon, so call it
   * yourself only for uses that are not orders.
   */
  incrementCouponUsage: (id: DocumentId, options?: { req?: PayloadRequest }) => Promise<TCoupon>
  /**
   * Previews a coupon for a cart without using it. Creating an order with the returned
   * `coupon.id` applies the same rules again.
   */
  validateCoupon: (params: ValidateCouponParams) => Promise<ApplyCouponResult<TCoupon>>
}

export const createCouponHelpers = <TCoupon = UntypedDocument>(
  payload: Payload,
  slugs: EcommerceSlugs,
  accessOptions: HelperAccessOptions = {},
): CouponHelpers<TCoupon> => {
  const couponsSlug = slugs.coupons
  const ordersSlug = slugs.orders
  // Coupons are readable by admins only, and these helpers are how everyone else gets a
  // code checked, so they always bypass access control.
  const { trusted } = resolveLocalApiAccess(accessOptions)

  /** Finds a coupon by its code. Codes are stored in upper case and matched ignoring case. */
  const findCouponByCode = async (code: string): Promise<null | UntypedDocument> => {
    const { docs } = await payload.find({
      ...trusted,
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
  }: ValidateCouponParams): Promise<ApplyCouponResult<any>> => {
    const coupon = await findCouponByCode(code)

    return await evaluateCoupon(payload, coupon, {
      ...params,
      ordersSlug,
      req: trusted.req,
      // An id that arrived as text has to match the type of the stored `user` to be counted.
      userId: toDocumentId(payload, slugs.users, params.userId),
    })
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
  const incrementCouponUsage = async (id: DocumentId, options: { req?: PayloadRequest } = {}) => {
    const couponId = toDocumentId(payload, couponsSlug, id)
    const counted = await adjustCouponUsage(payload, {
      couponId,
      couponsSlug,
      delta: 1,
      req: options.req ?? trusted.req,
    })

    if (!counted) {
      throw new Error('Coupon not found or its usage limit is reached')
    }

    return await payload.findByID({
      ...trusted,
      id: couponId,
      collection: couponsSlug,
      depth: 0,
      req: options.req ?? trusted.req,
    })
  }

  /**
   * Gives back one use of a coupon (never below 0) and returns the coupon. The orders
   * collection calls this when an order with a coupon is cancelled or refunded.
   */
  const decrementCouponUsage = async (id: DocumentId, options: { req?: PayloadRequest } = {}) => {
    const couponId = toDocumentId(payload, couponsSlug, id)
    await adjustCouponUsage(payload, { couponId, couponsSlug, delta: -1, req: options.req ?? trusted.req })

    return await payload.findByID({
      ...trusted,
      id: couponId,
      collection: couponsSlug,
      depth: 0,
      req: options.req ?? trusted.req,
    })
  }

  const helpers: CouponHelpers = {
    findCouponByCode,
    validateCoupon,
    applyCoupon,
    incrementCouponUsage,
    decrementCouponUsage,
  }

  // The Local API only knows the coupons slug as a string, so it returns untyped documents.
  // The object above is checked against the helper signatures with that untyped
  // document; which document type the collection really has is the caller's word.
  return helpers as unknown as CouponHelpers<TCoupon>
}
