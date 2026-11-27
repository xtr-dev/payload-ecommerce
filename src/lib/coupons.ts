import type { Payload } from 'payload'

import type { DocumentId } from './relationships.js'

import { isSameDocument } from './relationships.js'

export interface ValidateCouponParams {
  code: string
  cartTotal: number
  userId?: DocumentId
  productIds?: DocumentId[]
  categoryIds?: DocumentId[]
}

export interface ApplyCouponResult {
  valid: boolean
  discount: number
  error?: string
  coupon?: any
}

export const createCouponHelpers = (
  payload: Payload,
  couponsSlug = 'coupons',
  ordersSlug = 'orders',
) => {
  const validateCoupon = async ({
    code,
    cartTotal,
    userId,
    productIds = [],
    categoryIds = [],
  }: ValidateCouponParams): Promise<ApplyCouponResult> => {
    const { docs } = await payload.find({
      collection: couponsSlug,
      where: {
        code: {
          equals: code.toUpperCase(),
        },
      },
      limit: 1,
    })

    const coupon = docs[0]

    if (!coupon) {
      return {
        valid: false,
        discount: 0,
        error: 'Coupon not found',
      }
    }

    if (coupon.status !== 'active') {
      return {
        valid: false,
        discount: 0,
        error: 'Coupon is not active',
      }
    }

    const now = new Date()

    if (coupon.validFrom && new Date(coupon.validFrom) > now) {
      return {
        valid: false,
        discount: 0,
        error: 'Coupon is not yet valid',
      }
    }

    if (coupon.validUntil && new Date(coupon.validUntil) < now) {
      return {
        valid: false,
        discount: 0,
        error: 'Coupon has expired',
      }
    }

    if (coupon.usageLimit && coupon.usageCount >= coupon.usageLimit) {
      return {
        valid: false,
        discount: 0,
        error: 'Coupon usage limit reached',
      }
    }

    if (userId && coupon.customerLimit) {
      const { totalDocs } = await payload.count({
        collection: ordersSlug,
        where: {
          and: [
            {
              user: {
                equals: userId,
              },
            },
            {
              coupon: {
                equals: coupon.id,
              },
            },
          ],
        },
      })

      if (totalDocs >= coupon.customerLimit) {
        return {
          valid: false,
          discount: 0,
          error: 'Customer usage limit reached',
        }
      }
    }

    if (coupon.minPurchase && cartTotal < coupon.minPurchase) {
      return {
        valid: false,
        discount: 0,
        error: `Minimum purchase amount of ${coupon.minPurchase} required`,
      }
    }

    if (coupon.appliesToProducts && coupon.appliesToProducts.length > 0) {
      const hasApplicableProduct = productIds.some((id) =>
        coupon.appliesToProducts.some((product: unknown) => isSameDocument(product, id)),
      )

      if (!hasApplicableProduct) {
        return {
          valid: false,
          discount: 0,
          error: 'Coupon does not apply to products in cart',
        }
      }
    }

    if (coupon.appliesToCategories && coupon.appliesToCategories.length > 0) {
      const hasApplicableCategory = categoryIds.some((id) =>
        coupon.appliesToCategories.some((category: unknown) => isSameDocument(category, id)),
      )

      if (!hasApplicableCategory) {
        return {
          valid: false,
          discount: 0,
          error: 'Coupon does not apply to product categories in cart',
        }
      }
    }

    let discount = 0

    if (coupon.type === 'percentage') {
      discount = (cartTotal * coupon.value) / 100
      if (coupon.maxDiscount && discount > coupon.maxDiscount) {
        discount = coupon.maxDiscount
      }
    } else if (coupon.type === 'fixed') {
      discount = coupon.value
    }

    return {
      valid: true,
      discount,
      coupon,
    }
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

  const incrementCouponUsage = async (couponId: DocumentId) => {
    const coupon = await payload.findByID({
      collection: couponsSlug,
      id: couponId,
    })

    if (!coupon) {
      throw new Error('Coupon not found')
    }

    return await payload.update({
      collection: couponsSlug,
      id: couponId,
      data: {
        usageCount: (coupon.usageCount || 0) + 1,
      },
    })
  }

  return {
    validateCoupon,
    applyCoupon,
    incrementCouponUsage,
  }
}
