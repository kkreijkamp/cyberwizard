import { describe, expect, it } from 'vitest'
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
