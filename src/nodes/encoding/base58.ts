import { defineNode } from '../../core/registry'
import { BYTES, STRING } from '../../core/types'

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
const BASE = 58n

/** Base58 with the Bitcoin alphabet: leading zero bytes become leading '1's. */
export function base58Encode(data: Uint8Array): string {
  let zeros = 0
  while (zeros < data.length && data[zeros] === 0) zeros++

  let num = 0n
  for (const b of data) num = (num << 8n) | BigInt(b)

  let digits = ''
  while (num > 0n) {
    digits = ALPHABET[Number(num % BASE)] + digits
    num /= BASE
  }
  return '1'.repeat(zeros) + digits
}

export function base58Decode(text: string): Uint8Array {
  let zeros = 0
  while (zeros < text.length && text[zeros] === '1') zeros++

  let num = 0n
  for (const ch of text) {
    const idx = ALPHABET.indexOf(ch)
    if (idx === -1) throw new Error(`invalid base58 character: ${JSON.stringify(ch)}`)
    num = num * BASE + BigInt(idx)
  }

  const body: number[] = []
  while (num > 0n) {
    body.unshift(Number(num & 0xffn))
    num >>= 8n
  }
  return new Uint8Array([...new Array<number>(zeros).fill(0), ...body])
}

defineNode({
  type: 'encoding/base58-encode',
  title: 'Base58 Encode',
  category: 'Encoding',
  inputs: [{ name: 'data', type: BYTES }] as const,
  outputs: [{ name: 'text', type: STRING }] as const,
  run: (inputs) => ({ text: base58Encode(inputs.data ?? new Uint8Array()) }),
})

defineNode({
  type: 'encoding/base58-decode',
  title: 'Base58 Decode',
  category: 'Encoding',
  inputs: [{ name: 'text', type: STRING }] as const,
  outputs: [{ name: 'data', type: BYTES }] as const,
  run: (inputs) => ({ data: base58Decode(inputs.text ?? '') }),
})
