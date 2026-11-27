import type { CollectionBeforeChangeHook } from 'payload'

import { ValidationError } from 'payload'

/**
 * Turns a title into a URL slug: lower case, accents removed ("Café Crème" → "cafe-creme"),
 * every run of other characters replaced by one dash, no dash at either end. Returns an
 * empty string when the text has no letters or digits to build a slug from.
 */
export const slugify = (text: string): string =>
  text
    .normalize('NFKD')
    // Combining marks left behind by the decomposition above (the accent of "é").
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

/** How many numbered variants of a slug are tried before giving up on a readable one. */
const MAX_SUFFIX = 100

/**
 * Builds the `beforeChange` hook that fills an empty `slug` from another field of the
 * same document, shared by products (from `title`) and categories (from `name`).
 *
 * - A slug the user entered is kept exactly as entered. If it is already taken, the save
 *   is rejected with a validation error on `slug`; it is never altered silently.
 * - A generated slug that is already taken by another document gets a numeric suffix:
 *   "blue-shirt", "blue-shirt-2", "blue-shirt-3", …
 * - Clearing the slug of an existing document generates it again on that save.
 *
 * The availability check is a read, so two documents with the same title that are saved
 * at the same moment can still pick the same slug; the unique index then rejects one.
 */
export const createSlugHook =
  (sourceField: string): CollectionBeforeChangeHook =>
  async ({ collection, data, operation, originalDoc, req }) => {
    const isTaken = async (slug: string): Promise<boolean> => {
      const { totalDocs } = await req.payload.count({
        collection: collection.slug,
        req,
        where: {
          and: [
            { slug: { equals: slug } },
            // The document being updated does not compete with itself.
            ...(operation === 'update' && originalDoc?.id !== undefined
              ? [{ id: { not_equals: originalDoc.id } }]
              : []),
          ],
        },
      })

      return totalDocs > 0
    }

    if (data.slug) {
      // Checked here because not every database adapter turns a violation of the unique
      // index into a validation error; SQLite reports a raw constraint failure instead.
      const isNewValue = operation === 'create' || data.slug !== originalDoc?.slug
      if (isNewValue && (await isTaken(data.slug))) {
        const message = `The slug "${data.slug}" is already in use`
        const error = new ValidationError(
          { collection: collection.slug, errors: [{ message, path: 'slug' }] },
          req.t,
        )
        // Payload's own message only names the field; the reason is more useful to a
        // caller of the local API.
        error.message = message
        throw error
      }

      return data
    }

    if (typeof data[sourceField] !== 'string') {
      return data
    }

    const base = slugify(data[sourceField])
    if (!base) {
      return data
    }

    let candidate = base
    for (let suffix = 2; await isTaken(candidate); suffix += 1) {
      if (suffix > MAX_SUFFIX) {
        // Hundreds of documents share this title; a timestamp ends the search.
        candidate = `${base}-${Date.now()}`
        break
      }
      candidate = `${base}-${suffix}`
    }

    data.slug = candidate
    return data
  }
