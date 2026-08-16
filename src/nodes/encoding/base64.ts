import { binaryStringToBytes, bytesToBinaryString } from '../../core/binary'
import { defineNode } from '../../core/registry'
import { BYTES, STRING } from '../../core/types'

const ALPHABETS = ['standard', 'url-safe'] as const
const alphabetParam = { kind: 'enum', name: 'alphabet', label: 'Alphabet', default: 'standard', options: ALPHABETS } as const

/** RFC 4648 Base64. */
defineNode({
  type: 'encoding/base64-encode',
  title: 'Base64 Encode',
  category: 'Encoding',
  inputs: [{ name: 'data', type: BYTES }] as const,
  outputs: [{ name: 'text', type: STRING }] as const,
  params: [alphabetParam] as const,
  run: (inputs, params) => {
    const data = inputs.data ?? new Uint8Array()
    let text = btoa(bytesToBinaryString(data))
    if (params.alphabet === 'url-safe') text = text.replaceAll('+', '-').replaceAll('/', '_')
    return { text }
  },
})

defineNode({
  type: 'encoding/base64-decode',
  title: 'Base64 Decode',
  category: 'Encoding',
  inputs: [{ name: 'text', type: STRING }] as const,
  outputs: [{ name: 'data', type: BYTES }] as const,
  params: [alphabetParam] as const,
  run: (inputs, params) => {
    let text = (inputs.text ?? '').replace(/\s+/g, '')
    if (params.alphabet === 'url-safe') text = text.replaceAll('-', '+').replaceAll('_', '/')
    const missing = (4 - (text.length % 4)) % 4
    const data = binaryStringToBytes(atob(text + '='.repeat(missing)))
    return { data }
  },
})
