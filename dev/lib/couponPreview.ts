import type { ApplyCouponResult, CouponRefusalReason } from 'payload-ecommerce'

/** What the storefront's browser code is told about a coupon code a visitor entered. */
export interface CouponPreview {
  valid: boolean
  /** Amount the coupon takes off the subtotal; 0 for a refusal. */
  discount: number
  freeShipping: boolean
  /** The code as stored (upper case). Absent when no coupon has the code. */
  code?: string
  /** Text to show the visitor: what was applied, or why the code was refused. */
  message: string
  reason?: CouponRefusalReason
  /** The minimum subtotal, when that is why the code was refused. */
  minPurchase?: number
}

/**
 * Reduces the result of `validateCoupon` to what a visitor may see.
 *
 * The result holds the whole coupon document, for refusals too. That document says how
 * often the coupon was used, what its limits are, which products it is restricted to and
 * what the shop's internal description of it is. Coupons are admin-only for that reason,
 * so a route that answers anyone who types a code must not pass the document on.
 */
export const toCouponPreview = (result: ApplyCouponResult<{ code?: null | string }>): CouponPreview => {
  const code = result.coupon?.code ?? undefined

  if (result.valid) {
    return {
      valid: true,
      discount: result.discount,
      freeShipping: result.freeShipping,
      code,
      message: result.freeShipping ? `${code} (free shipping)` : `${code}`,
    }
  }

  return {
    valid: false,
    discount: 0,
    freeShipping: false,
    code,
    message: result.error,
    reason: result.reason,
    ...(result.minPurchase === undefined ? {} : { minPurchase: result.minPurchase }),
  }
}
