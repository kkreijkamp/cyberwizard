import { describe, expect, it } from 'vitest'
import { CoercionError, canCoerce, coerce, utf8Encode } from '../../src/core/coerce'
import { ANY, BOOLEAN, BYTES, JSON as JSON_TYPE, NUMBER, STRING, listOf, repr } from '../../src/core/types'

describe('canCoerce', () => {
  it('allows identity and any', () => {
    expect(canCoerce(STRING, STRING)).toBe(true)
    expect(canCoerce(BYTES, ANY)).toBe(true)
    expect(canCoerce(ANY, NUMBER)).toBe(true)
  })

  it('allows the utf-8 bridge and scalar rendering', () => {
    expect(canCoerce(STRING, BYTES)).toBe(true)
    expect(canCoerce(BYTES, STRING)).toBe(true)
    expect(canCoerce(NUMBER, STRING)).toBe(true)
    expect(canCoerce(BOOLEAN, BYTES)).toBe(true)
  })

  it('allows parsing and serialising', () => {
    expect(canCoerce(STRING, NUMBER)).toBe(true)
    expect(canCoerce(STRING, JSON_TYPE)).toBe(true)
    expect(canCoerce(BYTES, NUMBER)).toBe(true) // unsigned big-endian
    expect(canCoerce(BYTES, JSON_TYPE)).toBe(true)
    expect(canCoerce(JSON_TYPE, STRING)).toBe(true)
    expect(canCoerce(JSON_TYPE, BYTES)).toBe(true)
  })

  it('allows list lifting and element-wise list conversion', () => {
    expect(canCoerce(STRING, listOf(NUMBER))).toBe(true)
    expect(canCoerce(listOf(STRING), listOf(NUMBER))).toBe(true)
    expect(canCoerce(listOf(BYTES), listOf(NUMBER))).toBe(true) // element-wise big-endian
    expect(canCoerce(BYTES, listOf(NUMBER))).toBe(true) // lift, then big-endian
  })

  it('rejects the impossible', () => {
    expect(canCoerce(NUMBER, JSON_TYPE)).toBe(false)
  })
})

describe('coerce', () => {
  it('round-trips string → bytes → string', () => {
    const s = 'héllo 🧙'
    expect(coerce(coerce(s, STRING, BYTES), BYTES, STRING)).toBe(s)
  })

  it('decodes invalid utf-8 lossily instead of throwing', () => {
    const out = coerce(new Uint8Array([0xff, 0x61]), BYTES, STRING)
    expect(out).toBe('�a')
  })

  it('renders scalars as strings/bytes', () => {
    expect(coerce(42, NUMBER, STRING)).toBe('42')
    expect(coerce(false, BOOLEAN, STRING)).toBe('false')
    expect(coerce(42, NUMBER, BYTES)).toEqual(new Uint8Array([52, 50]))
  })

  it('parses strings', () => {
    expect(coerce(' 3.14 ', STRING, NUMBER)).toBe(3.14)
    expect(coerce('true', STRING, BOOLEAN)).toBe(true)
    expect(() => coerce('xyz', STRING, NUMBER)).toThrow(CoercionError)
    expect(() => coerce('yes', STRING, BOOLEAN)).toThrow(CoercionError)
  })

  it('parses hex strings to numbers — decimal wins, bare hex with letters falls back', () => {
    expect(coerce('0x1f', STRING, NUMBER)).toBe(31) // Number() handles the prefixes
    expect(coerce('0b101', STRING, NUMBER)).toBe(5)
    expect(coerce('1f', STRING, NUMBER)).toBe(31)
    expect(coerce('FF', STRING, NUMBER)).toBe(255)
    expect(coerce('abc', STRING, NUMBER)).toBe(2748)
    expect(coerce('deadbeef', STRING, NUMBER)).toBe(0xdeadbeef)
    expect(coerce('-ff', STRING, NUMBER)).toBe(-255)
    expect(coerce('1e5', STRING, NUMBER)).toBe(100000) // decimal scientific, not hex
    expect(coerce('42', STRING, NUMBER)).toBe(42) // digit-only stays decimal
    expect(() => coerce('0x', STRING, NUMBER)).toThrow(CoercionError)
  })

  it('reads bytes as unsigned big-endian numbers', () => {
    expect(coerce(new Uint8Array([0x1f, 0x4a]), BYTES, NUMBER)).toBe(8010)
    expect(coerce(new Uint8Array([0, 1]), BYTES, NUMBER)).toBe(1)
    expect(coerce(new Uint8Array(), BYTES, NUMBER)).toBe(0)
    expect(coerce(new Uint8Array([0xff, 0xff, 0xff, 0xff]), BYTES, NUMBER)).toBe(4294967295)
    expect(coerce(new Uint8Array([1, 0, 0, 0, 0, 0]), BYTES, NUMBER)).toBe(2 ** 40) // 6 bytes: still exact
    expect(coerce(new Uint8Array([1, 0, 0, 0, 0, 0, 0, 0]), BYTES, NUMBER)).toBe(2 ** 56) // 8 bytes: magnitude right
  })

  it('parses and serialises json', () => {
    expect(coerce('{"a":1}', STRING, JSON_TYPE)).toEqual({ a: 1 })
    expect(coerce({ a: 1 }, JSON_TYPE, STRING)).toBe('{"a":1}')
    expect(coerce({ a: 1 }, JSON_TYPE, BYTES)).toEqual(coerce('{"a":1}', STRING, BYTES))
    expect(() => coerce('nope', STRING, JSON_TYPE)).toThrow(CoercionError)
  })

  it('lifts scalars into lists', () => {
    expect(coerce(5, NUMBER, listOf(NUMBER))).toEqual([5])
    expect(coerce('3', STRING, listOf(NUMBER))).toEqual([3])
  })

  it('converts lists element-wise', () => {
    expect(coerce(['1', '2'], listOf(STRING), listOf(NUMBER))).toEqual([1, 2])
    expect(() => coerce(['x'], listOf(STRING), listOf(NUMBER))).toThrow(CoercionError)
  })

  it('converts nested lists recursively', () => {
    const nested = coerce([['a', 'b'], ['c']], listOf(listOf(STRING)), listOf(listOf(BYTES)))
    expect(nested).toEqual([[utf8Encode('a'), utf8Encode('b')], [utf8Encode('c')]])
    expect(coerce([['1'], ['2']], listOf(listOf(STRING)), listOf(listOf(NUMBER)))).toEqual([[1], [2]])
    expect(() => coerce([['x']], listOf(listOf(STRING)), listOf(listOf(NUMBER)))).toThrow(CoercionError)
  })

  it('renders bytes inside lists/objects as hex in JSON output', () => {
    expect(coerce([new Uint8Array([0x48, 0x69])], listOf(BYTES), STRING)).toBe('["4869"]')
    expect(coerce({ raw: new Uint8Array([1, 2]) }, JSON_TYPE, STRING)).toBe('{"raw":"0102"}')
  })

  it('rejects impossible coercions with CoercionError', () => {
    expect(() => coerce(42, NUMBER, JSON_TYPE)).toThrow(CoercionError)
  })

  it('passes undefined through untouched', () => {
    expect(coerce(undefined, STRING, BYTES)).toBeUndefined()
  })
})

describe('repr', () => {
  it('renders values for previews', () => {
    expect(repr(undefined)).toBe('∅')
    expect(repr('abc')).toBe('abc')
    expect(repr(42)).toBe('42')
    expect(repr(new Uint8Array([0x48, 0x69]))).toBe('⟨2B⟩ 48 69')
    expect(repr([1, 2])).toContain('[2 items]')
  })

  it('renders nested lists and bytes inside lists readably', () => {
    expect(repr([['a', 'b'], ['c']])).toBe('[2 items] [2 items] a, b, [1 items] c')
    expect(repr([new Uint8Array([1])])).toBe('[1 items] ⟨1B⟩ 01')
    expect(repr([1, 2, 3, 4, 5, 6, 7])).toContain(', …')
  })
})
