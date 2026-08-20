import { describe, expect, it } from 'vitest'
import { coerce } from '../../src/core/coerce'
import { BYTES, NUMBER } from '../../src/core/types'
import { bytesOf, runOp, textOf } from './run-op'
import '../../src/nodes'

describe('rot13', () => {
  it('rotates letters, leaves the rest, self-inverse', async () => {
    expect((await runOp('logic/rot13', { text: 'Hello, Wizard!' })).text).toBe('Uryyb, Jvmneq!')
    expect((await runOp('logic/rot13', { text: 'Uryyb, Jvmneq!' })).text).toBe('Hello, Wizard!')
  })
})

describe('reverse', () => {
  it('reverses by code point', async () => {
    expect((await runOp('logic/reverse', { text: 'abc' })).text).toBe('cba')
    expect((await runOp('logic/reverse', { text: 'a🧙b' })).text).toBe('b🧙a')
  })
})

describe('json', () => {
  it('parses and stringifies with indent', async () => {
    expect((await runOp('data/json-parse', { text: '{"a":[1,2]}' })).value).toEqual({ a: [1, 2] })
    expect((await runOp('data/json-stringify', { value: { a: 1 } }, { indent: 2 })).text)
      .toBe('{\n  "a": 1\n}')
    expect((await runOp('data/json-stringify', { value: [1] }, { indent: 0 })).text).toBe('[1]')
  })

  it('parse errors surface as node errors', async () => {
    await expect(runOp('data/json-parse', { text: '{nope' })).rejects.toThrow()
  })

  it('picks dot and bracket paths', async () => {
    const value = { a: { b: [10, 20, { c: 'deep' }] } }
    expect((await runOp('data/json-pick', { value }, { path: 'a.b[1]' })).picked).toBe(20)
    expect((await runOp('data/json-pick', { value }, { path: 'a.b[2].c' })).picked).toBe('deep')
    expect((await runOp('data/json-pick', { value }, { path: '' })).picked).toEqual(value)
    expect((await runOp('data/json-pick', { value }, { path: 'missing' })).picked).toBeUndefined()
  })
})

describe('to/from bytes', () => {
  it('round-trips strings and passes bytes through', async () => {
    expect((await runOp('data/to-bytes', { value: 'hé' })).data).toEqual(bytesOf('hé'))
    const raw = new Uint8Array([1, 2])
    expect((await runOp('data/to-bytes', { value: raw })).data).toBe(raw)
    expect((await runOp('data/from-bytes', { data: bytesOf('hé') })).text).toBe('hé')
  })

  it('serialises non-strings as json', async () => {
    expect((await runOp('data/to-bytes', { value: { a: 1 } })).data).toEqual(bytesOf('{"a":1}'))
  })
})

describe('boolean combinators', () => {
  it('and / or over both inputs', async () => {
    expect((await runOp('logic/and', { a: true, b: true })).result).toBe(true)
    expect((await runOp('logic/and', { a: true, b: false })).result).toBe(false)
    expect((await runOp('logic/or', { a: false, b: true })).result).toBe(true)
    expect((await runOp('logic/or', { a: false, b: false })).result).toBe(false)
  })

  it('unwired inputs act as the identity (true for and, false for or)', async () => {
    expect((await runOp('logic/and', { a: true })).result).toBe(true)
    expect((await runOp('logic/and', { a: false })).result).toBe(false)
    expect((await runOp('logic/or', { b: true })).result).toBe(true)
    expect((await runOp('logic/or', {})).result).toBe(false)
  })

  it('not inverts, unwired acts as false', async () => {
    expect((await runOp('logic/not', { value: true })).result).toBe(false)
    expect((await runOp('logic/not', { value: false })).result).toBe(true)
    expect((await runOp('logic/not', {})).result).toBe(true)
  })
})

describe('to-bytes on numbers (big-endian)', () => {
  it('encodes integers as minimal big-endian bytes', async () => {
    expect((await runOp('data/to-bytes', { value: 255 })).data).toEqual(new Uint8Array([0xff]))
    expect((await runOp('data/to-bytes', { value: 8010 })).data).toEqual(new Uint8Array([0x1f, 0x4a]))
    expect((await runOp('data/to-bytes', { value: 0 })).data).toEqual(new Uint8Array([0x00]))
    expect((await runOp('data/to-bytes', { value: 3.9 })).data).toEqual(new Uint8Array([0x03])) // truncates
  })

  it('round-trips through the bytes→number coercion', async () => {
    expect(coerce((await runOp('data/to-bytes', { value: 8010 })).data, BYTES, NUMBER)).toBe(8010)
  })

  it('errors on negative and non-finite numbers', async () => {
    await expect(runOp('data/to-bytes', { value: -1 })).rejects.toThrow(/negative/)
    await expect(runOp('data/to-bytes', { value: Number.NaN })).rejects.toThrow(/non-finite/)
  })
})

describe('logic gates on bytes (bitwise)', () => {
  it('and / or are bitwise, left-padding the shorter operand', async () => {
    expect((await runOp('logic/and', { a: new Uint8Array([0x0f]), b: new Uint8Array([0xf0]) })).result)
      .toEqual(new Uint8Array([0x00]))
    expect((await runOp('logic/or', { a: new Uint8Array([0x0f]), b: new Uint8Array([0xf0]) })).result)
      .toEqual(new Uint8Array([0xff]))
    expect((await runOp('logic/and', { a: new Uint8Array([0xff, 0x0f]), b: new Uint8Array([0x0f]) })).result)
      .toEqual(new Uint8Array([0x00, 0x0f])) // b left-padded: [ff 0f] & [00 0f]
  })

  it('accepts numbers and hex strings as gate operands', async () => {
    expect((await runOp('logic/and', { a: new Uint8Array([0xff]), b: 15 })).result)
      .toEqual(new Uint8Array([0x0f]))
    expect((await runOp('logic/or', { a: new Uint8Array([0x0f]), b: 'f0' })).result)
      .toEqual(new Uint8Array([0xff]))
  })

  it('unwired input acts as the identity (the other operand passes through)', async () => {
    expect((await runOp('logic/and', { a: new Uint8Array([0xab]) })).result).toEqual(new Uint8Array([0xab]))
    expect((await runOp('logic/or', { a: new Uint8Array([0xab]) })).result).toEqual(new Uint8Array([0xab]))
  })

  it('not inverts every byte, keeping the length', async () => {
    expect((await runOp('logic/not', { value: new Uint8Array([0x0f, 0xff, 0x00]) })).result)
      .toEqual(new Uint8Array([0xf0, 0x00, 0xff]))
  })

  it('booleans keep their logical behavior', async () => {
    expect((await runOp('logic/and', { a: true, b: false })).result).toBe(false)
    expect((await runOp('logic/or', { a: true, b: false })).result).toBe(true)
    expect((await runOp('logic/not', { value: true })).result).toBe(false)
  })
})
