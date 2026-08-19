/**
 * Flow — conditionals, eager and lazy.
 *
 * Select is the plain ternary: cond, then, and else are ordinary wired
 * inputs, so both branches always compute (the engine is eager dataflow).
 * Cheap and simple for picking between two already-cheap values.
 *
 * If is the lazy conditional — the functional-programming keystone. Its
 * branches are subgraph definitions (thunks); only the taken one is applied
 * (RunContext.apply), the other never evaluates. That is what recursion
 * terminates through: with the base case in one branch subgraph and the
 * recursive call in the other, a self-instancing definition bottoms out at
 * the base case. Through an eager node both sides would evaluate on every
 * level, and the recursion could only stop at the depth limit — in error.
 *
 * Branch shape: 1 output; 1 input (receives the value) or 0 inputs (a
 * constant base case). Both branches are validated up front, so a miswired
 * branch errors deterministically instead of only when the cond flips.
 */

import { defineNode } from '../../core/registry'
import type { SubgraphDefMeta } from '../../core/subgraph'
import { ANY, BOOLEAN } from '../../core/types'
import { applyOf, fnParam, installFnPickers, resolveFnDef } from './subgraph-fn'

defineNode({
  type: 'flow/select',
  title: 'Select',
  category: 'Flow',
  description: 'cond ? then : else. Both branches are always computed — for recursion or expensive branches use If.',
  inputs: [
    { name: 'cond', type: BOOLEAN },
    { name: 'then', type: ANY },
    { name: 'else', type: ANY },
  ] as const,
  outputs: [{ name: 'result', type: ANY }] as const,
  run: (inputs) => ({ result: (inputs.cond ?? false) ? inputs.then : inputs.else }),
})

function branchArity(meta: SubgraphDefMeta, param: string): void {
  if (meta.inputs.length > 1 || meta.outputs.length !== 1) {
    throw new Error(
      `if ${param} needs a 0-in or 1-in, 1-out subgraph ("${meta.name}" has ${meta.inputs.length} in / ${meta.outputs.length} out)`,
    )
  }
}

defineNode({
  type: 'flow/if',
  title: 'If',
  category: 'Flow',
  description:
    'Lazy cond: applies only the taken branch subgraph to the value (a 0-in branch is a constant). Recursion terminates through If — put the recursive call in a branch.',
  inputs: [
    { name: 'cond', type: BOOLEAN },
    { name: 'value', type: ANY },
  ] as const,
  outputs: [{ name: 'result', type: ANY }] as const,
  params: [fnParam('then'), fnParam('else')] as const,
  setup: (node) => installFnPickers(node, ['then', 'else']),
  run: async (inputs, params, ctx) => {
    const thenMeta = resolveFnDef(ctx, params.then, 'then')
    const elseMeta = resolveFnDef(ctx, params.else, 'else')
    branchArity(thenMeta, 'then')
    branchArity(elseMeta, 'else')
    const apply = applyOf(ctx)
    const meta = (inputs.cond ?? false) ? thenMeta : elseMeta
    const branchInputs = meta.inputs.length === 1 ? [inputs.value] : []
    return { result: (await apply(meta.id, branchInputs))[0] }
  },
})
