import { describe, expect, it } from 'vitest'
import '../../src/nodes'
import { runOp } from './run-op'

describe('flow/list ops', () => {
  it('packs only the connected slots, in order', async () => {
    const node = { inputs: [{ link: 1 }, { link: null }, { link: 3 }] } as never
    const out = await runOp('flow/list-pack', { a: 'x', b: 'skipped', c: 42 }, {}, { node })
    expect(out.items).toEqual(['x', 42])
  })

  it('gets elements by index, negatives from the end', async () => {
    expect((await runOp('flow/list-get', { items: ['a', 'b', 'c'], index: 0 })).element).toBe('a')
    expect((await runOp('flow/list-get', { items: ['a', 'b', 'c'], index: 2 })).element).toBe('c')
    expect((await runOp('flow/list-get', { items: ['a', 'b', 'c'], index: -1 })).element).toBe('c')
    expect((await runOp('flow/list-get', { items: ['a', 'b', 'c'], index: -3 })).element).toBe('a')
  })

  it('errors on out-of-range index and missing index input', async () => {
    await expect(runOp('flow/list-get', { items: ['a'], index: 5 })).rejects.toThrow(/out of range/)
    await expect(runOp('flow/list-get', { items: ['a'], index: -2 })).rejects.toThrow(/out of range/)
    await expect(runOp('flow/list-get', { items: ['a'] })).rejects.toThrow(/not connected/)
  })

  it('takes and drops the first n items', async () => {
    expect((await runOp('flow/list-take', { items: [1, 2, 3, 4] }, { n: 2 })).items).toEqual([1, 2])
    expect((await runOp('flow/list-drop', { items: [1, 2, 3, 4] }, { n: 2 })).items).toEqual([3, 4])
    expect((await runOp('flow/list-take', { items: [1] }, { n: 99 })).items).toEqual([1])
    expect((await runOp('flow/list-drop', { items: undefined })).items).toEqual([])
  })

  it('reverses without mutating the input', async () => {
    const items = [1, 2, 3]
    expect((await runOp('flow/list-reverse', { items })).items).toEqual([3, 2, 1])
    expect(items).toEqual([1, 2, 3])
  })

  it('dedups stably — primitives, bytes, and objects', async () => {
    const out = await runOp('flow/list-unique', {
      items: ['a', 'b', 'a', 1, 2, 1, '1', { x: 1 }, { x: 1 }, new Uint8Array([1, 2]), new Uint8Array([1, 2])],
    })
    expect(out.items).toEqual(['a', 'b', 1, 2, '1', { x: 1 }, new Uint8Array([1, 2])])
  })

  it('sorts numbers numerically, ascending and descending', async () => {
    expect((await runOp('flow/list-sort', { items: [10, 2, 1, 20] })).items).toEqual([1, 2, 10, 20])
    expect((await runOp('flow/list-sort', { items: [10, 2, 1, 20] }, { order: 'desc' })).items).toEqual([20, 10, 2, 1])
  })

  it('sorts strings lexicographically and mixed lists by repr', async () => {
    expect((await runOp('flow/list-sort', { items: ['pear', 'apple', 'fig'] })).items).toEqual(['apple', 'fig', 'pear'])
    const mixed = (await runOp('flow/list-sort', { items: ['b', 10, 'a', 2] })).items as unknown[]
    expect(mixed.map(String)).toEqual(['10', '2', 'a', 'b']) // repr order: '10' < '2' < 'a' < 'b'
  })

  it('flattens one level, passing non-lists through', async () => {
    expect((await runOp('flow/list-flatten', { items: [[1, 2], 3, [4, [5, 6]]] })).items).toEqual([1, 2, 3, 4, [5, 6]])
    expect((await runOp('flow/list-flatten', { items: [] })).items).toEqual([])
  })

  it('zips to the shorter list', async () => {
    expect((await runOp('flow/list-zip', { a: [1, 2, 3], b: ['a', 'b'] })).pairs).toEqual([[1, 'a'], [2, 'b']])
  })

  it('concats lists', async () => {
    expect((await runOp('flow/list-concat', { a: [1, 2], b: [3] })).items).toEqual([1, 2, 3])
    expect((await runOp('flow/list-concat', { a: undefined, b: [3] })).items).toEqual([3])
  })

  it('generates ranges and guards bad params', async () => {
    expect((await runOp('flow/list-range', {}, { start: 1, count: 4, step: 2 })).items).toEqual([1, 3, 5, 7])
    expect((await runOp('flow/list-range', {}, { count: 3 })).items).toEqual([0, 1, 2])
    await expect(runOp('flow/list-range', {}, { step: 0 })).rejects.toThrow(/step/)
    await expect(runOp('flow/list-range', {}, { count: 2_000_000 })).rejects.toThrow(/too large/)
  })
})
