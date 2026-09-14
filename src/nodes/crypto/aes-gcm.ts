import { asBufferSource } from '../../core/binary'
import { defineNode } from '../../core/registry'
import { BYTES } from '../../core/types'
import { GCM_NONCE_BYTES, importAesKey, randomBytes } from './aes-common'

const TAG_LENGTHS = ['128', '120', '112', '104', '96', '64', '32'] as const

/**
 * AES-GCM: authenticated encryption. The auth tag rides inside the ciphertext
 * output (WebCrypto appends it), so two slots carry everything decryption
 * needs: ciphertext + nonce. An empty nonce input generates a fresh 12-byte
 * one and reports it on the iv output.
 */
defineNode({
  type: 'crypto/aes-gcm-encrypt',
  title: 'AES-GCM Encrypt',
  category: 'Crypto',
  description:
    'Authenticated encryption. Key: 16/24/32 bytes. Leave iv empty to generate a random 12-byte nonce (reported on the iv output). The auth tag is appended to the ciphertext.',
  inputs: [
    { name: 'data', type: BYTES },
    { name: 'key', type: BYTES },
    { name: 'iv', type: BYTES },
    { name: 'aad', type: BYTES },
  ] as const,
  outputs: [
    { name: 'ciphertext', type: BYTES },
    { name: 'iv', type: BYTES },
  ] as const,
  params: [{ kind: 'enum', name: 'tagLength', label: 'Tag length (bits)', default: '128', options: TAG_LENGTHS }] as const,
  run: async (inputs, params) => {
    const key = await importAesKey(inputs.key, 'AES-GCM', ['encrypt'])
    const iv = inputs.iv === undefined || inputs.iv.length === 0 ? randomBytes(GCM_NONCE_BYTES) : inputs.iv
    const ciphertext = new Uint8Array(
      await crypto.subtle.encrypt(
        {
          name: 'AES-GCM',
          iv: asBufferSource(iv),
          tagLength: Number(params.tagLength),
          additionalData: asBufferSource(inputs.aad ?? new Uint8Array()),
        },
        key,
        asBufferSource(inputs.data ?? new Uint8Array()),
      ),
    )
    return { ciphertext, iv }
  },
})

/** AES-GCM decryption: fails loudly when the key/nonce/tag is wrong (tamper-evident). */
defineNode({
  type: 'crypto/aes-gcm-decrypt',
  title: 'AES-GCM Decrypt',
  category: 'Crypto',
  description: 'Authenticated decryption: errors when the key, nonce or ciphertext is wrong (authentication failure).',
  inputs: [
    { name: 'ciphertext', type: BYTES },
    { name: 'key', type: BYTES },
    { name: 'iv', type: BYTES },
    { name: 'aad', type: BYTES },
  ] as const,
  outputs: [{ name: 'plaintext', type: BYTES }] as const,
  params: [{ kind: 'enum', name: 'tagLength', label: 'Tag length (bits)', default: '128', options: TAG_LENGTHS }] as const,
  run: async (inputs, params) => {
    const key = await importAesKey(inputs.key, 'AES-GCM', ['decrypt'])
    const iv = inputs.iv ?? new Uint8Array()
    if (iv.length === 0) throw new Error('iv is required for decryption')
    try {
      const plaintext = new Uint8Array(
        await crypto.subtle.decrypt(
          {
            name: 'AES-GCM',
            iv: asBufferSource(iv),
            tagLength: Number(params.tagLength),
            additionalData: asBufferSource(inputs.aad ?? new Uint8Array()),
          },
          key,
          asBufferSource(inputs.ciphertext ?? new Uint8Array()),
        ),
      )
      return { plaintext }
    } catch {
      throw new Error('AES-GCM decryption failed: wrong key, nonce, AAD, or tampered ciphertext')
    }
  },
})
