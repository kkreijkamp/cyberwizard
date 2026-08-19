/**
 * Logic — boolean combinators for composing conditions (comparisons output
 * booleans; If/Select consume them). Unwired inputs act as the identity:
 * true for And, false for Or — a partially wired node still computes.
 */

import { defineNode } from '../../core/registry'
import { BOOLEAN } from '../../core/types'

const binary = {
  inputs: [
    { name: 'a', type: BOOLEAN },
    { name: 'b', type: BOOLEAN },
  ] as const,
  outputs: [{ name: 'result', type: BOOLEAN }] as const,
}

defineNode({
  type: 'logic/and',
  title: 'And',
  category: 'Logic',
  description: 'Unwired inputs act as true.',
  ...binary,
  run: (inputs) => ({ result: (inputs.a ?? true) && (inputs.b ?? true) }),
})

defineNode({
  type: 'logic/or',
  title: 'Or',
  category: 'Logic',
  description: 'Unwired inputs act as false.',
  ...binary,
  run: (inputs) => ({ result: (inputs.a ?? false) || (inputs.b ?? false) }),
})

defineNode({
  type: 'logic/not',
  title: 'Not',
  category: 'Logic',
  inputs: [{ name: 'value', type: BOOLEAN }] as const,
  outputs: [{ name: 'result', type: BOOLEAN }] as const,
  run: (inputs) => ({ result: !(inputs.value ?? false) }),
})
