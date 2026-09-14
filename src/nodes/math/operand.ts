/**
 * Math: operand normalization for ops that accept any-typed values.
 *
 * Bytes are the pivotal case: when ANY input is bytes, arithmetic runs as
 * big-endian unsigned bignum and the output is bytes (see arith.ts): the
 * f64 bytes→number coercion would lose everything past 2^53. Numbers and
 * (hex) strings keep the ordinary f64 path. Booleans read as 1/0, unwired
 * inputs take the op's identity default.
 */

import { bytesToBigInt } from '../../core/binary'
import { coerce } from '../../core/coerce'
import { NUMBER, STRING, repr } from '../../core/types'

/** Bytes stay bytes (bignum path); everything else becomes an f64 number. */
export function toOperand(value: unknown, identity = 0): Uint8Array | number {
  if (value instanceof Uint8Array) return value
  if (value === undefined || value === null) return identity
  if (typeof value === 'number') return value
  if (typeof value === 'string') return coerce(value, STRING, NUMBER) as number
  if (typeof value === 'boolean') return value ? 1 : 0
  // Full repr: the message is the whole story in the inspect overlay (the
  // badge clips to three lines regardless, so brevity buys nothing there).
  throw new Error(`not a numeric operand: ${repr(value, { full: true })}`)
}

/** Exact integer view of an operand, for the bignum path. */
export function toBignum(value: Uint8Array | number): bigint {
  if (value instanceof Uint8Array) return bytesToBigInt(value)
  return BigInt(Math.trunc(value))
}

/**
 * BigInt() handles decimal and the 0x/0b/0o prefixes; bare hex with letters
 * ('1f', 'deadbeef') gets the 0x prefix treatment, matching the string→number
 * coercion. Non-integer strings ('3.14') are an error: bignum is integer-only.
 */
export function stringToBignum(s: string): bigint {
  const t = s.trim()
  try {
    return BigInt(t)
  } catch {
    // fall through to the hex fallback
  }
  const hex = /^-?(?:0x)?([0-9a-f]+)$/i.exec(t)
  if (!hex || !/[a-f]/i.test(hex[1]!)) {
    throw new Error(`not an integer: ${JSON.stringify(s)}`)
  }
  const digits = BigInt(`0x${hex[1]!}`)
  return t.startsWith('-') ? -digits : digits
}
