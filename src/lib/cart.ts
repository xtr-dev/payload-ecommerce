import type { Payload } from 'payload'

export interface AddToCartParams {
  productId: string
  quantity: number
  variant?: string
  userId?: string
  sessionId?: string
}

export interface UpdateCartItemParams {
  cartId: string
  productId: string
  quantity: number
}

export interface RemoveFromCartParams {
  cartId: string
  productId: string
  variant?: string
}

export const createCartHelpers = (payload: Payload, cartsSlug = 'carts') => {
  const addToCart = async ({
    productId,
    quantity,
    variant,
    userId,
    sessionId,
  }: AddToCartParams) => {
    if (!userId && !sessionId) {
      throw new Error('Either userId or sessionId is required')
    }

    const whereQuery: any = userId ? { user: { equals: userId } } : { sessionId: { equals: sessionId } }

    const { docs: existingCarts } = await payload.find({
      collection: cartsSlug,
      where: whereQuery,
      limit: 1,
    })

    let cart = existingCarts[0]

    if (cart) {
      const items = cart.items || []
      const existingItemIndex = items.findIndex(
        (item: any) =>
          item.product === productId && (variant ? item.variant === variant : !item.variant),
      )

      if (existingItemIndex >= 0) {
        items[existingItemIndex].quantity += quantity
      } else {
        items.push({ product: productId, variant, quantity })
      }

      cart = await payload.update({
        collection: cartsSlug,
        id: cart.id,
        data: { items },
      })
    } else {
      cart = await payload.create({
        collection: cartsSlug,
        data: {
          user: userId,
          sessionId,
          items: [{ product: productId, variant, quantity }],
        },
      })
    }

    return cart
  }

  const updateCartItem = async ({ cartId, productId, quantity }: UpdateCartItemParams) => {
    const cart = await payload.findByID({
      collection: cartsSlug,
      id: cartId,
    })

    if (!cart) {
      throw new Error('Cart not found')
    }

    const items = cart.items || []
    const itemIndex = items.findIndex((item: any) => item.product === productId)

    if (itemIndex === -1) {
      throw new Error('Item not found in cart')
    }

    if (quantity <= 0) {
      items.splice(itemIndex, 1)
    } else {
      items[itemIndex].quantity = quantity
    }

    return await payload.update({
      collection: cartsSlug,
      id: cartId,
      data: { items },
    })
  }

  const removeFromCart = async ({ cartId, productId, variant }: RemoveFromCartParams) => {
    const cart = await payload.findByID({
      collection: cartsSlug,
      id: cartId,
    })

    if (!cart) {
      throw new Error('Cart not found')
    }

    const items = (cart.items || []).filter(
      (item: any) =>
        !(item.product === productId && (variant ? item.variant === variant : !item.variant)),
    )

    return await payload.update({
      collection: cartsSlug,
      id: cartId,
      data: { items },
    })
  }

  const getCart = async (userId?: string, sessionId?: string) => {
    if (!userId && !sessionId) {
      throw new Error('Either userId or sessionId is required')
    }

    const whereQuery: any = userId ? { user: { equals: userId } } : { sessionId: { equals: sessionId } }

    const { docs } = await payload.find({
      collection: cartsSlug,
      where: whereQuery,
      limit: 1,
    })

    return docs[0] || null
  }

  const clearCart = async (cartId: string) => {
    return await payload.update({
      collection: cartsSlug,
      id: cartId,
      data: { items: [] },
    })
  }

  return {
    addToCart,
    updateCartItem,
    removeFromCart,
    getCart,
    clearCart,
  }
}
