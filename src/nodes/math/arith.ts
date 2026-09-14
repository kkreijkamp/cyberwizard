/**
 * Math: arithmetic. When ANY input is bytes, the op runs as big-endian
 * unsigned bignum (BigInt) and the output is bytes: the f64 bytes→number
 * coercion would lose everything past 2^53. Mixed operands (numbers, hex
 * strings, booleans) convert exactly; a negative result is an error, since
 * bytes are unsigned. With no bytes involved, ops keep their plain f64
 * semantics and unwired inputs act as the operation's identity (0 for
 * additive ops, 1 for multiplicative ops).
 */

import { bigIntToBytes } from '../../core/binary'
import { defineNode } from '../../core/registry'
import { ANY } from '../../core/types'
import { stringToBignum, toBignum, toOperand } from './operand'

function bytesResult(n: bigint): Uint8Array {
  if (n < 0n) throw new Error('negative result: bytes are unsigned')
  return bigIntToBytes(n)
}

/** Dispatch: bignum when either side is bytes (strings stay exact via stringToBignum), f64 otherwise. */
function arith(
  inputs: { a?: unknown; b?: unknown },
  identityA: number,
  identityB: number,
  numberFn: (a: number, b: number) => number,
  bigFn: (a: bigint, b: bigint) => bigint,
): unknown {
  const a = toOperand(inputs.a, identityA)
  const b = toOperand(inputs.b, identityB)
  if (a instanceof Uint8Array || b instanceof Uint8Array) {
    const bigA = typeof inputs.a === 'string' ? stringToBignum(inputs.a) : toBignum(a)
    const bigB = typeof inputs.b === 'string' ? stringToBignum(inputs.b) : toBignum(b)
    return bytesResult(bigFn(bigA, bigB))
  }
  return numberFn(a, b)
}

const binary = {
  inputs: [
    { name: 'a', type: ANY },
    { name: 'b', type: ANY },
  ] as const,
  outputs: [{ name: 'result', type: ANY }] as const,
}

const unary = {
  inputs: [{ name: 'n', type: ANY }] as const,
  outputs: [{ name: 'result', type: ANY }] as const,
}

defineNode({
  type: 'math/add',
  title: 'Add',
  category: 'Math',
  description: 'Bytes involved: big-endian unsigned bignum addition, output is bytes.',
  ...binary,
  run: (inputs) => ({ result: arith(inputs, 0, 0, (a, b) => a + b, (a, b) => a + b) }),
})

defineNode({
  type: 'math/subtract',
  title: 'Subtract',
  category: 'Math',
  description: 'Bytes involved: unsigned bignum subtraction; a negative result is an error.',
  ...binary,
  run: (inputs) => ({ result: arith(inputs, 0, 0, (a, b) => a - b, (a, b) => a - b) }),
})

defineNode({
  type: 'math/multiply',
  title: 'Multiply',
  category: 'Math',
  description: 'Bytes involved: big-endian unsigned bignum multiplication, output is bytes. Unwired inputs act as 1.',
  ...binary,
  run: (inputs) => ({ result: arith(inputs, 1, 1, (a, b) => a * b, (a, b) => a * b) }),
})

defineNode({
  type: 'math/divide',
  title: 'Divide',
  category: 'Math',
  description: 'Bytes involved: unsigned bignum division (floor). Division by zero errors.',
  ...binary,
  run: (inputs) => ({
    result: arith(
      inputs,
      0,
      1,
      (a, b) => {
        if (b === 0) throw new Error('division by zero')
        return a / b
      },
      (a, b) => {
        if (b === 0n) throw new Error('division by zero')
        return a / b
      },
    ),
  }),
})

/** JS remainder semantics on numbers (dividend's sign); bignum remainder is unsigned. */
defineNode({
  type: 'math/modulo',
  title: 'Modulo',
  category: 'Math',
  description: 'Numbers: remainder takes the dividend’s sign. Bytes: unsigned bignum remainder. Modulo by zero errors.',
  ...binary,
  run: (inputs) => ({
    result: arith(
      inputs,
      0,
      1,
      (a, b) => {
        if (b === 0) throw new Error('modulo by zero')
        return a % b
      },
      (a, b) => {
        if (b === 0n) throw new Error('modulo by zero')
        return a % b
      },
    ),
  }),
})

defineNode({
  type: 'math/power',
  title: 'Power',
  category: 'Math',
  description: 'Bytes involved: unsigned bignum power (exponent capped at 1 000 000). Unwired inputs act as 1.',
  ...binary,
  run: (inputs) => ({
    result: arith(inputs, 1, 1, (a, b) => a ** b, (a, b) => {
      if (b < 0n) throw new Error('negative exponent: result would not be an integer')
      if (b > 1_000_000n) throw new Error('exponent too large for byte power (max 1 000 000)')
      return a ** b
    }),
  }),
})

defineNode({
  type: 'math/min',
  title: 'Min',
  category: 'Math',
  description: 'Bytes compare as unsigned bignums.',
  ...binary,
  run: (inputs) => ({ result: arith(inputs, 0, 0, Math.min, (a, b) => (a <= b ? a : b)) }),
})

defineNode({
  type: 'math/max',
  title: 'Max',
  category: 'Math',
  description: 'Bytes compare as unsigned bignums.',
  ...binary,
  run: (inputs) => ({ result: arith(inputs, 0, 0, Math.max, (a, b) => (a >= b ? a : b)) }),
})

defineNode({
  type: 'math/abs',
  title: 'Abs',
  category: 'Math',
  description: 'Bytes pass through (unsigned values are already absolute).',
  ...unary,
  run: (inputs) => ({ result: inputs.n instanceof Uint8Array ? inputs.n : Math.abs(toOperand(inputs.n) as number) }),
})

defineNode({
  type: 'math/negate',
  title: 'Negate',
  category: 'Math',
  description: 'Numbers only: bytes are unsigned and cannot be negated.',
  ...unary,
  run: (inputs) => {
    if (inputs.n instanceof Uint8Array) throw new Error('cannot negate bytes (unsigned)')
    return { result: -toOperand(inputs.n) }
  },
})

defineNode({
  type: 'math/floor',
  title: 'Floor',
  category: 'Math',
  description: 'Bytes pass through (already integers).',
  ...unary,
  run: (inputs) => ({ result: inputs.n instanceof Uint8Array ? inputs.n : Math.floor(toOperand(inputs.n) as number) }),
})

defineNode({
  type: 'math/ceil',
  title: 'Ceil',
  category: 'Math',
  description: 'Bytes pass through (already integers).',
  ...unary,
  run: (inputs) => ({ result: inputs.n instanceof Uint8Array ? inputs.n : Math.ceil(toOperand(inputs.n) as number) }),
})

defineNode({
  type: 'math/round',
  title: 'Round',
  category: 'Math',
  description: 'Bytes pass through (already integers).',
  ...unary,
  run: (inputs) => ({ result: inputs.n instanceof Uint8Array ? inputs.n : Math.round(toOperand(inputs.n) as number) }),
})
