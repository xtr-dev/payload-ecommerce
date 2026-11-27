import type { Payload } from 'payload'

import type { DocumentId } from './relationships.js'

/**
 * Converts a document id to the type the collection stores its ids in, so that an id that
 * arrived as text (from a URL, a form field or a JSON body) can be used as is.
 *
 * SQL adapters (SQLite, Postgres) use numeric ids by default and reject `'5'` where a
 * relationship expects `5`; MongoDB uses text ids. The type is the collection's custom id
 * field type when it has one, else the adapter's default. A value that cannot be an id of
 * that type (for example `'abc'` for a numeric id) is returned unchanged, and Payload then
 * reports it as invalid or not found, as it would have without this function.
 */
export const toDocumentId = <T extends DocumentId | null | undefined>(
  payload: Payload,
  collectionSlug: string,
  id: T,
): DocumentId | T => {
  const idType = payload.collections[collectionSlug]?.customIDType ?? payload.db.defaultIDType

  if (idType === 'number' && typeof id === 'string' && /^\d+$/.test(id)) {
    const numeric = Number(id)
    return Number.isSafeInteger(numeric) ? numeric : id
  }

  if (idType === 'text' && typeof id === 'number') {
    return String(id)
  }

  return id
}
