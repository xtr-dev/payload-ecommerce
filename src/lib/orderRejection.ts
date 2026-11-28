import type { PayloadRequest } from 'payload'

import { ValidationError } from 'payload'

import type { CouponRefusalReason } from './coupons.js'
import type { DocumentId } from './relationships.js'

/**
 * An order that was refused because of its coupon. `reason` is the same value
 * `validateCoupon` reports for that coupon.
 */
export interface CouponOrderRejection {
  type: 'coupon'
  reason: CouponRefusalReason
  /**
   * The coupon's minimum subtotal, as stored (in the shop's money unit). Only set when
   * `reason` is `min_purchase`.
   */
  minPurchase?: number
}

/** An order that was refused because it asks for more units than are in stock. */
export interface StockOrderRejection {
  type: 'stock'
  reason: 'out_of_stock'
  /** Id of the product that is short. */
  product: DocumentId
  /**
   * Name of the variant whose own stock is short. Absent when the product's own quantity
   * is short, which is also the case for a variant without a stock number of its own.
   */
  variant?: string
  /** Units the order asks for, added up over all of its lines that draw from this stock. */
  requested: number
  /**
   * Units in stock when the order was checked. Absent when the order passed that check
   * and then lost the last units to a simultaneous order: the number that was read is
   * out of date by then. Read the product again to show a current number.
   */
  available?: number
}

/**
 * Why the plugin refused to create an order, for code that reacts to the cause or words
 * its own message instead of showing the English one. `type` tells the kinds apart;
 * `reason` is unique across them, so it can be switched on directly as well.
 */
export type OrderRejection = CouponOrderRejection | StockOrderRejection

/**
 * The error that rejects an order because of its stock or its coupon.
 *
 * It is a Payload ValidationError, so the admin panel and the REST API report it on the
 * given field with status 400, and its `name` stays `'ValidationError'` for code that
 * checks that. Two things differ from a plain ValidationError:
 *
 * - `message` is the reason itself. Payload's own message only says which field is
 *   invalid, which tells a caller of the Local API nothing about what to change.
 * - The cause is available in machine-readable form as `rejection`. It is also put on
 *   `data.rejection`, because `data` is what Payload sends in a REST or GraphQL error
 *   response, so a client of those APIs can read it too.
 */
export class OrderRejectedError extends ValidationError {
  rejection: OrderRejection

  constructor(args: {
    collection: string
    message: string
    path: 'coupon' | 'items'
    rejection: OrderRejection
    req?: PayloadRequest
  }) {
    super({ collection: args.collection, errors: [{ message: args.message, path: args.path }] }, args.req?.t)
    this.message = args.message
    this.rejection = args.rejection
    ;(this.data as Record<string, unknown>).rejection = args.rejection
  }
}

/**
 * Returns why an order was rejected when `error` is the plugin's rejection of an order
 * for its stock or coupon, and `undefined` for any other error (a missing address, a
 * failing hook, a database error).
 *
 * Prefer this over `instanceof OrderRejectedError`: it reads the rejection from the
 * error's `data`, so it also recognises an error thrown by a second copy of this package
 * in the bundle, and the `errors[0]` entry of a REST error response.
 */
export const getOrderRejection = (error: unknown): OrderRejection | undefined => {
  if (typeof error !== 'object' || error === null) {
    return undefined
  }

  const { data, rejection } = error as { data?: { rejection?: unknown }; rejection?: unknown }
  const candidate = (rejection ?? data?.rejection) as Partial<OrderRejection> | undefined

  if (
    typeof candidate === 'object' &&
    candidate !== null &&
    (candidate.type === 'coupon' || candidate.type === 'stock') &&
    typeof candidate.reason === 'string'
  ) {
    return candidate as OrderRejection
  }

  return undefined
}
