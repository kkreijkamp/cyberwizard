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

describe('aes-cbc', () => {
  // NIST SP 800-38A F.2.1 CBC-AES128: known key/iv and 4 plaintext blocks.
  // WebCrypto appends a padding block, so the NIST blocks are a strict prefix.
  const KEY = hexToBytes('2b7e151628aed2a6abf7158809cf4f3c')
  const IV = hexToBytes('000102030405060708090a0b0c0d0e0f')
  const PLAIN = hexToBytes(
    '6bc1bee22e409f96e93d7e117393172a' +
      'ae2d8a571e03ac9c9eb76fac45af8e51' +
      '30c81c46a35ce411e5fbc1191a0a52ef' +
      'f69f2445df4f9b17ad2b417be66c3710',
  )
  const EXPECTED_PREFIX =
    '7649abac8119b246cee98e9b12e9197d' +
    '5086cb9b507219ee95db113a917678b2' +
    '73bed6b8e3c1743b7116e69e22229516' +
    '3ff1caa1681fac09120eca307586e1a7'

  it('matches the NIST CBC-AES128 vectors (plus a padding block)', async () => {
    const { ciphertext } = await runOp('crypto/aes-cbc-encrypt', { data: PLAIN, key: KEY, iv: IV })
    const hex = bytesToHex(ciphertext as Uint8Array)
    expect(hex.startsWith(EXPECTED_PREFIX)).toBe(true)
    expect(hex.length).toBe(EXPECTED_PREFIX.length + 32) // one PKCS#7 padding block
  })

  it('round-trips and strips padding', async () => {
    const key = crypto.getRandomValues(new Uint8Array(24))
    const { ciphertext, iv } = await runOp('crypto/aes-cbc-encrypt', { data: bytesOf('not a multiple of 16'), key })
    expect((iv as Uint8Array).length).toBe(16)
    const { plaintext } = await runOp('crypto/aes-cbc-decrypt', { ciphertext, key, iv })
    expect(textOf(plaintext)).toBe('not a multiple of 16')
  })

  it('decrypts the NIST vector prefix when given the full ciphertext', async () => {
    const { ciphertext } = await runOp('crypto/aes-cbc-encrypt', { data: PLAIN, key: KEY, iv: IV })
    const { plaintext } = await runOp('crypto/aes-cbc-decrypt', { ciphertext, key: KEY, iv: IV })
    expect(plaintext).toEqual(PLAIN)
  })

  it('rejects a bad iv length', async () => {
    await expect(runOp('crypto/aes-cbc-encrypt', { data: PLAIN, key: KEY, iv: new Uint8Array(8) })).rejects.toThrow(/exactly 16 bytes, got 8/)
  })
})

describe('rsa (OAEP)', () => {
  it('generates a key pair and round-trips a wrapped key', async () => {
    const { publicKey, privateKey } = await runOp('crypto/rsa-generate', {}, { modulus: '2048', hash: 'SHA-256', usage: 'encrypt' })
    expect((publicKey as Uint8Array).length).toBeGreaterThan(250)
    expect((privateKey as Uint8Array).length).toBeGreaterThan(1000)

    const wrapped = crypto.getRandomValues(new Uint8Array(32)) // a symmetric session key
    const { ciphertext } = await runOp('crypto/rsa-encrypt', { data: wrapped, publicKey })
    expect((ciphertext as Uint8Array).length).toBe(256) // one modulus
    const { plaintext } = await runOp('crypto/rsa-decrypt', { ciphertext, privateKey })
    expect(plaintext).toEqual(wrapped)
  })

  it('works with SHA-512 and 3072-bit keys', async () => {
    const { publicKey, privateKey } = await runOp('crypto/rsa-generate', {}, { modulus: '3072', hash: 'SHA-512', usage: 'encrypt' })
    const { ciphertext } = await runOp('crypto/rsa-encrypt', { data: bytesOf('hi'), publicKey }, { hash: 'SHA-512' })
    expect((ciphertext as Uint8Array).length).toBe(384)
    const { plaintext } = await runOp('crypto/rsa-decrypt', { ciphertext, privateKey }, { hash: 'SHA-512' })
    expect(textOf(plaintext)).toBe('hi')
  })

  it('fails to decrypt with a different key', async () => {
    const a = await runOp('crypto/rsa-generate', {}, { usage: 'encrypt' })
    const b = await runOp('crypto/rsa-generate', {}, { usage: 'encrypt' })
    const { ciphertext } = await runOp('crypto/rsa-encrypt', { data: bytesOf('secret'), publicKey: a.publicKey })
    await expect(runOp('crypto/rsa-decrypt', { ciphertext, privateKey: b.privateKey })).rejects.toThrow(/decryption failed/)
  })

  it('rejects oversized payloads with a clear error', async () => {
    const { publicKey } = await runOp('crypto/rsa-generate', {}, { modulus: '2048', hash: 'SHA-256', usage: 'encrypt' })
    const tooBig = new Uint8Array(191) // 2048/SHA-256 limit is 190
    await expect(runOp('crypto/rsa-encrypt', { data: tooBig, publicKey })).rejects.toThrow(/payload too large \(191 bytes\)/)
  })

  it('rejects garbage key material', async () => {
    await expect(runOp('crypto/rsa-encrypt', { data: bytesOf('x'), publicKey: new Uint8Array(10) })).rejects.toThrow(/not a valid RSA public/)
  })
})

describe('rsa-pss (sign/verify)', () => {
  it('signs and verifies', async () => {
    const { publicKey, privateKey } = await runOp('crypto/rsa-generate', {}, { usage: 'sign' })
    const { signature } = await runOp('crypto/rsa-sign', { data: bytesOf('message'), privateKey })
    expect((signature as Uint8Array).length).toBe(256)
    const { valid } = await runOp('crypto/rsa-verify', { data: bytesOf('message'), signature, publicKey })
    expect(valid).toBe(true)
  })

  it('rejects tampered data, wrong keys, and wrong salt lengths', async () => {
    const a = await runOp('crypto/rsa-generate', {}, { usage: 'sign' })
    const b = await runOp('crypto/rsa-generate', {}, { usage: 'sign' })
    const { signature } = await runOp('crypto/rsa-sign', { data: bytesOf('message'), privateKey: a.privateKey })

    const tampered = await runOp('crypto/rsa-verify', { data: bytesOf('massage'), signature, publicKey: a.publicKey })
    expect(tampered.valid).toBe(false)
    const wrongKey = await runOp('crypto/rsa-verify', { data: bytesOf('message'), signature, publicKey: b.publicKey })
    expect(wrongKey.valid).toBe(false)
    const wrongSalt = await runOp('crypto/rsa-verify', { data: bytesOf('message'), signature, publicKey: a.publicKey }, { saltLength: 20 })
    expect(wrongSalt.valid).toBe(false)
  })

  it('signs with SHA-512 and a custom salt length', async () => {
    const { publicKey, privateKey } = await runOp('crypto/rsa-generate', {}, { usage: 'sign', hash: 'SHA-512' })
    const { signature } = await runOp('crypto/rsa-sign', { data: bytesOf('m'), privateKey }, { hash: 'SHA-512', saltLength: 64 })
    const { valid } = await runOp('crypto/rsa-verify', { data: bytesOf('m'), signature, publicKey }, { hash: 'SHA-512', saltLength: 64 })
    expect(valid).toBe(true)
  })
})

describe('ec (ECDSA + ECDH)', () => {
  it('ECDSA signs and verifies on every curve', async () => {
    for (const curve of ['P-256', 'P-384', 'P-521']) {
      const { publicKey, privateKey } = await runOp('crypto/ec-generate', {}, { curve, usage: 'sign' })
      const { signature } = await runOp('crypto/ecdsa-sign', { data: bytesOf('message'), privateKey }, { curve })
      const { valid } = await runOp('crypto/ecdsa-verify', { data: bytesOf('message'), signature, publicKey }, { curve })
      expect(valid).toBe(true)
      const tampered = await runOp('crypto/ecdsa-verify', { data: bytesOf('massage'), signature, publicKey }, { curve })
      expect(tampered.valid).toBe(false)
    }
  })

  it('ECDH derives the same secret on both sides', async () => {
    const alice = await runOp('crypto/ec-generate', {}, { curve: 'P-256', usage: 'derive' })
    const bob = await runOp('crypto/ec-generate', {}, { curve: 'P-256', usage: 'derive' })
    const { sharedSecret: forAlice } = await runOp(
      'crypto/ecdh-derive',
      { privateKey: alice.privateKey, publicKey: bob.publicKey },
      { curve: 'P-256', length: 32 },
    )
    const { sharedSecret: forBob } = await runOp(
      'crypto/ecdh-derive',
      { privateKey: bob.privateKey, publicKey: alice.publicKey },
      { curve: 'P-256', length: 32 },
    )
    expect(forAlice).toEqual(forBob)
    expect((forAlice as Uint8Array).length).toBe(32)
  })

  it('ECDH secrets differ across pairs', async () => {
    const alice = await runOp('crypto/ec-generate', {}, { usage: 'derive' })
    const bob = await runOp('crypto/ec-generate', {}, { usage: 'derive' })
    const carol = await runOp('crypto/ec-generate', {}, { usage: 'derive' })
    const ab = (await runOp('crypto/ecdh-derive', { privateKey: alice.privateKey, publicKey: bob.publicKey })).sharedSecret
    const ac = (await runOp('crypto/ecdh-derive', { privateKey: alice.privateKey, publicKey: carol.publicKey })).sharedSecret
    expect(ab).not.toEqual(ac)
  })
})

describe('ed25519', () => {
  it('signs and verifies (deterministic 64-byte signatures)', async () => {
    const { publicKey, privateKey } = await runOp('crypto/ed25519-generate')
    const a = (await runOp('crypto/ed25519-sign', { data: bytesOf('message'), privateKey })).signature
    const b = (await runOp('crypto/ed25519-sign', { data: bytesOf('message'), privateKey })).signature
    expect(a).toEqual(b) // deterministic
    expect((a as Uint8Array).length).toBe(64)
    const { valid } = await runOp('crypto/ed25519-verify', { data: bytesOf('message'), signature: a, publicKey })
    expect(valid).toBe(true)
  })

  it('rejects tampered data and wrong keys', async () => {
    const a = await runOp('crypto/ed25519-generate')
    const b = await runOp('crypto/ed25519-generate')
    const { signature } = await runOp('crypto/ed25519-sign', { data: bytesOf('message'), privateKey: a.privateKey })
    expect((await runOp('crypto/ed25519-verify', { data: bytesOf('massage'), signature, publicKey: a.publicKey })).valid).toBe(false)
    expect((await runOp('crypto/ed25519-verify', { data: bytesOf('message'), signature, publicKey: b.publicKey })).valid).toBe(false)
  })
})

describe('kdf', () => {
  it('PBKDF2-HMAC-SHA1 matches RFC 6070', async () => {
    const { hex } = await runOp(
      'crypto/pbkdf2',
      { password: bytesOf('password'), salt: bytesOf('salt') },
      { hash: 'SHA-1', iterations: 1, length: 20 },
    )
    expect(hex).toBe('0c60c80f961f0e71f3a9b524af6012062fe037a6')
  })

  it('PBKDF2-HMAC-SHA256 matches the standard vector', async () => {
    const { hex } = await runOp(
      'crypto/pbkdf2',
      { password: bytesOf('password'), salt: bytesOf('salt') },
      { hash: 'SHA-256', iterations: 1, length: 32 },
    )
    expect(hex).toBe('120fb6cffcf8b32c43e7225256c4f837a86548c92ccc35480805987cb70be17b')
  })

  it('PBKDF2 is deterministic, salt- and iteration-sensitive', async () => {
    const args = { password: bytesOf('pw'), salt: bytesOf('s') }
    const a = (await runOp('crypto/pbkdf2', args, { iterations: 10 })).key
    expect((await runOp('crypto/pbkdf2', args, { iterations: 10 })).key).toEqual(a)
    expect((await runOp('crypto/pbkdf2', args, { iterations: 11 })).key).not.toEqual(a)
    expect((await runOp('crypto/pbkdf2', { ...args, salt: bytesOf('t') }, { iterations: 10 })).key).not.toEqual(a)
  })

  it('HKDF matches RFC 5869 test case 1 (SHA-256)', async () => {
    const { hex } = await runOp(
      'crypto/hkdf',
      {
        ikm: new Uint8Array(22).fill(0x0b),
        salt: hexToBytes('000102030405060708090a0b0c'),
        info: hexToBytes('f0f1f2f3f4f5f6f7f8f9'),
      },
      { hash: 'SHA-256', length: 42 },
    )
    expect(hex).toBe('3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865')
  })

  it('HKDF info labels produce different keys', async () => {
    const base = { ikm: new Uint8Array(32), salt: new Uint8Array(16) }
    const a = (await runOp('crypto/hkdf', { ...base, info: bytesOf('encryption') })).key
    const b = (await runOp('crypto/hkdf', { ...base, info: bytesOf('signing') })).key
    expect(a).not.toEqual(b)
  })
})

describe('jwt-decode', () => {
  // The classic jwt.io HS256 example token.
  const TOKEN =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
    'eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.' +
    'SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'

  it('splits header, payload, signature, and the signed bytes', async () => {
    const { header, payload, signature, signedData } = await runOp('crypto/jwt-decode', { token: TOKEN })
    expect(header).toEqual({ alg: 'HS256', typ: 'JWT' })
    expect(payload).toEqual({ sub: '1234567890', name: 'John Doe', iat: 1516239022 })
    expect((signature as Uint8Array).length).toBe(32) // SHA-256
    // signedData is exactly what an HMAC-SHA-256 over the key would verify.
    expect(textOf(signedData)).toBe(TOKEN.split('.').slice(0, 2).join('.'))
  })

  it('signedData verifies against the known jwt.io secret', async () => {
    const { signedData, signature } = await runOp('crypto/jwt-decode', { token: TOKEN })
    const { hex } = await runOp('hashing/hmac', { data: signedData, key: bytesOf('your-256-bit-secret') }, { hash: 'SHA-256' })
    expect(hexToBytes(hex as string)).toEqual(signature)
  })

  it('rejects malformed tokens with clear errors', async () => {
    await expect(runOp('crypto/jwt-decode', { token: 'two.parts' })).rejects.toThrow(/3 dot-separated parts, got 2/)
    await expect(runOp('crypto/jwt-decode', { token: 'a.b.c' })).rejects.toThrow()
  })
})
