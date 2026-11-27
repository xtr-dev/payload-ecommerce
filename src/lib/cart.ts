import type { Payload, Where } from 'payload'

import type { DeleteExpiredCartsOptions } from './cartExpiry.js'
import type { DocumentId } from './relationships.js'

import { deleteExpiredCarts, isCartExpired } from './cartExpiry.js'

import { isSameDocument } from './relationships.js'

export interface AddToCartParams {
  productId: DocumentId
  quantity: number
  variant?: string
  userId?: DocumentId
  sessionId?: string
}

export interface UpdateCartItemParams {
  cartId: DocumentId
  productId: DocumentId
  quantity: number
}

export interface RemoveFromCartParams {
  cartId: DocumentId
  productId: DocumentId
  variant?: string
}

export const createCartHelpers = (payload: Payload, cartsSlug = 'carts') => {
  /**
   * Finds the cart of a user or guest session that has not expired, the most recently
   * changed one first. An expired cart is treated as absent; it stays in the database
   * until `deleteExpiredCarts` removes it.
   */
  const findActiveCart = async (userId?: DocumentId, sessionId?: string) => {
    if (!userId && !sessionId) {
      throw new Error('Either userId or sessionId is required')
    }

    const owner: Where = userId ? { user: { equals: userId } } : { sessionId: { equals: sessionId } }

    const { docs } = await payload.find({
      collection: cartsSlug,
      limit: 1,
      sort: '-updatedAt',
      where: {
        and: [
          owner,
          {
            or: [
              { expiresAt: { greater_than: new Date().toISOString() } },
              { expiresAt: { exists: false } },
            ],
          },
        ],
      },
    })

    return docs[0] || null
  }

  /**
   * Loads a cart by id for a change. Throws when the cart does not exist or has expired,
   * since an expired cart is treated as absent.
   */
  const loadActiveCart = async (cartId: DocumentId) => {
    const cart = await payload.findByID({
      id: cartId,
      collection: cartsSlug,
      disableErrors: true,
    })

    if (!cart || isCartExpired(cart)) {
      throw new Error('Cart not found')
    }

    return cart
  }

  /**
   * Adds a product to the cart of the user or guest session, creating the cart when there
   * is none or the existing one has expired. Every change to a cart moves its expiry to
   * 30 days from now.
   */
  const addToCart = async ({
    productId,
    quantity,
    variant,
    userId,
    sessionId,
  }: AddToCartParams) => {
    let cart = await findActiveCart(userId, sessionId)

    if (cart) {
      const items = cart.items || []
      const existingItemIndex = items.findIndex(
        (item: any) =>
          isSameDocument(item.product, productId) && (variant ? item.variant === variant : !item.variant),
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
    const cart = await loadActiveCart(cartId)

    const items = cart.items || []
    const itemIndex = items.findIndex((item: any) => isSameDocument(item.product, productId))

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
    const cart = await loadActiveCart(cartId)

    const items = (cart.items || []).filter(
      (item: any) =>
        !(isSameDocument(item.product, productId) && (variant ? item.variant === variant : !item.variant)),
    )

    return await payload.update({
      collection: cartsSlug,
      id: cartId,
      data: { items },
    })
  }

  /** Returns the cart of the user or guest session, or null when there is none or it has expired. */
  const getCart = async (userId?: DocumentId, sessionId?: string) => {
    return await findActiveCart(userId, sessionId)
  }

  const clearCart = async (cartId: DocumentId) => {
    await loadActiveCart(cartId)

    return await payload.update({
      collection: cartsSlug,
      id: cartId,
      data: { items: [] },
    })
  }

  /** Deletes every expired cart in this collection and returns how many were deleted. */
  const deleteExpired = async (options: Omit<DeleteExpiredCartsOptions, 'cartsSlug'> = {}) => {
    return await deleteExpiredCarts(payload, { ...options, cartsSlug })
  }

  return {
    addToCart,
    updateCartItem,
    removeFromCart,
    getCart,
    clearCart,
    deleteExpiredCarts: deleteExpired,
  }
}
