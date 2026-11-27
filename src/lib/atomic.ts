import type { Payload, PayloadRequest } from 'payload'

import type { DocumentId } from './relationships.js'

/**
 * Atomic counter updates for stock and coupon usage.
 *
 * Payload's own API can only write absolute values ("set quantity to 4"), so reducing stock
 * through it means reading the quantity and writing back quantity − n. Two orders doing
 * that at the same time both read the same quantity and both succeed, overselling the
 * product. The functions here instead send one conditional statement to the database
 * ("subtract n, but only if at least n is left"), which the database applies to one order
 * at a time:
 *
 * - MongoDB (`@payloadcms/db-mongodb`): `updateOne` with `$inc` and the condition in the
 *   filter, on the adapter's Mongoose model.
 * - SQL (`@payloadcms/db-sqlite`, `@payloadcms/db-postgres` and other Drizzle adapters):
 *   one `UPDATE … SET x = x + n WHERE … RETURNING id` through the adapter's `execute`.
 * - Any other adapter, or a schema in which the expected table or column cannot be found
 *   (for example a field given a custom `dbName`): a read followed by `payload.update`.
 *   That fallback is correct for one order at a time but can oversell under concurrency.
 *
 * `claimOrderRelease` uses the same technique for a flag instead of a counter: "clear this
 * flag, but only if it is still set", so that of several simultaneous cancellations of one
 * order exactly one gives the order's stock and coupon use back.
 *
 * All of them run in the transaction of the `req` they are given, when it has one.
 */

/** The parts of the Mongoose and Drizzle adapters used here; neither is in Payload's types. */
interface AdapterInternals {
  collections?: Record<
    string,
    {
      updateOne: (
        filter: Record<string, unknown>,
        update: Record<string, unknown>,
        options: Record<string, unknown>,
      ) => Promise<{ matchedCount?: number }>
    }
  >
  drizzle?: unknown
  execute?: (args: { db?: unknown; drizzle?: unknown; raw: string }) => Promise<unknown>
  name?: string
  schemaName?: string
  sessions?: Record<string, unknown>
  tableNameMap?: Map<string, string>
  tables?: Record<string, Record<string, unknown> | undefined>
}

const internals = (payload: Payload): AdapterInternals => payload.db as unknown as AdapterInternals

/**
 * Returns the key under which the adapter keeps the session of the request's transaction,
 * or `undefined` when the request has no transaction. Adapters that run without
 * transactions (the SQLite adapter's default) leave `req.transactionID` empty or set it to
 * a placeholder that has no session, so only an id with a session counts.
 */
const transactionKey = async (payload: Payload, req?: PayloadRequest): Promise<string | undefined> => {
  const transactionID = await req?.transactionID
  if (typeof transactionID !== 'string' && typeof transactionID !== 'number') {
    return undefined
  }

  const key = String(transactionID)
  return internals(payload).sessions?.[key] ? key : undefined
}

/**
 * Tells whether work done with this request is part of a database transaction, and will
 * therefore be rolled back by Payload when the operation fails.
 */
export const hasActiveTransaction = async (payload: Payload, req?: PayloadRequest): Promise<boolean> =>
  (await transactionKey(payload, req)) !== undefined

/** Same conversion Payload's Drizzle adapters use to turn a slug or field name into a table or column name. */
const toSnakeCase = (value: string): string =>
  value
    .replace(/([a-z\d])([A-Z])/g, '$1_$2')
    .replace(/[\s-]+/g, '_')
    .toLowerCase()

const quoteIdentifier = (name: string): string => `"${name.replace(/"/g, '""')}"`

/**
 * Values are inlined into the SQL text because the adapter's `execute` takes no
 * parameters, so every value is validated or escaped here: numbers must be finite, ids may
 * only hold word characters and dashes, and other strings get their quotes doubled.
 */
const numberLiteral = (value: number): string => {
  if (!Number.isFinite(value)) {
    throw new Error(`Expected a finite number but got ${value}`)
  }
  return String(value)
}

const idLiteral = (id: DocumentId): string => {
  if (typeof id === 'number') {
    return numberLiteral(id)
  }
  if (!/^[\w-]+$/.test(id)) {
    throw new Error(`Unexpected document id: ${id}`)
  }
  return `'${id}'`
}

const stringLiteral = (value: string): string => {
  if (value.includes('\0')) {
    throw new Error('Unexpected NUL character in a text value')
  }
  return `'${value.replace(/'/g, "''")}'`
}

/**
 * Resolves the SQL table of a collection (or of one of its array fields) and checks that
 * it has the columns the statement is about to use. Returns `undefined` when the adapter
 * is not a Drizzle adapter or the schema differs from what is expected, in which case the
 * caller uses its non-atomic fallback.
 */
const resolveSqlTable = (
  payload: Payload,
  defaultTableName: string,
  columns: string[],
): string | undefined => {
  const db = internals(payload)
  if (!db.drizzle || typeof db.execute !== 'function' || !db.tableNameMap || !db.tables) {
    return undefined
  }

  const tableName = db.tableNameMap.get(defaultTableName) ?? defaultTableName
  const table = db.tables[tableName]
  if (!table) {
    return undefined
  }

  const columnNames = new Set(
    Object.values(table)
      .map((column) => (column as { name?: unknown } | null)?.name)
      .filter((name): name is string => typeof name === 'string'),
  )
  if (!columns.every((column) => columnNames.has(column))) {
    return undefined
  }

  return db.schemaName
    ? `${quoteIdentifier(db.schemaName)}.${quoteIdentifier(tableName)}`
    : quoteIdentifier(tableName)
}

/** Runs one `UPDATE … RETURNING` statement and tells whether it changed a row. */
const runSqlUpdate = async (payload: Payload, raw: string, req?: PayloadRequest): Promise<boolean> => {
  const db = internals(payload)
  const key = await transactionKey(payload, req)
  // Use the transaction's own connection when there is one, so the statement is part of
  // that transaction and does not wait on a lock the transaction itself holds.
  const session = key === undefined ? undefined : (db.sessions?.[key] as { db?: unknown } | undefined)?.db

  const result = (await db.execute!({ db: session, drizzle: db.drizzle, raw })) as
    | { rows?: unknown[] }
    | undefined

  return (result?.rows?.length ?? 0) > 0
}

const runMongoUpdate = async (
  payload: Payload,
  collection: string,
  filter: Record<string, unknown>,
  update: Record<string, unknown>,
  req?: PayloadRequest,
): Promise<boolean> => {
  const db = internals(payload)
  const model = db.collections?.[collection]
  if (!model) {
    throw new Error(`Collection "${collection}" has no Mongoose model`)
  }

  const key = await transactionKey(payload, req)
  const session = key === undefined ? undefined : db.sessions?.[key]
  // `timestamps: false` keeps `updatedAt` as it is, the same as the SQL statement does;
  // a stock movement caused by an order is not an edit of the product.
  const result = await model.updateOne(filter, update, { session, timestamps: false })

  return (result.matchedCount ?? 0) > 0
}

export interface AdjustStockParams {
  productsSlug: string
  productId: DocumentId
  /**
   * Name of the variant whose own `inventory` number is adjusted. Leave undefined to adjust
   * the product's `inventory.quantity`.
   */
  variant?: string
  /**
   * Units to add (positive, when stock is restored) or remove (negative, when an order
   * takes stock). Removing only happens when at least that many units are left.
   */
  delta: number
  req?: PayloadRequest
}

/**
 * Adds `delta` units to a product's (or variant's) stock in one atomic step. Returns
 * `false`, leaving the stock untouched, when units are being removed and fewer are left
 * than requested, or when the product or variant does not exist.
 */
export const adjustStock = async (
  payload: Payload,
  { productsSlug, productId, variant, delta, req }: AdjustStockParams,
): Promise<boolean> => {
  const db = internals(payload)
  const needed = delta < 0 ? -delta : 0

  if (db.name === 'mongoose') {
    if (variant !== undefined) {
      // $inc fails on a null value, so the variant must hold a number; callers only target
      // a variant whose inventory is numeric (see resolveStockTarget).
      return await runMongoUpdate(
        payload,
        productsSlug,
        {
          _id: productId,
          variants: { $elemMatch: { name: variant, inventory: needed > 0 ? { $gte: needed } : { $type: 'number' } } },
        },
        { $inc: { 'variants.$.inventory': delta } },
        req,
      )
    }

    const adjusted = await runMongoUpdate(
      payload,
      productsSlug,
      { _id: productId, 'inventory.quantity': needed > 0 ? { $gte: needed } : { $type: 'number' } },
      { $inc: { 'inventory.quantity': delta } },
      req,
    )
    if (adjusted || needed > 0) {
      return adjusted
    }

    // Restoring stock on a product whose quantity was never filled in: $inc cannot add to
    // a missing-or-null value inside a filter that requires a number, so the quantity is
    // set instead. The filter still excludes numbers, so a concurrent restore is not lost.
    return await runMongoUpdate(
      payload,
      productsSlug,
      { _id: productId, 'inventory.quantity': { $not: { $type: 'number' } } },
      { $set: { 'inventory.quantity': delta } },
      req,
    )
  }

  const tableName = toSnakeCase(productsSlug)
  const table =
    variant !== undefined
      ? resolveSqlTable(payload, `${tableName}_variants`, ['id', '_parent_id', 'name', 'inventory'])
      : resolveSqlTable(payload, tableName, ['id', 'inventory_quantity'])

  if (table) {
    const column = quoteIdentifier(variant !== undefined ? 'inventory' : 'inventory_quantity')
    const row =
      variant !== undefined
        ? `"_parent_id" = ${idLiteral(productId)} AND "name" = ${stringLiteral(variant)}`
        : `"id" = ${idLiteral(productId)}`
    const enough = needed > 0 ? ` AND COALESCE(${column}, 0) >= ${numberLiteral(needed)}` : ''

    return await runSqlUpdate(
      payload,
      `UPDATE ${table} SET ${column} = COALESCE(${column}, 0) + (${numberLiteral(delta)}) WHERE ${row}${enough} RETURNING "id"`,
      req,
    )
  }

  // Non-atomic fallback: read, check, write.
  const product = await payload.findByID({
    id: productId,
    collection: productsSlug,
    depth: 0,
    disableErrors: true,
    overrideAccess: true,
    req,
  })
  if (!product) {
    return false
  }

  if (variant !== undefined) {
    const variants: Array<{ inventory?: null | number; name?: string }> = [...(product.variants || [])]
    const index = variants.findIndex((candidate) => candidate.name === variant)
    if (index === -1 || (variants[index].inventory || 0) < needed) {
      return false
    }
    variants[index] = { ...variants[index], inventory: (variants[index].inventory || 0) + delta }
    await payload.update({ id: productId, collection: productsSlug, data: { variants }, overrideAccess: true, req })
    return true
  }

  const quantity = product.inventory?.quantity || 0
  if (quantity < needed) {
    return false
  }
  await payload.update({
    id: productId,
    collection: productsSlug,
    data: { inventory: { ...product.inventory, quantity: quantity + delta } },
    overrideAccess: true,
    req,
  })
  return true
}

export interface AdjustCouponUsageParams {
  couponsSlug: string
  couponId: DocumentId
  /** +1 when an order uses the coupon, −1 when that order is cancelled or refunded. */
  delta: -1 | 1
  req?: PayloadRequest
}

/**
 * Changes a coupon's `usageCount` by one in a single atomic step. Counting a use returns
 * `false`, leaving the count untouched, when the coupon's `usageLimit` is already reached,
 * so concurrent orders cannot take a coupon past its limit. Giving a use back returns
 * `false` when the count is already 0. Both return `false` when the coupon does not exist.
 */
export const adjustCouponUsage = async (
  payload: Payload,
  { couponsSlug, couponId, delta, req }: AdjustCouponUsageParams,
): Promise<boolean> => {
  const db = internals(payload)

  if (db.name === 'mongoose') {
    if (delta < 0) {
      return await runMongoUpdate(
        payload,
        couponsSlug,
        { _id: couponId, usageCount: { $gt: 0 } },
        { $inc: { usageCount: -1 } },
        req,
      )
    }

    const underLimit = {
      $or: [
        // No limit: the field is missing, null or 0.
        { usageLimit: { $in: [null, 0] } },
        { $expr: { $lt: [{ $ifNull: ['$usageCount', 0] }, '$usageLimit'] } },
      ],
    }
    const counted = await runMongoUpdate(
      payload,
      couponsSlug,
      { _id: couponId, usageCount: { $type: 'number' }, ...underLimit },
      { $inc: { usageCount: 1 } },
      req,
    )
    if (counted) {
      return true
    }

    // A coupon whose usageCount is missing or null ($inc cannot add to null): first use.
    return await runMongoUpdate(
      payload,
      couponsSlug,
      { _id: couponId, usageCount: { $not: { $type: 'number' } }, ...underLimit },
      { $set: { usageCount: 1 } },
      req,
    )
  }

  const table = resolveSqlTable(payload, toSnakeCase(couponsSlug), ['id', 'usage_count', 'usage_limit'])
  if (table) {
    const condition =
      delta < 0
        ? `COALESCE("usage_count", 0) > 0`
        : `(COALESCE("usage_limit", 0) = 0 OR COALESCE("usage_count", 0) < "usage_limit")`

    return await runSqlUpdate(
      payload,
      `UPDATE ${table} SET "usage_count" = COALESCE("usage_count", 0) + (${numberLiteral(delta)}) WHERE "id" = ${idLiteral(couponId)} AND ${condition} RETURNING "id"`,
      req,
    )
  }

  // Non-atomic fallback: read, check, write.
  const coupon = await payload.findByID({
    id: couponId,
    collection: couponsSlug,
    depth: 0,
    disableErrors: true,
    overrideAccess: true,
    req,
  })
  if (!coupon) {
    return false
  }

  const usageCount = coupon.usageCount || 0
  if (delta < 0 ? usageCount <= 0 : Boolean(coupon.usageLimit) && usageCount >= coupon.usageLimit) {
    return false
  }
  await payload.update({
    id: couponId,
    collection: couponsSlug,
    data: { usageCount: usageCount + delta },
    overrideAccess: true,
    req,
  })
  return true
}

/**
 * The order fields that record what an order still holds: `inventoryReduced` while it
 * holds stock, `couponUsageCounted` while it counts as a use of its coupon.
 */
export type OrderHoldFlag = 'couponUsageCounted' | 'inventoryReduced'

export interface ClaimOrderReleaseParams {
  ordersSlug: string
  orderId: DocumentId
  flag: OrderHoldFlag
  req?: PayloadRequest
}

/**
 * Clears one of an order's hold flags in a single atomic step and tells whether this call
 * was the one that cleared it. Only the caller that gets `true` may give back what the flag
 * stands for (the order's stock, or its coupon use): when an order is cancelled and
 * refunded at the same moment, or cancelled twice, every caller but one gets `false`.
 * Also returns `false` when the flag was not set or the order does not exist.
 */
export const claimOrderRelease = async (
  payload: Payload,
  { ordersSlug, orderId, flag, req }: ClaimOrderReleaseParams,
): Promise<boolean> => {
  const db = internals(payload)

  if (db.name === 'mongoose') {
    return await runMongoUpdate(
      payload,
      ordersSlug,
      { _id: orderId, [flag]: true },
      { $set: { [flag]: false } },
      req,
    )
  }

  const columnName = toSnakeCase(flag)
  const table = resolveSqlTable(payload, toSnakeCase(ordersSlug), ['id', columnName])
  if (table) {
    const column = quoteIdentifier(columnName)

    return await runSqlUpdate(
      payload,
      `UPDATE ${table} SET ${column} = FALSE WHERE "id" = ${idLiteral(orderId)} AND ${column} = TRUE RETURNING "id"`,
      req,
    )
  }

  // Non-atomic fallback: read, check, write. Two simultaneous callers can both read the
  // flag as set and both be told they cleared it.
  const order = await payload.findByID({
    id: orderId,
    collection: ordersSlug,
    depth: 0,
    disableErrors: true,
    overrideAccess: true,
    req,
  })
  if (!order?.[flag]) {
    return false
  }
  // The whole document is written back because not every adapter can update one field of
  // a document that has required fields.
  const { id: _id, ...fields } = order
  await payload.db.updateOne({
    id: orderId,
    collection: ordersSlug,
    data: { ...fields, [flag]: false },
    req,
  })
  return true
}
