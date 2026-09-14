/**
 * Flow: conditionals. Both are lazy, the untaken branch never runs.
 *
 * Select is the value-level ternary: cond ? then : else, with the branches
 * as ordinary wired inputs. Its then/else slots are lazy (def.lazyInputs):
 * the engine evaluates only the one Select pulls. That is what recursion
 * terminates through: the branch feeding the recursive call is never pulled
 * once the base case holds, so a self-instancing definition bottoms out
 * instead of demanding its own output forever.
 *
 * If is the branch-subgraph conditional: its branches are definitions
 * (thunks) picked in the then/else dropdowns, and only the taken one is
 * applied (RunContext.apply). Use it when the branches are worth naming and
 * reusing; use Select for inline wiring. Branch shape: 1 output; 1 input
 * (receives the value) or 0 inputs (a constant base case). Both branches
 * are validated up front, so a miswired branch errors deterministically
 * instead of only when the cond flips.
 */

import { defineNode } from '../../core/registry'
import type { SubgraphDefMeta } from '../../core/subgraph'
import { ANY, BOOLEAN } from '../../core/types'
import { applyOf, fnParam, installFnPickers, resolveFnDef } from './subgraph-fn'

defineNode({
  type: 'flow/select',
  title: 'Select',
  category: 'Flow',
  description: 'cond ? then : else, lazy: only the taken branch is evaluated, so recursion terminates through it.',
  inputs: [
    { name: 'cond', type: BOOLEAN },
    { name: 'then', type: ANY },
    { name: 'else', type: ANY },
  ] as const,
  outputs: [{ name: 'result', type: ANY }] as const,
  lazyInputs: ['then', 'else'],
  run: async (inputs, _params, ctx) => ({
    result: (inputs.cond ?? false) ? await ctx.pull('then') : await ctx.pull('else'),
  }),
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
    'Lazy cond: applies only the taken branch subgraph to the value (a 0-in branch is a constant). Recursion terminates through If, put the recursive call in a branch.',
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
