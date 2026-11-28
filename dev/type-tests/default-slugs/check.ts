// Compiled by `pnpm test:types` against the built declarations in dist, as a host that
// has generated Payload types (dev/payload-types.ts) and uses the plugin's default slugs.
// Nothing here runs; the file passes when it compiles.
import type {
  ApplyCouponResult,
  CouponRefusalReason,
  DocumentId,
  EcommerceHelpers,
} from '@xtr-dev/payload-ecommerce'
import type { PaginatedDocs, Payload } from 'payload'

import { getEcommerce, getOrderRejection, useEcommerce } from '@xtr-dev/payload-ecommerce'

import type { Cart, Coupon, Order, Product } from '../../payload-types.js'

import { type Equal, expectTrue } from '../expect.js'

declare const payload: Payload

const ecommerce = getEcommerce(payload)
type Result<TFunction extends (...args: never[]) => unknown> = Awaited<ReturnType<TFunction>>

// Every document comes back as the generated type of its collection, without a cast.
expectTrue<Equal<Result<typeof ecommerce.cart.addToCart>, Cart>>()
expectTrue<Equal<Result<typeof ecommerce.cart.updateCartItem>, Cart>>()
expectTrue<Equal<Result<typeof ecommerce.cart.removeFromCart>, Cart>>()
expectTrue<Equal<Result<typeof ecommerce.cart.clearCart>, Cart>>()
expectTrue<Equal<Result<typeof ecommerce.orders.createOrderFromCart>, Order>>()
expectTrue<Equal<Result<typeof ecommerce.orders.updateOrderStatus>, Order>>()
expectTrue<Equal<Result<typeof ecommerce.orders.getOrder>, Order>>()
expectTrue<Equal<Result<typeof ecommerce.orders.getUserOrders>, PaginatedDocs<Order>>>()
expectTrue<Equal<Result<typeof ecommerce.products.getProduct>, Product>>()
expectTrue<Equal<Result<typeof ecommerce.products.getProducts>, PaginatedDocs<Product>>>()
expectTrue<Equal<Result<typeof ecommerce.products.reduceInventory>, Product>>()
expectTrue<Equal<Result<typeof ecommerce.products.restoreInventory>, Product>>()
expectTrue<Equal<Result<typeof ecommerce.coupons.incrementCouponUsage>, Coupon>>()
expectTrue<Equal<Result<typeof ecommerce.coupons.decrementCouponUsage>, Coupon>>()

// The lookups that can find nothing say so.
expectTrue<Equal<Result<typeof ecommerce.cart.getCart>, Cart | null>>()
expectTrue<Equal<Result<typeof ecommerce.coupons.findCouponByCode>, Coupon | null>>()
expectTrue<Equal<Result<typeof ecommerce.orders.getOrderByToken>, null | Order>>()

// The exported helper type and the deprecated alias carry the same types.
expectTrue<Equal<typeof ecommerce, EcommerceHelpers>>()
expectTrue<Equal<ReturnType<typeof useEcommerce>, EcommerceHelpers>>()

export const couponResult = async (): Promise<void> => {
  const result = await ecommerce.coupons.validateCoupon({ cartTotal: 100, code: 'SAVE10' })
  expectTrue<Equal<typeof result, ApplyCouponResult<Coupon>>>()
  expectTrue<Equal<ApplyCouponResult, ApplyCouponResult<Coupon>>>()

  // Reading the refusal fields needs no narrowing.
  expectTrue<Equal<typeof result.error, string | undefined>>()

  if (result.valid) {
    expectTrue<Equal<typeof result.coupon, Coupon>>()
    expectTrue<Equal<typeof result.reason, undefined>>()
  } else {
    expectTrue<Equal<typeof result.coupon, Coupon | undefined>>()
    expectTrue<Equal<typeof result.error, string>>()
    expectTrue<Equal<typeof result.minPurchase, number | undefined>>()
    // @ts-expect-error -- a refusal reason outside the union does not compile.
    expectTrue<Equal<typeof result.reason, 'unknown_reason'>>()
  }
}

// A named document type wins over the generated one, per collection.
interface ExtendedOrder extends Order {
  giftMessage: string
}
const extended = getEcommerce<{ orders: ExtendedOrder }>(payload)
expectTrue<Equal<Result<typeof extended.orders.getOrder>, ExtendedOrder>>()
expectTrue<Equal<Result<typeof extended.cart.getCart>, Cart | null>>()

export const orderRejection = (error: unknown): void => {
  const rejection = getOrderRejection(error)
  if (!rejection) {
    return
  }

  // `reason` can be switched on without looking at `type` first.
  expectTrue<Equal<typeof rejection.reason, 'out_of_stock' | CouponRefusalReason>>()

  if (rejection.type === 'stock') {
    expectTrue<Equal<typeof rejection.product, DocumentId>>()
    expectTrue<Equal<typeof rejection.available, number | undefined>>()
    expectTrue<Equal<typeof rejection.variant, string | undefined>>()
  } else {
    expectTrue<Equal<typeof rejection.reason, CouponRefusalReason>>()
    expectTrue<Equal<typeof rejection.minPurchase, number | undefined>>()
  }
}

export const orderParams = async (): Promise<void> => {
  const shippingAddress = { address1: '1 Main Street', city: 'Amsterdam', country: 'NL', firstName: 'A', lastName: 'B' }

  await ecommerce.orders.createOrderFromCart({ cartId: 1, orderData: { shippingAddress } })
  // @ts-expect-error -- the address belongs in orderData, which is required.
  await ecommerce.orders.createOrderFromCart({ cartId: 1 })
  // @ts-expect-error -- there are no order fields next to cartId.
  await ecommerce.orders.createOrderFromCart({ cartId: 1, orderData: { shippingAddress }, shippingAddress })
}
