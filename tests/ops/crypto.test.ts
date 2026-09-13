import { describe, expect, it } from 'vitest'
import { bytesToHex, hexToBytes } from '../../src/core/binary'
import { bytesOf, runOp, textOf } from './run-op'
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

describe('aes-gcm', () => {
  // McGrew & Viega NIST GCM test case 4: all-zero 128-bit key/nonce, 16 zero
  // bytes of plaintext → known ciphertext+tag (WebCrypto appends the tag).
  const KEY = hexToBytes('00000000000000000000000000000000')
  const IV = hexToBytes('000000000000000000000000')
  const PLAIN = new Uint8Array(16)
  const EXPECTED = '0388dace60b6a392f328c2b971b2fe78ab6e47d42cec13bdf53a67b21257bddf'

  it('matches the NIST GCM test vector', async () => {
    const { ciphertext, iv } = await runOp('crypto/aes-gcm-encrypt', { data: PLAIN, key: KEY, iv: IV })
    expect(bytesToHex(ciphertext as Uint8Array)).toBe(EXPECTED)
    expect(iv).toEqual(IV)
  })

  it('decrypts the NIST vector back', async () => {
    const { plaintext } = await runOp('crypto/aes-gcm-decrypt', { ciphertext: hexToBytes(EXPECTED), key: KEY, iv: IV })
    expect(plaintext).toEqual(PLAIN)
  })

  it('round-trips with a random key and generated nonce', async () => {
    const key = crypto.getRandomValues(new Uint8Array(32))
    const { ciphertext, iv } = await runOp('crypto/aes-gcm-encrypt', { data: bytesOf('attack at dawn'), key })
    expect((iv as Uint8Array).length).toBe(12) // generated
    const { plaintext } = await runOp('crypto/aes-gcm-decrypt', { ciphertext, key, iv })
    expect(textOf(plaintext)).toBe('attack at dawn')
  })

  it('authenticates: wrong key, nonce, or AAD fails decryption', async () => {
    const key = crypto.getRandomValues(new Uint8Array(16))
    const aad = bytesOf('header')
    const { ciphertext, iv } = await runOp('crypto/aes-gcm-encrypt', { data: bytesOf('msg'), key, aad })
    const wrongKey = crypto.getRandomValues(new Uint8Array(16))
    await expect(runOp('crypto/aes-gcm-decrypt', { ciphertext, key: wrongKey, iv, aad })).rejects.toThrow(/decryption failed/)
    await expect(runOp('crypto/aes-gcm-decrypt', { ciphertext, key, iv: new Uint8Array(12), aad })).rejects.toThrow(/decryption failed/)
    await expect(runOp('crypto/aes-gcm-decrypt', { ciphertext, key, iv, aad: bytesOf('other') })).rejects.toThrow(/decryption failed/)
    // …and the right AAD succeeds.
    const { plaintext } = await runOp('crypto/aes-gcm-decrypt', { ciphertext, key, iv, aad })
    expect(textOf(plaintext)).toBe('msg')
  })

  it('rejects bad key lengths with a clear error', async () => {
    await expect(runOp('crypto/aes-gcm-encrypt', { data: PLAIN, key: new Uint8Array(5), iv: IV })).rejects.toThrow(/16, 24 or 32 bytes.*got 5/)
  })
})
