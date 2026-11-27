import type { CollectionConfig } from 'payload'

import type { EcommerceAccess } from '../lib/access.js'
import type { EcommerceSlugs } from '../lib/slugs.js'

import { cartExpiryFrom } from '../lib/cartExpiry.js'
import { resolveUnitPrice } from '../lib/pricing.js'
import { getRelationshipId } from '../lib/relationships.js'

export const createCarts = (
  slugs: EcommerceSlugs,
  ownerFieldAccess: EcommerceAccess['cartOwnerField'],
): CollectionConfig => ({
  slug: slugs.carts,
  admin: {
    useAsTitle: 'id',
    defaultColumns: ['user', 'sessionId', 'subtotal', 'expiresAt', 'updatedAt'],
  },
  fields: [
    {
      name: 'user',
      type: 'relationship',
      relationTo: slugs.users,
      access: ownerFieldAccess,
      admin: {
        description: 'Logged-in user (optional)',
      },
    },
    {
      name: 'sessionId',
      type: 'text',
      access: ownerFieldAccess,
      index: true,
      admin: {
        description: 'Session ID for guest users',
      },
    },
    {
      name: 'items',
      type: 'array',
      fields: [
        {
          name: 'product',
          type: 'relationship',
          relationTo: slugs.products,
          required: true,
        },
        {
          name: 'variant',
          type: 'text',
        },
        {
          name: 'quantity',
          type: 'number',
          required: true,
          min: 1,
        },
      ],
    },
    {
      name: 'subtotal',
      type: 'number',
      defaultValue: 0,
      min: 0,
      admin: {
        description: 'Auto-calculated',
        readOnly: true,
      },
    },
    {
      name: 'expiresAt',
      type: 'date',
      admin: {
        description:
          'Set to 30 days after the cart was last changed. The cart helpers ignore a cart past this date.',
      },
    },
  ],
  hooks: {
    beforeChange: [
      async ({ data, operation, originalDoc, req }) => {
        // A cart expires CART_LIFETIME_DAYS after it was last changed. On update Payload
        // fills `data.expiresAt` with the stored value when the caller did not pass one,
        // so "same instant as the stored value" means the caller is not setting the expiry
        // and the cart gets a fresh one. An expiry that the caller does change is kept.
        if (operation === 'create') {
          if (!data.expiresAt) {
            data.expiresAt = cartExpiryFrom()
          }
        } else if (operation === 'update') {
          const stored = originalDoc?.expiresAt ? new Date(originalDoc.expiresAt).getTime() : undefined
          const incoming = data.expiresAt ? new Date(data.expiresAt).getTime() : undefined
          if (incoming === stored) {
            data.expiresAt = cartExpiryFrom()
          }
        }

        if (data.items && Array.isArray(data.items)) {
          let subtotal = 0
          for (const item of data.items) {
            const productId = getRelationshipId(item.product)
            // A bare id (string on MongoDB, number on SQLite/Postgres) means the relationship
            // is not populated and the product has to be loaded for its price and variants.
            let product = typeof item.product === 'object' ? item.product : undefined
            if (productId !== undefined && typeof item.product !== 'object') {
              try {
                product = await req.payload.findByID({
                  collection: slugs.products,
                  id: productId,
                  depth: 0,
                  // The price is needed whoever saves the cart, also for a product the
                  // user cannot read.
                  overrideAccess: true,
                  req,
                })
              } catch (error) {
                req.payload.logger.error(`Error fetching product: ${error}`)
              }
            }
            // A line whose product could not be loaded adds nothing to the subtotal.
            if (product) {
              subtotal += resolveUnitPrice(product, item.variant) * item.quantity
            }
          }
          data.subtotal = subtotal
        }

        return data
      },
    ],
  },
})
