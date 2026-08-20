import { bigIntToBytes } from '../../core/binary'
import { utf8Decode, utf8Encode } from '../../core/coerce'
import { defineNode } from '../../core/registry'
import { ANY, BYTES, STRING } from '../../core/types'

/**
 * Explicit any → bytes: strings utf-8 encode, bytes pass through, numbers
 * encode as minimal big-endian (255 → ff, 8010 → 1f4a, 0 → 00 — the exact
 * inverse of the bytes→number coercion; negatives error, fractions
 * truncate), everything else JSON-serialises.
 */
defineNode({
  type: 'data/to-bytes',
  title: 'To Bytes',
  category: 'Data',
  inputs: [{ name: 'value', type: ANY }] as const,
  outputs: [{ name: 'data', type: BYTES }] as const,
  run: (inputs) => {
    const v = inputs.value
    if (v === undefined) return { data: new Uint8Array() }
    if (v instanceof Uint8Array) return { data: v }
    if (typeof v === 'string') return { data: utf8Encode(v) }
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) throw new Error('cannot convert a non-finite number to bytes')
      if (v < 0) throw new Error('cannot convert a negative number to bytes (unsigned big-endian)')
      return { data: bigIntToBytes(BigInt(Math.trunc(v))) }
    }
    return { data: utf8Encode(globalThis.JSON.stringify(v) ?? '') }
  },
})

/** Explicit bytes → utf-8 string. */
defineNode({
  type: 'data/from-bytes',
  title: 'From Bytes',
  category: 'Data',
  inputs: [{ name: 'data', type: BYTES }] as const,
  outputs: [{ name: 'text', type: STRING }] as const,
  run: (inputs) => ({ text: utf8Decode(inputs.data ?? new Uint8Array()) }),
})
