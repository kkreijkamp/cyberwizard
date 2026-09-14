import { bytesToHex } from '../../core/binary'
import { defineNode } from '../../core/registry'
import { BYTES, STRING } from '../../core/types'

/** Cryptographically secure random bytes: keys, IVs, nonces, salts. */
defineNode({
  type: 'crypto/random-bytes',
  title: 'Random Bytes',
  category: 'Crypto',
  description: 'CSPRNG output (crypto.getRandomValues): key/IV/nonce/salt material.',
  inputs: [] as const,
  outputs: [
    { name: 'bytes', type: BYTES },
    { name: 'hex', type: STRING },
  ] as const,
  params: [
    { kind: 'number', name: 'count', label: 'Count', default: 16, min: 1, max: 65536, step: 1, precision: 0 },
  ] as const,
  run: (_inputs, params) => {
    const count = Math.floor(params.count)
    if (count < 1 || count > 65536) throw new Error(`count must be 1–65536, got ${params.count}`)
    const bytes = crypto.getRandomValues(new Uint8Array(count))
    return { bytes, hex: bytesToHex(bytes) }
  },
})
