import { describe, expect, it } from 'vitest'
import { runOp } from './run-op'
import '../../src/nodes'

describe('crypto/random-bytes', () => {
  it('produces exactly count bytes', async () => {
    for (const count of [1, 16, 32, 100]) {
      const { bytes, hex } = await runOp('crypto/random-bytes', {}, { count })
      expect((bytes as Uint8Array).length).toBe(count)
      expect((hex as string).length).toBe(count * 2)
    }
  })

  it('two runs never match (CSPRNG)', async () => {
    const a = (await runOp('crypto/random-bytes', {}, { count: 16 })).hex
    const b = (await runOp('crypto/random-bytes', {}, { count: 16 })).hex
    expect(a).not.toBe(b)
  })

  it('rejects silly counts', async () => {
    await expect(runOp('crypto/random-bytes', {}, { count: 0 })).rejects.toThrow(/1–65536/)
  })
})
