import { asBufferSource, bytesToHex } from '../../core/binary'
import { defineNode } from '../../core/registry'
import { BYTES, STRING } from '../../core/types'

/** SHA family via WebCrypto — one def factory, three algorithms. */
const ALGORITHMS = [
  { subtle: 'SHA-1', slug: 'sha-1' },
  { subtle: 'SHA-256', slug: 'sha-256' },
  { subtle: 'SHA-512', slug: 'sha-512' },
] as const

for (const { subtle, slug } of ALGORITHMS) {
  defineNode({
    type: `hashing/${slug}`,
    title: subtle,
    category: 'Hashing',
    inputs: [{ name: 'data', type: BYTES }] as const,
    outputs: [
      { name: 'digest', type: BYTES },
      { name: 'hex', type: STRING },
    ] as const,
    run: async (inputs) => {
      const data = inputs.data ?? new Uint8Array()
      const digest = new Uint8Array(await crypto.subtle.digest(subtle, asBufferSource(data)))
      return { digest, hex: bytesToHex(digest) }
    },
  })
}
