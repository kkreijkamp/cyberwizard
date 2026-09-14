/**
 * Subgraph definitions: reusable composite nodes ("functions").
 *
 * A subgraph definition is a named graph fragment with declared, typed inputs
 * and outputs. Definitions live on the document's root LGraph
 * (`graph.subgraphs`, keyed by UUID) and are instantiated as LiteGraph
 * `SubgraphNode`s whose `type` is the definition UUID. Definitions may nest
 * inside other definitions: including themselves (recursion is a runtime
 * concern for the engine, never a serialization problem, since definitions
 * are stored flat by id).
 *
 * This module owns the definition lifecycle:
 *  - create / rename / delete, and typed IO add / rename / remove
 *  - the per-definition factory-class shim (0.17.2 standalone cannot
 *    instantiate SubgraphNodes: `LiteGraph.createNode(uuid)` returns null
 *    unless a SubgraphNode subclass is registered under the UUID)
 *  - metadata the engine/serializer need beyond what the library stores
 *    (declared slot DataTypes, since SubgraphIO slots only carry type strings)
 *  - attachSubgraphSupport(): the coordinator bridging definitions and the
 *    engine: instance indexing across the root graph and every definition
 *    interior, and dirty-propagation across the subgraph boundary.
 *
 * The engine (core/engine.ts) evaluates instances with call semantics; it
 * looks definitions up through getSubgraphDef() and never imports this
 * module's coordinator half (one-directional dependency: subgraph → engine).
 */

import { LiteGraph, Subgraph, SubgraphNode } from '@comfyorg/litegraph'
import type { ISlotType, LGraph, LGraphNode, LLink, NodeId } from '@comfyorg/litegraph'
import type { ExportedSubgraph } from '@comfyorg/litegraph'
import type { DataType } from './types'
import { dataTypeFromKind, toSlotType } from './types'
import type { SlotDef } from './registry'
import { PREVIEW_WIDGET_NAME, applyNodeFrame, categoryColors, getNodeDef, markNodeDirty, setDirtyHandler } from './registry'
import { makePreviewWidget } from './preview-widget'
import type { Engine } from './engine'

/** Palette/engine category for subgraph instances. */
export const SUBGRAPH_CATEGORY = 'Subgraphs'

/**
 * Well-known ids for a definition's boundary panel nodes. Interior nodes get
 * non-negative ids from the subgraph's own counter, so these never collide.
 */
export const SUBGRAPH_INPUT_NODE_ID = -10
export const SUBGRAPH_OUTPUT_NODE_ID = -20

export interface SubgraphDefMeta {
  /** Definition UUID: also the LiteGraph node type string of instances. */
  readonly id: string
  name: string
  /** Declared, typed inputs: authoritative for the engine and serializer. */
  inputs: SlotDef[]
  outputs: SlotDef[]
  /**
   * Lexical scope: the definition this one belongs to. A scoped definition
   * is visible (palette, fn pickers, name resolution) only inside its
   * parent's subtree: inner scopes see outer bindings, siblings do not.
   * Absent = global. Storage stays flat on the root; scope is a visibility
   * property, never containment (recursion and serialization are unaffected).
   */
  scope?: string
}

// ─── Per-document registries (keyed by root graph) ──────────────────────────

const metasByRoot = new WeakMap<LGraph, Map<string, SubgraphDefMeta>>()

function metasOf(rootGraph: LGraph): Map<string, SubgraphDefMeta> {
  let metas = metasByRoot.get(rootGraph)
  if (!metas) {
    metas = new Map()
    metasByRoot.set(rootGraph, metas)
  }
  return metas
}

/** Metadata for a definition, or undefined if the id isn't one. */
export function getSubgraphDef(rootGraph: LGraph, defId: string): SubgraphDefMeta | undefined {
  return metasByRoot.get(rootGraph)?.get(defId)
}

/** All definitions of the document, in creation order. */
export function allSubgraphDefs(rootGraph: LGraph): readonly SubgraphDefMeta[] {
  return [...(metasByRoot.get(rootGraph)?.values() ?? [])]
}

/**
 * The lexical ancestor chain of a definition: [def, its scope-parent, …].
 * Cycle-safe: a hand-edited scope loop degrades to the ids visited so far.
 */
export function scopeChainOf(rootGraph: LGraph, defId: string): string[] {
  const chain: string[] = []
  const seen = new Set<string>()
  let current: string | undefined = defId
  while (current !== undefined && !seen.has(current)) {
    seen.add(current)
    chain.push(current)
    current = metasOf(rootGraph).get(current)?.scope
  }
  return chain
}

/** Where a node lives: the root graph, or a definition's interior. */
export type DefLocation = LGraph | Subgraph | null | undefined

/** The engine attached to this document, if any (reconcileAfterLoad at restore). */
export function engineFor(rootGraph: LGraph): Engine | undefined {
  return attachments.get(rootGraph)?.engine
}

/**
 * Definitions visible from a location: globals are visible everywhere; a
 * scoped definition only inside its parent's subtree (the location's own
 * chain). The palette, fn pickers, and name resolution all use this.
 */
export function visibleSubgraphDefs(rootGraph: LGraph, location: DefLocation): SubgraphDefMeta[] {
  const defs = [...metasOf(rootGraph).values()]
  if (!(location instanceof Subgraph)) return defs.filter((d) => d.scope === undefined)
  const chain = new Set(scopeChainOf(rootGraph, location.id))
  return defs.filter((d) => d.scope === undefined || chain.has(d.scope))
}

/** Resolves a name the way a picker at `location` sees it: first visible match. */
export function resolveVisibleDef(rootGraph: LGraph, location: DefLocation, name: string): SubgraphDefMeta | undefined {
  return visibleSubgraphDefs(rootGraph, location).find((d) => d.name === name)
}

/**
 * Moves a definition between scopes: up to global, down into a parent, or
 * sideways to another parent. Refuses to scope a definition into itself or
 * its own descendants (a cyclic chain). The name is uniquified within the
 * new scope; consumers of the old/new name are re-dirtied so resolution
 * errors and re-picks surface immediately.
 */
export function reScopeDef(rootGraph: LGraph, defId: string, newScope: string | undefined): void {
  const meta = getSubgraphDef(rootGraph, defId)
  if (!meta || meta.scope === newScope) return
  if (newScope !== undefined) {
    if (!getSubgraphDef(rootGraph, newScope)) return
    if (scopeChainOf(rootGraph, newScope).includes(defId)) return
  }
  const oldName = meta.name
  meta.scope = newScope
  meta.name = uniqueNameForScope(rootGraph, meta.name, newScope, defId)
  const subgraph = rawSubgraph(rootGraph, defId)
  if (subgraph) subgraph.name = meta.name
  const factory = factories.get(defId)
  if (factory) factory.title = meta.name
  dirtyFnConsumersNamed(rootGraph, oldName, defId)
  dirtyDependents(rootGraph, defId)
  emitDefsChange(rootGraph)
}

/** Free display name for a definition within a scope (siblings may share names across scopes). */
function uniqueNameForScope(
  rootGraph: LGraph,
  desired: string,
  scope: string | undefined,
  excludeId?: string,
): string {
  const taken = new Set(
    [...metasOf(rootGraph).values()]
      .filter((m) => m.scope === scope && m.id !== excludeId)
      .map((m) => m.name),
  )
  return uniqueName(desired, taken)
}

/** Factory classes are registered globally (keyed by UUID); tracked for rename/delete. */
const factories = new Map<string, typeof SubgraphNode>()

type DefChangeListener = () => void
const defListeners = new WeakMap<LGraph, Set<DefChangeListener>>()

/** Palette hook: fired on any definition create/rename/IO-change/delete. */
export function onSubgraphDefsChange(rootGraph: LGraph, listener: DefChangeListener): () => void {
  let listeners = defListeners.get(rootGraph)
  if (!listeners) {
    listeners = new Set()
    defListeners.set(rootGraph, listeners)
  }
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function emitDefsChange(rootGraph: LGraph): void {
  for (const listener of defListeners.get(rootGraph) ?? []) listener()
}

/** SubgraphIO slot type strings are strings only (no legacy 0): 'any' spelled out. */
function toIOSlotType(type: DataType): string {
  const slot = toSlotType(type)
  return slot === 0 ? 'any' : slot
}

// ─── Factory shim ────────────────────────────────────────────────────────────

/**
 * Registers a SubgraphNode subclass under the definition's UUID so
 * LiteGraph.createNode(uuid) works (verified broken unshimmed in 0.17.2).
 * One class per definition, so the static title can carry the definition name
 * (LGraphNode.configure resets instance titles to the constructor's static
 * title when instance data has none).
 */
function registerFactory(subgraph: Subgraph): void {
  if (LiteGraph.registered_node_types[subgraph.id]) LiteGraph.unregisterNodeType(subgraph.id)
  const colors = categoryColors(SUBGRAPH_CATEGORY)

  class InstanceNode extends SubgraphNode {
    constructor() {
      super(null as never, subgraph, {} as never)
      // Same live-preview contract as registry nodes (Engine.paint rewrites it).
      this.addCustomWidget(makePreviewWidget(PREVIEW_WIDGET_NAME))
      this.color = colors.color
      this.bgcolor = colors.bgcolor
      applyNodeFrame(this)
      // The library's enter-subgraph title button renders a PrimeIcons glyph
      // (pi-window-maximize), but PrimeIcons isn't loaded in this app: it
      // paints as a tofu square. Repaint it as a vector "enter" arrow.
      const enterButton = this.title_buttons?.find((b) => b.name === 'enter_subgraph')
      if (enterButton) paintEnterIcon(enterButton)
    }

    // SubgraphNode has no registry-generated onConnectionsChange: without
    // this bridge, wiring edits on an instance would never re-evaluate it.
    // Root-level instances additionally invalidate their precise interior
    // seeds: fresh input values mean everything downstream of the panel
    // must re-run, not just a seeded branch.
    override onConnectionsChange(
      type: ISlotType,
      index: number,
      isConnected: boolean,
      linkInfo: LLink | null | undefined,
      inputOrOutput: Parameters<NonNullable<LGraphNode['onConnectionsChange']>>[4],
    ): void {
      super.onConnectionsChange?.(type, index, isConnected, linkInfo, inputOrOutput)
      const rootGraph = subgraph.rootGraph
      const engine = attachments.get(rootGraph)?.engine
      if (engine && this.graph === rootGraph) engine.instanceWiringChanged(this)
      else markNodeDirty(this)
    }
  }

  const cleaned = subgraph.name.replace(/[^a-zA-Z0-9_$]/g, '')
  Object.defineProperty(InstanceNode, 'name', {
    value: `Subgraph_${cleaned === '' || /^\d/.test(cleaned) ? 'Node' + cleaned : cleaned}`,
  })
  InstanceNode.title = subgraph.name

  LiteGraph.registerNodeType(subgraph.id, InstanceNode)
  factories.set(subgraph.id, InstanceNode)
}

/** Appends " 2", " 3", … until the name is free (duplicate IO names desync instance slots). */
function uniqueName(desired: string, taken: ReadonlySet<string>): string {
  if (!taken.has(desired)) return desired
  for (let i = 2; ; i++) {
    const candidate = `${desired} ${i}`
    if (!taken.has(candidate)) return candidate
  }
}

/** Structural view of the library's LGraphButton (only what we repaint). */
interface TitleButtonLike {
  text: string | undefined
  height: number
  xOffset: number
  yOffset: number
  readonly _last_area: { [index: number]: number }
  getWidth(ctx: CanvasRenderingContext2D): number
  draw(ctx: CanvasRenderingContext2D, x: number, y: number): void
}

const ENTER_ICON_SIZE = 14

/**
 * Repaints the enter-subgraph title button as a vector icon (the stock glyph
 * is a PrimeIcons codepoint and PrimeIcons isn't loaded: it renders as a
 * tofu box). Draws an "open / step into" arrow: a small corner bracket with
 * a diagonal arrow rising out of it, in the node's title text colour. The
 * button's text stays set (it drives `visible`), but is never painted.
 */
function paintEnterIcon(button: TitleButtonLike): void {
  button.getWidth = () => ENTER_ICON_SIZE
  button.draw = (ctx, x, y) => {
    button._last_area[0] = x + button.xOffset
    button._last_area[1] = y + button.yOffset
    button._last_area[2] = ENTER_ICON_SIZE
    button._last_area[3] = button.height

    const cx = x + button.xOffset + ENTER_ICON_SIZE / 2
    const cy = y + button.yOffset + button.height / 2

    ctx.save()
    ctx.strokeStyle = ctx.fillStyle || '#ffffff'
    ctx.lineWidth = 1.5
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'

    const a = 4.5 // arrow half-extent
    ctx.beginPath()
    // diagonal shaft: bottom-left → top-right
    ctx.moveTo(cx - a + 1, cy + a - 1)
    ctx.lineTo(cx + a, cy - a)
    // arrowhead: horizontal then vertical into the tip
    ctx.moveTo(cx + a - 4, cy - a)
    ctx.lineTo(cx + a, cy - a)
    ctx.lineTo(cx + a, cy - a + 4)
    // corner bracket bottom-left (the "window" being opened)
    ctx.moveTo(cx - a - 1, cy + 1)
    ctx.lineTo(cx - a - 1, cy + a + 1)
    ctx.lineTo(cx - 1, cy + a + 1)
    ctx.stroke()
    ctx.restore()
  }
}

// ─── Definition lifecycle ────────────────────────────────────────────────────

function emptySubgraphData(id: string, name: string): ExportedSubgraph {
  return {
    id,
    name,
    inputNode: { id: SUBGRAPH_INPUT_NODE_ID, bounding: [0, 0, 75, 100] },
    outputNode: { id: SUBGRAPH_OUTPUT_NODE_ID, bounding: [300, 0, 75, 100] },
    inputs: [],
    outputs: [],
    widgets: [],
    nodes: [],
    links: [],
    groups: [],
    version: 1,
    revision: 0,
    state: { lastGroupId: 0, lastNodeId: 0, lastLinkId: 0, lastRerouteId: 0 },
    config: {},
    extra: {},
  } as unknown as ExportedSubgraph
}

/** Registers metadata + factory for a definition that exists on the root graph. */
function registerExisting(rootGraph: LGraph, subgraph: Subgraph, scope?: string): SubgraphDefMeta {
  const meta: SubgraphDefMeta = {
    id: subgraph.id,
    name: subgraph.name,
    scope,
    inputs: [],
    outputs: [],
  }
  metasOf(rootGraph).set(subgraph.id, meta)
  syncMetaFromSubgraph(meta, subgraph)
  registerFactory(subgraph)
  watchIfAttached(rootGraph, subgraph)
  emitDefsChange(rootGraph)
  return meta
}

/**
 * Rebuilds metadata from the library Subgraph object. This is the single
 * sync point for BOTH API edits and native panel edits: inside a subgraph,
 * dragging from the dashed empty slot (or right-click rename/remove on a
 * slot) mutates the definition through library code paths that would
 * otherwise leave our metadata (and with it the serialized form) stale.
 */
function syncMetaFromSubgraph(meta: SubgraphDefMeta, subgraph: Subgraph): void {
  // displayName = label ?? name: renames set the label, so this is what the
  // user sees and what should round-trip through serialization.
  meta.inputs = subgraph.inputs.map((slot) => ({ name: slot.displayName, type: dataTypeFromKind(slot.type) }))
  meta.outputs = subgraph.outputs.map((slot) => ({ name: slot.displayName, type: dataTypeFromKind(slot.type) }))
}

/**
 * Deferred, batched sync for native panel edits. Some library events are
 * pre-mutation ('removing-input'), so the rebuild must run after the edit
 * lands: a microtask per subgraph, coalescing bursts. API edits already
 * synced (and dirtied instances) via editIO, but fire the same library
 * events, so only dirty instances when the signature actually changed,
 * otherwise this deferred dirty lands mid-run and forces a re-evaluation.
 */
const pendingMetaSyncs = new Set<string>()

function scheduleMetaSync(rootGraph: LGraph, subgraph: Subgraph): void {
  if (pendingMetaSyncs.has(subgraph.id)) return
  pendingMetaSyncs.add(subgraph.id)
  queueMicrotask(() => {
    pendingMetaSyncs.delete(subgraph.id)
    const meta = getSubgraphDef(rootGraph, subgraph.id)
    if (!meta || !rawSubgraph(rootGraph, subgraph.id)) return
    const before = ioSignature(meta)
    syncMetaFromSubgraph(meta, subgraph)
    if (ioSignature(meta) === before) return
    dirtyDependents(rootGraph, subgraph.id)
    emitDefsChange(rootGraph)
  })
}

function ioSignature(meta: SubgraphDefMeta): string {
  return globalThis.JSON.stringify({ inputs: meta.inputs, outputs: meta.outputs })
}

/**
 * Creates an empty definition with no IO and returns its metadata. With
 * `scope`, the definition is local to that parent (visible only inside its
 * subtree); the name is uniquified within the scope.
 */
export function createSubgraphDef(rootGraph: LGraph, name: string, scope?: string): SubgraphDefMeta {
  const unique = uniqueNameForScope(rootGraph, name, scope)
  const subgraph = rootGraph.createSubgraph(emptySubgraphData(crypto.randomUUID(), unique))
  return registerExisting(rootGraph, subgraph, scope) // registers + emits
}

/**
 * Re-registers a definition that was created outside this module's lifecycle
 * (deserialization restores definitions, then populates their interiors).
 */
export function registerRestoredDef(rootGraph: LGraph, subgraph: Subgraph, scope?: string): SubgraphDefMeta {
  return registerExisting(rootGraph, subgraph, scope)
}

/** The raw library Subgraph behind a definition id. */
export function rawSubgraph(rootGraph: LGraph, defId: string): Subgraph | undefined {
  return rootGraph.subgraphs.get(defId as never)
}

export function renameSubgraphDef(rootGraph: LGraph, defId: string, name: string): void {
  const meta = getSubgraphDef(rootGraph, defId)
  const subgraph = rawSubgraph(rootGraph, defId)
  if (!meta || !subgraph) return
  const oldName = meta.name
  subgraph.name = name
  meta.name = name
  const factory = factories.get(defId)
  if (factory) factory.title = name
  // Instances that were never manually renamed follow the definition name.
  for (const instance of instancesOf(rootGraph, defId)) {
    if (instance.title === oldName) {
      instance.title = name
      instance.setDirtyCanvas(true, true)
    }
  }
  // By-name consumers still point at the old name: dirty them so the
  // "renamed? re-pick it" error surfaces on their next pull.
  dirtyFnConsumersNamed(rootGraph, oldName, defId)
  emitDefsChange(rootGraph)
}

function editIO(
  rootGraph: LGraph,
  defId: string,
  edit: (subgraph: Subgraph, meta: SubgraphDefMeta) => void,
): void {
  const meta = getSubgraphDef(rootGraph, defId)
  const subgraph = rawSubgraph(rootGraph, defId)
  if (!meta || !subgraph) return
  edit(subgraph, meta)
  // Rebuild metadata from the (now mutated) library object: idempotent and
  // the same sync the native panel events use.
  syncMetaFromSubgraph(meta, subgraph)
  // Instance slots track IO edits natively (SubgraphNode slot listeners);
  // every instance must re-evaluate against the new signature.
  dirtyDependents(rootGraph, defId)
  emitDefsChange(rootGraph)
}

export function addDefInput(rootGraph: LGraph, defId: string, name: string, type: DataType): void {
  const meta = getSubgraphDef(rootGraph, defId)
  if (!meta) return
  const unique = uniqueName(name, new Set(meta.inputs.map((i) => i.name)))
  editIO(rootGraph, defId, (subgraph) => {
    subgraph.addInput(unique, toIOSlotType(type))
  })
}

export function addDefOutput(rootGraph: LGraph, defId: string, name: string, type: DataType): void {
  const meta = getSubgraphDef(rootGraph, defId)
  if (!meta) return
  const unique = uniqueName(name, new Set(meta.outputs.map((o) => o.name)))
  editIO(rootGraph, defId, (subgraph) => {
    subgraph.addOutput(unique, toIOSlotType(type))
  })
}

export function renameDefInput(rootGraph: LGraph, defId: string, index: number, name: string): void {
  const meta = getSubgraphDef(rootGraph, defId)
  if (!meta) return
  const others = new Set(meta.inputs.filter((_, i) => i !== index).map((i) => i.name))
  const unique = uniqueName(name, others)
  editIO(rootGraph, defId, (subgraph) => {
    const slot = subgraph.inputs[index]
    if (slot) subgraph.renameInput(slot, unique)
  })
}

export function renameDefOutput(rootGraph: LGraph, defId: string, index: number, name: string): void {
  const meta = getSubgraphDef(rootGraph, defId)
  if (!meta) return
  const others = new Set(meta.outputs.filter((_, i) => i !== index).map((o) => o.name))
  const unique = uniqueName(name, others)
  editIO(rootGraph, defId, (subgraph) => {
    const slot = subgraph.outputs[index]
    if (slot) subgraph.renameOutput(slot, unique)
  })
}

export function removeDefInput(rootGraph: LGraph, defId: string, index: number): void {
  editIO(rootGraph, defId, (subgraph) => {
    const slot = subgraph.inputs[index]
    if (slot) subgraph.removeInput(slot)
  })
}

export function removeDefOutput(rootGraph: LGraph, defId: string, index: number): void {
  editIO(rootGraph, defId, (subgraph) => {
    const slot = subgraph.outputs[index]
    if (slot) subgraph.removeOutput(slot)
  })
}

/**
 * Deletes a definition, every instance of it, and its whole scope subtree:
 * scoped helpers are lexically part of their parent, so deleting a
 * definition deletes the definitions nested under it too.
 */
export function deleteSubgraphDef(rootGraph: LGraph, defId: string): void {
  const descendants = [...metasOf(rootGraph).values()]
    .filter((m) => m.id !== defId && scopeChainOf(rootGraph, m.id).includes(defId))
    .map((m) => m.id)
  for (const id of [defId, ...descendants]) deleteOne(rootGraph, id)
}

function deleteOne(rootGraph: LGraph, defId: string): void {
  const name = getSubgraphDef(rootGraph, defId)?.name
  for (const instance of [...instancesOf(rootGraph, defId)]) {
    instance.graph?.remove(instance)
  }
  attachments.get(rootGraph)?.instancesByDef.delete(defId)
  LiteGraph.unregisterNodeType(defId)
  factories.delete(defId)
  const subgraph = rawSubgraph(rootGraph, defId)
  if (subgraph) unwatchSubgraph(rootGraph, subgraph)
  rootGraph.subgraphs.delete(defId as never)
  metasOf(rootGraph).delete(defId)
  // By-name consumers now point at nothing: dirty them so the "not found"
  // error surfaces on their next pull.
  if (name !== undefined) dirtyFnConsumersNamed(rootGraph, name, defId)
  emitDefsChange(rootGraph)
}

/**
 * Drops every definition and all coordinator state for the document.
 * Idempotent: safe before or after graph.clear() (which wipes
 * graph.subgraphs without firing node-removed hooks).
 */
export function clearSubgraphDefs(rootGraph: LGraph): void {
  const attachment = attachments.get(rootGraph)
  for (const unwatch of attachment?.subgraphWatches.values() ?? []) unwatch()
  attachment?.subgraphWatches.clear()
  attachment?.instancesByDef.clear()
  for (const defId of metasOf(rootGraph).keys()) {
    LiteGraph.unregisterNodeType(defId)
    factories.delete(defId)
  }
  metasOf(rootGraph).clear()
  rootGraph.subgraphs.clear()
  // graph.clear() never fires node-removed hooks: engine caches (which key on
  // reused low node ids) must be dropped explicitly or they alias into the
  // next document.
  attachment?.engine.reset()
  emitDefsChange(rootGraph)
}

/** Spawns an instance node (caller adds it to a graph). */
export function spawnSubgraphNode(defId: string): SubgraphNode | null {
  return LiteGraph.createNode(defId) as SubgraphNode | null
}

// ─── Coordinator: instance indexing + dirty bridging ────────────────────────

interface Attachment {
  readonly engine: Engine
  readonly instancesByDef: Map<string, Set<SubgraphNode>>
  /** Unwatch functions per watched definition interior. */
  readonly subgraphWatches: Map<Subgraph, () => void>
}

const attachments = new WeakMap<LGraph, Attachment>()

function instancesOf(rootGraph: LGraph, defId: string): ReadonlySet<SubgraphNode> {
  return attachments.get(rootGraph)?.instancesByDef.get(defId) ?? new Set()
}

function dirtyAllInstances(rootGraph: LGraph, defId: string): void {
  for (const instance of instancesOf(rootGraph, defId)) markNodeDirty(instance)
}

/**
 * Nodes referencing a definition BY NAME in a subgraph-ref param (map/
 * filter/fold's fn, If's then/else) are not instances: dirtyAllInstances
 * never reaches them, so editing a picked definition used to leave their
 * outputs stale. Scan the root graph and every interior for such params
 * and dirty the holders. With scoped names, a consumer is only dirtied when
 * the name resolves to THIS definition from its own location: a same-named
 * definition in another scope must not be shadowed by accident.
 */
function dirtyFnConsumersNamed(rootGraph: LGraph, name: string, defId?: string): void {
  const visit = (node: LGraphNode): void => {
    for (const param of getNodeDef(node)?.params ?? []) {
      if (param.kind !== 'string' || !param.subgraphRef || node.properties[param.name] !== name) {
        continue
      }
      if (defId !== undefined) {
        const resolved = resolveVisibleDef(rootGraph, node.graph, name)
        // Skip only when the name resolves to a DIFFERENT definition (a same-
        // named def shadows ours). An orphan (rename/delete) must be dirtied
        // so the resolution error surfaces.
        if (resolved !== undefined && resolved.id !== defId) continue
      }
      markNodeDirty(node)
      break
    }
  }
  for (const node of rootGraph._nodes) visit(node)
  for (const subgraph of rootGraph.subgraphs.values()) {
    for (const node of subgraph._nodes) visit(node)
  }
}

function dirtyFnConsumers(rootGraph: LGraph, defId: string): void {
  const meta = getSubgraphDef(rootGraph, defId)
  if (meta) dirtyFnConsumersNamed(rootGraph, meta.name, defId)
}

/** Definition changed: dirty its instances AND its by-name consumers. */
function dirtyDependents(rootGraph: LGraph, defId: string): void {
  dirtyAllInstances(rootGraph, defId)
  dirtyFnConsumers(rootGraph, defId)
}

/**
 * Attaches the subgraph coordinator to a document: indexes instances across
 * the root graph and every definition interior, and bridges dirtiness across
 * the boundary. Interior edits seed precise per-instance re-evaluation when
 * the instance lives at the root; deeper nesting degrades to whole-instance
 * re-evaluation (conservative, always correct).
 */
export function attachSubgraphSupport(rootGraph: LGraph, engine: Engine): () => void {
  const attachment: Attachment = {
    engine,
    instancesByDef: new Map(),
    subgraphWatches: new Map(),
  }
  attachments.set(rootGraph, attachment)

  const detachGraphWatch = watchGraphNodes(rootGraph, attachment)
  for (const node of rootGraph._nodes) indexNode(attachment, node)
  for (const subgraph of rootGraph.subgraphs.values()) watchSubgraph(rootGraph, subgraph)

  return () => {
    detachGraphWatch()
    for (const unwatch of attachment.subgraphWatches.values()) unwatch()
    // The root dirty handler belongs to the engine: leave it alone.
    attachments.delete(rootGraph)
  }
}

function watchIfAttached(rootGraph: LGraph, subgraph: Subgraph): void {
  if (attachments.has(rootGraph)) watchSubgraph(rootGraph, subgraph)
}

/** Watches one definition interior: dirty bridge + nested-instance indexing. */
function watchSubgraph(rootGraph: LGraph, subgraph: Subgraph): void {
  const attachment = attachments.get(rootGraph)
  if (!attachment || attachment.subgraphWatches.has(subgraph)) return

  // Interior param edits / connection changes arrive through the registry's
  // dirty bridge (GeneratedNode callbacks call markNodeDirty with node.graph
  // === this subgraph).
  setDirtyHandler(subgraph, (node) => onInteriorNodeDirty(rootGraph, subgraph, node))
  const detachGraphWatch = watchGraphNodes(subgraph, attachment)

  // Native panel edits (empty-slot drags, right-click rename/remove) mutate
  // the definition without touching our lifecycle API: keep metadata (and
  // with it the serialized form and the palette) in sync. Deferred: some of
  // these events are pre-mutation.
  const onNativeIO = (): void => scheduleMetaSync(rootGraph, subgraph)
  const IO_EVENTS = [
    'input-added',
    'output-added',
    'removing-input',
    'removing-output',
    'renaming-input',
    'renaming-output',
  ] as const
  for (const type of IO_EVENTS) subgraph.events.addEventListener(type, onNativeIO)

  for (const node of subgraph._nodes) indexNode(attachment, node)

  attachment.subgraphWatches.set(subgraph, () => {
    setDirtyHandler(subgraph, undefined)
    detachGraphWatch()
    for (const type of IO_EVENTS) subgraph.events.removeEventListener(type, onNativeIO)
  })
}

function unwatchSubgraph(rootGraph: LGraph, subgraph: Subgraph): void {
  const attachment = attachments.get(rootGraph)
  attachment?.subgraphWatches.get(subgraph)?.()
  attachment?.subgraphWatches.delete(subgraph)
}

/**
 * Guard against infinite broadcast loops in (mutually) recursive definitions:
 * a dirty instance inside a definition it is itself an instance of would
 * re-trigger the same broadcast synchronously, forever. Each (def, node)
 * pair is broadcast once per synchronous propagation chain: repeat arrivals
 * carry no new information.
 */
const activeBroadcasts = new Set<string>()

/**
 * An interior node went dirty (param edit, connection change, widget action).
 * Root-level instances get a precise interior seed (only that node and its
 * downstream re-run); deeper instances are dirtied wholesale: the enclosing
 * subgraph's own dirty bridge carries it root-ward.
 */
function onInteriorNodeDirty(rootGraph: LGraph, subgraph: Subgraph, node: LGraphNode): void {
  const key = `${subgraph.id}:${String(node.id)}`
  if (activeBroadcasts.has(key)) return
  activeBroadcasts.add(key)
  try {
    for (const instance of instancesOf(rootGraph, subgraph.id)) {
      if (instance === node) continue // its own dirtiness is the event, not news
      if (instance.graph === rootGraph) {
        attachments.get(rootGraph)?.engine.seedSubgraphInstanceDirty(instance, node.id)
      } else {
        markNodeDirty(instance)
      }
    }
    // And the by-name consumers (map/filter/fold/if picking this definition).
    dirtyFnConsumers(rootGraph, subgraph.id)
  } finally {
    activeBroadcasts.delete(key)
  }
}

/** Indexes instances as they appear anywhere in the document; structural changes dirty all instances of the affected definition. */
function watchGraphNodes(graph: LGraph | Subgraph, attachment: Attachment): () => void {
  const previousAdd = graph.onNodeAdded
  const previousRemove = graph.onNodeRemoved
  const isInterior = graph !== attachment.engine.graph

  graph.onNodeAdded = function (node: LGraphNode) {
    previousAdd?.call(graph, node)
    indexNode(attachment, node)
    if (isInterior) dirtyDependents(attachment.engine.graph, (graph as Subgraph).id)
  }
  graph.onNodeRemoved = function (node: LGraphNode) {
    previousRemove?.call(graph, node)
    unindexNode(attachment, node)
    if (isInterior) dirtyDependents(attachment.engine.graph, (graph as Subgraph).id)
  }
  return () => {
    graph.onNodeAdded = previousAdd
    graph.onNodeRemoved = previousRemove
  }
}

function indexNode(attachment: Attachment, node: LGraphNode): void {
  if (!node.isSubgraphNode?.()) return
  const instance = node as SubgraphNode
  let set = attachment.instancesByDef.get(instance.type)
  if (!set) {
    set = new Set()
    attachment.instancesByDef.set(instance.type, set)
  }
  set.add(instance)
  // Note: the instance's onConnectionsChange → dirty bridge lives in the
  // factory class (registerFactory), so it also covers instances created
  // before this attachment (e.g. during document load).
}

function unindexNode(attachment: Attachment, node: LGraphNode): void {
  if (!node.isSubgraphNode?.()) return
  attachment.instancesByDef.get(node.type)?.delete(node as SubgraphNode)
}
