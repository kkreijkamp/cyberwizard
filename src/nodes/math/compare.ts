/**
 * Math: comparisons. Equality is structural (see core/types valueKey):
 * primitives by value (1 ≠ "1": types differ), bytes by hex, objects and
 * lists by JSON. Ordering compares numbers numerically, strings
 * lexicographically, bytes (and mixed bytes/number/hex-string) as unsigned
 * big-endian bignums, and anything else by its repr.
 */

import { defineNode } from '../../core/registry'
import { ANY, BOOLEAN, repr, valuesEqual } from '../../core/types'
import { stringToBignum, toBignum, toOperand } from './operand'

const binary = {
  inputs: [
    { name: 'a', type: ANY },
    { name: 'b', type: ANY },
  ] as const,
  outputs: [{ name: 'result', type: BOOLEAN }] as const,
}

function compareOrder(a: unknown, b: unknown): number {
  if (a instanceof Uint8Array || b instanceof Uint8Array) {
    const x = typeof a === 'string' ? stringToBignum(a) : toBignum(toOperand(a))
    const y = typeof b === 'string' ? stringToBignum(b) : toBignum(toOperand(b))
    return x < y ? -1 : x > y ? 1 : 0
  }
  if (typeof a === 'number' && typeof b === 'number') return a - b
  if (typeof a === 'string' && typeof b === 'string') return a < b ? -1 : a > b ? 1 : 0
  const ra = repr(a)
  const rb = repr(b)
  return ra < rb ? -1 : ra > rb ? 1 : 0
}

defineNode({
  type: 'math/equals',
  title: 'Equals',
  category: 'Math',
  description: 'Structural equality: 1 ≠ "1"; bytes and lists compare by content.',
  ...binary,
  run: (inputs) => ({ result: valuesEqual(inputs.a, inputs.b) }),
})

defineNode({
  type: 'math/not-equals',
  title: 'Not Equals',
  category: 'Math',
  ...binary,
  run: (inputs) => ({ result: !valuesEqual(inputs.a, inputs.b) }),
})

defineNode({
  type: 'math/less',
  title: 'Less Than',
  category: 'Math',
  ...binary,
  run: (inputs) => ({ result: compareOrder(inputs.a, inputs.b) < 0 }),
})

defineNode({
  type: 'math/less-eq',
  title: 'Less or Equal',
  category: 'Math',
  ...binary,
  run: (inputs) => ({ result: compareOrder(inputs.a, inputs.b) <= 0 }),
})

defineNode({
  type: 'math/greater',
  title: 'Greater Than',
  category: 'Math',
  ...binary,
  run: (inputs) => ({ result: compareOrder(inputs.a, inputs.b) > 0 }),
})

defineNode({
  type: 'math/greater-eq',
  title: 'Greater or Equal',
  category: 'Math',
  ...binary,
  run: (inputs) => ({ result: compareOrder(inputs.a, inputs.b) >= 0 }),
})
