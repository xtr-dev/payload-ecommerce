import type { CollectionConfig } from 'payload'

import type { EcommerceSlugs } from '../lib/slugs.js'

import { createSlugHook } from '../lib/slug.js'

export const createProducts = (slugs: EcommerceSlugs): CollectionConfig => ({
  slug: slugs.products,
  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'price', 'status', 'updatedAt'],
  },
  fields: [
    {
      name: 'title',
      type: 'text',
      required: true,
    },
    {
      name: 'slug',
      type: 'text',
      unique: true,
      index: true,
      admin: {
        position: 'sidebar',
        description: 'Leave empty to generate it from the title. Must be unique.',
      },
    },
    {
      name: 'description',
      type: 'richText',
    },
    {
      name: 'price',
      type: 'number',
      required: true,
      min: 0,
    },
    {
      name: 'compareAtPrice',
      type: 'number',
      min: 0,
      admin: {
        description: 'Original price for showing discounts',
      },
    },
    {
      name: 'sku',
      type: 'text',
      admin: {
        description: 'Stock keeping unit',
      },
    },
    {
      name: 'barcode',
      type: 'text',
    },
    {
      name: 'inventory',
      type: 'group',
      fields: [
        {
          name: 'trackQuantity',
          type: 'checkbox',
          defaultValue: false,
        },
        {
          name: 'quantity',
          type: 'number',
          min: 0,
          admin: {
            condition: (data, siblingData) => siblingData?.trackQuantity === true,
          },
        },
        {
          name: 'lowStockThreshold',
          type: 'number',
          min: 0,
          admin: {
            description: 'Alert threshold for low stock',
            condition: (data, siblingData) => siblingData?.trackQuantity === true,
          },
        },
      ],
    },
    {
      name: 'images',
      type: 'relationship',
      relationTo: slugs.media,
      hasMany: true,
    },
    {
      name: 'categories',
      type: 'relationship',
      relationTo: slugs.categories,
      hasMany: true,
    },
    {
      name: 'variants',
      type: 'array',
      fields: [
        {
          name: 'name',
          type: 'text',
          required: true,
        },
        {
          name: 'sku',
          type: 'text',
        },
        {
          name: 'price',
          type: 'number',
          min: 0,
          admin: {
            description: 'Price override for this variant',
          },
        },
        {
          name: 'inventory',
          type: 'number',
          min: 0,
        },
      ],
    },
    {
      name: 'status',
      type: 'select',
      options: [
        {
          label: 'Draft',
          value: 'draft',
        },
        {
          label: 'Active',
          value: 'active',
        },
        {
          label: 'Archived',
          value: 'archived',
        },
      ],
      defaultValue: 'draft',
      required: true,
      admin: {
        position: 'sidebar',
      },
    },
  ],
  hooks: {
    beforeChange: [createSlugHook('title')],
    beforeValidate: [
      ({ data }) => {
        if (data && data.price && data.compareAtPrice) {
          if (data.compareAtPrice < data.price) {
            data.compareAtPrice = undefined
          }
        }
        return data
      },
    ],
  },
})
