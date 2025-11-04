import type { CollectionConfig } from 'payload'

export const Carts: CollectionConfig = {
  slug: 'carts',
  admin: {
    useAsTitle: 'id',
    defaultColumns: ['user', 'sessionId', 'subtotal', 'expiresAt', 'updatedAt'],
  },
  fields: [
    {
      name: 'user',
      type: 'relationship',
      relationTo: 'users',
      admin: {
        description: 'Logged-in user (optional)',
      },
    },
    {
      name: 'sessionId',
      type: 'text',
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
          relationTo: 'products',
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
        description: 'Cart expiration date',
      },
    },
  ],
  hooks: {
    beforeChange: [
      async ({ data, operation, req }) => {
        if (operation === 'create' && !data.expiresAt) {
          const expirationDate = new Date()
          expirationDate.setDate(expirationDate.getDate() + 30)
          data.expiresAt = expirationDate.toISOString()
        }

        if (data.items && Array.isArray(data.items)) {
          let subtotal = 0
          for (const item of data.items) {
            if (typeof item.product === 'string') {
              try {
                const product = await req.payload.findByID({
                  collection: 'products',
                  id: item.product,
                })
                if (product?.price) {
                  subtotal += product.price * item.quantity
                }
              } catch (error) {
                req.payload.logger.error(`Error fetching product: ${error}`)
              }
            } else if (item.product?.price) {
              subtotal += item.product.price * item.quantity
            }
          }
          data.subtotal = subtotal
        }

        return data
      },
    ],
  },
}
