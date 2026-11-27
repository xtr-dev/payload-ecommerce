import type { CollectionConfig, Field, PayloadRequest } from 'payload'
import { ValidationError } from 'payload'
import type { PayloadEcommerceConfig } from '../index.js'
import { describeStockShortage, resolveStockTarget } from '../lib/products.js'
import { adjustCouponUsage, adjustStock, claimOrderRelease, hasActiveTransaction } from '../lib/atomic.js'
import { evaluateCoupon, RELEASED_ORDER_STATUSES } from '../lib/coupons.js'
import type { DocumentId } from '../lib/relationships.js'
import type { EcommerceSlugs } from '../lib/slugs.js'
import { getRelationshipId } from '../lib/relationships.js'
import { calculateOrderTotal } from '../lib/totals.js'
import { getRoundMoney } from '../lib/money.js'

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

/**
 * The fields of an order address. `required` is what the shipping address needs to be
 * deliverable: a name, a street, a city and a country. `state` and `postalCode` are never
 * required, because many countries have no states or provinces in their addresses and
 * some have no postal codes.
 *
 * The billing address uses the same fields with nothing required: an order may have no
 * separate billing address at all, and a group with a required field cannot be left empty.
 */
const addressFields = (required: boolean): Field[] => [
  { name: 'firstName', type: 'text', required },
  { name: 'lastName', type: 'text', required },
  { name: 'address1', type: 'text', required },
  { name: 'address2', type: 'text' },
  { name: 'city', type: 'text', required },
  { name: 'state', type: 'text' },
  { name: 'postalCode', type: 'text' },
  { name: 'country', type: 'text', required },
  { name: 'phone', type: 'text' },
]

interface OrderLine {
  product?: unknown
  quantity?: number
  variant?: null | string
}

/**
 * Loads each distinct product of the given order lines once, without populating its
 * relationships. A product that no longer exists is left out of the result.
 */
const loadLineProducts = async (
  req: PayloadRequest,
  productsSlug: string,
  lines: OrderLine[],
): Promise<Map<string, any>> => {
  const products = new Map<string, any>()

  for (const line of lines) {
    const productId = getRelationshipId(line.product)
    if (productId === undefined || products.has(String(productId))) {
      continue
    }

    const product = await req.payload.findByID({
      id: productId,
      collection: productsSlug,
      depth: 0,
      disableErrors: true,
      overrideAccess: true,
      req,
    })
    if (product) {
      products.set(String(productId), product)
    }
  }

  return products
}

interface StockDemand {
  product: any
  productId: DocumentId
  /** Variant name as written on the order line, used in messages. */
  lineVariant?: null | string
  /** Variant whose own stock is used; undefined when the product's quantity is used. */
  variant?: string
  quantity: number
  available: number
}

/**
 * Adds up the order lines per stock number they draw from (a product's quantity, or one
 * variant's inventory), so that two lines for the same product are checked and taken
 * together. Lines for products that do not track their quantity are left out.
 */
const collectStockDemand = (lines: OrderLine[], products: Map<string, any>): StockDemand[] => {
  const demand = new Map<string, StockDemand>()

  for (const line of lines) {
    const productId = getRelationshipId(line.product)
    const product = productId === undefined ? undefined : products.get(String(productId))
    if (productId === undefined || !product) {
      continue
    }

    const target = resolveStockTarget(product, line.variant)
    if (!target.tracked) {
      continue
    }

    const key = JSON.stringify([String(productId), target.variant ?? null])
    const existing = demand.get(key)
    if (existing) {
      existing.quantity += line.quantity || 0
    } else {
      demand.set(key, {
        available: target.available,
        lineVariant: line.variant,
        product,
        productId,
        quantity: line.quantity || 0,
        variant: target.variant,
      })
    }
  }

  return [...demand.values()]
}

/**
 * Builds the error that rejects an order. It is a Payload ValidationError, so the admin UI
 * and the REST API report it on the given field, but with the reason as its `message`:
 * Payload's own message only says which field is invalid, which tells a caller of the
 * local API nothing about what to change.
 */
const orderError = (
  collection: string,
  path: string,
  message: string,
  req: PayloadRequest,
): ValidationError => {
  const error = new ValidationError({ collection, errors: [{ message, path }] }, req.t)
  error.message = message
  return error
}

/**
 * Builds the error that fails an order create or update because its tax could not be
 * calculated. It is a plain Error, not a ValidationError: the cause is the host's
 * `calculateTax` hook (for example an unreachable tax service), not something the caller
 * of the API sent, so the REST API answers 500 and does not show the hook's message to
 * the customer. The hook's own error is kept as `cause`.
 */
const taxError = (operation: 'create' | 'update', reason: string, cause?: unknown): Error =>
  new Error(
    `Order was not ${operation === 'create' ? 'created' : 'updated'}: tax could not be calculated (${reason})`,
    { cause },
  )

export const createOrders = (
  config: Pick<PayloadEcommerceConfig, 'hooks'>,
  slugs: EcommerceSlugs,
): CollectionConfig => {
  const productsSlug = slugs.products
  const couponsSlug = slugs.coupons

  return {
    slug: slugs.orders,
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
      relationTo: slugs.users,
      admin: {
        description: 'User who placed the order (optional for guest orders)',
      },
    },
    {
      name: 'customerEmail',
      type: 'email',
      admin: {
        description:
          'Where to reach the customer about this order. Needed for a guest order, which has no user.',
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
      fields: addressFields(true),
    },
    {
      name: 'billingAddress',
      type: 'group',
      admin: {
        description: 'Optional. createOrderFromCart copies the shipping address when none is given.',
      },
      fields: addressFields(false),
    },
    {
      name: 'notes',
      type: 'textarea',
    },
    {
      name: 'coupon',
      type: 'relationship',
      relationTo: slugs.coupons,
      admin: {
        description:
          'On a new order the coupon is validated and sets the discount (or zeroes shipping for a free shipping coupon). Changing it later does not recalculate the order.',
      },
    },
    {
      name: 'inventoryReduced',
      type: 'checkbox',
      defaultValue: false,
      admin: {
        position: 'sidebar',
        readOnly: true,
        description:
          'Set by the plugin while this order holds stock. Cleared when the stock is put back on cancellation or refund.',
      },
    },
    {
      name: 'couponUsageCounted',
      type: 'checkbox',
      defaultValue: false,
      admin: {
        position: 'sidebar',
        readOnly: true,
        description:
          'Set by the plugin while this order counts as a use of its coupon. Cleared on cancellation or refund.',
      },
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
        async ({ collection, data, operation, originalDoc, req }) => {
          if (operation === 'create' && !data.orderNumber) {
            const timestamp = Date.now()
            const random = Math.floor(Math.random() * 1000)
              .toString()
              .padStart(3, '0')
            data.orderNumber = `ORD-${timestamp}-${random}`
          }

          // A coupon on a new order is applied here rather than trusted from the caller: the
          // coupon is checked against this order and decides the discount (and, for a free
          // shipping coupon, the shipping cost). This happens before tax and total are
          // calculated so both see the coupon's effect.
          const couponId = operation === 'create' ? getRelationshipId(data.coupon) : undefined
          if (couponId !== undefined) {
            // disableErrors makes a missing coupon come back as null instead of throwing, so
            // it is reported as a validation error on the coupon field below.
            const coupon = await req.payload.findByID({
              id: couponId,
              collection: couponsSlug,
              depth: 0,
              disableErrors: true,
              overrideAccess: true,
              req,
            })

            const productIds: DocumentId[] = []
            const categoryIds: DocumentId[] = []
            for (const item of data.items || []) {
              const productId = getRelationshipId(item.product)
              if (productId === undefined) {
                continue
              }
              productIds.push(productId)

              // Categories are only needed for category-restricted coupons; they come from
              // the populated product when there is one and are loaded otherwise.
              if (coupon?.appliesToCategories?.length) {
                const product =
                  typeof item.product === 'object' && item.product !== null
                    ? item.product
                    : await req.payload.findByID({
                        id: productId,
                        collection: productsSlug,
                        depth: 0,
                        disableErrors: true,
                        overrideAccess: true,
                        req,
                      })
                for (const category of product?.categories || []) {
                  const categoryId = getRelationshipId(category)
                  if (categoryId !== undefined) {
                    categoryIds.push(categoryId)
                  }
                }
              }
            }

            const result = await evaluateCoupon(req.payload, coupon, {
              cartTotal: data.subtotal || 0,
              categoryIds,
              ordersSlug: collection.slug,
              productIds,
              req,
              userId: getRelationshipId(data.user),
            })

            if (!result.valid) {
              throw orderError(collection.slug, 'coupon', result.error || 'Coupon is not valid', req)
            }

            data.discount = result.discount
            if (result.freeShipping) {
              data.shipping = 0
            }
          }

          if (operation === 'create') {
            // An order created directly as cancelled or refunded never holds stock or a
            // coupon use, so there is nothing to check, take or give back later.
            const holds = !RELEASED_ORDER_STATUSES.includes(data.status ?? 'pending')

            // Reject the order while nothing has been written yet when it asks for more
            // units than are in stock. This read cannot see concurrent orders; the atomic
            // stock update in afterChange is what settles a race for the last units.
            const demand = holds
              ? collectStockDemand(
                  data.items || [],
                  await loadLineProducts(req, productsSlug, data.items || []),
                )
              : []
            for (const entry of demand) {
              if (entry.available < entry.quantity) {
                throw orderError(
                  collection.slug,
                  'items',
                  describeStockShortage(entry.product, entry.lineVariant, entry.quantity, entry.available),
                  req,
                )
              }
            }

            // These flags record what afterChange is about to do, so that a later
            // cancellation gives back exactly what this order took. They are always set
            // here; a value passed by the caller is replaced.
            data.inventoryReduced = demand.length > 0
            data.couponUsageCounted = holds && couponId !== undefined
          } else if (operation === 'update') {
            // An update never writes the flags. Payload saves every field that is in
            // `data`, and `data` holds the values read before this hook ran; writing them
            // back could set a flag again that a simultaneous cancellation has just
            // cleared, and the order's stock would then be given back twice. Removing them
            // leaves the stored values alone. The only writer after creation is the atomic
            // claim in afterChange (see claimOrderRelease), which also means a caller
            // cannot change these fields.
            delete data.inventoryReduced
            delete data.couponUsageCounted
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
            // An order must never be stored with a tax amount that was not actually
            // calculated, so a hook that throws, or returns something that is not an
            // amount, fails the whole create or update. This hook runs before anything is
            // written: no order row, stock or coupon use has changed yet, so there is
            // nothing to undo.
            let tax: unknown
            try {
              tax = await config.hooks.calculateTax({
                items: current('items') || [],
                subtotal: current('subtotal') || 0,
                discount: current('discount') || 0,
                shipping: current('shipping') || 0,
                shippingAddress: current('shippingAddress'),
                billingAddress: current('billingAddress'),
              })
            } catch (error) {
              throw taxError(operation, error instanceof Error ? error.message : String(error), error)
            }

            if (typeof tax !== 'number' || !Number.isFinite(tax)) {
              throw taxError(operation, `the calculateTax hook returned ${String(tax)} instead of a number`)
            }

            // A hook that taxes (subtotal − discount) returns a negative amount when the
            // discount exceeds the subtotal; tax is never negative, so that becomes 0.
            // A rate times an amount rarely is a whole money unit, so it is rounded here.
            data.tax = Math.max(0, getRoundMoney(req.payload)(tax))
          }

          if (operation === 'create' && config.hooks?.beforeCreateOrder) {
            data = await config.hooks.beforeCreateOrder(data)
          }

          // The total always follows from its parts; a `total` passed by the caller is
          // replaced. This runs before field validation, so callers do not have to pass the
          // required `total` at all, and after beforeCreateOrder so amounts changed by that
          // hook count. On update it runs only when an amount (or the total itself) changes.
          if (operation === 'create' || TOTAL_INPUT_FIELDS.some(isChanged)) {
            data.total = calculateOrderTotal(
              {
                subtotal: current('subtotal'),
                discount: current('discount'),
                tax: current('tax'),
                shipping: current('shipping'),
              },
              getRoundMoney(req.payload),
            )
          }

          return data
        },
      ],
      afterChange: [
        async ({ collection, doc, operation, previousDoc, req }) => {
          if (operation === 'create') {
            // Everything this order took, so it can be given back if a later step fails.
            const takenStock: StockDemand[] = []
            let countedCouponId: DocumentId | undefined

            try {
              if (doc.inventoryReduced) {
                const demand = collectStockDemand(
                  doc.items || [],
                  await loadLineProducts(req, productsSlug, doc.items || []),
                )

                for (const entry of demand) {
                  const taken = await adjustStock(req.payload, {
                    delta: -entry.quantity,
                    productId: entry.productId,
                    productsSlug,
                    req,
                    variant: entry.variant,
                  })

                  if (!taken) {
                    // Another order took the units between the check in beforeChange and
                    // this update. `available` was read before that, so it is not repeated.
                    throw orderError(
                      collection.slug,
                      'items',
                      describeStockShortage(entry.product, entry.lineVariant, entry.quantity),
                      req,
                    )
                  }
                  takenStock.push(entry)
                }
              }

              const couponId = doc.couponUsageCounted ? getRelationshipId(doc.coupon) : undefined
              if (couponId !== undefined) {
                const counted = await adjustCouponUsage(req.payload, {
                  couponId,
                  couponsSlug,
                  delta: 1,
                  req,
                })

                if (!counted) {
                  throw orderError(collection.slug, 'coupon', 'Coupon usage limit reached', req)
                }
                countedCouponId = couponId
              }

              if (config.hooks?.afterCreateOrder) {
                await config.hooks.afterCreateOrder(doc)
              }
            } catch (error) {
              // The order must not exist when any of its side effects failed. Inside a
              // transaction, rethrowing makes Payload roll back the order together with
              // the updates above. Without one (the SQLite adapter's default) nothing is
              // rolled back, so the updates are undone and the order row is deleted here.
              if (!(await hasActiveTransaction(req.payload, req))) {
                for (const entry of takenStock) {
                  await adjustStock(req.payload, {
                    delta: entry.quantity,
                    productId: entry.productId,
                    productsSlug,
                    req,
                    variant: entry.variant,
                  })
                }
                if (countedCouponId !== undefined) {
                  await adjustCouponUsage(req.payload, {
                    couponId: countedCouponId,
                    couponsSlug,
                    delta: -1,
                    req,
                  })
                }
                await req.payload.db.deleteOne({
                  collection: collection.slug,
                  req,
                  where: { id: { equals: doc.id } },
                })
              }

              throw error
            }
          }

          if (operation === 'update' && RELEASED_ORDER_STATUSES.includes(doc.status)) {
            // The order is cancelled or refunded, so whatever it still holds is given back.
            // Two updates can get here for the same order at the same time (a cancellation
            // and a refund, or a double submit) and both have read the flags as set, so the
            // flags that were read decide nothing. Each flag is claimed with one
            // conditional database statement and only the update that clears it gives
            // back. A later update finds the flags cleared and does nothing. Reopening a
            // cancelled order does not take stock again.
            const release = async (flag: 'couponUsageCounted' | 'inventoryReduced'): Promise<boolean> => {
              // Skips the statement for an order that held nothing when this update began.
              const claimed =
                Boolean(previousDoc?.[flag] || doc[flag]) &&
                (await claimOrderRelease(req.payload, {
                  flag,
                  orderId: doc.id,
                  ordersSlug: collection.slug,
                  req,
                }))
              // Whoever won the claim, the stored flag is cleared now; the returned
              // document was read before the claim and has to say the same.
              doc[flag] = false
              return claimed
            }

            if (await release('inventoryReduced')) {
              // What is given back is what the order held before this save, hence previousDoc.
              const lines = previousDoc?.items || doc.items || []
              const demand = collectStockDemand(lines, await loadLineProducts(req, productsSlug, lines))

              for (const entry of demand) {
                await adjustStock(req.payload, {
                  delta: entry.quantity,
                  productId: entry.productId,
                  productsSlug,
                  req,
                  variant: entry.variant,
                })
              }
            }

            if (await release('couponUsageCounted')) {
              const couponId = getRelationshipId(previousDoc?.coupon ?? doc.coupon)
              if (couponId !== undefined) {
                await adjustCouponUsage(req.payload, { couponId, couponsSlug, delta: -1, req })
              }
            }
          }

          return doc
        },
      ],
    },
  }
}
