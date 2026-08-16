/**
 * The execution engine — the piece that makes CyberWizard a reactive dataflow
 * system rather than a frame-polled LiteGraph demo.
 *
 * Semantics:
 *  - Editing a param or changing a connection marks the node dirty; dirtiness
 *    propagates to everything downstream (cycle-safe).
 *  - Evaluation is microtask-batched: a burst of edits triggers one pass.
 *  - Each pass walks dirty nodes in topological order (Kahn). A node reads
 *    its inputs from upstream output caches, coerces them to its declared
 *    slot types, runs (possibly async), and caches its outputs.
 *  - Stale-run cancellation: every run records the node's generation; if the
 *    node was marked dirty again while the run was in flight, the result is
 *    discarded and a fresh run follows.
 *  - Errors are captured per node and block downstream nodes instead of
 *    cascading garbage values.
 *  - Nodes left over by Kahn's algorithm are (tainted by) cycles — they get a
 *    cycle error and never execute.
 */

import type { LGraph, LGraphNode, NodeId } from '@comfyorg/litegraph'
import type { DataType } from './types'
import { ANY } from './types'
import { CoercionError, coerce } from './coerce'
import { getNodeDef, setDirtyHandler } from './registry'

export interface NodeState {
  dirty: boolean
  running: boolean
  /** Bumped on every dirty-mark; runs capture it to detect supersession. */
  generation: number
  outputs: readonly unknown[] | undefined
  error: Error | undefined
  /** True when an upstream node errored and this node was skipped. */
  blocked: boolean
}

const COLOR_ERROR = '#ef4444'
const COLOR_BLOCKED = '#6b7280'

type InputStatus = 'ok' | 'empty' | 'blocked' | 'stale'

interface ResolvedInput {
  status: InputStatus
  value: unknown
  fromType: DataType
}

export class Engine {
  private readonly states = new Map<NodeId, NodeState>()
  private readonly abortControllers = new Map<NodeId, AbortController>()
  private scheduled = false
  private evaluating = false
  private rerunRequested = false
  private idleWaiters: Array<() => void> = []
  private readonly previousOnNodeAdded: LGraph['onNodeAdded']

  constructor(readonly graph: LGraph) {
    setDirtyHandler(graph, (node) => this.markDirty(node))
    this.previousOnNodeAdded = graph.onNodeAdded
    graph.onNodeAdded = (node) => {
      this.previousOnNodeAdded?.call(graph, node)
      this.markDirty(node)
    }
    for (const node of graph._nodes) this.markDirty(node)
    this.schedule()
  }

  dispose(): void {
    setDirtyHandler(this.graph, undefined)
    this.graph.onNodeAdded = this.previousOnNodeAdded
  }

  stateOf(node: LGraphNode): Readonly<NodeState> {
    return this.state(node)
  }

  /** Current cached outputs of a node, undefined if it never ran cleanly. */
  outputsOf(node: LGraphNode): readonly unknown[] | undefined {
    return this.state(node).outputs
  }

  /** Resolves when no evaluation is running/scheduled and no node is dirty. */
  async whenIdle(): Promise<void> {
    while (this.evaluating || this.scheduled || this.anyDirty()) {
      await new Promise<void>((resolve) => this.idleWaiters.push(resolve))
    }
  }

  markDirty(node: LGraphNode): void {
    const stack: LGraphNode[] = [node]
    const visited = new Set<NodeId>()
    while (stack.length > 0) {
      const current = stack.pop() as LGraphNode
      if (visited.has(current.id)) continue
      visited.add(current.id)

      const s = this.state(current)
      s.dirty = true
      s.generation++
      this.abortControllers.get(current.id)?.abort()

      for (const output of current.outputs ?? []) {
        for (const linkId of output.links ?? []) {
          const target = this.graph.getNodeById(this.graph.getLink(linkId)?.target_id ?? null)
          if (target) stack.push(target)
        }
      }
    }
    this.schedule()
  }

  // ─── Evaluation ──────────────────────────────────────────────────────────

  private schedule(): void {
    if (this.scheduled) return
    this.scheduled = true
    queueMicrotask(() => {
      this.scheduled = false
      void this.evaluate()
    })
  }

  private async evaluate(): Promise<void> {
    if (this.evaluating) {
      this.rerunRequested = true
      return
    }
    this.evaluating = true
    try {
      do {
        this.rerunRequested = false
        await this.evaluatePass()
      } while (this.rerunRequested || this.anyDirty())
    } finally {
      this.evaluating = false
      this.drainIdleWaiters()
    }
  }

  private drainIdleWaiters(): void {
    if (this.anyDirty() || this.scheduled) return
    const waiters = this.idleWaiters.splice(0)
    for (const resolve of waiters) resolve()
  }

  private async evaluatePass(): Promise<void> {
    const { order, cyclicIds } = topoOrder(this.graph)

    for (const id of cyclicIds) {
      const node = this.graph.getNodeById(id)
      if (!node) continue
      const s = this.state(node)
      s.error = new Error('graph contains a cycle through this node')
      s.outputs = undefined
      s.dirty = false
      this.paint(node, s)
    }

    for (const node of order) {
      const s = this.state(node)
      if (!s.dirty) continue
      await this.runNode(node, s)
    }
  }

  private async runNode(node: LGraphNode, s: NodeState): Promise<void> {
    const def = getNodeDef(node)
    if (!def) {
      // Foreign node (not created via defineNode) — outside engine semantics.
      s.dirty = false
      return
    }
    const generation = s.generation

    // Gather inputs from upstream caches; upstream errors block this node.
    // A dirty/running upstream means its cached output is stale (its fresh run
    // was superseded mid-pass) — skip and let the next pass run us properly.
    const inputs: Record<string, unknown> = {}
    for (const [index, slot] of def.inputs.entries()) {
      const resolved = this.resolveInput(node, index)
      if (resolved.status === 'stale') return
      if (resolved.status === 'blocked') {
        s.blocked = true
        s.error = undefined
        s.outputs = undefined
        s.dirty = false
        this.paint(node, s)
        this.propagateToDownstream(node)
        return
      }
      try {
        inputs[slot.name] = coerce(resolved.value, resolved.fromType, slot.type)
      } catch (err) {
        this.captureError(node, s, err)
        return
      }
    }

    const params: Record<string, unknown> = {}
    for (const p of def.params ?? []) params[p.name] = node.properties[p.name] ?? p.default

    const controller = new AbortController()
    this.abortControllers.set(node.id, controller)
    s.running = true
    try {
      const result = await def.run(inputs, params, { signal: controller.signal, node })
      if (generation !== s.generation) return // superseded while running — discard
      s.outputs = def.outputs.map((o) => result[o.name])
      s.error = undefined
      s.blocked = false
      s.dirty = false
      this.paint(node, s)
      this.propagateToDownstream(node)
    } catch (err) {
      if (generation !== s.generation) return
      this.captureError(node, s, err)
    } finally {
      s.running = false
      if (this.abortControllers.get(node.id) === controller) {
        this.abortControllers.delete(node.id)
      }
    }
  }

  private captureError(node: LGraphNode, s: NodeState, err: unknown): void {
    s.error =
      err instanceof CoercionError || err instanceof Error ? err : new Error(String(err))
    s.outputs = undefined
    s.blocked = false
    s.dirty = false
    this.paint(node, s)
    this.propagateToDownstream(node)
  }

  private resolveInput(node: LGraphNode, index: number): ResolvedInput {
    const linkId = node.inputs[index]?.link
    if (linkId == null) return { status: 'empty', value: undefined, fromType: ANY }
    const link = this.graph.getLink(linkId)
    if (!link) return { status: 'empty', value: undefined, fromType: ANY }
    const origin = this.graph.getNodeById(link.origin_id)
    if (!origin) return { status: 'empty', value: undefined, fromType: ANY }

    const originState = this.state(origin)
    if (originState.error || originState.blocked) return { status: 'blocked', value: undefined, fromType: ANY }
    if (originState.dirty || originState.running) return { status: 'stale', value: undefined, fromType: ANY }
    const fromType = getNodeDef(origin)?.outputs[link.origin_slot]?.type ?? ANY
    return { status: 'ok', value: originState.outputs?.[link.origin_slot], fromType }
  }

  private propagateToDownstream(node: LGraphNode): void {
    for (const output of node.outputs ?? []) {
      for (const linkId of output.links ?? []) {
        const target = this.graph.getNodeById(this.graph.getLink(linkId)?.target_id ?? null)
        if (!target) continue
        const s = this.state(target)
        s.dirty = true
        s.generation++
        this.abortControllers.get(target.id)?.abort()
      }
    }
  }

  private paint(node: LGraphNode, s: NodeState): void {
    node.boxcolor = s.error ? COLOR_ERROR : s.blocked ? COLOR_BLOCKED : undefined
  }

  // ─── State storage ───────────────────────────────────────────────────────

  private state(node: LGraphNode): NodeState {
    let s = this.states.get(node.id)
    if (!s) {
      // Nodes the engine never saw (e.g. added before attach, or foreign)
      // start dirty so the next pass evaluates them.
      s = { dirty: true, running: false, generation: 0, outputs: undefined, error: undefined, blocked: false }
      this.states.set(node.id, s)
    }
    return s
  }

  private anyDirty(): boolean {
    for (const s of this.states.values()) if (s.dirty) return true
    return false
  }
}

/** Kahn's algorithm over the graph's links. Nodes not emitted are in (or downstream of) a cycle. */
function topoOrder(graph: LGraph): { order: LGraphNode[]; cyclicIds: Set<NodeId> } {
  const nodes = graph._nodes
  const byId = new Map<NodeId, LGraphNode>()
  const indegree = new Map<NodeId, number>()
  const downstream = new Map<NodeId, NodeId[]>()

  for (const node of nodes) {
    byId.set(node.id, node)
    indegree.set(node.id, 0)
  }
  for (const link of graph._links.values()) {
    indegree.set(link.target_id, (indegree.get(link.target_id) ?? 0) + 1)
    const list = downstream.get(link.origin_id)
    if (list) list.push(link.target_id)
    else downstream.set(link.origin_id, [link.target_id])
  }

  const queue = nodes.filter((n) => indegree.get(n.id) === 0).map((n) => n.id)
  const order: LGraphNode[] = []
  const emitted = new Set<NodeId>()

  for (let head = 0; head < queue.length; head++) {
    const id = queue[head] as NodeId
    const node = byId.get(id)
    if (!node || emitted.has(id)) continue
    emitted.add(id)
    order.push(node)
    for (const targetId of downstream.get(id) ?? []) {
      const remaining = (indegree.get(targetId) ?? 0) - 1
      indegree.set(targetId, remaining)
      if (remaining === 0) queue.push(targetId)
    }
  }

  const cyclicIds = new Set<NodeId>()
  for (const node of nodes) if (!emitted.has(node.id)) cyclicIds.add(node.id)
  return { order, cyclicIds }
}
