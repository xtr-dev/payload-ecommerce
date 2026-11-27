import type { Access, CollectionConfig, FieldAccess, PayloadRequest } from 'payload'

import { isSameDocument } from './relationships.js'

/**
 * Decides whether the user of a request may manage the shop: write products, categories
 * and coupons, and read and change every order and cart.
 */
export type IsAdmin = (args: { req: PayloadRequest }) => boolean | Promise<boolean>

/**
 * The default `isAdmin`: a signed-in user whose `role` is `'admin'` or whose `roles`
 * array contains `'admin'`. A user document with neither field is not an admin, so a
 * host whose users collection has no role field has to pass its own `isAdmin` before
 * anyone can manage the shop through the admin panel, REST or GraphQL.
 */
export const defaultIsAdmin: IsAdmin = ({ req }) => {
  const user = req.user as { role?: unknown; roles?: unknown } | null | undefined
  if (!user) {
    return false
  }

  return user.role === 'admin' || (Array.isArray(user.roles) && user.roles.includes('admin'))
}

export interface EcommerceAccess {
  carts: NonNullable<CollectionConfig['access']>
  /** Field access for cart fields that say whose cart it is; only an admin may change them. */
  cartOwnerField: { create: FieldAccess; update: FieldAccess }
  categories: NonNullable<CollectionConfig['access']>
  coupons: NonNullable<CollectionConfig['access']>
  orders: NonNullable<CollectionConfig['access']>
  products: NonNullable<CollectionConfig['access']>
}

/**
 * Builds the default access control of the plugin's collections. It applies to REST,
 * GraphQL, the admin panel and Local API calls made with `overrideAccess: false`; the
 * plugin's own hooks and the `useEcommerce` helpers (by default) bypass it.
 *
 * - products: everyone reads products whose status is `active`; admins read and write all.
 * - categories: everyone reads; admins write.
 * - coupons: admins only, so codes cannot be listed. Storefronts validate a code through
 *   `useEcommerce(payload).coupons.validateCoupon` on the server.
 * - orders: a signed-in user reads the orders whose `user` is them; admins read and write
 *   all. Orders are created on the server (`createOrderFromCart`), never by a customer
 *   through the API, because the caller of a create decides prices and discounts.
 * - carts: a signed-in user reads, creates and updates the carts whose `user` is them;
 *   admins everything. Guest carts (`sessionId`) and guest orders belong to nobody the API
 *   can identify, so only admins and server code reach them.
 *
 * "Signed-in user" means a user of `userCollection`: the `user` field relates to that
 * collection only, and an id from another auth collection could collide with it.
 */
export const createEcommerceAccess = (isAdmin: IsAdmin, userCollection: string): EcommerceAccess => {
  const adminOnly: Access = ({ req }) => isAdmin({ req })

  /** The signed-in shop customer of this request, if any. */
  const customerId = (req: PayloadRequest): number | string | undefined =>
    req.user && req.user.collection === userCollection ? req.user.id : undefined

  const adminOrOwner: Access = async ({ req }) => {
    if (await isAdmin({ req })) {
      return true
    }

    const id = customerId(req)
    return id === undefined ? false : { user: { equals: id } }
  }

  const adminOnlyCollection = {
    create: adminOnly,
    delete: adminOnly,
    read: adminOnly,
    update: adminOnly,
  }

  return {
    cartOwnerField: {
      // On create the collection's own access rule has already checked that a customer's
      // new cart names that customer; afterwards only an admin may hand a cart to someone else.
      create: () => true,
      update: ({ req }) => isAdmin({ req }),
    },
    carts: {
      create: async ({ data, req }) => {
        if (await isAdmin({ req })) {
          return true
        }

        const id = customerId(req)
        // A customer may only create their own cart, and not one that is also tied to a
        // guest session, which would let them plant a cart for a session id they know.
        return id !== undefined && isSameDocument(data?.user, id) && !data?.sessionId
      },
      delete: adminOnly,
      read: adminOrOwner,
      update: adminOrOwner,
    },
    categories: { ...adminOnlyCollection, read: () => true },
    coupons: adminOnlyCollection,
    orders: { ...adminOnlyCollection, read: adminOrOwner },
    products: {
      ...adminOnlyCollection,
      read: async ({ req }) => ((await isAdmin({ req })) ? true : { status: { equals: 'active' } }),
    },
  }
}

/**
 * How the `useEcommerce` helpers call Payload's Local API.
 *
 * By default the helpers are trusted server code: they bypass access control
 * (`overrideAccess: true`), which is what a checkout for guests needs, since a guest cart
 * is not readable through access control at all. The caller is then responsible for only
 * passing ids (cart, order, user, session) that belong to the visitor.
 *
 * With `overrideAccess: false` the helpers read and change carts, orders and products as
 * `user` (or `req.user`), under the collections' access rules.
 */
export interface HelperAccessOptions {
  /** Default `true`. Set to `false` to apply the collections' access rules for `user`. */
  overrideAccess?: boolean
  /** Request to run every call with, for example to join its transaction. Its `user` is used when `user` is not given. */
  req?: PayloadRequest
  /** The user to apply access control for when `overrideAccess` is `false`. */
  user?: PayloadRequest['user']
}

export interface LocalApiAccess {
  /** Options for calls that act on behalf of the caller. */
  caller: { overrideAccess: boolean; req?: PayloadRequest; user?: PayloadRequest['user'] }
  /**
   * Options for the plugin's own bookkeeping, which always bypasses access control: an
   * order created from a cart, coupon lookups, stock.
   */
  trusted: { overrideAccess: true; req?: PayloadRequest }
}

export const resolveLocalApiAccess = ({ overrideAccess = true, req, user }: HelperAccessOptions = {}): LocalApiAccess => ({
  caller: { overrideAccess, ...(req ? { req } : {}), ...(user ? { user } : {}) },
  trusted: { overrideAccess: true, ...(req ? { req } : {}) },
})
