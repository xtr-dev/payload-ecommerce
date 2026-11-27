import type { Payload } from 'payload'

import { ECOMMERCE_CUSTOM_KEY } from './slugs.js'

/**
 * Rounds an amount of money to the smallest unit the shop charges in. The plugin calls it
 * for every amount it calculates itself: a coupon's discount, the result of the
 * `calculateTax` hook and an order's total.
 */
export type RoundMoney = (amount: number) => number

/**
 * The default rounding: to two decimals, for prices stored in major units (19.99). The
 * small offset makes values such as 1.005, which binary floating point stores just below
 * the half, round up as expected. A shop that stores integer minor units (1999 cents)
 * passes `roundMoney: Math.round` to the plugin instead.
 */
export const roundToTwoDecimals: RoundMoney = (amount) =>
  Math.round((amount + Math.sign(amount) * Number.EPSILON) * 100) / 100

/**
 * Returns the `roundMoney` function the plugin was configured with, read from the Payload
 * config where the plugin recorded it, so hooks and helpers round the same way.
 */
export const getRoundMoney = (payload: Payload): RoundMoney => {
  const custom = payload.config.custom?.[ECOMMERCE_CUSTOM_KEY] as { roundMoney?: RoundMoney } | undefined

  return typeof custom?.roundMoney === 'function' ? custom.roundMoney : roundToTwoDecimals
}
