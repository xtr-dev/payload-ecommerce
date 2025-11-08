import type { Payload } from 'payload'

export interface CreateOrderFromCartParams {
  cartId: string
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
    discount?: number
    total?: number
    coupon?: string
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
  orderId: string
  status: 'pending' | 'processing' | 'shipped' | 'delivered' | 'cancelled' | 'refunded'
  trackingNumber?: string
  trackingUrl?: string
}

export const createOrderHelpers = (
  payload: Payload,
  ordersSlug = 'orders',
  cartsSlug = 'carts',
  productsSlug = 'products',
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
    })

    if (!cart || !cart.items || cart.items.length === 0) {
      throw new Error('Cart is empty or not found')
    }

    const items = []
    let calculatedSubtotal = 0

    for (const item of cart.items) {
      const product =
        typeof item.product === 'string'
          ? await payload.findByID({
              collection: productsSlug,
              id: item.product,
            })
          : item.product

      if (!product) {
        throw new Error(`Product not found: ${item.product}`)
      }

      const price = product.price || 0
      const total = price * item.quantity

      items.push({
        product: typeof item.product === 'string' ? item.product : item.product.id,
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
    const total = orderData?.total ?? subtotal
    const status = orderData?.status || 'pending'
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
        total,
        shippingAddress,
        billingAddress: billingAddress || shippingAddress,
        paymentMethod,
        notes,
        status,
        paymentStatus,
        coupon: orderData?.coupon,
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

  const getOrder = async (orderId: string) => {
    return await payload.findByID({
      collection: ordersSlug,
      id: orderId,
      depth: 2,
    })
  }

  const getUserOrders = async (userId: string) => {
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
