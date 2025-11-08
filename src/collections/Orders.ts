import type { CollectionConfig } from 'payload'
import type { PayloadEcommerceConfig } from '../index.js'
import { createProductHelpers } from '../lib/products.js'
import { createCouponHelpers } from '../lib/coupons.js'

const addressFields = [
  {
    name: 'firstName',
    type: 'text' as const,
    required: true,
  },
  {
    name: 'lastName',
    type: 'text' as const,
    required: true,
  },
  {
    name: 'address1',
    type: 'text' as const,
    required: true,
  },
  {
    name: 'address2',
    type: 'text' as const,
  },
  {
    name: 'city',
    type: 'text' as const,
    required: true,
  },
  {
    name: 'state',
    type: 'text' as const,
    required: true,
  },
  {
    name: 'postalCode',
    type: 'text' as const,
    required: true,
  },
  {
    name: 'country',
    type: 'text' as const,
    required: true,
  },
  {
    name: 'phone',
    type: 'text' as const,
  },
]

export const createOrders = (config: PayloadEcommerceConfig = {}): CollectionConfig => {
  const productsSlug = config.collections?.products
    ? (typeof config.collections.products === 'string' ? config.collections.products : 'products')
    : 'products'

  const couponsSlug = config.collections?.coupons
    ? (typeof config.collections.coupons === 'string' ? config.collections.coupons : 'coupons')
    : 'coupons'

  return {
    slug: 'orders',
  admin: {
    useAsTitle: 'orderNumber',
    defaultColumns: ['orderNumber', 'user', 'total', 'status', 'createdAt'],
  },
  fields: [
    {
      name: 'orderNumber',
      type: 'text',
      unique: true,
      index: true,
      admin: {
        position: 'sidebar',
        readOnly: true,
      },
    },
    {
      name: 'user',
      type: 'relationship',
      relationTo: 'users',
      admin: {
        description: 'User who placed the order (optional for guest orders)',
      },
    },
    {
      name: 'items',
      type: 'array',
      required: true,
      minRows: 1,
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
        {
          name: 'price',
          type: 'number',
          required: true,
          min: 0,
          admin: {
            description: 'Price at time of purchase',
          },
        },
        {
          name: 'total',
          type: 'number',
          required: true,
          min: 0,
        },
      ],
    },
    {
      name: 'subtotal',
      type: 'number',
      required: true,
      min: 0,
    },
    {
      name: 'tax',
      type: 'number',
      defaultValue: 0,
      min: 0,
    },
    {
      name: 'shipping',
      type: 'number',
      defaultValue: 0,
      min: 0,
    },
    {
      name: 'discount',
      type: 'number',
      defaultValue: 0,
      min: 0,
    },
    {
      name: 'total',
      type: 'number',
      required: true,
      min: 0,
    },
    {
      name: 'status',
      type: 'select',
      options: [
        {
          label: 'Pending',
          value: 'pending',
        },
        {
          label: 'Processing',
          value: 'processing',
        },
        {
          label: 'Shipped',
          value: 'shipped',
        },
        {
          label: 'Delivered',
          value: 'delivered',
        },
        {
          label: 'Cancelled',
          value: 'cancelled',
        },
        {
          label: 'Refunded',
          value: 'refunded',
        },
      ],
      defaultValue: 'pending',
      required: true,
      admin: {
        position: 'sidebar',
      },
    },
    {
      name: 'paymentStatus',
      type: 'select',
      options: [
        {
          label: 'Pending',
          value: 'pending',
        },
        {
          label: 'Paid',
          value: 'paid',
        },
        {
          label: 'Failed',
          value: 'failed',
        },
        {
          label: 'Refunded',
          value: 'refunded',
        },
      ],
      defaultValue: 'pending',
      required: true,
      admin: {
        position: 'sidebar',
      },
    },
    {
      name: 'paymentMethod',
      type: 'text',
      admin: {
        position: 'sidebar',
      },
    },
    {
      name: 'paymentId',
      type: 'text',
      admin: {
        position: 'sidebar',
        description: 'Payment gateway transaction ID',
      },
    },
    {
      name: 'shippingAddress',
      type: 'group',
      fields: addressFields,
    },
    {
      name: 'billingAddress',
      type: 'group',
      fields: addressFields,
    },
    {
      name: 'notes',
      type: 'textarea',
    },
    {
      name: 'coupon',
      type: 'relationship',
      relationTo: 'coupons',
    },
    {
      name: 'trackingNumber',
      type: 'text',
      admin: {
        position: 'sidebar',
      },
    },
    {
      name: 'trackingUrl',
      type: 'text',
      admin: {
        position: 'sidebar',
      },
    },
  ],
    hooks: {
      beforeChange: [
        async ({ data, operation, req }) => {
          if (operation === 'create' && !data.orderNumber) {
            const timestamp = Date.now()
            const random = Math.floor(Math.random() * 1000)
              .toString()
              .padStart(3, '0')
            data.orderNumber = `ORD-${timestamp}-${random}`
          }

          if (operation === 'create' && config.hooks?.beforeCreateOrder) {
            data = await config.hooks.beforeCreateOrder(data)
          }

          return data
        },
      ],
      afterChange: [
        async ({ doc, operation, req }) => {
          if (operation === 'create') {
            const productHelpers = createProductHelpers(req.payload, productsSlug)

            for (const item of doc.items || []) {
              const productId = typeof item.product === 'string' ? item.product : item.product.id
              try {
                await productHelpers.reduceInventory(productId, item.quantity, item.variant)
              } catch (error) {
                req.payload.logger.error(`Failed to reduce inventory for product ${productId}: ${error}`)
              }
            }

            if (doc.coupon) {
              const couponHelpers = createCouponHelpers(req.payload, couponsSlug)
              const couponId = typeof doc.coupon === 'string' ? doc.coupon : doc.coupon.id
              try {
                await couponHelpers.incrementCouponUsage(couponId)
              } catch (error) {
                req.payload.logger.error(`Failed to increment coupon usage: ${error}`)
              }
            }

            if (config.hooks?.afterCreateOrder) {
              await config.hooks.afterCreateOrder(doc)
            }
          }

          return doc
        },
      ],
    },
  }
}

export const Orders: CollectionConfig = createOrders()
