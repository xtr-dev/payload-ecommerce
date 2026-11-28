import type { PaginatedDocs, Payload } from 'payload'

import type { HelperAccessOptions } from './access.js'
import type { UntypedDocument } from './documents.js'
import type { DocumentId } from './relationships.js'
import type { EcommerceSlugs } from './slugs.js'
import type { OrderTotalParts } from './totals.js'

import { resolveLocalApiAccess } from './access.js'
import { isCartExpired } from './cartExpiry.js'
import { createCouponHelpers } from './coupons.js'
import { toDocumentId } from './ids.js'
import { getRoundMoney } from './money.js'
import { OrderRejectedError } from './orderRejection.js'
import { resolveUnitPrice } from './pricing.js'
import { getRelationshipId } from './relationships.js'
import { calculateOrderTotal } from './totals.js'

/** An order's shipping or billing address. */
export interface OrderAddress {
  firstName: string
  lastName: string
  address1: string
  address2?: string
  city: string
  /** State or province; leave out for countries that do not use one. */
  state?: string
  /** Leave out for countries without postal codes. */
  postalCode?: string
  country: string
  phone?: string
}

export interface CreateOrderFromCartParams {
  cartId: DocumentId
  orderData?: {
    shippingAddress: OrderAddress
    /** Defaults to the shipping address. */
    billingAddress?: OrderAddress
    /**
     * Email address to reach the customer at, stored on the order as `customerEmail`.
     * Pass it for a guest cart, whose order has no user to look an address up from.
     */
    customerEmail?: string
    paymentMethod?: string
    notes?: string
    subtotal?: number
    tax?: number
    shipping?: number
    /** Manual discount amount. Ignored when a coupon is given: the coupon sets the discount. */
    discount?: number
    /** Id of the coupon to apply. The order is rejected when the coupon is not valid for it. */
    coupon?: DocumentId
    /** Code of the coupon to apply, as an alternative to `coupon`. */
    couponCode?: string
    status?: string
    paymentStatus?: string
  }
  // Legacy parameters for backward compatibility
  shippingAddress?: OrderAddress
  billingAddress?: OrderAddress
  paymentMethod?: string
  notes?: string
}

export interface UpdateOrderStatusParams {
  orderId: DocumentId
  status: 'pending' | 'processing' | 'shipped' | 'delivered' | 'cancelled' | 'refunded'
  trackingNumber?: string
  trackingUrl?: string
}

/** The helpers of `getEcommerce(payload).orders`. `TOrder` is the type of an order document. */
export interface OrderHelpers<TOrder = UntypedDocument> {
  /**
   * The total an order with these amounts will get: subtotal − discount + tax + shipping,
   * never negative, rounded with the plugin's `roundMoney` option. Use it to show a total
   * before the order exists, for example on a cart or checkout page.
   */
  calculateTotal: (parts: OrderTotalParts) => number
  /**
   * Creates an order from a cart and empties the cart. Throws when the cart is missing,
   * expired or empty, and when the orders collection rejects the order (stock, coupon).
   * A stock or coupon rejection is an `OrderRejectedError`; `getOrderRejection(error)`
   * returns its cause.
   */
  createOrderFromCart: (params: CreateOrderFromCartParams) => Promise<TOrder>
  /** Returns the order with its relationships populated (depth 2). Throws when it does not exist. */
  getOrder: (orderId: DocumentId) => Promise<TOrder>
  /** Returns a page of the customer's orders, newest first, with relationships populated (depth 2). */
  getUserOrders: (userId: DocumentId) => Promise<PaginatedDocs<TOrder>>
  /** Sets the order's status and, when given, its tracking number and URL. */
  updateOrderStatus: (params: UpdateOrderStatusParams) => Promise<TOrder>
}

export const createOrderHelpers = <TOrder = UntypedDocument>(
  payload: Payload,
  slugs: EcommerceSlugs,
  accessOptions: HelperAccessOptions = {},
): OrderHelpers<TOrder> => {
  const { carts: cartsSlug, orders: ordersSlug, products: productsSlug } = slugs
  const { caller, trusted } = resolveLocalApiAccess(accessOptions)

  /**
   * Creates an order from a cart and empties the cart.
   *
   * The cart is read on behalf of the caller, so with `overrideAccess: false` a user can
   * only check out their own cart. Everything after that is the plugin's own work and
   * bypasses access control: pricing the lines from the products, looking up the coupon,
   * creating the order (the default access rules let nobody but an admin create one
   * through the API) and emptying the cart.
   */
  const createOrderFromCart = async (params: CreateOrderFromCartParams) => {
    const { orderData } = params
    // Ids may arrive as text (from a URL or a JSON body); see toDocumentId.
    const cartId = toDocumentId(payload, cartsSlug, params.cartId)

    // Support both new orderData structure and legacy parameters
    const shippingAddress = orderData?.shippingAddress || params.shippingAddress
    const billingAddress = orderData?.billingAddress || params.billingAddress
    const paymentMethod = orderData?.paymentMethod || params.paymentMethod
    const notes = orderData?.notes || params.notes

    if (!shippingAddress) {
      throw new Error('Shipping address is required')
    }

    const cart = await payload.findByID({
      ...caller,
      collection: cartsSlug,
      id: cartId,
      depth: 2,
      disableErrors: true,
    })

    // An expired cart is treated as absent everywhere, but gets its own message here so a
    // checkout can tell the customer why the order was not placed.
    if (cart && isCartExpired(cart)) {
      throw new Error('Cart has expired')
    }

    if (!cart || !cart.items || cart.items.length === 0) {
      throw new Error('Cart is empty or not found')
    }

    const items = []
    let calculatedSubtotal = 0

    for (const item of cart.items) {
      const productId = getRelationshipId(item.product)

      if (productId === undefined) {
        throw new Error('Cart contains an item without a product')
      }

      // The cart is read with depth 2, so the product is normally already populated. It is
      // still a bare id when the caller's access control or a custom products collection
      // prevents population, and then it has to be loaded to know its price and variants.
      const product =
        typeof item.product === 'object'
          ? item.product
          : await payload.findByID({
              ...trusted,
              collection: productsSlug,
              id: productId,
            })

      if (!product) {
        throw new Error(`Product not found: ${productId}`)
      }

      // The same function prices the cart's subtotal, so a variant's own price is used here too.
      const price = resolveUnitPrice(product, item.variant)
      const total = price * item.quantity

      items.push({
        product: productId,
        variant: item.variant,
        quantity: item.quantity,
        price,
        total,
      })

      calculatedSubtotal += total
    }

    // Use provided values or fall back to calculated/default values
    const subtotal = orderData?.subtotal ?? calculatedSubtotal
    const tax = orderData?.tax ?? 0
    const shipping = orderData?.shipping ?? 0
    const discount = orderData?.discount ?? 0
    const status = orderData?.status || 'pending'

    // The coupon's rules, discount and free shipping are applied by the orders collection
    // when the order is created; here a code only has to be turned into the coupon's id.
    let couponId = toDocumentId(payload, slugs.coupons, orderData?.coupon)
    if (couponId === undefined && orderData?.couponCode) {
      const coupon = await createCouponHelpers(payload, slugs, accessOptions).findCouponByCode(
        orderData.couponCode,
      )
      if (!coupon) {
        throw new OrderRejectedError({
          collection: ordersSlug,
          message: `Coupon not found: ${orderData.couponCode}`,
          path: 'coupon',
          rejection: { type: 'coupon', reason: 'not_found' },
          req: trusted.req,
        })
      }
      couponId = coupon.id
    }
    const paymentStatus = orderData?.paymentStatus || 'pending'

    const order = await payload.create({
      ...trusted,
      collection: ordersSlug,
      data: {
        user: getRelationshipId(cart.user),
        customerEmail: orderData?.customerEmail,
        items,
        subtotal,
        tax,
        shipping,
        discount,
        shippingAddress,
        billingAddress: billingAddress || shippingAddress,
        paymentMethod,
        notes,
        status,
        paymentStatus,
        coupon: couponId,
      },
    })

    await payload.update({
      ...trusted,
      collection: cartsSlug,
      id: cartId,
      data: { items: [] },
    })

    return order
  }

  const updateOrderStatus = async ({
    orderId,
    status,
    trackingNumber,
    trackingUrl,
  }: UpdateOrderStatusParams) => {
    const updateData: any = { status }

    if (trackingNumber) {
      updateData.trackingNumber = trackingNumber
    }

    if (trackingUrl) {
      updateData.trackingUrl = trackingUrl
    }

    return await payload.update({
      ...caller,
      collection: ordersSlug,
      id: toDocumentId(payload, ordersSlug, orderId),
      data: updateData,
    })
  }

  const getOrder = async (orderId: DocumentId) => {
    return await payload.findByID({
      ...caller,
      collection: ordersSlug,
      id: toDocumentId(payload, ordersSlug, orderId),
      depth: 2,
    })
  }

  const getUserOrders = async (userId: DocumentId) => {
    return await payload.find({
      ...caller,
      collection: ordersSlug,
      where: {
        user: {
          equals: toDocumentId(payload, slugs.users, userId),
        },
      },
      sort: '-createdAt',
      depth: 2,
    })
  }

  /**
   * The total an order with these amounts will get: subtotal − discount + tax + shipping,
   * never negative, rounded with the plugin's `roundMoney` option. Use it to show a total
   * before the order exists, for example on a cart or checkout page.
   */
  const calculateTotal = (parts: OrderTotalParts): number =>
    calculateOrderTotal(parts, getRoundMoney(payload))

  const helpers: OrderHelpers = {
    calculateTotal,
    createOrderFromCart,
    updateOrderStatus,
    getOrder,
    getUserOrders,
  }

  // The Local API only knows the orders slug as a string, so it returns untyped documents.
  // The object above is checked against the helper signatures with that untyped
  // document; which document type the collection really has is the caller's word.
  return helpers as unknown as OrderHelpers<TOrder>
}
