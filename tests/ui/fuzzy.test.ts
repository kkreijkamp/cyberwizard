import { describe, expect, it } from 'vitest'
import { fuzzyMatch } from '../../src/ui/fuzzy'

describe('fuzzyMatch', () => {
  it('matches empty query against everything', () => {
    expect(fuzzyMatch('', 'anything')).toBe(true)
    expect(fuzzyMatch('', '')).toBe(true)
  })

  it('matches subsequences case-insensitively', () => {
    expect(fuzzyMatch('b64', 'Base64 Encode')).toBe(true)
    expect(fuzzyMatch('b6e', 'Base64 Encode')).toBe(true)
    expect(fuzzyMatch('SHA', 'hashing/sha-256')).toBe(true)
  })

  it('rejects non-subsequences', () => {
    expect(fuzzyMatch('xyz', 'Base64 Encode')).toBe(false)
    expect(fuzzyMatch('64b', 'Base64 Encode')).toBe(false)
  })
})
