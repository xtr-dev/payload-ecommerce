export interface OrderTotalParts {
  /** Sum of the order's line totals, before discount, tax and shipping. */
  subtotal?: null | number
  /** Amount taken off the subtotal, for example by a coupon. */
  discount?: null | number
  /** Tax amount, as returned by the `calculateTax` hook or passed in by the caller. */
  tax?: null | number
  /** Shipping cost. */
  shipping?: null | number
}

/**
 * Reads one part of an order total. A missing, null or non-numeric part counts as 0 so
 * that an order saved without, say, a shipping cost still gets a numeric total.
 */
const amount = (value: null | number | undefined): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0

/**
 * The only place an order's `total` is computed: subtotal − discount + tax + shipping.
 *
 * The result is never negative (a discount larger than the rest of the order gives 0) and
 * is rounded to six decimals. That rounding only removes binary floating point noise such
 * as 0.1 + 0.2 = 0.30000000000000004; it is not currency rounding, which is left to the
 * caller because the number of minor units differs per currency.
 */
export const calculateOrderTotal = (parts: OrderTotalParts): number => {
  const total =
    amount(parts.subtotal) - amount(parts.discount) + amount(parts.tax) + amount(parts.shipping)

  return Math.max(0, Math.round(total * 1e6) / 1e6)
}
