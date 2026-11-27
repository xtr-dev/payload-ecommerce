import { describe, expect, test } from 'vitest'

import { getRelationshipId, isSameDocument } from '../src/lib/relationships.js'

describe('getRelationshipId', () => {
  test('returns a string id (MongoDB) as is', () => {
    expect(getRelationshipId('64f0c0ffee0000000000abcd')).toBe('64f0c0ffee0000000000abcd')
  })

  test('returns a numeric id (SQLite/Postgres) as is', () => {
    expect(getRelationshipId(42)).toBe(42)
    expect(getRelationshipId(0)).toBe(0)
  })

  test('returns the id of a populated document', () => {
    expect(getRelationshipId({ id: '64f0c0ffee0000000000abcd', title: 'Shirt' })).toBe(
      '64f0c0ffee0000000000abcd',
    )
    expect(getRelationshipId({ id: 42, title: 'Shirt' })).toBe(42)
  })

  test('returns undefined when the value holds no id', () => {
    expect(getRelationshipId(undefined)).toBeUndefined()
    expect(getRelationshipId(null)).toBeUndefined()
    expect(getRelationshipId({})).toBeUndefined()
    expect(getRelationshipId({ id: null })).toBeUndefined()
  })
})

describe('isSameDocument', () => {
  test('matches bare ids and populated documents in any combination', () => {
    expect(isSameDocument(42, 42)).toBe(true)
    expect(isSameDocument({ id: 42 }, 42)).toBe(true)
    expect(isSameDocument('abc', { id: 'abc' })).toBe(true)
    expect(isSameDocument({ id: 'abc' }, { id: 'abc' })).toBe(true)
  })

  test('matches a numeric id with its string form from a request', () => {
    expect(isSameDocument(42, '42')).toBe(true)
    expect(isSameDocument({ id: 42 }, '42')).toBe(true)
  })

  test('does not match different or missing ids', () => {
    expect(isSameDocument(42, 43)).toBe(false)
    expect(isSameDocument('abc', 'abd')).toBe(false)
    expect(isSameDocument(undefined, undefined)).toBe(false)
    expect(isSameDocument(null, 42)).toBe(false)
  })
})
