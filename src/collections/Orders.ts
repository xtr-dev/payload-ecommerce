import type { CollectionConfig } from 'payload'
import type { PayloadEcommerceConfig } from '../index.js'
import { createProductHelpers } from '../lib/products.js'
import { createCouponHelpers } from '../lib/coupons.js'
import { getRelationshipId } from '../lib/relationships.js'
import { calculateOrderTotal } from '../lib/totals.js'

/**
 * Order fields that are passed to the `calculateTax` hook. A change to any of them can
 * change the tax amount.
 */
const TAX_INPUT_FIELDS = [
  'items',
  'subtotal',
  'discount',
  'shipping',
  'shippingAddress',
  'billingAddress',
]

/**
 * Compares two field values (numbers, strings, address groups, item arrays) by content.
 * `null` and `undefined` count as the same "no value", because a field the caller left out
 * arrives as `undefined` while the database returns it as `null`.
 */
const isDeepEqual = (a: unknown, b: unknown): boolean => {
  if (a === b || (a == null && b == null)) {
    return true
  }

  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) {
    return false
  }

  if (Array.isArray(a) !== Array.isArray(b)) {
    return false
  }

  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const key of keys) {
    if (!isDeepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])) {
      return false
    }
  }

  return true
}

/** Order fields whose change requires `total` to be computed again. */
const TOTAL_INPUT_FIELDS = ['subtotal', 'discount', 'tax', 'shipping', 'total']

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
      admin: {
        description: 'Calculated on save: subtotal − discount + tax + shipping',
        readOnly: true,
      },
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
        async ({ data, operation, originalDoc, req }) => {
          if (operation === 'create' && !data.orderNumber) {
            const timestamp = Date.now()
            const random = Math.floor(Math.random() * 1000)
              .toString()
              .padStart(3, '0')
            data.orderNumber = `ORD-${timestamp}-${random}`
          }

          // Payload fills `data` with the stored value of every field the caller left out
          // of an update, so "is this field in data" does not tell whether it is being
          // changed; comparing with the stored order does. `current` still falls back to
          // the stored order for a field that is missing from `data` altogether.
          const stored: Record<string, unknown> = operation === 'update' ? (originalDoc ?? {}) : {}
          const current = (field: string) => (field in data ? data[field] : stored[field])
          const isChanged = (field: string) => !isDeepEqual(current(field), stored[field])

          // Tax depends on the items, amounts and addresses. It is calculated for every new
          // order, and for an update only when one of those inputs changes, so that a status
          // or tracking update does not re-tax an existing order at today's rates.
          const changesTaxInput = operation === 'create' || TAX_INPUT_FIELDS.some(isChanged)

          if (changesTaxInput && config.hooks?.calculateTax) {
            try {
              const tax = await config.hooks.calculateTax({
                items: current('items') || [],
                subtotal: current('subtotal') || 0,
                discount: current('discount') || 0,
                shipping: current('shipping') || 0,
                shippingAddress: current('shippingAddress'),
                billingAddress: current('billingAddress'),
              })
              // A hook that taxes (subtotal − discount) returns a negative amount when the
              // discount exceeds the subtotal; tax is never negative, so that becomes 0.
              data.tax = Math.max(0, tax)
            } catch (error) {
              req.payload.logger.error(`Failed to calculate tax: ${error}`)
              // Continue without tax calculation if it fails
            }
          }

          if (operation === 'create' && config.hooks?.beforeCreateOrder) {
            data = await config.hooks.beforeCreateOrder(data)
          }

          // The total always follows from its parts; a `total` passed by the caller is
          // replaced. This runs before field validation, so callers do not have to pass the
          // required `total` at all, and after beforeCreateOrder so amounts changed by that
          // hook count. On update it runs only when an amount (or the total itself) changes.
          if (operation === 'create' || TOTAL_INPUT_FIELDS.some(isChanged)) {
            data.total = calculateOrderTotal({
              subtotal: current('subtotal'),
              discount: current('discount'),
              tax: current('tax'),
              shipping: current('shipping'),
            })
          }

          return data
        },
      ],
      afterChange: [
        async ({ doc, operation, req }) => {
          if (operation === 'create') {
            const productHelpers = createProductHelpers(req.payload, productsSlug)

            for (const item of doc.items || []) {
              const productId = getRelationshipId(item.product)
              if (productId === undefined) {
                continue
              }
              try {
                await productHelpers.reduceInventory(productId, item.quantity, item.variant)
              } catch (error) {
                req.payload.logger.error(`Failed to reduce inventory for product ${productId}: ${error}`)
              }
            }

            if (doc.coupon) {
              const couponHelpers = createCouponHelpers(req.payload, couponsSlug)
              const couponId = getRelationshipId(doc.coupon)
              try {
                if (couponId !== undefined) {
                  await couponHelpers.incrementCouponUsage(couponId)
                }
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
