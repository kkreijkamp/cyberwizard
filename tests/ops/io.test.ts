import { describe, expect, it } from 'vitest'
import { runOp } from './run-op'
import '../../src/nodes'

describe('io ops', () => {
  it('number input emits its param', async () => {
    expect((await runOp('io/number-input', {}, { value: 42 })).number).toBe(42)
  })

  it('integer input rounds decimals to whole numbers', async () => {
    expect((await runOp('io/integer-input', {}, { value: 42 })).number).toBe(42)
    expect((await runOp('io/integer-input', {}, { value: 3.7 })).number).toBe(4)
    expect((await runOp('io/integer-input', {}, { value: -3.7 })).number).toBe(-4)
    expect((await runOp('io/integer-input')).number).toBe(0)
  })

  it('file input yields empty bytes and name before a file is chosen', async () => {
    const out = await runOp('io/file-input')
    expect(out.data).toEqual(new Uint8Array())
    expect(out.name).toBe('')
  })

  it('download run is a no-op outside the browser', async () => {
    await expect(runOp('io/download', { data: new Uint8Array([1]) })).resolves.toEqual({})
  })
})
