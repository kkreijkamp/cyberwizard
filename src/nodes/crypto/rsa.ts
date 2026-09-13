import { asBufferSource } from '../../core/binary'
import { defineNode } from '../../core/registry'
import { BYTES } from '../../core/types'

const MODULI = ['2048', '3072', '4096'] as const
const HASHES = ['SHA-256', 'SHA-512', 'SHA-1'] as const
const USAGES = ['encrypt', 'sign'] as const

function algorithmFor(usage: string, hash: string): RsaHashedKeyAlgorithm {
  return { name: usage === 'sign' ? 'RSA-PSS' : 'RSA-OAEP', modulusLength: 0, publicExponent: new Uint8Array([1, 0, 1]), hash: { name: hash } }
}

/**
 * RSA key pair generation. Keys export in wire-friendly standard formats:
 * public as SPKI DER, private as PKCS#8 DER. The hash chosen here is baked
 * into the keys — encrypt/sign with the same hash. The usage chooses the
 * algorithm family: RSA-OAEP (encrypt/decrypt) or RSA-PSS (sign/verify).
 */
defineNode({
  type: 'crypto/rsa-generate',
  title: 'RSA Generate Key Pair',
  category: 'Crypto',
  description:
    'Generates an RSA key pair (public: SPKI bytes, private: PKCS#8 bytes). Usage picks the algorithm family — "encrypt" → RSA-OAEP, "sign" → RSA-PSS. The hash is baked into the keys; use the same hash downstream.',
  inputs: [] as const,
  outputs: [
    { name: 'publicKey', type: BYTES },
    { name: 'privateKey', type: BYTES },
  ] as const,
  params: [
    { kind: 'enum', name: 'modulus', label: 'Modulus (bits)', default: '2048', options: MODULI },
    { kind: 'enum', name: 'hash', label: 'Hash', default: 'SHA-256', options: HASHES },
    { kind: 'enum', name: 'usage', label: 'Usage', default: 'encrypt', options: USAGES },
  ] as const,
  run: async (_inputs, params) => {
    const algorithm = algorithmFor(params.usage, params.hash)
    algorithm.modulusLength = Number(params.modulus)
    const usages: KeyUsage[] = params.usage === 'sign' ? ['sign', 'verify'] : ['encrypt', 'decrypt']
    const pair = await crypto.subtle.generateKey(algorithm, true, usages)
    const publicKey = new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey))
    const privateKey = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey))
    return { publicKey, privateKey }
  },
})

async function importOaepKey(key: Uint8Array | undefined, format: 'spki' | 'pkcs8', hash: string, usages: KeyUsage[]): Promise<CryptoKey> {
  const raw = key ?? new Uint8Array()
  if (raw.length === 0) throw new Error(`${format === 'spki' ? 'public' : 'private'} key is required`)
  try {
    return await crypto.subtle.importKey(format, asBufferSource(raw), { name: 'RSA-OAEP', hash: { name: hash } }, false, usages)
  } catch {
    throw new Error(`not a valid RSA ${format === 'spki' ? 'public (SPKI)' : 'private (PKCS#8)'} key for RSA-OAEP/${hash} (${raw.length} bytes)`)
  }
}

/** RSA-OAEP encryption with the recipient's public key (small payloads only). */
defineNode({
  type: 'crypto/rsa-encrypt',
  title: 'RSA Encrypt',
  category: 'Crypto',
  description:
    'RSA-OAEP public-key encryption. Payload is limited by key size (modulus/8 − 2×hash − 2 bytes; 190 bytes for 2048-bit/SHA-256) — typically wraps a symmetric key. Hash must match the key\'s.',
  inputs: [
    { name: 'data', type: BYTES },
    { name: 'publicKey', type: BYTES },
  ] as const,
  outputs: [{ name: 'ciphertext', type: BYTES }] as const,
  params: [{ kind: 'enum', name: 'hash', label: 'Hash', default: 'SHA-256', options: HASHES }] as const,
  run: async (inputs, params) => {
    const key = await importOaepKey(inputs.publicKey, 'spki', params.hash, ['encrypt'])
    const data = inputs.data ?? new Uint8Array()
    try {
      const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, key, asBufferSource(data)))
      return { ciphertext }
    } catch {
      throw new Error(`RSA-OAEP encryption failed: payload too large (${data.length} bytes) for this key/hash`)
    }
  },
})

/** RSA-OAEP decryption with the private key. */
defineNode({
  type: 'crypto/rsa-decrypt',
  title: 'RSA Decrypt',
  category: 'Crypto',
  description: 'RSA-OAEP private-key decryption. Hash must match the key\'s (and the encryptor\'s).',
  inputs: [
    { name: 'ciphertext', type: BYTES },
    { name: 'privateKey', type: BYTES },
  ] as const,
  outputs: [{ name: 'plaintext', type: BYTES }] as const,
  params: [{ kind: 'enum', name: 'hash', label: 'Hash', default: 'SHA-256', options: HASHES }] as const,
  run: async (inputs, params) => {
    const key = await importOaepKey(inputs.privateKey, 'pkcs8', params.hash, ['decrypt'])
    try {
      const plaintext = new Uint8Array(
        await crypto.subtle.decrypt({ name: 'RSA-OAEP' }, key, asBufferSource(inputs.ciphertext ?? new Uint8Array())),
      )
      return { plaintext }
    } catch {
      throw new Error('RSA-OAEP decryption failed: wrong key, hash mismatch, or corrupted ciphertext')
    }
  },
})
