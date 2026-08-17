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
 *
 * Subgraph instances (core/subgraph.ts) evaluate with call semantics: the
 * instance is one node in its parent's topo order; running it evaluates the
 * definition's interior with the instance inputs bound at the input panel and
 * reads the output panel back as the instance's outputs. Interior node state
 * is cached per instance path, so unchanged instances never re-run and
 * interior edits re-evaluate only the affected branch. Recursion (a
 * definition containing an instance of itself) is bounded by a depth limit
 * and a per-call-tree evaluation budget.
 */

import type { LGraph, LGraphNode, NodeId, Subgraph, SubgraphNode } from '@comfyorg/litegraph'
import type { DataType } from './types'
import { ANY, repr } from './types'
import { CoercionError, coerce } from './coerce'
import type { SlotDef } from './registry'
import { PREVIEW_WIDGET_NAME, getNodeDef, setDirtyHandler } from './registry'
import type { SubgraphDefMeta } from './subgraph'
import { getSubgraphDef } from './subgraph'

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

/** Max call depth for nested instances — the guard on true recursive self-reference. */
export const MAX_SUBGRAPH_DEPTH = 64
/** Max interior evaluations per instance call tree — guards exponential recursion fan-out. */
export const SUBGRAPH_EVAL_BUDGET = 1000

type InputStatus = 'ok' | 'empty' | 'blocked' | 'stale'

interface ResolvedInput {
  status: InputStatus
  value: unknown
  fromType: DataType
}

/**
 * One evaluation context: the root graph, or the interior of one subgraph
 * definition during an instance run. Interior scopes have their own state
 * store (per instance path) and share the enclosing run's abort signal, so
 * cancelling a root-level instance unwinds the whole call tree.
 */
interface EvalScope {
  /** Graph whose nodes are evaluated (root, or a definition's Subgraph). */
  graph: LGraph
  /** Node states for this scope (the root scope reuses the engine's own map). */
  store: Map<NodeId, NodeState>
  /** Instance path from the root ('' at root; "12/7" inside nested instances). */
  path: string
  /** Ids of the definitions enclosing this scope — recursion detection. */
  defStack: readonly string[]
  /** Shared call-tree evaluation budget (created by the root-level instance). */
  budget: { remaining: number } | null
  /** Cancellation of the enclosing instance run (null at root). */
  signal: AbortSignal | null
  /** Boundary bindings when this scope is a definition interior. */
  boundary: {
    inputPanelId: NodeId
    inputs: readonly unknown[]
    inputDefs: readonly SlotDef[]
  } | null
}

export class Engine {
  private readonly states = new Map<NodeId, NodeState>()
  private readonly abortControllers = new Map<NodeId, AbortController>()
  /** Interior node states, keyed by instance path ("12", "12/7", …). */
  private readonly interiorStores = new Map<string, Map<NodeId, NodeState>>()
  /**
   * Precise interior re-evaluation seeds written by the subgraph coordinator
   * (core/subgraph.ts): which interior nodes must re-run on the instance's
   * next evaluation. Absent entry = re-run everything downstream of the
   * input panel (the conservative default when instance inputs changed).
   * `invalidatedSeeds` marks paths whose seeds must be ignored because fresh
   * values flowed into the instance since the seeds were written.
   */
  private readonly pendingSeeds = new Map<string, Set<NodeId>>()
  private readonly invalidatedSeeds = new Set<string>()
  private scheduled = false
  private evaluating = false
  private rerunRequested = false
  private idleWaiters: Array<() => void> = []
  private readonly previousOnNodeAdded: LGraph['onNodeAdded']
  private readonly previousOnNodeRemoved: LGraph['onNodeRemoved']

  constructor(readonly graph: LGraph) {
    setDirtyHandler(graph, (node) => this.markDirty(node))
    this.previousOnNodeAdded = graph.onNodeAdded
    graph.onNodeAdded = (node) => {
      this.previousOnNodeAdded?.call(graph, node)
      this.markDirty(node)
    }
    this.previousOnNodeRemoved = graph.onNodeRemoved
    graph.onNodeRemoved = (node) => {
      this.previousOnNodeRemoved?.call(graph, node)
      this.forget(node)
    }
    for (const node of graph._nodes) this.markDirty(node)
    this.schedule()
  }

  dispose(): void {
    setDirtyHandler(this.graph, undefined)
    this.graph.onNodeAdded = this.previousOnNodeAdded
    this.graph.onNodeRemoved = this.previousOnNodeRemoved
  }

  /**
   * Drop all engine state for a removed node: abort its in-flight run and
   * delete its state entry so a dirty flag on a ghost can never wedge the
   * evaluation loop. (markDirty may still re-create a state lazily via
   * connection callbacks firing during removal — anyDirty() guards on graph
   * membership for exactly that reason.) Also drops interior state rooted at
   * a removed subgraph instance.
   */
  private forget(node: LGraphNode): void {
    this.abortControllers.get(node.id)?.abort()
    this.abortControllers.delete(node.id)
    this.states.delete(node.id)
    const path = String(node.id)
    const prefix = `${path}/`
    for (const key of [...this.interiorStores.keys()]) {
      if (key === path || key.startsWith(prefix)) this.interiorStores.delete(key)
    }
    for (const key of [...this.pendingSeeds.keys()]) {
      if (key === path || key.startsWith(prefix)) this.pendingSeeds.delete(key)
    }
    for (const key of [...this.invalidatedSeeds]) {
      if (key === path || key.startsWith(prefix)) this.invalidatedSeeds.delete(key)
    }
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

  // ─── Subgraph coordinator API ─────────────────────────────────────────────

  /**
   * An interior node of a definition went dirty while `instance` (root-level)
   * is alive: seed a precise re-evaluation — on the instance's next run only
   * the seeded nodes and their interior downstream re-execute.
   */
  seedSubgraphInstanceDirty(instance: LGraphNode, interiorNodeId: NodeId): void {
    let seeds = this.pendingSeeds.get(String(instance.id))
    if (!seeds) {
      seeds = new Set()
      this.pendingSeeds.set(String(instance.id), seeds)
    }
    seeds.add(interiorNodeId)
    this.markDirty(instance)
  }

  /** An instance's own edges changed — its inputs may differ, so interior seeds are void. */
  instanceWiringChanged(instance: LGraphNode): void {
    this.pendingSeeds.delete(String(instance.id))
    this.invalidatedSeeds.add(String(instance.id))
    this.markDirty(instance)
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
    const scope: EvalScope = {
      graph: this.graph,
      store: this.states,
      path: '',
      defStack: [],
      budget: null,
      signal: null,
      boundary: null,
    }
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
      await this.runNode(node, s, scope)
    }
  }

  private async runNode(node: LGraphNode, s: NodeState, scope: EvalScope): Promise<void> {
    if (node.isSubgraphNode()) return this.runSubgraphNode(node, s, scope)

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
      const resolved = this.resolveInput(node, index, scope)
      if (resolved.status === 'stale') return
      if (resolved.status === 'blocked') {
        s.blocked = true
        s.error = undefined
        s.outputs = undefined
        s.dirty = false
        this.paint(node, s)
        this.propagateToDownstream(node, scope)
        return
      }
      try {
        inputs[slot.name] = coerce(resolved.value, resolved.fromType, slot.type)
      } catch (err) {
        this.captureError(node, s, err, scope)
        return
      }
    }

    const params: Record<string, unknown> = {}
    for (const p of def.params ?? []) params[p.name] = node.properties[p.name] ?? p.default

    // Interior nodes share the enclosing instance run's signal; only root
    // nodes get their own controller (keyed by id — interior ids from
    // different scopes would collide).
    const controller = scope.signal ? null : new AbortController()
    if (controller) this.abortControllers.set(node.id, controller)
    s.running = true
    try {
      const signal = scope.signal ?? (controller as AbortController).signal
      const result = await def.run(inputs, params, { signal, node })
      if (generation !== s.generation) return // superseded while running — discard
      s.outputs = def.outputs.map((o) => result[o.name])
      s.error = undefined
      s.blocked = false
      s.dirty = false
      this.paint(node, s)
      this.propagateToDownstream(node, scope)
    } catch (err) {
      if (generation !== s.generation) return
      this.captureError(node, s, err, scope)
    } finally {
      s.running = false
      if (controller && this.abortControllers.get(node.id) === controller) {
        this.abortControllers.delete(node.id)
      }
    }
  }

  /**
   * Call-semantics evaluation of a subgraph instance: bind the (coerced)
   * instance inputs at the definition's input panel, evaluate the interior in
   * the instance's own state store, read the output panel back.
   */
  private async runSubgraphNode(node: SubgraphNode, s: NodeState, scope: EvalScope): Promise<void> {
    const meta = getSubgraphDef(this.graph, node.type)
    const generation = s.generation
    if (!meta) {
      this.captureError(node, s, new Error(`unknown subgraph definition "${node.type}"`), scope)
      return
    }

    const inputValues: unknown[] = []
    for (const [index, slot] of meta.inputs.entries()) {
      const resolved = this.resolveInput(node, index, scope)
      if (resolved.status === 'stale') return
      if (resolved.status === 'blocked') {
        s.blocked = true
        s.error = undefined
        s.outputs = undefined
        s.dirty = false
        this.paint(node, s)
        this.propagateToDownstream(node, scope)
        return
      }
      try {
        inputValues[index] = coerce(resolved.value, resolved.fromType, slot.type)
      } catch (err) {
        this.captureError(node, s, err, scope)
        return
      }
    }

    if (scope.defStack.length >= MAX_SUBGRAPH_DEPTH) {
      this.captureError(
        node,
        s,
        new Error(`subgraph recursion depth limit (${MAX_SUBGRAPH_DEPTH}) exceeded`),
        scope,
      )
      return
    }
    const budget = scope.budget ?? { remaining: SUBGRAPH_EVAL_BUDGET }
    if (budget.remaining-- <= 0) {
      this.captureError(node, s, new Error('subgraph evaluation budget exhausted (runaway recursion?)'), scope)
      return
    }

    const controller = scope.signal ? null : new AbortController()
    if (controller) this.abortControllers.set(node.id, controller)
    const signal = scope.signal ?? (controller as AbortController).signal
    s.running = true
    try {
      const outputs = await this.evaluateInterior(node.subgraph, meta, inputValues, scope, budget, signal, node)
      if (generation !== s.generation) return // superseded while running — discard
      s.outputs = outputs
      s.error = undefined
      s.blocked = false
      s.dirty = false
      this.paint(node, s)
      this.propagateToDownstream(node, scope)
    } catch (err) {
      if (generation !== s.generation) return
      this.captureError(node, s, err, scope)
    } finally {
      s.running = false
      if (controller && this.abortControllers.get(node.id) === controller) {
        this.abortControllers.delete(node.id)
      }
    }
  }

  private async evaluateInterior(
    subgraph: Subgraph,
    meta: SubgraphDefMeta,
    inputValues: readonly unknown[],
    parentScope: EvalScope,
    budget: { remaining: number },
    signal: AbortSignal,
    instance: LGraphNode,
  ): Promise<unknown[]> {
    // Under true recursion (the definition is already on the call stack) each
    // level gets different data, so caching is meaningless — and unbounded.
    const recursiveReentry = parentScope.defStack.includes(meta.id)
    const path = parentScope.path === '' ? String(instance.id) : `${parentScope.path}/${String(instance.id)}`

    let store = recursiveReentry ? undefined : this.interiorStores.get(path)
    if (!store) {
      store = new Map()
      if (!recursiveReentry) this.interiorStores.set(path, store)
    }
    // Prune states of interior nodes removed since the last run.
    for (const id of store.keys()) if (!subgraph.getNodeById(id)) store.delete(id)

    // Seed dirtiness: precise seeds from interior edits, or everything
    // downstream of the input panel when the instance's inputs changed
    // (seed invalidation covers upstream re-runs and wiring changes).
    const invalidated = this.invalidatedSeeds.delete(path)
    const seeds = invalidated ? undefined : this.pendingSeeds.get(path)
    this.pendingSeeds.delete(path)
    const inputPanelId = subgraph.inputNode.id
    this.seedInterior(subgraph, store, seeds ?? new Set([inputPanelId]))

    const scope: EvalScope = {
      graph: subgraph,
      store,
      path,
      defStack: [...parentScope.defStack, meta.id],
      budget,
      signal,
      boundary: { inputPanelId, inputs: inputValues, inputDefs: meta.inputs },
    }

    const { order, cyclicIds } = topoOrder(subgraph, inputPanelId)
    for (const id of cyclicIds) {
      const node = subgraph.getNodeById(id)
      if (!node) continue
      const st = this.stateIn(store, node)
      st.error = new Error('graph contains a cycle through this node')
      st.outputs = undefined
      st.dirty = false
    }
    for (const node of order) {
      if (signal.aborted) throw new Error('subgraph run aborted')
      const st = this.stateIn(store, node)
      if (!st.dirty) continue
      await this.runNode(node, st, scope)
    }

    // The first interior error (in topo order) becomes the instance error.
    // Blocked nodes only exist downstream of an error, so this covers them.
    for (const node of order) {
      const st = store.get(node.id)
      if (st?.error) throw new Error(`[${node.title}] ${st.error.message}`)
    }

    return meta.outputs.map((slot, i) => this.readBoundaryOutput(subgraph, store, slot, i))
  }

  /** Marks the given starting points and everything downstream of them dirty in the store. */
  private seedInterior(graph: LGraph, store: Map<NodeId, NodeState>, starts: ReadonlySet<NodeId>): void {
    const reachable = new Set<NodeId>(starts)
    const stack = [...starts]
    while (stack.length > 0) {
      const id = stack.pop() as NodeId
      for (const link of graph._links.values()) {
        if (link.origin_id !== id || reachable.has(link.target_id)) continue
        reachable.add(link.target_id)
        stack.push(link.target_id)
      }
    }
    for (const node of graph._nodes) {
      if (reachable.has(node.id)) this.stateIn(store, node).dirty = true
    }
    // Nodes with no cached state start dirty regardless (see stateIn), so
    // first runs and freshly added interior nodes need no marking here.
  }

  /** Reads one declared output back from the interior, coerced to its slot type. */
  private readBoundaryOutput(
    subgraph: Subgraph,
    store: Map<NodeId, NodeState>,
    slot: SlotDef,
    index: number,
  ): unknown {
    const ioSlot = subgraph.outputs[index]
    const linkId = ioSlot?.linkIds?.[0]
    if (linkId == null) return undefined
    const link = subgraph.getLink(linkId)
    if (!link) return undefined
    const origin = subgraph.getNodeById(link.origin_id)
    if (!origin) return undefined
    const st = store.get(origin.id)
    if (!st) return undefined
    if (st.error) throw new Error(`[${origin.title}] ${st.error.message}`)
    if (st.blocked) throw new Error(`[${origin.title}] blocked upstream`)
    if (st.dirty || st.running) {
      throw new Error(`subgraph evaluation incomplete — "${origin.title}" never ran`)
    }
    return coerce(st.outputs?.[link.origin_slot], this.outputTypeOf(origin, link.origin_slot), slot.type)
  }

  private captureError(node: LGraphNode, s: NodeState, err: unknown, scope: EvalScope): void {
    s.error =
      err instanceof CoercionError || err instanceof Error ? err : new Error(String(err))
    s.outputs = undefined
    s.blocked = false
    s.dirty = false
    this.paint(node, s)
    this.propagateToDownstream(node, scope)
  }

  private resolveInput(node: LGraphNode, index: number, scope: EvalScope): ResolvedInput {
    const linkId = node.inputs[index]?.link
    if (linkId == null) return { status: 'empty', value: undefined, fromType: ANY }
    const link = scope.graph.getLink(linkId)
    if (!link) return { status: 'empty', value: undefined, fromType: ANY }

    // Boundary: the enclosing definition's input panel supplies the value.
    if (scope.boundary && link.origin_id === scope.boundary.inputPanelId) {
      const fromType = scope.boundary.inputDefs[link.origin_slot]?.type ?? ANY
      return { status: 'ok', value: scope.boundary.inputs[link.origin_slot], fromType }
    }

    const origin = scope.graph.getNodeById(link.origin_id)
    if (!origin) return { status: 'empty', value: undefined, fromType: ANY }

    const originState = this.stateIn(scope.store, origin)
    if (originState.error || originState.blocked) return { status: 'blocked', value: undefined, fromType: ANY }
    if (originState.dirty || originState.running) return { status: 'stale', value: undefined, fromType: ANY }
    return { status: 'ok', value: originState.outputs?.[link.origin_slot], fromType: this.outputTypeOf(origin, link.origin_slot) }
  }

  /** Declared output type of a node, whether a registry node or a subgraph instance. */
  private outputTypeOf(node: LGraphNode, slot: number): DataType {
    if (node.isSubgraphNode()) {
      return getSubgraphDef(this.graph, node.type)?.outputs[slot]?.type ?? ANY
    }
    return getNodeDef(node)?.outputs[slot]?.type ?? ANY
  }

  private propagateToDownstream(node: LGraphNode, scope: EvalScope): void {
    for (const output of node.outputs ?? []) {
      for (const linkId of output.links ?? []) {
        const target = scope.graph.getNodeById(scope.graph.getLink(linkId)?.target_id ?? null)
        if (!target) continue
        const s = this.stateIn(scope.store, target)
        s.dirty = true
        s.generation++
        // Cancellation lives at the root: interior runs share the enclosing
        // instance's signal, and interior ids could collide with root ids.
        if (scope.signal === null) this.abortControllers.get(target.id)?.abort()
        // Fresh values are flowing into this instance — precise interior
        // seeds no longer describe what must re-run.
        if (target.isSubgraphNode()) this.invalidatedSeeds.add(childPath(scope, target))
      }
    }
  }

  private paint(node: LGraphNode, s: NodeState): void {
    node.boxcolor = s.error ? COLOR_ERROR : s.blocked ? COLOR_BLOCKED : undefined

    // Live preview widget (present on all registry nodes with outputs, and on
    // subgraph instances via the factory class in core/subgraph.ts).
    const widget = node.widgets?.find((w) => w.name === PREVIEW_WIDGET_NAME) as
      | { value?: unknown }
      | undefined
    if (!widget) return
    if (s.error) {
      widget.value = `⚠ ${s.error.message}`
    } else if (s.blocked) {
      widget.value = '⏸ blocked upstream'
    } else if (s.outputs) {
      const outputs = node.isSubgraphNode()
        ? getSubgraphDef(this.graph, node.type)?.outputs
        : getNodeDef(node)?.outputs
      widget.value = outputs
        ? outputs.map((o, i) => `${o.name}: ${repr(s.outputs?.[i])}`).join('\n')
        : '∅'
    } else {
      widget.value = '∅'
    }
  }

  // ─── State storage ───────────────────────────────────────────────────────

  private state(node: LGraphNode): NodeState {
    return this.stateIn(this.states, node)
  }

  private stateIn(store: Map<NodeId, NodeState>, node: LGraphNode): NodeState {
    let s = store.get(node.id)
    if (!s) {
      // Nodes the engine never saw (e.g. added before attach, or foreign)
      // start dirty so the next pass evaluates them.
      s = { dirty: true, running: false, generation: 0, outputs: undefined, error: undefined, blocked: false }
      store.set(node.id, s)
    }
    return s
  }

  private anyDirty(): boolean {
    for (const [id, s] of this.states) {
      // Ghost states (node removed from the graph but re-dirtied by a late
      // connection callback) must not block quiescence.
      if (s.dirty && this.graph.getNodeById(id) !== null) return true
    }
    return false
  }
}

function childPath(scope: EvalScope, node: LGraphNode): string {
  return scope.path === '' ? String(node.id) : `${scope.path}/${String(node.id)}`
}

/**
 * Kahn's algorithm over the graph's links. Nodes not emitted are in (or
 * downstream of) a cycle. Links originating at `ignoreOriginId` (a
 * definition's input panel) are excluded — the panel is a boundary seed, not
 * a node, and counting it would wedge interior nodes' indegrees.
 */
function topoOrder(graph: LGraph, ignoreOriginId?: NodeId): { order: LGraphNode[]; cyclicIds: Set<NodeId> } {
  const nodes = graph._nodes
  const byId = new Map<NodeId, LGraphNode>()
  const indegree = new Map<NodeId, number>()
  const downstream = new Map<NodeId, NodeId[]>()

  for (const node of nodes) {
    byId.set(node.id, node)
    indegree.set(node.id, 0)
  }
  for (const link of graph._links.values()) {
    if (ignoreOriginId !== undefined && link.origin_id === ignoreOriginId) continue
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
