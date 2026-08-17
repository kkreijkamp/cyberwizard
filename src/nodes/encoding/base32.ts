import { defineNode } from '../../core/registry'
import { BYTES, STRING } from '../../core/types'

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

/** RFC 4648 Base32. */
export function base32Encode(data: Uint8Array): string {
  let out = ''
  for (let i = 0; i < data.length; i += 5) {
    const chunk = data.subarray(i, i + 5)
    let bits = 0n
    for (const b of chunk) bits = (bits << 8n) | BigInt(b)
    bits <<= BigInt(8 * (5 - chunk.length))
    const chars = Math.ceil((chunk.length * 8) / 5)
    for (let j = 0; j < 8; j++) {
      out += j < chars ? ALPHABET[Number((bits >> BigInt(5 * (7 - j))) & 31n)] : '='
    }
  }
  return out
}

export function base32Decode(text: string): Uint8Array {
  const clean = text.toUpperCase().replace(/[\s=]/g, '')
  const out: number[] = []
  for (let i = 0; i < clean.length; i += 8) {
    const chunk = clean.slice(i, i + 8)
    let bits = 0n
    for (const ch of chunk) {
      const idx = ALPHABET.indexOf(ch)
      if (idx === -1) throw new Error(`invalid base32 character: ${JSON.stringify(ch)}`)
      bits = (bits << 5n) | BigInt(idx)
    }
    const byteCount = Math.floor((chunk.length * 5) / 8)
    const shift = chunk.length * 5 - byteCount * 8
    for (let j = 0; j < byteCount; j++) {
      out.push(Number((bits >> BigInt(shift + 8 * (byteCount - 1 - j))) & 0xffn))
    }
  }
  return new Uint8Array(out)
}

defineNode({
  type: 'encoding/base32-encode',
  title: 'Base32 Encode',
  category: 'Encoding',
  inputs: [{ name: 'data', type: BYTES }] as const,
  outputs: [{ name: 'text', type: STRING }] as const,
  run: (inputs) => ({ text: base32Encode(inputs.data ?? new Uint8Array()) }),
})

defineNode({
  type: 'encoding/base32-decode',
  title: 'Base32 Decode',
  category: 'Encoding',
  inputs: [{ name: 'text', type: STRING }] as const,
  outputs: [{ name: 'data', type: BYTES }] as const,
  run: (inputs) => ({ data: base32Decode(inputs.text ?? '') }),
})
