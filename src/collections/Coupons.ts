import type { CollectionConfig } from 'payload'

export const Coupons: CollectionConfig = {
  slug: 'coupons',
  admin: {
    useAsTitle: 'code',
    defaultColumns: ['code', 'type', 'value', 'status', 'validUntil'],
  },
  fields: [
    {
      name: 'code',
      type: 'text',
      required: true,
      unique: true,
      index: true,
    },
    {
      name: 'description',
      type: 'textarea',
      admin: {
        description: 'Internal description',
      },
    },
    {
      name: 'type',
      type: 'select',
      options: [
        {
          label: 'Percentage',
          value: 'percentage',
        },
        {
          label: 'Fixed Amount',
          value: 'fixed',
        },
        {
          label: 'Free Shipping',
          value: 'freeShipping',
        },
      ],
      required: true,
      defaultValue: 'percentage',
    },
    {
      name: 'value',
      type: 'number',
      min: 0,
      admin: {
        description: 'Discount value (percentage or fixed amount)',
        condition: (data) => data.type !== 'freeShipping',
      },
    },
    {
      name: 'minPurchase',
      type: 'number',
      min: 0,
      admin: {
        description: 'Minimum order amount required',
      },
    },
    {
      name: 'maxDiscount',
      type: 'number',
      min: 0,
      admin: {
        description: 'Maximum discount cap',
        condition: (data) => data.type === 'percentage',
      },
    },
    {
      name: 'usageLimit',
      type: 'number',
      min: 0,
      admin: {
        description: 'Total usage limit (0 = unlimited)',
      },
    },
    {
      name: 'usageCount',
      type: 'number',
      defaultValue: 0,
      min: 0,
      admin: {
        description: 'Current usage count',
        readOnly: true,
      },
    },
    {
      name: 'customerLimit',
      type: 'number',
      min: 0,
      admin: {
        description: 'Per-customer usage limit (0 = unlimited)',
      },
    },
    {
      name: 'validFrom',
      type: 'date',
      admin: {
        description: 'Start date',
      },
    },
    {
      name: 'validUntil',
      type: 'date',
      admin: {
        description: 'End date',
      },
    },
    {
      name: 'status',
      type: 'select',
      options: [
        {
          label: 'Active',
          value: 'active',
        },
        {
          label: 'Inactive',
          value: 'inactive',
        },
        {
          label: 'Expired',
          value: 'expired',
        },
      ],
      defaultValue: 'active',
      required: true,
      admin: {
        position: 'sidebar',
      },
    },
    {
      name: 'appliesToProducts',
      type: 'relationship',
      relationTo: 'products',
      hasMany: true,
      admin: {
        description: 'Specific products this coupon applies to (empty = all products)',
      },
    },
    {
      name: 'appliesToCategories',
      type: 'relationship',
      relationTo: 'categories',
      hasMany: true,
      admin: {
        description: 'Specific categories this coupon applies to (empty = all categories)',
      },
    },
  ],
  hooks: {
    beforeChange: [
      async ({ data }) => {
        if (data.validUntil) {
          const now = new Date()
          const validUntil = new Date(data.validUntil)

          if (validUntil < now && data.status === 'active') {
            data.status = 'expired'
          }
        }

        if (data.validFrom && data.validUntil) {
          const validFrom = new Date(data.validFrom)
          const validUntil = new Date(data.validUntil)

          if (validFrom > validUntil) {
            throw new Error('Valid from date must be before valid until date')
          }
        }

        if (data.usageLimit && data.usageCount >= data.usageLimit) {
          data.status = 'expired'
        }

        return data
      },
    ],
  },
}
