import type { Payload } from 'payload'

import type { DocumentId } from './relationships.js'

import { isCartExpired } from './cartExpiry.js'
import { createCouponHelpers } from './coupons.js'
import { getRelationshipId } from './relationships.js'

export interface CreateOrderFromCartParams {
  cartId: DocumentId
  orderData?: {
    shippingAddress: {
      firstName: string
      lastName: string
      address1: string
      address2?: string
      city: string
      state: string
      postalCode: string
      country: string
      phone?: string
    }
    billingAddress?: {
      firstName: string
      lastName: string
      address1: string
      address2?: string
      city: string
      state: string
      postalCode: string
      country: string
      phone?: string
    }
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
  shippingAddress?: {
    firstName: string
    lastName: string
    address1: string
    address2?: string
    city: string
    state: string
    postalCode: string
    country: string
    phone?: string
  }
  billingAddress?: {
    firstName: string
    lastName: string
    address1: string
    address2?: string
    city: string
    state: string
    postalCode: string
    country: string
    phone?: string
  }
  paymentMethod?: string
  notes?: string
}

export interface UpdateOrderStatusParams {
  orderId: DocumentId
  status: 'pending' | 'processing' | 'shipped' | 'delivered' | 'cancelled' | 'refunded'
  trackingNumber?: string
  trackingUrl?: string
}

export const createOrderHelpers = (
  payload: Payload,
  ordersSlug = 'orders',
  cartsSlug = 'carts',
  productsSlug = 'products',
  couponsSlug = 'coupons',
) => {
  const createOrderFromCart = async (params: CreateOrderFromCartParams) => {
    const { cartId, orderData } = params

    // Support both new orderData structure and legacy parameters
    const shippingAddress = orderData?.shippingAddress || params.shippingAddress
    const billingAddress = orderData?.billingAddress || params.billingAddress
    const paymentMethod = orderData?.paymentMethod || params.paymentMethod
    const notes = orderData?.notes || params.notes

    if (!shippingAddress) {
      throw new Error('Shipping address is required')
    }

    const cart = await payload.findByID({
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
      // prevents population, and then it has to be loaded to know its price.
      const product =
        typeof item.product === 'object'
          ? item.product
          : await payload.findByID({
              collection: productsSlug,
              id: productId,
            })

      if (!product) {
        throw new Error(`Product not found: ${productId}`)
      }

      const price = product.price || 0
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
    let couponId = orderData?.coupon
    if (couponId === undefined && orderData?.couponCode) {
      const coupon = await createCouponHelpers(payload, couponsSlug, ordersSlug).findCouponByCode(
        orderData.couponCode,
      )
      if (!coupon) {
        throw new Error(`Coupon not found: ${orderData.couponCode}`)
      }
      couponId = coupon.id
    }
    const paymentStatus = orderData?.paymentStatus || 'pending'

    const order = await payload.create({
      collection: ordersSlug,
      data: {
        user: cart.user || undefined,
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
      collection: ordersSlug,
      id: orderId,
      data: updateData,
    })
  }

  const getOrder = async (orderId: DocumentId) => {
    return await payload.findByID({
      collection: ordersSlug,
      id: orderId,
      depth: 2,
    })
  }

  const getUserOrders = async (userId: DocumentId) => {
    return await payload.find({
      collection: ordersSlug,
      where: {
        user: {
          equals: userId,
        },
      },
      sort: '-createdAt',
      depth: 2,
    })
  }

  return {
    createOrderFromCart,
    updateOrderStatus,
    getOrder,
    getUserOrders,
  }
}
