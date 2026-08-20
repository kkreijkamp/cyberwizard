/**
 * Math — bitwise shifts. JavaScript semantics: operands are truncated to
 * 32-bit integers and the shift count is masked to 5 bits (0–31), so
 * `1 << 32 === 1`. Unwired inputs act as 0 (a no-op shift).
 */

import { defineNode } from '../../core/registry'
import { NUMBER } from '../../core/types'

const shift = {
  inputs: [
    { name: 'value', type: NUMBER },
    { name: 'by', type: NUMBER },
  ] as const,
  outputs: [{ name: 'result', type: NUMBER }] as const,
}

defineNode({
  type: 'math/shift-left',
  title: 'Shift Left',
  category: 'Math',
  description: 'value << by — 32-bit, count masked to 0–31.',
  ...shift,
  run: (inputs) => ({ result: (inputs.value ?? 0) << (inputs.by ?? 0) }),
})

defineNode({
  type: 'math/shift-right',
  title: 'Shift Right',
  category: 'Math',
  description: 'value >> by — 32-bit, keeping the sign bit.',
  ...shift,
  run: (inputs) => ({ result: (inputs.value ?? 0) >> (inputs.by ?? 0) }),
})

defineNode({
  type: 'math/shift-right-unsigned',
  title: 'Shift Right (unsigned)',
  category: 'Math',
  description: 'value >>> by — 32-bit, zero-filling from the left.',
  ...shift,
  run: (inputs) => ({ result: (inputs.value ?? 0) >>> (inputs.by ?? 0) }),
})
