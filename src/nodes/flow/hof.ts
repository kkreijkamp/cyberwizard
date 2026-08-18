/**
 * Flow — higher-order ops: map, filter, fold. Each applies a subgraph
 * definition per element (PLAN.md: "Map (apply subgraph per element)") via
 * the engine's RunContext.apply hook — same call semantics, recursion depth
 * limit, and per-call budget as instance evaluation.
 *
 * The function is picked per node instance in the `fn` dropdown, which
 * setup() swaps for a combo listing the document's definitions (refreshed
 * live as definitions come and go). The param stores the definition *name*
 * so saved documents stay human-readable; renaming a definition means
 * re-picking it (the eval error says so).
 */

import type { LGraphNode } from '@comfyorg/litegraph'
import { defineNode, markNodeDirty, paramWidgets } from '../../core/registry'
import type { RunContext } from '../../core/registry'
import type { SubgraphDefMeta } from '../../core/subgraph'
import { allSubgraphDefs, onSubgraphDefsChange } from '../../core/subgraph'
import { ANY, listOf } from '../../core/types'

const NONE = '(none)'

const fnParam = {
  kind: 'string',
  name: 'fn',
  label: 'fn (subgraph)',
  default: '',
} as const

/** Swaps the fn text widget for a combo of the document's subgraph definitions. */
function installPicker(node: LGraphNode): void {
  const values = [NONE]
  const existing = paramWidgets(node).get('fn')
  if (existing) node.removeWidget(existing)
  const widget = node.addWidget(
    'combo',
    'fn',
    String(node.properties.fn ?? '') || NONE,
    (value: string) => {
      node.properties.fn = value
      markNodeDirty(node)
    },
    { values },
  )
  paramWidgets(node).set('fn', widget as never)

  const refresh = (): void => {
    const root = node.graph?.rootGraph
    if (!root) return
    values.splice(1, values.length, ...allSubgraphDefs(root).map((d) => d.name))
  }

  let unsubscribe: (() => void) | undefined
  node.onAdded = () => {
    refresh()
    const root = node.graph?.rootGraph
    if (root) {
      unsubscribe?.()
      unsubscribe = onSubgraphDefsChange(root, refresh)
    }
  }
  node.onRemoved = () => {
    unsubscribe?.()
    unsubscribe = undefined
  }
}

function resolveDef(ctx: RunContext, name: unknown): SubgraphDefMeta {
  if (typeof name !== 'string' || name === '' || name === NONE) {
    throw new Error('no subgraph selected — pick one in the node’s fn dropdown')
  }
  const root = ctx.node?.graph?.rootGraph
  const meta = root ? allSubgraphDefs(root).find((d) => d.name === name) : undefined
  if (!meta) throw new Error(`subgraph "${name}" not found (renamed? re-pick it in fn)`)
  return meta
}

function requireArity(meta: SubgraphDefMeta, inputs: number, op: string): void {
  if (meta.inputs.length !== inputs || meta.outputs.length !== 1) {
    throw new Error(
      `${op} needs a ${inputs}-in-1-out subgraph ("${meta.name}" has ${meta.inputs.length} in / ${meta.outputs.length} out)`,
    )
  }
}

function applyOf(ctx: RunContext): NonNullable<RunContext['apply']> {
  if (!ctx.apply) throw new Error('this op needs engine apply support')
  return ctx.apply
}

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
  params: [fnParam] as const,
  setup: installPicker,
  run: async (inputs, params, ctx) => {
    const meta = resolveDef(ctx, params.fn)
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
  params: [fnParam] as const,
  setup: installPicker,
  run: async (inputs, params, ctx) => {
    const meta = resolveDef(ctx, params.fn)
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
  params: [fnParam] as const,
  setup: installPicker,
  run: async (inputs, params, ctx) => {
    const meta = resolveDef(ctx, params.fn)
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
