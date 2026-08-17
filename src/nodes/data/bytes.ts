import { utf8Decode, utf8Encode } from '../../core/coerce'
import { defineNode } from '../../core/registry'
import { ANY, BYTES, STRING } from '../../core/types'

/** Explicit any → bytes: strings utf-8 encode, bytes pass, everything else JSON-serialises. */
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
