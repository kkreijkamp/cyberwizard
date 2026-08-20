/**
 * Flow — shared machinery for ops that take subgraph definitions as params
 * (map/filter/fold's `fn`, If's `then`/`else`).
 *
 * The function is picked per node instance in a dropdown, which
 * installFnPickers() swaps for a combo listing the document's definitions
 * (refreshed live as definitions come and go). The param stores the
 * definition *name* so saved documents stay human-readable; renaming a
 * definition means re-picking it (the eval error says so).
 */

import type { LGraphNode } from '@comfyorg/litegraph'
import { markNodeDirty, paramWidgets } from '../../core/registry'
import type { RunContext } from '../../core/registry'
import type { SubgraphDefMeta } from '../../core/subgraph'
import { allSubgraphDefs, getSubgraphDef, onSubgraphDefsChange, resolveVisibleDef, visibleSubgraphDefs } from '../../core/subgraph'

const NONE = '(none)'

/** A string param holding a subgraph name; setup() swaps its widget for a picker. */
export function fnParam<N extends string>(name: N) {
  return { kind: 'string', name, label: `${name} (subgraph)`, default: '', subgraphRef: true } as const
}

/**
 * Swaps the named params' text widgets for combos of the document's subgraph
 * definitions. One call installs all of a node's pickers so the add/remove
 * subscriptions are shared (per-param installs would clobber each other's
 * onAdded/onRemoved).
 */
export function installFnPickers(node: LGraphNode, names: readonly string[]): void {
  const pickers = names.map((name) => {
    const values = [NONE]
    const existing = paramWidgets(node).get(name)
    if (existing) node.removeWidget(existing)
    const widget = node.addWidget(
      'combo',
      name,
      String(node.properties[name] ?? '') || NONE,
      (value: string) => {
        node.properties[name] = value
        markNodeDirty(node)
      },
      { values },
    )
    paramWidgets(node).set(name, widget as never)
    return values
  })

  const refresh = (): void => {
    const root = node.graph?.rootGraph
    if (!root) return
    // Only definitions visible from this node's location (its lexical chain).
    const defs = visibleSubgraphDefs(root, node.graph).map((d) => d.name)
    for (const values of pickers) values.splice(1, values.length, ...defs)
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

/** Resolves a picked subgraph name to its definition metadata, with actionable errors. */
export function resolveFnDef(ctx: RunContext, picked: unknown, param: string): SubgraphDefMeta {
  if (typeof picked !== 'string' || picked === '' || picked === NONE) {
    throw new Error(`no subgraph selected for ${param} — pick one in the node’s ${param} dropdown`)
  }
  const root = ctx.node?.graph?.rootGraph
  const meta = root ? resolveVisibleDef(root, ctx.node.graph, picked) : undefined
  if (meta) return meta
  const global = root ? allSubgraphDefs(root).find((d) => d.name === picked) : undefined
  if (root && global?.scope) {
    const parentName = getSubgraphDef(root, global.scope)?.name ?? global.scope
    throw new Error(`subgraph "${picked}" is scoped to "${parentName}" — not visible here`)
  }
  throw new Error(`subgraph "${picked}" not found (renamed? re-pick it in ${param})`)
}

/** Higher-order ops take exactly `inputs`-in-1-out definitions. */
export function requireArity(meta: SubgraphDefMeta, inputs: number, op: string): void {
  if (meta.inputs.length !== inputs || meta.outputs.length !== 1) {
    throw new Error(
      `${op} needs a ${inputs}-in-1-out subgraph ("${meta.name}" has ${meta.inputs.length} in / ${meta.outputs.length} out)`,
    )
  }
}

export function applyOf(ctx: RunContext): NonNullable<RunContext['apply']> {
  if (!ctx.apply) throw new Error('this op needs engine apply support')
  return ctx.apply
}
