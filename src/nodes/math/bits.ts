/**
 * Math: bitwise shifts. The shift semantics depend on the value's type:
 *
 *  - **bytes**: a big-endian bignum shift, << appends zero bits (growing
 *    as needed), >> drops low bits; the result is minimal-length. This is
 *    the only way to shift long values: through a number slot the
 *    bytes→number coercion produces an f64, and values past 2^32 have zero
 *    low bits: a 32-bit shift would see 0. Fractional counts truncate;
 *    negative counts shift the other way.
 *  - **numbers and (hex) strings**: JavaScript 32-bit semantics, the
 *    operand truncates to int32 and the count masks to 0–31, so
 *    `1 << 32 === 1`. (Signed >> keeps the sign bit; unsigned >>> does not.
 *    On bytes the two coincide: bignums are unsigned.)
 *
 * The `bits` input is the count in BITS: 8 bits = one byte (shift left 8
 * appends a zero byte, shift left 1 appends a zero bit). Unwired value
 * acts as 0, unwired count as 0 (a no-op shift).
 */

import { bigIntToBytes, bytesToBigInt } from '../../core/binary'
import { defineNode } from '../../core/registry'
import { ANY, NUMBER } from '../../core/types'
import { toOperand } from './operand'

function shiftBytesLeft(data: Uint8Array, bits: number): Uint8Array {
  if (bits < 0) return shiftBytesRight(data, -bits)
  return bigIntToBytes(bytesToBigInt(data) << BigInt(Math.trunc(bits)))
}

function shiftBytesRight(data: Uint8Array, bits: number): Uint8Array {
  if (bits < 0) return shiftBytesLeft(data, -bits)
  return bigIntToBytes(bytesToBigInt(data) >> BigInt(Math.trunc(bits)))
}

const shiftSlots = {
  inputs: [
    { name: 'value', type: ANY },
    { name: 'bits', type: NUMBER },
  ] as const,
  outputs: [{ name: 'result', type: ANY }] as const,
}

defineNode({
  type: 'math/shift-left',
  title: 'Shift Left',
  category: 'Math',
  description: 'Bits count is in BITS (8 = one byte). Bytes: big-endian bignum shift (appends zero bits, may grow). Numbers/strings: 32-bit.',
  ...shiftSlots,
  run: (inputs) => {
    const value = toOperand(inputs.value)
    const bits = inputs.bits ?? 0
    return { result: value instanceof Uint8Array ? shiftBytesLeft(value, bits) : value << bits }
  },
})

defineNode({
  type: 'math/shift-right',
  title: 'Shift Right',
  category: 'Math',
  description: 'Bits count is in BITS (8 = one byte). Bytes: big-endian bignum shift (drops low bits). Numbers/strings: 32-bit, keeping the sign bit.',
  ...shiftSlots,
  run: (inputs) => {
    const value = toOperand(inputs.value)
    const bits = inputs.bits ?? 0
    return { result: value instanceof Uint8Array ? shiftBytesRight(value, bits) : value >> bits }
  },
})

defineNode({
  type: 'math/shift-right-unsigned',
  title: 'Shift Right (unsigned)',
  category: 'Math',
  description: 'Bits count is in BITS (8 = one byte). Bytes: same as Shift Right (bignums are unsigned). Numbers/strings: 32-bit, zero-filling.',
  ...shiftSlots,
  run: (inputs) => {
    const value = toOperand(inputs.value)
    const bits = inputs.bits ?? 0
    return { result: value instanceof Uint8Array ? shiftBytesRight(value, bits) : value >>> bits }
  },
})
