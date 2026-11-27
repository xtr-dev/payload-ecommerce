/**
 * A Payload document id: a string on MongoDB, a number on SQLite and Postgres
 * (unless the collection defines a custom id field).
 */
export type DocumentId = number | string

/**
 * Returns the document id held by a relationship field value.
 *
 * Depending on the `depth` of the operation that produced it, a relationship value is
 * either the bare id of the related document (string or number) or the populated
 * document itself, whose id is then on its `id` property. Returns `undefined` when the
 * value holds no id at all (empty relationship, or a related document that was deleted).
 */
export const getRelationshipId = (value: unknown): DocumentId | undefined => {
  if (typeof value === 'string' || typeof value === 'number') {
    return value
  }

  if (typeof value === 'object' && value !== null && 'id' in value) {
    const { id } = value
    if (typeof id === 'string' || typeof id === 'number') {
      return id
    }
  }

  return undefined
}

/**
 * Tells whether two relationship values (bare ids or populated documents) point at the
 * same document.
 *
 * Ids are compared by their string form because the same id can arrive as a number from
 * a SQL database and as a string from a URL parameter or a JSON request body.
 */
export const isSameDocument = (a: unknown, b: unknown): boolean => {
  const idA = getRelationshipId(a)
  const idB = getRelationshipId(b)

  return idA !== undefined && idB !== undefined && String(idA) === String(idB)
}
