/**
 * Logic — the gates. Booleans behave as logical and/or/not (unwired inputs
 * act as the identity: true for And, false for Or). When any input is
 * bytes, the gate is bitwise on the byte strings, left-padding the shorter
 * operand with zeros (big-endian alignment, so it matches the bignum
 * arithmetic): [ff] AND [0f f0] = [00 f0], NOT inverts every byte in place.
 * Numbers and hex strings convert into the byte path exactly. `logic/xor`
 * stays the repeating-key byte op.
 */

import { bigIntToBytes } from '../../core/binary'
import { coerce } from '../../core/coerce'
import { defineNode } from '../../core/registry'
import { ANY, BOOLEAN, STRING, repr } from '../../core/types'
import { stringToBignum } from '../math/operand'

function boolOf(value: unknown, identity: boolean): boolean {
  if (value === undefined || value === null) return identity
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  if (typeof value === 'string') return coerce(value, STRING, BOOLEAN) as boolean
  return true // any non-empty payload is truthy
}

/** Bytes view of a gate operand: bytes pass, numbers/hex strings/booleans convert exactly. */
function toGateBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value
  if (typeof value === 'number') {
    // Full reprs in every message: the inspect overlay shows them whole (the
    // badge clips to three lines regardless).
    if (!Number.isFinite(value) || value < 0) throw new Error(`gate operand must be a non-negative integer, got ${repr(value, { full: true })}`)
    return bigIntToBytes(BigInt(Math.trunc(value)))
  }
  if (typeof value === 'boolean') return new Uint8Array([value ? 1 : 0])
  if (typeof value === 'string') return bigIntToBytes(stringToBignum(value))
  throw new Error(`gate operand must be bytes/number/string/boolean, got ${repr(value, { full: true })}`)
}

/** Bitwise op over two byte strings; the shorter is left-padded with zeros. */
function bitwiseBytes(a: Uint8Array, b: Uint8Array, fn: (x: number, y: number) => number): Uint8Array {
  const len = Math.max(a.length, b.length)
  const pa = new Uint8Array(len)
  pa.set(a, len - a.length)
  const pb = new Uint8Array(len)
  pb.set(b, len - b.length)
  const out = new Uint8Array(len)
  for (let i = 0; i < len; i++) out[i] = fn(pa[i]!, pb[i]!)
  return out
}

const gate = {
  inputs: [
    { name: 'a', type: ANY },
    { name: 'b', type: ANY },
  ] as const,
  outputs: [{ name: 'result', type: ANY }] as const,
}

defineNode({
  type: 'logic/and',
  title: 'And',
  category: 'Logic',
  description: 'Booleans: logical and (unwired acts as true). Bytes involved: bitwise AND, left-padded — output is bytes.',
  ...gate,
  run: (inputs) => {
    const { a, b } = inputs
    if (a instanceof Uint8Array || b instanceof Uint8Array) {
      if (a === undefined) return { result: b } // unwired: identity is all-ones → the other operand
      if (b === undefined) return { result: a }
      return { result: bitwiseBytes(toGateBytes(a), toGateBytes(b), (x, y) => x & y) }
    }
    return { result: boolOf(a, true) && boolOf(b, true) }
  },
})

defineNode({
  type: 'logic/or',
  title: 'Or',
  category: 'Logic',
  description: 'Booleans: logical or (unwired acts as false). Bytes involved: bitwise OR, left-padded — output is bytes.',
  ...gate,
  run: (inputs) => {
    const { a, b } = inputs
    if (a instanceof Uint8Array || b instanceof Uint8Array) {
      if (a === undefined) return { result: b } // unwired: identity is all-zeros → the other operand
      if (b === undefined) return { result: a }
      return { result: bitwiseBytes(toGateBytes(a), toGateBytes(b), (x, y) => x | y) }
    }
    return { result: boolOf(a, false) || boolOf(b, false) }
  },
})

defineNode({
  type: 'logic/not',
  title: 'Not',
  category: 'Logic',
  description: 'Booleans: logical not. Bytes: inverts every byte (same length).',
  inputs: [{ name: 'value', type: ANY }] as const,
  outputs: [{ name: 'result', type: ANY }] as const,
  run: (inputs) => {
    const v = inputs.value
    if (v instanceof Uint8Array) {
      const out = new Uint8Array(v.length)
      for (let i = 0; i < v.length; i++) out[i] = ~v[i]! & 0xff
      return { result: out }
    }
    return { result: !boolOf(v, false) }
  },
})
