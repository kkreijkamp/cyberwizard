/**
 * Subgraph definitions — reusable composite nodes ("functions").
 *
 * A subgraph definition is a named graph fragment with declared, typed inputs
 * and outputs. Definitions live on the document's root LGraph
 * (`graph.subgraphs`, keyed by UUID) and are instantiated as LiteGraph
 * `SubgraphNode`s whose `type` is the definition UUID. Definitions may nest
 * inside other definitions — including themselves (recursion is a runtime
 * concern for the engine, never a serialization problem, since definitions
 * are stored flat by id).
 *
 * This module owns the definition lifecycle:
 *  - create / rename / delete, and typed IO add / rename / remove
 *  - the per-definition factory-class shim (0.17.2 standalone cannot
 *    instantiate SubgraphNodes — `LiteGraph.createNode(uuid)` returns null
 *    unless a SubgraphNode subclass is registered under the UUID)
 *  - metadata the engine/serializer need beyond what the library stores
 *    (declared slot DataTypes, since SubgraphIO slots only carry type strings)
 *  - attachSubgraphSupport(): the coordinator bridging definitions and the
 *    engine — instance indexing across the root graph and every definition
 *    interior, and dirty-propagation across the subgraph boundary.
 *
 * The engine (core/engine.ts) evaluates instances with call semantics; it
 * looks definitions up through getSubgraphDef() and never imports this
 * module's coordinator half (one-directional dependency: subgraph → engine).
 */

import { LiteGraph, SubgraphNode } from '@comfyorg/litegraph'
import type { ISlotType, LGraph, LGraphNode, LLink, NodeId, Subgraph } from '@comfyorg/litegraph'
import type { ExportedSubgraph } from '@comfyorg/litegraph'
import type { DataType } from './types'
import { dataTypeFromKind, toSlotType } from './types'
import type { SlotDef } from './registry'
import { PREVIEW_WIDGET_NAME, categoryColors, markNodeDirty, setDirtyHandler } from './registry'
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
  /** Definition UUID — also the LiteGraph node type string of instances. */
  readonly id: string
  name: string
  /** Declared, typed inputs — authoritative for the engine and serializer. */
  inputs: SlotDef[]
  outputs: SlotDef[]
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

/** SubgraphIO slot type strings are strings only (no legacy 0) — 'any' spelled out. */
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
      this.addWidget('text', PREVIEW_WIDGET_NAME, '∅', null, { multiline: true })
      this.color = colors.color
      this.bgcolor = colors.bgcolor
    }

    // SubgraphNode has no registry-generated onConnectionsChange — without
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
function registerExisting(rootGraph: LGraph, subgraph: Subgraph): SubgraphDefMeta {
  const meta: SubgraphDefMeta = {
    id: subgraph.id,
    name: subgraph.name,
    inputs: subgraph.inputs.map((slot) => ({ name: slot.name, type: dataTypeFromKind(slot.type) })),
    outputs: subgraph.outputs.map((slot) => ({ name: slot.name, type: dataTypeFromKind(slot.type) })),
  }
  metasOf(rootGraph).set(subgraph.id, meta)
  registerFactory(subgraph)
  watchIfAttached(rootGraph, subgraph)
  return meta
}

/** Creates an empty definition with no IO and returns its metadata. */
export function createSubgraphDef(rootGraph: LGraph, name: string): SubgraphDefMeta {
  const subgraph = rootGraph.createSubgraph(emptySubgraphData(crypto.randomUUID(), name))
  const meta = registerExisting(rootGraph, subgraph)
  emitDefsChange(rootGraph)
  return meta
}

/**
 * Re-registers a definition that was created outside this module's lifecycle
 * (deserialization restores definitions, then populates their interiors).
 */
export function registerRestoredDef(rootGraph: LGraph, subgraph: Subgraph): SubgraphDefMeta {
  return registerExisting(rootGraph, subgraph)
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
  // Instance slots track IO edits natively (SubgraphNode slot listeners);
  // every instance must re-evaluate against the new signature.
  dirtyAllInstances(rootGraph, defId)
  emitDefsChange(rootGraph)
}

export function addDefInput(rootGraph: LGraph, defId: string, name: string, type: DataType): void {
  const meta = getSubgraphDef(rootGraph, defId)
  if (!meta) return
  const unique = uniqueName(name, new Set(meta.inputs.map((i) => i.name)))
  editIO(rootGraph, defId, (subgraph, m) => {
    subgraph.addInput(unique, toIOSlotType(type))
    m.inputs.push({ name: unique, type })
  })
}

export function addDefOutput(rootGraph: LGraph, defId: string, name: string, type: DataType): void {
  const meta = getSubgraphDef(rootGraph, defId)
  if (!meta) return
  const unique = uniqueName(name, new Set(meta.outputs.map((o) => o.name)))
  editIO(rootGraph, defId, (subgraph, m) => {
    subgraph.addOutput(unique, toIOSlotType(type))
    m.outputs.push({ name: unique, type })
  })
}

export function renameDefInput(rootGraph: LGraph, defId: string, index: number, name: string): void {
  const meta = getSubgraphDef(rootGraph, defId)
  if (!meta) return
  const others = new Set(meta.inputs.filter((_, i) => i !== index).map((i) => i.name))
  const unique = uniqueName(name, others)
  editIO(rootGraph, defId, (subgraph, m) => {
    const slot = subgraph.inputs[index]
    if (!slot || !m.inputs[index]) return
    subgraph.renameInput(slot, unique)
    m.inputs[index] = { ...m.inputs[index], name: unique }
  })
}

export function renameDefOutput(rootGraph: LGraph, defId: string, index: number, name: string): void {
  const meta = getSubgraphDef(rootGraph, defId)
  if (!meta) return
  const others = new Set(meta.outputs.filter((_, i) => i !== index).map((o) => o.name))
  const unique = uniqueName(name, others)
  editIO(rootGraph, defId, (subgraph, m) => {
    const slot = subgraph.outputs[index]
    if (!slot || !m.outputs[index]) return
    subgraph.renameOutput(slot, unique)
    m.outputs[index] = { ...m.outputs[index], name: unique }
  })
}

export function removeDefInput(rootGraph: LGraph, defId: string, index: number): void {
  editIO(rootGraph, defId, (subgraph, meta) => {
    const slot = subgraph.inputs[index]
    if (!slot) return
    subgraph.removeInput(slot)
    meta.inputs.splice(index, 1)
  })
}

export function removeDefOutput(rootGraph: LGraph, defId: string, index: number): void {
  editIO(rootGraph, defId, (subgraph, meta) => {
    const slot = subgraph.outputs[index]
    if (!slot) return
    subgraph.removeOutput(slot)
    meta.outputs.splice(index, 1)
  })
}

/** Deletes a definition and every instance of it across the document. */
export function deleteSubgraphDef(rootGraph: LGraph, defId: string): void {
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
  emitDefsChange(rootGraph)
}

/**
 * Drops every definition and all coordinator state for the document.
 * Idempotent — safe before or after graph.clear() (which wipes
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
    // The root dirty handler belongs to the engine — leave it alone.
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

  for (const node of subgraph._nodes) indexNode(attachment, node)

  attachment.subgraphWatches.set(subgraph, () => {
    setDirtyHandler(subgraph, undefined)
    detachGraphWatch()
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
 * pair is broadcast once per synchronous propagation chain — repeat arrivals
 * carry no new information.
 */
const activeBroadcasts = new Set<string>()

/**
 * An interior node went dirty (param edit, connection change, widget action).
 * Root-level instances get a precise interior seed (only that node and its
 * downstream re-run); deeper instances are dirtied wholesale — the enclosing
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
    if (isInterior) dirtyAllInstances(attachment.engine.graph, (graph as Subgraph).id)
  }
  graph.onNodeRemoved = function (node: LGraphNode) {
    previousRemove?.call(graph, node)
    unindexNode(attachment, node)
    if (isInterior) dirtyAllInstances(attachment.engine.graph, (graph as Subgraph).id)
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
