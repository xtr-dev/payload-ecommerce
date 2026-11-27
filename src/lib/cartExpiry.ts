import type { Payload, PayloadRequest, TaskConfig } from 'payload'

import { getEcommerceSlugs } from './slugs.js'

/** Days a cart stays usable after it was last changed. */
export const CART_LIFETIME_DAYS = 30

/** Slug of the optional jobs task that deletes expired carts. */
export const DELETE_EXPIRED_CARTS_TASK_SLUG = 'ecommerce-delete-expired-carts'

/** The moment a cart that is created or changed at `from` expires. */
export const cartExpiryFrom = (from: Date = new Date()): string => {
  const expiresAt = new Date(from)
  expiresAt.setDate(expiresAt.getDate() + CART_LIFETIME_DAYS)
  return expiresAt.toISOString()
}

/**
 * Tells whether a cart is past its `expiresAt`. A cart without an expiry date never
 * expires. The cart helpers treat an expired cart as if it did not exist.
 */
export const isCartExpired = (
  cart: null | Record<string, unknown> | undefined,
  now: Date = new Date(),
): boolean => {
  const expiresAt = cart?.expiresAt
  if (typeof expiresAt !== 'string' && !(expiresAt instanceof Date)) {
    return false
  }

  return new Date(expiresAt).getTime() <= now.getTime()
}

export interface DeleteExpiredCartsOptions {
  /** Slug of the carts collection. Default: the slug the plugin was configured with. */
  cartsSlug?: string
  /** Carts that expired at or before this moment are deleted. Default: now. */
  now?: Date
  /** Request to run the delete with, for example to join its transaction. */
  req?: PayloadRequest
}

/**
 * Deletes every cart whose `expiresAt` has passed and returns how many were deleted.
 * Nothing calls this on its own: run it from a cron job, or register the plugin's
 * `cartCleanupTask` and queue that from your jobs runner.
 */
export const deleteExpiredCarts = async (
  payload: Payload,
  { cartsSlug = getEcommerceSlugs(payload).carts, now = new Date(), req }: DeleteExpiredCartsOptions = {},
): Promise<{ deleted: number }> => {
  const result = await payload.delete({
    collection: cartsSlug,
    depth: 0,
    overrideAccess: true,
    req,
    where: { expiresAt: { less_than_equal: now.toISOString() } },
  })

  if (result.errors.length > 0) {
    throw new Error(
      `Could not delete ${result.errors.length} expired cart(s): ${result.errors
        .map((error) => error.message)
        .join('; ')}`,
    )
  }

  return { deleted: result.docs.length }
}

/**
 * When the cart cleanup task runs on its own. Same shape as an entry of a Payload task's
 * `schedule`; declared here because Payload versions before task schedules existed do not
 * export the type.
 */
export interface CartCleanupSchedule {
  /** Cron expression, for example `'0 3 * * *'` for every night at 03:00. */
  cron: string
  /** Queue the job is added to. Your jobs runner (`jobs.autoRun` or `payload jobs:run`) has to process it. */
  queue: string
}

/**
 * Builds the Payload jobs task that deletes expired carts. The plugin registers it when
 * the `cartCleanupTask` option is set; it can also be added to `jobs.tasks` by hand.
 * The task takes no input and reports the number of deleted carts as `deleted`.
 *
 * With a `schedule`, Payload queues the task itself at those times (this needs a Payload
 * version with task schedules and a jobs runner that handles schedules); without one the
 * host queues it.
 */
export const createDeleteExpiredCartsTask = (
  cartsSlug?: string,
  schedule?: CartCleanupSchedule[],
): TaskConfig<any> => ({
  slug: DELETE_EXPIRED_CARTS_TASK_SLUG,
  handler: async ({ req }: { req: PayloadRequest }) => {
    const { deleted } = await deleteExpiredCarts(req.payload, { cartsSlug, req })

    return { output: { deleted } }
  },
  label: 'Delete expired carts',
  outputSchema: [{ name: 'deleted', type: 'number' }],
  ...(schedule?.length ? { schedule } : {}),
})
