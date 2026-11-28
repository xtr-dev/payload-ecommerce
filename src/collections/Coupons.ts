import type { CollectionConfig } from 'payload'

import type { EcommerceSlugs } from '../lib/slugs.js'

export const createCoupons = (slugs: EcommerceSlugs): CollectionConfig => ({
  slug: slugs.coupons,
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
      admin: {
        description: 'Stored in upper case; customers can enter it in any case',
      },
      hooks: {
        beforeValidate: [
          // Coupon lookups compare against the upper-cased code a customer typed, so the
          // stored code has to be upper case too or the coupon could never be found.
          ({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value),
        ],
      },
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
        description: 'Discount value (percentage or fixed amount). Not used for free shipping.',
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
      // The count belongs to the orders that use the coupon. The admin panel submits
      // read-only fields along with the rest of the form, holding the value from when the
      // form was opened, so without this rule saving a coupon would wipe out the uses
      // counted since. REST and GraphQL updates are refused the same way; server code that
      // really means to correct the count does so through the Local API.
      access: {
        update: () => false,
      },
      admin: {
        description:
          'Orders that currently use this coupon. Counted when an order is created and given back when it is cancelled or refunded.',
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
      relationTo: slugs.products,
      hasMany: true,
      admin: {
        description: 'Specific products this coupon applies to (empty = all products)',
      },
    },
    {
      name: 'appliesToCategories',
      type: 'relationship',
      relationTo: slugs.categories,
      hasMany: true,
      admin: {
        description: 'Specific categories this coupon applies to (empty = all categories)',
      },
    },
  ],
  hooks: {
    beforeChange: [
      ({ data, operation, originalDoc }) => {
        // Payload fills `data` with the stored value of every field an update leaves out
        // and then saves all of `data`. For `usageCount` that would write back the count
        // read at the start of this update, undoing an order that counted a use in
        // between. Removing an unchanged count from `data` leaves the stored value alone;
        // a count the caller actually changes is still saved.
        if (operation === 'update' && data.usageCount === originalDoc?.usageCount) {
          delete data.usageCount
        }

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

        return data
      },
    ],
  },
})
