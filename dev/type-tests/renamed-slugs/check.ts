// Compiled by `pnpm test:types` against the built declarations in dist, as a host that
// has generated Payload types in which the plugin's collections have other slugs.
// Nothing here runs; the file passes when it compiles.
import type { ApplyCouponResult, UntypedDocument } from '@xtr-dev/payload-ecommerce'
import type { PaginatedDocs, Payload } from 'payload'

import { getEcommerce } from '@xtr-dev/payload-ecommerce'

import type { PurchaseOrder, ShopCart, ShopCoupon, ShopOrder, ShopProduct } from './payload-types.js'

import { type Equal, expectTrue } from '../expect.js'

declare const payload: Payload

type Result<TFunction extends (...args: never[]) => unknown> = Awaited<ReturnType<TFunction>>

// Without type arguments the helpers still compile. A default slug that is not among the
// host's collections gives untyped documents, as before.
const untyped = getEcommerce(payload)
expectTrue<Equal<Result<typeof untyped.cart.getCart>, null | UntypedDocument>>()
expectTrue<Equal<Result<typeof untyped.products.getProduct>, UntypedDocument>>()
expectTrue<Equal<Result<typeof untyped.coupons.findCouponByCode>, null | UntypedDocument>>()

export const untypedDocumentsAreLoose = async (): Promise<void> => {
  const cart = await untyped.cart.addToCart({ productId: 1, quantity: 1, sessionId: 'session' })
  // Any field can be read from an untyped document.
  void cart.items[0].quantity
}

// The host's own `orders` collection is what the default resolves to; this is the case
// the type argument exists for.
expectTrue<Equal<Result<typeof untyped.orders.getOrder>, PurchaseOrder>>()

const ecommerce = getEcommerce<{
  carts: ShopCart
  coupons: ShopCoupon
  orders: ShopOrder
  products: ShopProduct
}>(payload)

expectTrue<Equal<Result<typeof ecommerce.cart.getCart>, null | ShopCart>>()
expectTrue<Equal<Result<typeof ecommerce.cart.addToCart>, ShopCart>>()
expectTrue<Equal<Result<typeof ecommerce.orders.createOrderFromCart>, ShopOrder>>()
expectTrue<Equal<Result<typeof ecommerce.orders.getUserOrders>, PaginatedDocs<ShopOrder>>>()
expectTrue<Equal<Result<typeof ecommerce.products.getProducts>, PaginatedDocs<ShopProduct>>>()
expectTrue<Equal<Result<typeof ecommerce.coupons.findCouponByCode>, null | ShopCoupon>>()
expectTrue<Equal<Result<typeof ecommerce.coupons.validateCoupon>, ApplyCouponResult<ShopCoupon>>>()
