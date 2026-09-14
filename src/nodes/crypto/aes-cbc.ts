import { asBufferSource } from '../../core/binary'
import { defineNode } from '../../core/registry'
import { BYTES } from '../../core/types'
import { CBC_IV_BYTES, importAesKey, randomBytes } from './aes-common'

/**
 * AES-CBC: classic block-cipher encryption (PKCS#7 padding, handled by
 * WebCrypto). NOT authenticated: pair with HMAC if tamper-evidence matters,
 * or use AES-GCM. An empty iv input generates a fresh 16-byte one.
 */
defineNode({
  type: 'crypto/aes-cbc-encrypt',
  title: 'AES-CBC Encrypt',
  category: 'Crypto',
  description:
    'Block-cipher encryption with PKCS#7 padding (not authenticated: use AES-GCM for tamper-evidence). Key: 16/24/32 bytes. Leave iv empty to generate a random 16-byte one (reported on the iv output).',
  inputs: [
    { name: 'data', type: BYTES },
    { name: 'key', type: BYTES },
    { name: 'iv', type: BYTES },
  ] as const,
  outputs: [
    { name: 'ciphertext', type: BYTES },
    { name: 'iv', type: BYTES },
  ] as const,
  run: async (inputs) => {
    const key = await importAesKey(inputs.key, 'AES-CBC', ['encrypt'])
    const iv = inputs.iv === undefined || inputs.iv.length === 0 ? randomBytes(CBC_IV_BYTES) : inputs.iv
    if (iv.length !== CBC_IV_BYTES) throw new Error(`AES-CBC iv must be exactly ${CBC_IV_BYTES} bytes, got ${iv.length}`)
    const ciphertext = new Uint8Array(
      await crypto.subtle.encrypt({ name: 'AES-CBC', iv: asBufferSource(iv) }, key, asBufferSource(inputs.data ?? new Uint8Array())),
    )
    return { ciphertext, iv }
  },
})

/** AES-CBC decryption: strips PKCS#7 padding, errors on bad key/iv/corrupt data. */
defineNode({
  type: 'crypto/aes-cbc-decrypt',
  title: 'AES-CBC Decrypt',
  category: 'Crypto',
  description: 'Block-cipher decryption; strips PKCS#7 padding. Errors on wrong key/iv or corrupted ciphertext.',
  inputs: [
    { name: 'ciphertext', type: BYTES },
    { name: 'key', type: BYTES },
    { name: 'iv', type: BYTES },
  ] as const,
  outputs: [{ name: 'plaintext', type: BYTES }] as const,
  run: async (inputs) => {
    const key = await importAesKey(inputs.key, 'AES-CBC', ['decrypt'])
    const iv = inputs.iv ?? new Uint8Array()
    if (iv.length !== CBC_IV_BYTES) throw new Error(`AES-CBC iv must be exactly ${CBC_IV_BYTES} bytes, got ${iv.length}`)
    try {
      const plaintext = new Uint8Array(
        await crypto.subtle.decrypt({ name: 'AES-CBC', iv: asBufferSource(iv) }, key, asBufferSource(inputs.ciphertext ?? new Uint8Array())),
      )
      return { plaintext }
    } catch {
      throw new Error('AES-CBC decryption failed: wrong key/iv or corrupted ciphertext (bad padding)')
    }
  },
})
