import { defineNode } from '../../core/registry'
import { BYTES, STRING } from '../../core/types'

/** Bytes as space-separated binary octets: 0x48 0x69 → "01001000 01101001". */
defineNode({
  type: 'encoding/binary-encode',
  title: 'Binary Encode',
  category: 'Encoding',
  inputs: [{ name: 'data', type: BYTES }] as const,
  outputs: [{ name: 'text', type: STRING }] as const,
  run: (inputs) => ({
    text: [...(inputs.data ?? [])].map((b) => b.toString(2).padStart(8, '0')).join(' '),
  }),
})

defineNode({
  type: 'encoding/binary-decode',
  title: 'Binary Decode',
  category: 'Encoding',
  inputs: [{ name: 'text', type: STRING }] as const,
  outputs: [{ name: 'data', type: BYTES }] as const,
  run: (inputs) => {
    const bits = (inputs.text ?? '').replace(/[^01]/g, '')
    if (bits.length % 8 !== 0) {
      throw new Error(`bit string length ${bits.length} is not a multiple of 8`)
    }
    const out = new Uint8Array(bits.length / 8)
    for (let i = 0; i < out.length; i++) {
      out[i] = Number.parseInt(bits.slice(i * 8, i * 8 + 8), 2)
    }
    return { data: out }
  },
})
