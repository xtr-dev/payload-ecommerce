import { createHash, randomBytes, timingSafeEqual } from 'crypto'

/** Name of the orders field that holds the order's access token. */
export const ORDER_ACCESS_TOKEN_FIELD = 'accessToken'

/**
 * Creates the secret that lets its holder see one order: 32 random bytes from the
 * operating system's generator, written as 43 URL-safe characters, so it can be put in a
 * link without encoding and cannot be guessed or derived from the order's id or number.
 */
export const generateOrderAccessToken = (): string => randomBytes(32).toString('base64url')

/**
 * Tells whether `token` is the access token of `order`.
 *
 * The comparison takes the same time whatever the candidate is, so response times do not
 * reveal how much of a guess was right: both values are hashed first, which gives
 * `timingSafeEqual` the equal-length inputs it requires without exposing the length of
 * the stored token either.
 *
 * Returns false for an order without a token (one created before the field existed, or
 * read without it), for an empty candidate and for anything that is not a string, so a
 * missing token never matches a missing candidate.
 */
export const matchesOrderAccessToken = (
  order: null | object | undefined,
  token: unknown,
): boolean => {
  const stored = (order as { accessToken?: unknown } | null | undefined)?.accessToken

  if (typeof stored !== 'string' || stored === '' || typeof token !== 'string' || token === '') {
    return false
  }

  const digest = (value: string) => createHash('sha256').update(value).digest()

  return timingSafeEqual(digest(stored), digest(token))
}
