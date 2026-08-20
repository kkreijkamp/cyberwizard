/**
 * Math — bitwise shifts. The shift semantics depend on the value's type:
 *
 *  - **bytes**: a big-endian bignum shift — << appends zero bits (growing
 *    as needed), >> drops low bits; the result is minimal-length. This is
 *    the only way to shift long values: through a number slot the
 *    bytes→number coercion produces an f64, and values past 2^32 have zero
 *    low bits — a 32-bit shift would see 0. Fractional counts truncate;
 *    negative counts shift the other way.
 *  - **numbers and (hex) strings**: JavaScript 32-bit semantics — the
 *    operand truncates to int32 and the count masks to 0–31, so
 *    `1 << 32 === 1`. (Signed >> keeps the sign bit; unsigned >>> does not.
 *    On bytes the two coincide — bignums are unsigned.)
 *
 * Unwired value acts as 0, unwired count as 0 (a no-op shift).
 */

import { bigIntToBytes, bytesToBigInt } from '../../core/binary'
import { coerce } from '../../core/coerce'
import { defineNode } from '../../core/registry'
import { ANY, NUMBER, STRING, repr } from '../../core/types'

/** The value to shift: bytes stay bytes (bignum path), everything else becomes a number. */
function toShiftable(value: unknown): Uint8Array | number {
  if (value instanceof Uint8Array) return value
  if (value === undefined || value === null) return 0
  if (typeof value === 'number') return value
  if (typeof value === 'string') return coerce(value, STRING, NUMBER) as number
  if (typeof value === 'boolean') return value ? 1 : 0
  throw new Error(`cannot bit-shift ${repr(value)}`)
}

function shiftBytesLeft(data: Uint8Array, by: number): Uint8Array {
  if (by < 0) return shiftBytesRight(data, -by)
  return bigIntToBytes(bytesToBigInt(data) << BigInt(Math.trunc(by)))
}

function shiftBytesRight(data: Uint8Array, by: number): Uint8Array {
  if (by < 0) return shiftBytesLeft(data, -by)
  return bigIntToBytes(bytesToBigInt(data) >> BigInt(Math.trunc(by)))
}

const shiftSlots = {
  inputs: [
    { name: 'value', type: ANY },
    { name: 'by', type: NUMBER },
  ] as const,
  outputs: [{ name: 'result', type: ANY }] as const,
}

defineNode({
  type: 'math/shift-left',
  title: 'Shift Left',
  category: 'Math',
  description: 'Bytes: big-endian bignum shift (appends zero bits, may grow). Numbers/strings: 32-bit, count masked to 0–31.',
  ...shiftSlots,
  run: (inputs) => {
    const value = toShiftable(inputs.value)
    const by = inputs.by ?? 0
    return { result: value instanceof Uint8Array ? shiftBytesLeft(value, by) : value << by }
  },
})

defineNode({
  type: 'math/shift-right',
  title: 'Shift Right',
  category: 'Math',
  description: 'Bytes: big-endian bignum shift (drops low bits). Numbers/strings: 32-bit, keeping the sign bit.',
  ...shiftSlots,
  run: (inputs) => {
    const value = toShiftable(inputs.value)
    const by = inputs.by ?? 0
    return { result: value instanceof Uint8Array ? shiftBytesRight(value, by) : value >> by }
  },
})

defineNode({
  type: 'math/shift-right-unsigned',
  title: 'Shift Right (unsigned)',
  category: 'Math',
  description: 'Bytes: same as Shift Right (bignums are unsigned). Numbers/strings: 32-bit, zero-filling from the left.',
  ...shiftSlots,
  run: (inputs) => {
    const value = toShiftable(inputs.value)
    const by = inputs.by ?? 0
    return { result: value instanceof Uint8Array ? shiftBytesRight(value, by) : value >>> by }
  },
})
