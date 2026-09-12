/**
 * The execution engine — demand-driven reactive dataflow.
 *
 * Semantics:
 *  - Sinks drive evaluation. Registry nodes with no declared outputs
 *    (Preview, Download) are pull roots: a microtask-batched flush ensures
 *    each dirty sink, which recursively ensures the upstream nodes it
 *    actually reads from. Nodes nothing demands never run — a disconnected
 *    branch, an unwired cycle, or the untaken side of a conditional.
 *  - Editing a param or changing a connection marks the node dirty;
 *    dirtiness propagates downstream (cycle-safe). Pulling re-runs only
 *    dirty nodes — clean cached outputs are memo hits, so evaluation work
 *    is confined to what changed AND what is demanded.
 *  - Lazy inputs (a def's `lazyInputs`, e.g. Select's then/else) are not
 *    pre-evaluated: the op pulls them on demand via RunContext.pull. The
 *    untaken branch never runs, so recursion terminates through an ordinary
 *    conditional — no subgraph-thunk ceremony required.
 *  - Stale-run cancellation: every run records the node's generation; if the
 *    node was marked dirty again while the run was in flight, the result is
 *    discarded and the node stays dirty for the next flush.
 *  - Errors are captured per node and block downstream nodes instead of
 *    cascading garbage values.
 *  - A pull that (transitively) demands the node itself is a cycle: the
 *    nodes on the cycle get a cycle error and never execute. Pulls within a
 *    scope are sequential — the pull stack is the single active chain, which
 *    is what makes re-entrancy detection exact (never Promise.all ensures).
 *
 * Subgraph instances (core/subgraph.ts) evaluate with call semantics: the
 * instance is one pull away in its parent; ensuring it evaluates the
 * definition's interior with the instance inputs bound at the input panel
 * and reads the output panel back. Interior evaluation is itself pull-based:
 * the output panel's feeders plus interior sinks (e.g. a Preview inside a
 * definition) are the pull roots, so dead interior branches don't run and
 * can't fail the instance. Interior node state is cached per instance path,
 * so unchanged instances never re-run and interior edits re-evaluate only
 * the affected branch. Recursion (a definition containing an instance of
 * itself) is bounded by a depth limit and a per-call-tree evaluation budget.
 */

import type { LGraph, LGraphNode, NodeId, Subgraph, SubgraphNode } from '@comfyorg/litegraph'
import type { DataType } from './types'
import { ANY, dataTypeFromKind, fromSlotType, inferDataType, repr } from './types'
import { CoercionError, coerce } from './coerce'
import type { SlotDef, UntypedNodeDef } from './registry'
import { PREVIEW_WIDGET_NAME, getNodeDef, paramDataType, setDirtyHandler } from './registry'
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
  /** While blocked: the node whose error propagated here (the root cause). */
  cause: FailureCause | undefined
  /** In-flight ensure() promise — dedups concurrent pulls of the same node. */
  inFlight: Promise<void> | undefined
  /** True when this node sits on a detected cycle; its error sticks until an edit re-dirties it. */
  cycle: boolean
  /** The node's own colors, stashed while an error repaint overrides them. */
  savedColors: { color: string | undefined; bgcolor: string | undefined } | undefined
}

/** The node to blame for a propagated failure, with its error text. */
interface FailureCause {
  nodeId: NodeId
  title: string
  message: string
}

const COLOR_ERROR = '#ef4444'
const COLOR_ERROR_BG = '#3d1515'
const CYCLE_MESSAGE = 'graph contains a cycle through this node'

/** Max call depth for nested instances — the guard on true recursive self-reference. */
export const MAX_SUBGRAPH_DEPTH = 512
/** Max interior evaluations per instance call tree — guards exponential recursion fan-out. */
export const SUBGRAPH_EVAL_BUDGET = 1000

type InputStatus = 'ok' | 'empty' | 'blocked' | 'stale'

interface ResolvedInput {
  status: InputStatus
  value: unknown
  fromType: DataType
  /** Present on 'blocked': the root-cause node upstream. */
  cause?: FailureCause
}

/** Thrown out of RunContext.pull when the pulled slot's upstream errored/is blocked. */
class UpstreamBlocked extends Error {
  constructor(override readonly cause?: FailureCause) {
    super()
  }
}
/** Thrown out of RunContext.pull when the pulled slot's upstream was superseded mid-pull. */
class UpstreamStale extends Error {}

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
  /**
   * When true, interior stores under this scope are never retained (apply()
   * calls and recursive re-entries: values differ per call, caching is
   * meaningless — and for large maps, unbounded).
   */
  transient: boolean
  /** The active pull chain, innermost last — the cycle detector. */
  pullStack: LGraphNode[]
  /**
   * First error captured during this scope's pull, if any. A blocked output
   * panel feeder reports this as the instance error (the root cause), rather
   * than an uninformative "blocked upstream".
   */
  firstError: { title: string; message: string } | null
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
   * connection callbacks firing during removal.) Also drops interior state
   * rooted at a removed subgraph instance.
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

  /** True when the node currently shows a failure — its own error, or blocked by one upstream. */
  hasFailure(node: LGraphNode): boolean {
    return this.failureState(node) !== undefined
  }

  /**
   * The node to blame for this one's failure: the recorded upstream cause
   * when blocked, or the interior node whose error a subgraph instance
   * wrapped (descend one level per call). Undefined when the node itself is
   * the root cause — or when it isn't failing. Backs the node menu's
   * "Go to failure source" action (ui/compute-menu.ts).
   */
  failureSource(node: LGraphNode): { node: LGraphNode; message: string } | undefined {
    const found = this.failureState(node)
    if (!found) return undefined
    const { s, graph } = found
    if (s.error) {
      if (node.isSubgraphNode()) return this.interiorFailure(node)
      return undefined
    }
    if (s.cause) {
      const origin = graph.getNodeById(s.cause.nodeId)
      if (origin) return { node: origin, message: s.cause.message }
    }
    return undefined
  }

  /** The failing state for a node, whether it lives at root or in a retained instance interior. */
  private failureState(node: LGraphNode): { s: NodeState; graph: LGraph } | undefined {
    const root = this.states.get(node.id)
    if (root && (root.error || root.blocked)) return { s: root, graph: this.graph }
    for (const store of this.interiorStores.values()) {
      const s = store.get(node.id)
      if (s && (s.error || s.blocked) && node.graph) return { s, graph: node.graph as LGraph }
    }
    return undefined
  }

  /** The first errored node inside a failed instance's interior, if its store was retained. */
  private interiorFailure(instance: LGraphNode): { node: LGraphNode; message: string } | undefined {
    const store = this.interiorStores.get(String(instance.id))
    const sub = (instance as SubgraphNode).subgraph
    if (!store || !sub) return undefined
    for (const [id, s] of store) {
      if (s.error) {
        const inner = sub.getNodeById(id)
        if (inner) return { node: inner, message: s.error.message }
      }
    }
    return undefined
  }

  /** Current cached outputs of a node, undefined if it never ran cleanly. */
  outputsOf(node: LGraphNode): readonly unknown[] | undefined {
    return this.state(node).outputs
  }

  /** Resolves when no flush is running or scheduled and no compute() is in flight. */
  async whenIdle(): Promise<void> {
    while (this.evaluating || this.scheduled || this.pendingComputes > 0) {
      await new Promise<void>((resolve) => this.idleWaiters.push(resolve))
    }
  }

  /**
   * Pulls one node on demand, as if a sink demanded it: the node and any
   * dirty upstream evaluate, clean cached values memo-hit, and the badge
   * repaints. The node menu's "Compute" action (ui/compute-menu.ts).
   */
  async compute(node: LGraphNode): Promise<void> {
    this.pendingComputes++
    try {
      await this.ensure(node, this.rootScope())
    } finally {
      this.pendingComputes--
      this.drainIdleWaiters()
    }
  }

  private pendingComputes = 0

  /**
   * Marks a node and everything downstream of it dirty. Fresh values may flow
   * into any instance reached this way, so its precise interior seeds are
   * void — except when the mark itself comes from seedSubgraphInstanceDirty
   * (preserveSeeds), which just wrote those seeds.
   */
  markDirty(node: LGraphNode, opts?: { preserveSeeds?: boolean }): void {
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

      if (current.isSubgraphNode() && !(opts?.preserveSeeds && current === node)) {
        this.invalidatedSeeds.add(String(current.id))
      }

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
   * is alive: seed a precise re-evaluation — on the instance's next pull only
   * the seeded nodes and their interior downstream re-execute.
   */
  seedSubgraphInstanceDirty(instance: LGraphNode, interiorNodeId: NodeId): void {
    let seeds = this.pendingSeeds.get(String(instance.id))
    if (!seeds) {
      seeds = new Set()
      this.pendingSeeds.set(String(instance.id), seeds)
    }
    seeds.add(interiorNodeId)
    this.markDirty(instance, { preserveSeeds: true })
  }

  /** An instance's own edges changed — its inputs may differ, so interior seeds are void. */
  instanceWiringChanged(instance: LGraphNode): void {
    this.pendingSeeds.delete(String(instance.id))
    this.invalidatedSeeds.add(String(instance.id))
    this.markDirty(instance)
  }

  // ─── Evaluation driver ───────────────────────────────────────────────────

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
        await this.pullSinks()
      } while (this.rerunRequested || this.anySinkDirty())
    } finally {
      this.evaluating = false
      this.drainIdleWaiters()
    }
  }

  private drainIdleWaiters(): void {
    if (this.evaluating || this.scheduled || this.pendingComputes > 0) return
    const waiters = this.idleWaiters.splice(0)
    for (const resolve of waiters) resolve()
  }

  /** A sink is a registry node with no outputs (Preview, Download) or a 0-output instance. */
  private isSink(node: LGraphNode): boolean {
    if (node.isSubgraphNode()) {
      return getSubgraphDef(this.graph, node.type)?.outputs.length === 0
    }
    return getNodeDef(node)?.outputs.length === 0
  }

  private rootScope(): EvalScope {
    return {
      graph: this.graph,
      store: this.states,
      path: '',
      defStack: [],
      budget: null,
      signal: null,
      boundary: null,
      transient: false,
      pullStack: [],
      firstError: null,
    }
  }

  private async pullSinks(): Promise<void> {
    const scope = this.rootScope()
    for (const node of this.graph._nodes) {
      if (this.isSink(node)) await this.ensure(node, scope)
    }
  }

  private anySinkDirty(): boolean {
    for (const node of this.graph._nodes) {
      if (this.states.get(node.id)?.dirty && this.isSink(node)) return true
    }
    return false
  }

  // ─── Pulling ─────────────────────────────────────────────────────────────

  /**
   * Ensures the node's cached state is fresh: runs it if dirty, returns
   * immediately on a memo hit, dedups concurrent pulls, and marks cycles on
   * re-entrant demand. Never rejects — every outcome lands in the node state.
   */
  private async ensure(node: LGraphNode, scope: EvalScope): Promise<void> {
    const s = this.stateIn(scope.store, node)
    if (!s.dirty) return
    const onStack = scope.pullStack.indexOf(node)
    if (onStack !== -1) {
      // Re-entrant pull: this node (transitively) demands itself. Every node
      // on the cycle gets the error; they never execute.
      for (const cyclic of scope.pullStack.slice(onStack)) {
        const st = this.stateIn(scope.store, cyclic)
        st.error = new Error(CYCLE_MESSAGE)
        st.outputs = undefined
        st.dirty = false
        st.cycle = true
        this.paint(cyclic, st)
      }
      return
    }
    if (s.inFlight) return s.inFlight
    s.inFlight = this.doEnsure(node, s, scope)
    try {
      await s.inFlight
    } finally {
      s.inFlight = undefined
    }
  }

  private async doEnsure(node: LGraphNode, s: NodeState, scope: EvalScope): Promise<void> {
    scope.pullStack.push(node)
    try {
      // A superseded interior run stops early; its result would be discarded
      // at the boundary anyway (generation check), so leave the state dirty.
      if (scope.signal?.aborted) return

      if (node.isSubgraphNode()) {
        return await this.ensureSubgraphInstance(node as SubgraphNode, s, scope)
      }

      const def = getNodeDef(node)
      if (!def) {
        // Foreign node (not created via defineNode) — outside engine semantics.
        s.dirty = false
        return
      }
      const generation = s.generation

      // Eager inputs: pulled up front. Lazy inputs (def.lazyInputs) are left
      // for the op to demand via RunContext.pull.
      const lazy = new Set(def.lazyInputs ?? [])
      const inputs: Record<string, unknown> = {}
      for (const [index, slot] of def.inputs.entries()) {
        if (lazy.has(slot.name)) continue
        const resolved = await this.pullInput(node, index, scope)
        if (resolved.status === 'stale') return
        if (resolved.status === 'blocked') {
          this.markBlocked(node, s, resolved.cause)
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

      // Converted widget inputs (core/registry convertParamToInput): params
      // promoted to connection points. A wired slot overrides the widget's
      // stored value; unwired, the widget value stands.
      for (let index = def.inputs.length; index < node.inputs.length; index++) {
        const slot = node.inputs[index]
        const paramName = (slot as { widget?: { name?: unknown } }).widget?.name
        if (typeof paramName !== 'string') continue
        const param = (def.params ?? []).find((p) => p.name === paramName)
        if (!param) continue
        const resolved = await this.pullInput(node, index, scope)
        if (resolved.status === 'stale') return
        if (resolved.status === 'blocked') {
          this.markBlocked(node, s, resolved.cause)
          return
        }
        if (resolved.status === 'empty') continue
        try {
          params[paramName] = coerce(resolved.value, resolved.fromType, paramDataType(param))
        } catch (err) {
          this.captureError(node, s, err, scope)
          return
        }
      }

      // Variadic inputs (Concat, List Pack): dynamically added slots past
      // the declared ones evaluate like declared slots, keyed by their
      // letter names (c, d, …) in the inputs record.
      if (def.variadicInputs) {
        for (let index = def.inputs.length; index < node.inputs.length; index++) {
          const slot = node.inputs[index]!
          if ((slot as { widget?: unknown }).widget !== undefined) continue // converted param, handled above
          const resolved = await this.pullInput(node, index, scope)
          if (resolved.status === 'stale') return
          if (resolved.status === 'blocked') {
            this.markBlocked(node, s, resolved.cause)
            return
          }
          if (resolved.status === 'empty') continue
          try {
            inputs[slot.name!] = coerce(resolved.value, resolved.fromType, dataTypeFromKind(fromSlotType(slot.type!)))
          } catch (err) {
            this.captureError(node, s, err, scope)
            return
          }
        }
      }

      // Interior nodes share the enclosing instance run's signal; only root
      // nodes get their own controller (keyed by id — interior ids from
      // different scopes would collide).
      const controller = scope.signal ? null : new AbortController()
      if (controller) this.abortControllers.set(node.id, controller)
      s.running = true
      try {
        const signal = scope.signal ?? (controller as AbortController).signal
        const result = await def.run(inputs, params, {
          signal,
          node,
          apply: (defId, applyInputs) => this.applySubgraph(defId, applyInputs, scope, signal),
          pull: (slotName) => this.pullSlot(node, def, slotName, scope),
        })
        if (generation !== s.generation) return // superseded while running — discard
        s.outputs = def.outputs.map((o) => result[o.name])
        s.error = undefined
        s.blocked = false
        s.cause = undefined
        s.dirty = false
        s.cycle = false
        this.paint(node, s)
      } catch (err) {
        if (generation !== s.generation) return
        if (err instanceof UpstreamBlocked) {
          this.markBlocked(node, s, err.cause)
          return
        }
        if (err instanceof UpstreamStale) return // stay dirty; a later flush retries
        this.captureError(node, s, err, scope)
      } finally {
        s.running = false
        if (controller && this.abortControllers.get(node.id) === controller) {
          this.abortControllers.delete(node.id)
        }
      }
    } finally {
      scope.pullStack.pop()
    }
  }

  /** Ensures the upstream feeding one input slot and resolves its value. */
  private async pullInput(node: LGraphNode, index: number, scope: EvalScope): Promise<ResolvedInput> {
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

    await this.ensure(origin, scope)
    const originState = this.stateIn(scope.store, origin)
    if (originState.error || originState.blocked) {
      // Propagate the root cause down the chain, so every blocked dependent
      // can name — and navigate to — the node actually at fault.
      const cause: FailureCause | undefined = originState.error
        ? { nodeId: origin.id, title: origin.title, message: originState.error.message }
        : originState.cause
      return { status: 'blocked', value: undefined, fromType: ANY, cause }
    }
    if (originState.dirty || originState.running) return { status: 'stale', value: undefined, fromType: ANY }
    return { status: 'ok', value: originState.outputs?.[link.origin_slot], fromType: this.outputTypeOf(origin, link.origin_slot) }
  }

  /** RunContext.pull: demand one (typically lazy) input slot's coerced value. */
  private async pullSlot(node: LGraphNode, def: UntypedNodeDef, slotName: string, scope: EvalScope): Promise<unknown> {
    const index = def.inputs.findIndex((slot) => slot.name === slotName)
    if (index === -1) throw new Error(`unknown input slot "${slotName}"`)
    const resolved = await this.pullInput(node, index, scope)
    if (resolved.status === 'blocked') throw new UpstreamBlocked(resolved.cause)
    if (resolved.status === 'stale') throw new UpstreamStale()
    return coerce(resolved.value, resolved.fromType, def.inputs[index]!.type)
  }

  /**
   * Call-semantics evaluation of a subgraph instance: bind the (coerced)
   * instance inputs at the definition's input panel, pull the interior's
   * sinks and output-panel feeders, read the output panel back.
   */
  private async ensureSubgraphInstance(node: SubgraphNode, s: NodeState, scope: EvalScope): Promise<void> {
    const meta = getSubgraphDef(this.graph, node.type)
    const generation = s.generation
    if (!meta) {
      this.captureError(node, s, new Error(`unknown subgraph definition "${node.type}"`), scope)
      return
    }

    const inputValues: unknown[] = []
    for (const [index, slot] of meta.inputs.entries()) {
      const resolved = await this.pullInput(node, index, scope)
      if (resolved.status === 'stale') return
      if (resolved.status === 'blocked') {
        this.markBlocked(node, s, resolved.cause)
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
      const outputs = await this.evaluateInterior(
        node.subgraph,
        meta,
        inputValues,
        scope,
        budget,
        signal,
        String(node.id),
      )
      if (generation !== s.generation) return // superseded while running — discard
      s.outputs = outputs
      s.error = undefined
      s.blocked = false
      s.cause = undefined
      s.dirty = false
      s.cycle = false
      this.paint(node, s)
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
   * Higher-order hook behind RunContext.apply: evaluate a definition once
   * with positional inputs. Each call gets a fresh evaluation budget (per-
   * element caps — recursion within one call is still depth-limited) and a
   * transient scope (stores are never retained: per-call values differ).
   */
  private async applySubgraph(
    defId: string,
    inputs: readonly unknown[],
    scope: EvalScope,
    signal: AbortSignal,
  ): Promise<readonly unknown[]> {
    const meta = getSubgraphDef(this.graph, defId)
    if (!meta) throw new Error(`unknown subgraph definition "${defId}"`)
    if (scope.defStack.length >= MAX_SUBGRAPH_DEPTH) {
      throw new Error(`subgraph recursion depth limit (${MAX_SUBGRAPH_DEPTH}) exceeded`)
    }
    const subgraph = this.graph.subgraphs.get(defId as never)
    if (!subgraph) throw new Error(`subgraph definition "${defId}" is missing from the document`)
    const budget = { remaining: SUBGRAPH_EVAL_BUDGET }
    // Like an instance boundary: coerce each value to the declared slot type,
    // inferring the source type from the runtime value itself.
    const bound = meta.inputs.map((slot, i) => coerce(inputs[i], inferDataType(inputs[i]), slot.type))
    return this.evaluateInterior(subgraph, meta, bound, scope, budget, signal, `apply${this.applySeq++}`)
  }

  private applySeq = 0

  private async evaluateInterior(
    subgraph: Subgraph,
    meta: SubgraphDefMeta,
    inputValues: readonly unknown[],
    parentScope: EvalScope,
    budget: { remaining: number },
    signal: AbortSignal,
    pathSegment: string,
  ): Promise<unknown[]> {
    // Store retention: instance runs in a stable scope keep their interior
    // caches; recursive re-entries and apply() calls evaluate transiently.
    const retained = !parentScope.transient && !parentScope.defStack.includes(meta.id)
    const path = parentScope.path === '' ? pathSegment : `${parentScope.path}/${pathSegment}`

    let store = retained ? this.interiorStores.get(path) : undefined
    if (!store) {
      store = new Map()
      if (retained) this.interiorStores.set(path, store)
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
      transient: !retained,
      pullStack: [],
      firstError: null,
    }

    // Interior sinks (a Preview inside the definition) are pull roots too —
    // they are why interior nodes off the output path ever run. Their errors
    // stay local (ensure captures per node; the instance result is unaffected).
    for (const node of subgraph._nodes) {
      if (signal.aborted) throw new Error('subgraph run aborted')
      if (this.isSink(node)) await this.ensure(node, scope)
    }

    const outputs: unknown[] = []
    for (const [index, slot] of meta.outputs.entries()) {
      if (signal.aborted) throw new Error('subgraph run aborted')
      outputs.push(await this.readBoundaryOutput(subgraph, scope, slot, index))
    }
    return outputs
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

  /** Ensures the feeder of one declared output, then reads it back coerced to the slot type. */
  private async readBoundaryOutput(
    subgraph: Subgraph,
    scope: EvalScope,
    slot: SlotDef,
    index: number,
  ): Promise<unknown> {
    const ioSlot = subgraph.outputs[index]
    const linkId = ioSlot?.linkIds?.[0]
    if (linkId == null) return undefined
    const link = subgraph.getLink(linkId)
    if (!link) return undefined

    // Pass-through: the output panel is wired straight from the input panel.
    if (scope.boundary && link.origin_id === scope.boundary.inputPanelId) {
      const fromType = scope.boundary.inputDefs[link.origin_slot]?.type ?? ANY
      return coerce(scope.boundary.inputs[link.origin_slot], fromType, slot.type)
    }

    const origin = subgraph.getNodeById(link.origin_id)
    if (!origin) return undefined
    await this.ensure(origin, scope)
    const st = scope.store.get(origin.id)
    if (!st) return undefined
    if (st.error) throw new Error(`[${origin.title}] ${st.error.message}`)
    if (st.blocked) {
      const first = scope.firstError
      throw new Error(first ? `[${first.title}] ${first.message}` : `[${origin.title}] blocked upstream`)
    }
    if (st.dirty || st.running) {
      throw new Error(`subgraph evaluation incomplete — "${origin.title}" never ran`)
    }
    return coerce(st.outputs?.[link.origin_slot], this.outputTypeOf(origin, link.origin_slot), slot.type)
  }

  private markBlocked(node: LGraphNode, s: NodeState, cause?: FailureCause): void {
    if (s.cycle) return // the cycle error is the more precise diagnosis — keep it
    s.blocked = true
    s.error = undefined
    s.cause = cause
    s.outputs = undefined
    s.dirty = false
    this.paint(node, s)
  }

  private captureError(node: LGraphNode, s: NodeState, err: unknown, scope: EvalScope): void {
    if (s.cycle) return
    s.error =
      err instanceof CoercionError || err instanceof Error ? err : new Error(String(err))
    s.outputs = undefined
    s.blocked = false
    s.cause = undefined
    s.dirty = false
    if (!scope.firstError) scope.firstError = { title: node.title, message: s.error.message }
    this.paint(node, s)
  }

  /** Declared output type of a node, whether a registry node or a subgraph instance. */
  private outputTypeOf(node: LGraphNode, slot: number): DataType {
    if (node.isSubgraphNode()) {
      return getSubgraphDef(this.graph, node.type)?.outputs[slot]?.type ?? ANY
    }
    return getNodeDef(node)?.outputs[slot]?.type ?? ANY
  }

  private paint(node: LGraphNode, s: NodeState): void {
    // Any failure — the node's own error, or an upstream one propagated to it
    // (blocked) — repaints the whole node red; the box strip alone is too easy
    // to miss. The node's own colors are stashed once so a later success
    // restores them.
    const failing = s.error !== undefined || s.blocked
    if (failing) {
      s.savedColors ??= { color: node.color, bgcolor: node.bgcolor }
      node.color = COLOR_ERROR
      node.bgcolor = COLOR_ERROR_BG
    } else if (s.savedColors) {
      node.color = s.savedColors.color
      node.bgcolor = s.savedColors.bgcolor
      s.savedColors = undefined
    }
    node.boxcolor = failing ? COLOR_ERROR : undefined

    // Live preview widget (present on all registry nodes with outputs, and on
    // subgraph instances via the factory class in core/subgraph.ts).
    const widget = node.widgets?.find((w) => w.name === PREVIEW_WIDGET_NAME) as
      | { value?: unknown }
      | undefined
    if (!widget) return
    if (s.error) {
      widget.value = `⚠ ${s.error.message}`
    } else if (s.blocked) {
      widget.value = s.cause ? `⚠ ${s.cause.title}: ${s.cause.message}` : '⚠ blocked upstream'
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
      // start dirty so the next flush can evaluate them.
      s = {
        dirty: true,
        running: false,
        generation: 0,
        outputs: undefined,
        error: undefined,
        blocked: false,
        cause: undefined,
        inFlight: undefined,
        cycle: false,
        savedColors: undefined,
      }
      store.set(node.id, s)
    }
    return s
  }
}
