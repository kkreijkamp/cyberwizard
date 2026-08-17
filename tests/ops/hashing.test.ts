import { describe, expect, it } from 'vitest'
import { bytesOf, runOp, textOf } from './run-op'
import '../../src/nodes'

describe('sha family', () => {
  it.each([
    ['hashing/sha-1', 'a9993e364706816aba3e25717850c26c9cd0d89d'],
    ['hashing/sha-256', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
    [
      'hashing/sha-512',
      'ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f',
    ],
  ])('%s("abc") matches the FIPS vector', async (type, expected) => {
    expect((await runOp(type, { data: bytesOf('abc') })).hex).toBe(expected)
  })

  it('digest output is the raw bytes of the hex output', async () => {
    const { digest, hex } = await runOp('hashing/sha-256', { data: bytesOf('abc') })
    expect(textOf(digest as Uint8Array)).not.toBe(hex)
    expect((digest as Uint8Array).length).toBe(32)
    expect(typeof hex).toBe('string')
  })
})

describe('md5', () => {
  it('RFC 1321 vector', async () => {
    expect((await runOp('hashing/md5', { data: bytesOf('abc') })).hex)
      .toBe('900150983cd24fb0d6963f7d28e17f72')
  })
})

describe('hmac', () => {
  it('RFC 4231 test case 2 equivalent', async () => {
    const { hex } = await runOp(
      'hashing/hmac',
      { data: bytesOf('The quick brown fox jumps over the lazy dog'), key: bytesOf('key') },
      { hash: 'SHA-256' },
    )
    expect(hex).toBe('f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8')
  })

  it('different keys give different macs', async () => {
    const data = bytesOf('msg')
    const a = (await runOp('hashing/hmac', { data, key: bytesOf('k1') })).hex
    const b = (await runOp('hashing/hmac', { data, key: bytesOf('k2') })).hex
    expect(a).not.toBe(b)
  })
})
