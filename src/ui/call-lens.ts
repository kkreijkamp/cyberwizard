/**
 * The call lens UI: step inside recorded subgraph calls and see each call's
 * values on the interior badges and in the inspect overlay.
 *  - Double-click an instance (or its enter-subgraph title button) to descend
 *    into the call that instance produced under the current lens: recursion
 *    becomes navigable one layer at a time.
 *  - Esc pops back out one call while the parent call is the same definition,
 *    then falls through to ordinary breadcrumb navigation.
 *  - A dropdown next to the breadcrumb lists every recorded call of the open
 *    definition ("top · n=5", "depth 3 · n=2", …) for direct jumps.
 *
 * The engine owns the lens (core/engine setLensPath); this module translates
 * navigation gestures into lens changes and keeps a per-definition memory of
 * the active lens (returning to a definition restores where you were).
 */

import { Subgraph, SubgraphNode } from '@comfyorg/litegraph'
import type { LGraph, LGraphCanvas as LGraphCanvasT, LGraphNode } from '@comfyorg/litegraph'
import type { CallInfo, Engine } from '../core/engine'
import { onSubgraphDefsChange } from '../core/subgraph'
import { repr } from '../core/types'
import { isInspectOpen } from './inspect'
import { onSetGraph } from './subgraphs'
import type { BreadcrumbHandle } from './subgraphs'

const MAX_LABEL_VALUE = 24

interface CanvasEventDetail {
  subType?: string
  node?: LGraphNode
}

interface SubgraphOpeningDetail {
  subgraph?: Subgraph
  closingGraph?: LGraph | Subgraph
}

/** LGraphButton isn't re-exported from the package root: we only need the name. */
interface TitleButtonLike {
  name?: string
}

/** Option label for one recorded call: its depth and (truncated) boundary inputs. */
export function callLabel(call: { path: string } & CallInfo): string {
  const inputs = call.inputs.map((value) => truncate(repr(value), MAX_LABEL_VALUE)).join(', ')
  return call.depth === 1 ? `top · ${inputs}` : `depth ${call.depth} · ${inputs}`
}

/** The lens path of the call `nodeId` produced inside the call at `base` (null = root). */
export function childCallPath(base: string | null, nodeId: number | string): string {
  return base === null ? String(nodeId) : `${base}/${String(nodeId)}`
}

/**
 * Where Esc moves the lens: one segment up while the parent call is the SAME
 * definition (recursion layers); null = let ordinary navigation handle it
 * (top call, or the parent call belongs to the enclosing definition).
 */
export function escPopTarget(
  lens: string,
  currentDefId: string,
  callInfo: (path: string) => CallInfo | undefined,
): string | null {
  const cut = lens.lastIndexOf('/')
  if (cut === -1) return null
  const parent = lens.slice(0, cut)
  return callInfo(parent)?.defId === currentDefId ? parent : null
}

export function installCallLens(
  engine: Engine,
  canvas: LGraphCanvasT,
  rootGraph: LGraph,
  breadcrumb: BreadcrumbHandle,
): void {
  /** The lens last active per open definition: restored when navigation returns. */
  const lensByGraph = new WeakMap<Subgraph, string>()
  /**
   * The lens captured when a subgraph starts opening. set-graph fires before
   * node-double-click and would clobber the lens with the target's default,
   * losing the base the child path is built from.
   */
  let pendingOpen: { subgraph: Subgraph; base: string | null } | null = null
  let lastSignature = ''

  // ─── Dropdown ─────────────────────────────────────────────────────────────

  const select = document.createElement('select')
  select.id = 'call-lens'
  select.hidden = true
  select.title = 'Which call of this definition to inspect'
  select.addEventListener('change', () => applyLens(select.value))
  breadcrumb.addExtra(select)

  function firstCallOf(graph: Subgraph): string | null {
    return engine.callsForDef(graph.id)[0]?.path ?? null
  }

  /** The lens to show for a freshly opened definition: remembered, else its first call. */
  function lensFor(graph: Subgraph): string | null {
    const remembered = lensByGraph.get(graph)
    if (remembered !== undefined && engine.callStore(remembered) !== undefined) return remembered
    return firstCallOf(graph)
  }

  function applyLens(path: string | null): void {
    engine.setLensPath(path)
    const graph = canvas.graph
    if (graph instanceof Subgraph) {
      const effective = engine.getLensPath()
      if (effective !== null) lensByGraph.set(graph, effective)
      else lensByGraph.delete(graph)
    }
    syncSelect()
  }

  function syncSelect(): void {
    const graph = canvas.graph
    const calls = graph instanceof Subgraph ? engine.callsForDef(graph.id) : []
    const lens = engine.getLensPath()
    // The engine may have fallen back to another call after a re-run: track it.
    if (graph instanceof Subgraph && lens !== null) lensByGraph.set(graph, lens)

    const signature = `${calls.map((c) => c.path).join('|')}\n${lens ?? ''}`
    select.hidden = calls.length === 0
    if (signature === lastSignature) return
    lastSignature = signature

    select.innerHTML = ''
    for (const call of calls) {
      const option = document.createElement('option')
      option.value = call.path
      option.textContent = callLabel(call)
      select.append(option)
    }
    if (lens !== null) select.value = lens
  }

  // ─── Descend: double-click body / enter-subgraph title button ─────────────

  /**
   * Moves the lens into the call `node` produced under the current lens. Only
   * fires when we're now inside the node's subgraph (navigation already
   * happened, or was prevented for self-entry) and the child call was recorded.
   */
  function descendToInstance(node: SubgraphNode): void {
    const open = pendingOpen
    pendingOpen = null
    if (canvas.graph !== node.subgraph) return
    const base = open && open.subgraph === node.subgraph ? open.base : engine.getLensPath()
    const child = childCallPath(base, node.id)
    if (engine.callStore(child) === undefined) return
    applyLens(child)
  }

  canvas.canvas.addEventListener('subgraph-opening', (e: Event) => {
    const { subgraph, closingGraph } = (e as CustomEvent).detail as SubgraphOpeningDetail
    if (!subgraph) return
    pendingOpen = { subgraph, base: engine.getLensPath() }
    // An open and its double-click/title-button complete synchronously in one
    // task; a programmatic openSubgraph (New Subgraph button) leaves a stale
    // base behind: expire it rather than descend from it later.
    queueMicrotask(() => {
      pendingOpen = null
    })
    // Self-entry (double-clicking the recursive instance): the library's
    // setGraph no-ops on the same graph, but its clear() would still wipe the
    // selection: veto the open; node-double-click descends the lens instead.
    if (subgraph === closingGraph) {
      const lens = engine.getLensPath()
      if (lens !== null && engine.hasCallsBelow(lens)) e.preventDefault()
    }
  })

  canvas.canvas.addEventListener('litegraph:canvas', (e: Event) => {
    const detail = (e as CustomEvent).detail as CanvasEventDetail
    if (detail?.subType !== 'node-double-click') return
    if (!(detail.node instanceof SubgraphNode)) return
    descendToInstance(detail.node)
  })

  // The enter-subgraph title button emits no event: wrap it (it calls
  // canvas.openSubgraph itself, so pendingOpen/subgraph-opening flow as above).
  const originalTitleButtonClick = SubgraphNode.prototype.onTitleButtonClick
  SubgraphNode.prototype.onTitleButtonClick = function (this: SubgraphNode, button: TitleButtonLike, c: LGraphCanvasT): void {
    originalTitleButtonClick.call(this, button as never, c as never)
    if (button.name === 'enter_subgraph') descendToInstance(this)
  }

  // ─── Navigation bookkeeping ────────────────────────────────────────────────

  onSetGraph(canvas, (newGraph) => {
    applyLens(newGraph instanceof Subgraph ? lensFor(newGraph) : null)
  })

  // Esc pops one call while the parent call is the same definition; otherwise
  // falls through to the breadcrumb (and to the inspect card first, when open).
  // Capture phase: preempts the breadcrumb's bubble listener without ordering
  // fragility.
  document.addEventListener(
    'keydown',
    (e) => {
      if (e.key !== 'Escape' || isInspectOpen()) return
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.target instanceof HTMLSelectElement) return
      const lens = engine.getLensPath()
      const graph = canvas.graph
      if (lens === null || !(graph instanceof Subgraph)) return
      const target = escPopTarget(lens, graph.id, (path) => engine.callInfo(path))
      if (target === null) return // top call, or parent is the enclosing def: breadcrumb navigates
      e.stopPropagation()
      applyLens(target)
    },
    true,
  )

  // ─── Refresh triggers ──────────────────────────────────────────────────────

  engine.onSettled(syncSelect)
  onSubgraphDefsChange(rootGraph, syncSelect)
  syncSelect()
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`
}
