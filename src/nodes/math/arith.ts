/**
 * Math — arithmetic on numbers. Unwired inputs act as the operation's
 * identity (0 for additive ops, 1 for multiplicative ops), so a partially
 * wired node still computes something meaningful.
 */

import { defineNode } from '../../core/registry'
import { NUMBER } from '../../core/types'

const binary = {
  inputs: [
    { name: 'a', type: NUMBER },
    { name: 'b', type: NUMBER },
  ] as const,
  outputs: [{ name: 'result', type: NUMBER }] as const,
}

const unary = {
  inputs: [{ name: 'n', type: NUMBER }] as const,
  outputs: [{ name: 'result', type: NUMBER }] as const,
}

defineNode({
  type: 'math/add',
  title: 'Add',
  category: 'Math',
  ...binary,
  run: (inputs) => ({ result: (inputs.a ?? 0) + (inputs.b ?? 0) }),
})

defineNode({
  type: 'math/subtract',
  title: 'Subtract',
  category: 'Math',
  ...binary,
  run: (inputs) => ({ result: (inputs.a ?? 0) - (inputs.b ?? 0) }),
})

defineNode({
  type: 'math/multiply',
  title: 'Multiply',
  category: 'Math',
  description: 'Unwired inputs act as 1.',
  ...binary,
  run: (inputs) => ({ result: (inputs.a ?? 1) * (inputs.b ?? 1) }),
})

defineNode({
  type: 'math/divide',
  title: 'Divide',
  category: 'Math',
  description: 'Unwired numerator acts as 0, denominator as 1. Division by zero errors.',
  ...binary,
  run: (inputs) => {
    const b = inputs.b ?? 1
    if (b === 0) throw new Error('division by zero')
    return { result: (inputs.a ?? 0) / b }
  },
})

/** JS remainder semantics (result takes the dividend's sign). */
defineNode({
  type: 'math/modulo',
  title: 'Modulo',
  category: 'Math',
  description: 'Remainder; takes the dividend’s sign. Modulo by zero errors.',
  ...binary,
  run: (inputs) => {
    const b = inputs.b ?? 1
    if (b === 0) throw new Error('modulo by zero')
    return { result: (inputs.a ?? 0) % b }
  },
})

defineNode({
  type: 'math/power',
  title: 'Power',
  category: 'Math',
  description: 'a to the power b. Unwired inputs act as 1.',
  ...binary,
  run: (inputs) => ({ result: (inputs.a ?? 1) ** (inputs.b ?? 1) }),
})

defineNode({
  type: 'math/min',
  title: 'Min',
  category: 'Math',
  ...binary,
  run: (inputs) => ({ result: Math.min(inputs.a ?? 0, inputs.b ?? 0) }),
})

defineNode({
  type: 'math/max',
  title: 'Max',
  category: 'Math',
  ...binary,
  run: (inputs) => ({ result: Math.max(inputs.a ?? 0, inputs.b ?? 0) }),
})

defineNode({
  type: 'math/abs',
  title: 'Abs',
  category: 'Math',
  ...unary,
  run: (inputs) => ({ result: Math.abs(inputs.n ?? 0) }),
})

defineNode({
  type: 'math/negate',
  title: 'Negate',
  category: 'Math',
  ...unary,
  run: (inputs) => ({ result: -(inputs.n ?? 0) }),
})

defineNode({
  type: 'math/floor',
  title: 'Floor',
  category: 'Math',
  ...unary,
  run: (inputs) => ({ result: Math.floor(inputs.n ?? 0) }),
})

defineNode({
  type: 'math/ceil',
  title: 'Ceil',
  category: 'Math',
  ...unary,
  run: (inputs) => ({ result: Math.ceil(inputs.n ?? 0) }),
})

defineNode({
  type: 'math/round',
  title: 'Round',
  category: 'Math',
  ...unary,
  run: (inputs) => ({ result: Math.round(inputs.n ?? 0) }),
})
