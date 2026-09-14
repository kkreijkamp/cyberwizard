/**
 * Flow: higher-order ops, map, filter, fold. Each applies a subgraph
 * definition per element (PLAN.md: "Map (apply subgraph per element)") via
 * the engine's RunContext.apply hook: same call semantics, recursion depth
 * limit, and per-call budget as instance evaluation.
 *
 * The subgraph-as-param machinery (picker dropdown, name resolution, arity
 * checks, the apply hook) is shared with the other higher-order ops in
 * flow/subgraph-fn.ts.
 */

import type { LGraphNode } from '@comfyorg/litegraph'
import { defineNode } from '../../core/registry'
import { ANY, listOf } from '../../core/types'
import { applyOf, fnParam, installFnPickers, requireArity, resolveFnDef } from './subgraph-fn'

const fnPicker = (node: LGraphNode): void => installFnPickers(node, ['fn'])

function elementError(op: string, index: number, err: unknown): Error {
  return new Error(`${op} element ${index}: ${err instanceof Error ? err.message : String(err)}`)
}

defineNode({
  type: 'flow/map',
  title: 'Map',
  category: 'Flow',
  description: 'Applies the picked 1-in-1-out subgraph to every element.',
  inputs: [{ name: 'items', type: listOf(ANY) }] as const,
  outputs: [{ name: 'items', type: listOf(ANY) }] as const,
  params: [fnParam('fn')] as const,
  setup: fnPicker,
  run: async (inputs, params, ctx) => {
    const meta = resolveFnDef(ctx, params.fn, 'fn')
    requireArity(meta, 1, 'map')
    const apply = applyOf(ctx)
    const out: unknown[] = []
    for (const [i, item] of (inputs.items ?? []).entries()) {
      try {
        out.push((await apply(meta.id, [item]))[0])
      } catch (err) {
        throw elementError('map', i, err)
      }
    }
    return { items: out }
  },
})

defineNode({
  type: 'flow/filter',
  title: 'Filter',
  category: 'Flow',
  description: 'Keeps elements for which the picked 1-in-1-out subgraph returns a truthy value.',
  inputs: [{ name: 'items', type: listOf(ANY) }] as const,
  outputs: [{ name: 'items', type: listOf(ANY) }] as const,
  params: [fnParam('fn')] as const,
  setup: fnPicker,
  run: async (inputs, params, ctx) => {
    const meta = resolveFnDef(ctx, params.fn, 'fn')
    requireArity(meta, 1, 'filter')
    const apply = applyOf(ctx)
    const out: unknown[] = []
    for (const [i, item] of (inputs.items ?? []).entries()) {
      try {
        if (await apply(meta.id, [item]).then((r) => r[0])) out.push(item)
      } catch (err) {
        throw elementError('filter', i, err)
      }
    }
    return { items: out }
  },
})

defineNode({
  type: 'flow/fold',
  title: 'Fold',
  category: 'Flow',
  description: 'Reduces the list with the picked 2-in-1-out subgraph: inputs are [acc, element], output is the new acc.',
  inputs: [
    { name: 'items', type: listOf(ANY) },
    { name: 'init', type: ANY },
  ] as const,
  outputs: [{ name: 'result', type: ANY }] as const,
  params: [fnParam('fn')] as const,
  setup: fnPicker,
  run: async (inputs, params, ctx) => {
    const meta = resolveFnDef(ctx, params.fn, 'fn')
    requireArity(meta, 2, 'fold')
    const apply = applyOf(ctx)
    let acc = inputs.init
    for (const [i, item] of (inputs.items ?? []).entries()) {
      try {
        acc = (await apply(meta.id, [acc, item]))[0]
      } catch (err) {
        throw elementError('fold', i, err)
      }
    }
    return { result: acc }
  },
})
