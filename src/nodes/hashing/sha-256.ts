import { asBufferSource, bytesToHex } from '../../core/binary'
import { defineNode } from '../../core/registry'
import { BYTES, STRING } from '../../core/types'

/** SHA-256 via WebCrypto — the M1 proof that async ops work. Two outputs: raw + hex. */
defineNode({
  type: 'hashing/sha-256',
  title: 'SHA-256',
  category: 'Hashing',
  inputs: [{ name: 'data', type: BYTES }] as const,
  outputs: [
    { name: 'digest', type: BYTES },
    { name: 'hex', type: STRING },
  ] as const,
  run: async (inputs) => {
    const data = inputs.data ?? new Uint8Array()
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', asBufferSource(data)))
    return { digest, hex: bytesToHex(digest) }
  },
})
