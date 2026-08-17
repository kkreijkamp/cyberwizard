import { bytesToHex, hexToBytes } from '../../core/binary'
import { defineNode } from '../../core/registry'
import { BYTES, STRING } from '../../core/types'

const caseParam = { kind: 'boolean', name: 'uppercase', label: 'Uppercase', default: false } as const

defineNode({
  type: 'encoding/hex-encode',
  title: 'Hex Encode',
  category: 'Encoding',
  inputs: [{ name: 'data', type: BYTES }] as const,
  outputs: [{ name: 'text', type: STRING }] as const,
  params: [caseParam] as const,
  run: (inputs, params) => {
    const hex = bytesToHex(inputs.data ?? new Uint8Array())
    return { text: params.uppercase ? hex.toUpperCase() : hex }
  },
})

defineNode({
  type: 'encoding/hex-decode',
  title: 'Hex Decode',
  category: 'Encoding',
  inputs: [{ name: 'text', type: STRING }] as const,
  outputs: [{ name: 'data', type: BYTES }] as const,
  run: (inputs) => ({ data: hexToBytes(inputs.text ?? '') }),
})
