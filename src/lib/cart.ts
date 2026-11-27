import type { Payload, Where } from 'payload'

import type { HelperAccessOptions } from './access.js'
import type { DeleteExpiredCartsOptions } from './cartExpiry.js'
import type { DocumentId } from './relationships.js'

import { resolveLocalApiAccess } from './access.js'
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
  /** New quantity of the line; 0 or less removes the line. */
  quantity: number
  /**
   * Variant name of the line to change. Leave out to change the line that has no variant;
   * it never matches a line that has one.
   */
  variant?: null | string
}

export interface RemoveFromCartParams {
  cartId: DocumentId
  productId: DocumentId
  /**
   * Variant name of the line to remove. Leave out to remove the line that has no variant;
   * it never matches a line that has one.
   */
  variant?: null | string
}

/**
 * Tells whether a cart line is the line for `productId` in `variant`. A cart holds one
 * line per product + variant combination, so two variants of one product are two lines
 * and the product alone does not identify a line. "No variant" is a combination of its
 * own: an empty, null or missing variant only matches a line without a variant.
 */
export const isSameCartLine = (
  item: { product?: unknown; variant?: null | string } | null | undefined,
  productId: unknown,
  variant?: null | string,
): boolean => isSameDocument(item?.product, productId) && (item?.variant || null) === (variant || null)

export const createCartHelpers = (
  payload: Payload,
  cartsSlug = 'carts',
  accessOptions: HelperAccessOptions = {},
) => {
  // Every cart read and write is made on behalf of the caller, so with
  // `overrideAccess: false` a user only reaches their own cart.
  const { caller } = resolveLocalApiAccess(accessOptions)

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
      ...caller,
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
      ...caller,
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
      const existingItemIndex = items.findIndex((item: any) => isSameCartLine(item, productId, variant))

      if (existingItemIndex >= 0) {
        items[existingItemIndex].quantity += quantity
      } else {
        items.push({ product: productId, variant, quantity })
      }

      cart = await payload.update({
        ...caller,
        collection: cartsSlug,
        id: cart.id,
        data: { items },
      })
    } else {
      cart = await payload.create({
        ...caller,
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

  /**
   * Sets the quantity of the cart line for this product and variant, or removes the line
   * when the quantity is 0 or less. Throws `Item not found in cart` when the cart has no
   * line for exactly this product + variant combination.
   */
  const updateCartItem = async ({ cartId, productId, quantity, variant }: UpdateCartItemParams) => {
    const cart = await loadActiveCart(cartId)

    const items = cart.items || []
    const itemIndex = items.findIndex((item: any) => isSameCartLine(item, productId, variant))

    if (itemIndex === -1) {
      throw new Error('Item not found in cart')
    }

    if (quantity <= 0) {
      items.splice(itemIndex, 1)
    } else {
      items[itemIndex].quantity = quantity
    }

    return await payload.update({
      ...caller,
      collection: cartsSlug,
      id: cartId,
      data: { items },
    })
  }

  /**
   * Removes the cart line for this product and variant. Other lines of the same product
   * (other variants) stay. Does nothing when the cart has no such line.
   */
  const removeFromCart = async ({ cartId, productId, variant }: RemoveFromCartParams) => {
    const cart = await loadActiveCart(cartId)

    const items = (cart.items || []).filter((item: any) => !isSameCartLine(item, productId, variant))

    return await payload.update({
      ...caller,
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
      ...caller,
      collection: cartsSlug,
      id: cartId,
      data: { items: [] },
    })
  }

  /** Deletes every expired cart in this collection and returns how many were deleted. */
  const deleteExpired = async (options: Omit<DeleteExpiredCartsOptions, 'cartsSlug'> = {}) => {
    return await deleteExpiredCarts(payload, { req: accessOptions.req, ...options, cartsSlug })
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
