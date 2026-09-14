/**
 * Graph persistence: CyberWizard's own versioned document format.
 *
 * We deliberately do NOT use LiteGraph's built-in serialize(): our document
 * is stable across litegraph versions, contains exactly what a graph needs
 * (node types, positions, params, links, view), and stays small enough for
 * URL sharing.
 *
 * Version 2 adds subgraph definitions (`subgraphs`): stored once, flat, by
 * UUID: recursion (a definition containing an instance of itself) therefore
 * never nests infinitely. Instances are ordinary SerializedNodes whose `type`
 * is the definition UUID. Boundary links use the well-known panel node ids
 * (SUBGRAPH_INPUT_NODE_ID / SUBGRAPH_OUTPUT_NODE_ID from core/subgraph.ts).
 *
 * Restore is three-phase so recursive and mutually-recursive definitions
 * load in any order: (1) register all definition shells + factories, (2)
 * populate every interior, (3) populate the root graph.
 */

import { LGraphGroup, LiteGraph, Subgraph } from '@comfyorg/litegraph'
import type { LGraph, LGraphCanvas, LGraphNode } from '@comfyorg/litegraph'
import type { ExportedSubgraph } from '@comfyorg/litegraph'
import { binaryStringToBytes, bytesToBinaryString } from './binary'
import { canCoerce } from './coerce'
import { convertParamToInput, getNodeDef, isConvertibleParam, setParam, variadicSlotName, widgetInputParams } from './registry'
import {
  SUBGRAPH_INPUT_NODE_ID,
  SUBGRAPH_OUTPUT_NODE_ID,
  allSubgraphDefs,
  clearSubgraphDefs,
  getSubgraphDef,
  registerRestoredDef,
} from './subgraph'
import type { DataType } from './types'
import { ANY, dataTypeFromKind, toSlotType } from './types'

export const GRAPH_FORMAT_VERSION = 2

/** File-input contents above this size are not embedded in documents. */
const FILE_EMBED_LIMIT = 1024 * 1024 // 1 MiB

export interface SerializedNode {
  id: number
  type: string
  pos: [number, number]
  /** Only set when the user renamed the node. */
  title?: string
  params: Record<string, string | number | boolean>
  /** Param names promoted to connection points, in slot order (core/registry widgetInputParams). */
  widgetInputs?: string[]
  /** Extra slots beyond the declared inputs on a variadic node (Concat, List Pack). */
  variadicInputs?: number
  /** Base64-encoded file bytes for io/file-input nodes. */
  fileData?: string
  fileName?: string
}

export interface SerializedLink {
  from: { node: number; slot: number }
  to: { node: number; slot: number }
}

export interface SerializedGroup {
  title: string
  /** [x, y, w, h]: the group's bounds. */
  bounding: [number, number, number, number]
  color?: string
  font_size?: number
  pinned?: boolean
}

export interface SerializedSubgraphIO {
  name: string
  /** DataType kind ('bytes' | 'string' | … | 'any'; list element types erased). */
  type: string
}

export interface SerializedSubgraph {
  /** Definition UUID: instance nodes reference it as their `type`. */
  id: string
  name: string
  /** Lexical scope: the parent definition's UUID. Absent = global. */
  scope?: string
  inputs: SerializedSubgraphIO[]
  outputs: SerializedSubgraphIO[]
  /** IO panel node bounds ([x, y, w, h]): the panels' positions inside the definition. */
  inputNode?: { bounding: [number, number, number, number]; pinned?: boolean }
  outputNode?: { bounding: [number, number, number, number]; pinned?: boolean }
  nodes: SerializedNode[]
  /** Interior links; endpoints may be the boundary panel ids (-10 / -20). */
  links: SerializedLink[]
  /** Interior groups, if any. */
  groups?: SerializedGroup[]
}

export interface GraphDocument {
  app: 'cyberwizard'
  version: number
  nodes: SerializedNode[]
  links: SerializedLink[]
  groups?: SerializedGroup[]
  subgraphs?: SerializedSubgraph[]
  view?: { offset: [number, number]; scale: number }
}

// ─── Serialise ───────────────────────────────────────────────────────────────

/** Shared walker for the root graph and each definition interior. */
function serializeFragment(graph: LGraph): {
  nodes: SerializedNode[]
  links: SerializedLink[]
  groups?: SerializedGroup[]
} {
  const nodes: SerializedNode[] = []
  for (const node of graph._nodes) {
    if (node.isSubgraphNode()) {
      const meta = getSubgraphDef(graph.rootGraph, node.type)
      const out: SerializedNode = {
        id: node.id as number,
        type: node.type,
        pos: [node.pos[0] ?? 0, node.pos[1] ?? 0],
        params: {},
      }
      if (node.title !== meta?.name) out.title = node.title
      nodes.push(out)
      continue
    }

    const def = getNodeDef(node)
    if (!def) continue // foreign node: can't be recreated, skip

    const params: SerializedNode['params'] = {}
    for (const p of def.params ?? []) {
      const value = node.properties[p.name]
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        params[p.name] = value
      }
    }

    const out: SerializedNode = {
      id: node.id as number,
      type: def.type,
      pos: [node.pos[0] ?? 0, node.pos[1] ?? 0],
      params,
    }
    if (node.title !== def.title) out.title = node.title

    const widgetInputs = widgetInputParams(node, def.inputs.length)
    if (widgetInputs.length > 0) out.widgetInputs = widgetInputs
    if (def.variadicInputs) {
      const extra = node.inputs.length - def.inputs.length - widgetInputs.length
      if (extra > 0) out.variadicInputs = extra
    }

    const fileData = node.properties.fileData
    if (fileData instanceof Uint8Array && fileData.length > 0 && fileData.length <= FILE_EMBED_LIMIT) {
      out.fileData = btoa(bytesToBinaryString(fileData))
      if (typeof node.properties.fileName === 'string') out.fileName = node.properties.fileName
    }

    nodes.push(out)
  }

  const links: SerializedLink[] = []
  for (const link of graph._links.values()) {
    links.push({
      from: { node: link.origin_id as number, slot: link.origin_slot },
      to: { node: link.target_id as number, slot: link.target_slot },
    })
  }

  const groups: SerializedGroup[] = graph._groups.map((group) => {
    const g: SerializedGroup = {
      title: group.title,
      bounding: [group.pos[0] ?? 0, group.pos[1] ?? 0, group.size[0] ?? 0, group.size[1] ?? 0],
    }
    if (typeof group.color === 'string' && group.color !== '') g.color = group.color
    if (typeof group.font_size === 'number') g.font_size = group.font_size
    if (group.pinned) g.pinned = true
    return g
  })
  return groups.length > 0 ? { nodes, links, groups } : { nodes, links }
}

export function serializeGraph(graph: LGraph, canvas?: LGraphCanvas): GraphDocument {
  const { nodes, links, groups } = serializeFragment(graph)

  const doc: GraphDocument = { app: 'cyberwizard', version: GRAPH_FORMAT_VERSION, nodes, links }
  if (groups) doc.groups = groups

  const defs = allSubgraphDefs(graph)
  if (defs.length > 0) {
    doc.subgraphs = defs.map((meta) => {
      const subgraph = graph.subgraphs.get(meta.id as never)
      const interior = subgraph ? serializeFragment(subgraph) : { nodes: [], links: [] }
      return {
        id: meta.id,
        name: meta.name,
        scope: meta.scope,
        inputs: meta.inputs.map((slot) => ({ name: slot.name, type: slot.type.kind })),
        outputs: meta.outputs.map((slot) => ({ name: slot.name, type: slot.type.kind })),
        // Panel positions, in the same shape the library writes (dropped on
        // restore if malformed: they are cosmetic).
        inputNode: subgraph
          ? (subgraph.inputNode.asSerialisable() as { bounding: [number, number, number, number]; pinned?: boolean })
          : undefined,
        outputNode: subgraph
          ? (subgraph.outputNode.asSerialisable() as { bounding: [number, number, number, number]; pinned?: boolean })
          : undefined,
        nodes: interior.nodes,
        links: interior.links,
        ...(interior.groups ? { groups: interior.groups } : {}),
      }
    })
  }

  // The canvas viewport only describes the graph it is currently showing.
  if (canvas && canvas.graph === graph) {
    doc.view = { offset: [...canvas.ds.offset], scale: canvas.ds.scale }
  }
  return doc
}

/** Panel bounds are cosmetic: malformed entries fall back to the default position. */
function validBounding(b: unknown): [number, number, number, number] | undefined {
  if (!Array.isArray(b) || b.length !== 4 || !b.every((v) => typeof v === 'number')) return undefined
  return [b[0], b[1], b[2], b[3]] as [number, number, number, number]
}

// ─── Deserialise ─────────────────────────────────────────────────────────────

export interface LoadResult {
  warnings: string[]
}

/**
 * Replaces the graph's contents with the document's. Safe to call on a live
 * graph: node removal/addition flows through the engine's normal hooks.
 */
export function deserializeGraph(doc: GraphDocument, graph: LGraph, canvas?: LGraphCanvas): LoadResult {
  const warnings: string[] = []
  graph.clear()
  clearSubgraphDefs(graph)

  // Phase 1: register all definition shells (and their factories) before any
  // instance is created: recursive and mutually-recursive definitions load
  // in any order.
  for (const saved of doc.subgraphs ?? []) {
    const subgraph = graph.createSubgraph({
      id: saved.id,
      name: saved.name,
      inputNode: {
        id: SUBGRAPH_INPUT_NODE_ID,
        bounding: validBounding(saved.inputNode?.bounding) ?? [0, 0, 75, 100],
        pinned: saved.inputNode?.pinned,
      },
      outputNode: {
        id: SUBGRAPH_OUTPUT_NODE_ID,
        bounding: validBounding(saved.outputNode?.bounding) ?? [300, 0, 75, 100],
        pinned: saved.outputNode?.pinned,
      },
      inputs: saved.inputs.map((slot) => ({ id: crypto.randomUUID(), name: slot.name, type: slot.type })),
      outputs: saved.outputs.map((slot) => ({ id: crypto.randomUUID(), name: slot.name, type: slot.type })),
      widgets: [],
      nodes: [],
      links: [],
      groups: [],
      version: 1,
      revision: 0,
      state: { lastGroupId: 0, lastNodeId: 0, lastLinkId: 0, lastRerouteId: 0 },
      config: {},
      extra: {},
    } as unknown as ExportedSubgraph)
    registerRestoredDef(graph, subgraph, typeof saved.scope === 'string' ? saved.scope : undefined)
  }

  // Scope targets are resolved after every definition is registered; a
  // missing parent degrades the definition to global rather than dropping it.
  for (const saved of doc.subgraphs ?? []) {
    if (typeof saved.scope !== 'string') continue
    if (!getSubgraphDef(graph, saved.scope)) {
      warnings.push(`subgraph "${saved.name}" scopes to a missing definition: treating it as global`)
      const meta = getSubgraphDef(graph, saved.id)
      if (meta) meta.scope = undefined
    }
  }

  // Phase 2: populate interiors.
  for (const saved of doc.subgraphs ?? []) {
    const subgraph = graph.subgraphs.get(saved.id as never)
    if (!subgraph) {
      warnings.push(`subgraph "${saved.name}" failed to restore: interior skipped`)
      continue
    }
    populateFragment(subgraph, saved, warnings)
  }

  // Phase 3: the root graph.
  populateFragment(graph, doc, warnings)

  // If the user was editing inside a definition that no longer exists, the
  // canvas would otherwise show a ghost subgraph.
  if (canvas && canvas.graph !== graph) canvas.setGraph(graph)

  if (canvas && doc.view) {
    canvas.ds.offset = [...doc.view.offset]
    canvas.ds.scale = doc.view.scale
  }

  return { warnings }
}

/** Shared populate for the root graph and each definition interior. */
function populateFragment(
  target: LGraph,
  frag: { nodes: SerializedNode[]; links: SerializedLink[]; groups?: SerializedGroup[] },
  warnings: string[],
): void {
  for (const saved of frag.groups ?? []) {
    const group = new LGraphGroup(saved.title)
    group.pos = [saved.bounding[0], saved.bounding[1]]
    group.size = [saved.bounding[2], saved.bounding[3]]
    if (saved.color !== undefined) group.color = saved.color
    if (saved.font_size !== undefined) group.font_size = saved.font_size
    if (saved.pinned) group.pin()
    target.add(group)
  }

  const byId = new Map<number, LGraphNode>()
  for (const saved of frag.nodes) {
    const node = LiteGraph.createNode(saved.type)
    if (!node) {
      warnings.push(`unknown node type "${saved.type}": skipped`)
      continue
    }
    node.pos = [saved.pos[0], saved.pos[1]]
    if (saved.title !== undefined) node.title = saved.title
    target.add(node)

    for (const [name, value] of Object.entries(saved.params)) {
      setParam(node, name, value)
    }
    if (saved.widgetInputs !== undefined) {
      const def = getNodeDef(node)
      for (const name of saved.widgetInputs) {
        const param = def?.params?.find((p) => p.name === name)
        if (!param || !isConvertibleParam(param)) {
          warnings.push(`${saved.type}: cannot convert param "${name}" to an input, skipped`)
          continue
        }
        convertParamToInput(node, param)
      }
    }
    if (saved.variadicInputs !== undefined && saved.variadicInputs > 0) {
      const def = getNodeDef(node)
      if (!def?.variadicInputs) {
        warnings.push(`${saved.type}: document has variadic inputs but the op is not variadic, skipped`)
      } else {
        const growthType = toSlotType(def.inputs[0]?.type ?? ANY) as string
        for (let i = 0; i < saved.variadicInputs; i++) {
          node.addInput(variadicSlotName(def.inputs.length + i), growthType)
        }
      }
    }
    if (saved.fileData !== undefined) {
      node.properties.fileData = binaryStringToBytes(atob(saved.fileData))
      if (saved.fileName !== undefined) node.properties.fileName = saved.fileName
    }
    // Content-sized nodes (the Note) computed their add-time size before any
    // params were restored: re-fit now everything is in place. A no-op for
    // nodes whose size doesn't depend on param values.
    node.setSize(node.computeSize())
    byId.set(saved.id, node)
  }

  const subgraph = target instanceof Subgraph ? target : null
  for (const link of frag.links) {
    // Boundary endpoints only exist inside a definition interior.
    if (link.from.node === SUBGRAPH_INPUT_NODE_ID && subgraph) {
      const ioSlot = subgraph.inputs[link.from.slot]
      const targetNode = byId.get(link.to.node)
      const inputSlot = targetNode?.inputs[link.to.slot]
      if (!ioSlot || !targetNode || !inputSlot) {
        warnings.push(`input panel link [${link.from.slot}] → ${link.to.node} is dangling: skipped`)
        continue
      }
      // SubgraphInput.connect bypasses LiteGraph.isValidConnection: validate
      // the coercion ourselves so malformed documents can't create bad edges.
      if (!canCoerce(dataTypeFromKind(ioSlot.type), inputTypeOf(targetNode, link.to.slot))) {
        warnings.push(`input panel link [${link.from.slot}] → ${targetNode.title} cannot coerce: skipped`)
        continue
      }
      if (!ioSlot.connect(inputSlot, targetNode)) {
        warnings.push(`could not connect input panel [${link.from.slot}] → ${targetNode.title}: skipped`)
      }
      continue
    }
    if (link.to.node === SUBGRAPH_OUTPUT_NODE_ID && subgraph) {
      const ioSlot = subgraph.outputs[link.to.slot]
      const originNode = byId.get(link.from.node)
      const outputSlot = originNode?.outputs[link.from.slot]
      if (!ioSlot || !originNode || !outputSlot) {
        warnings.push(`output panel link ${link.from.node} → [${link.to.slot}] is dangling: skipped`)
        continue
      }
      if (!canCoerce(outputTypeOf(originNode, link.from.slot), dataTypeFromKind(ioSlot.type))) {
        warnings.push(`output panel link ${originNode.title} → [${link.to.slot}] cannot coerce: skipped`)
        continue
      }
      if (!ioSlot.connect(outputSlot, originNode)) {
        warnings.push(`could not connect ${originNode.title} → output panel [${link.to.slot}]: skipped`)
      }
      continue
    }
    if (link.from.node < 0 || link.to.node < 0) {
      warnings.push(`link ${link.from.node}→${link.to.node} references a boundary panel outside a subgraph: skipped`)
      continue
    }

    const origin = byId.get(link.from.node)
    const targetNode = byId.get(link.to.node)
    if (!origin || !targetNode) {
      warnings.push(`link ${link.from.node}→${link.to.node} references a missing node: skipped`)
      continue
    }
    const created = origin.connect(link.from.slot, targetNode, link.to.slot)
    if (!created) warnings.push(`could not connect ${origin.title} → ${targetNode.title}: skipped`)
  }
}

/** Declared input type of any node (registry node or subgraph instance). */
function inputTypeOf(node: LGraphNode, slot: number): DataType {
  if (node.isSubgraphNode()) {
    return getSubgraphDef(node.graph.rootGraph, node.type)?.inputs[slot]?.type ?? ANY
  }
  return getNodeDef(node)?.inputs[slot]?.type ?? ANY
}

/** Declared output type of any node (registry node or subgraph instance). */
function outputTypeOf(node: LGraphNode, slot: number): DataType {
  if (node.isSubgraphNode()) {
    return getSubgraphDef(node.graph.rootGraph, node.type)?.outputs[slot]?.type ?? ANY
  }
  return getNodeDef(node)?.outputs[slot]?.type ?? ANY
}

// ─── Validation & migration ──────────────────────────────────────────────────

export function parseGraphDocument(data: unknown): GraphDocument {
  if (typeof data !== 'object' || data === null) throw new Error('document is not an object')
  const doc = data as Record<string, unknown>

  if (doc.version !== 1 && doc.version !== GRAPH_FORMAT_VERSION) {
    throw new Error(`unsupported format version: ${String(doc.version)} (expected 1–${GRAPH_FORMAT_VERSION})`)
  }
  validateFragment(doc, 'document')

  if (doc.subgraphs !== undefined) {
    if (!Array.isArray(doc.subgraphs)) throw new Error('document subgraphs is not an array')
    for (const [i, entry] of doc.subgraphs.entries()) {
      const s = entry as Record<string, unknown>
      if (typeof s?.id !== 'string' || typeof s.name !== 'string') {
        throw new Error(`subgraph #${i} is malformed`)
      }
      if (s.scope !== undefined && typeof s.scope !== 'string') {
        throw new Error(`subgraph #${i} scope is malformed`)
      }
      validateIO(s.inputs, `subgraph #${i} inputs`)
      validateIO(s.outputs, `subgraph #${i} outputs`)
      validateFragment(s, `subgraph #${i}`)
      validateGroups(s.groups, `subgraph #${i}`)
    }
  }

  validateGroups(doc.groups, 'document')

  // v1 → v2 migration: v1 predates subgraphs, so it already *is* a valid v2
  // document without a `subgraphs` key: accepting it is the whole migration.
  // (The version field is left untouched so codec round-trips stay identical;
  // the next serializeGraph() writes the document back out as v2.)
  return doc as unknown as GraphDocument
}

function validateGroups(groups: unknown, label: string): void {
  if (groups === undefined) return
  if (!Array.isArray(groups)) throw new Error(`${label} groups is not an array`)
  for (const [i, entry] of groups.entries()) {
    const g = entry as Record<string, unknown>
    if (typeof g?.title !== 'string' || !Array.isArray(g.bounding) || g.bounding.length !== 4 || !g.bounding.every((v) => typeof v === 'number')) {
      throw new Error(`${label} group #${i} is malformed`)
    }
    if (g.color !== undefined && typeof g.color !== 'string') throw new Error(`${label} group #${i} color is malformed`)
    if (g.font_size !== undefined && typeof g.font_size !== 'number') throw new Error(`${label} group #${i} font_size is malformed`)
    if (g.pinned !== undefined && typeof g.pinned !== 'boolean') throw new Error(`${label} group #${i} pinned is malformed`)
  }
}

function validateFragment(doc: Record<string, unknown>, label: string): void {
  if (!Array.isArray(doc.nodes)) throw new Error(`${label} has no nodes array`)
  if (!Array.isArray(doc.links)) throw new Error(`${label} has no links array`)

  for (const [i, node] of doc.nodes.entries()) {
    const n = node as Record<string, unknown>
    if (typeof n?.id !== 'number' || typeof n.type !== 'string' || !Array.isArray(n.pos)) {
      throw new Error(`${label} node #${i} is malformed`)
    }
  }
  for (const [i, link] of doc.links.entries()) {
    const l = link as { from?: unknown; to?: unknown }
    if (typeof l?.from !== 'object' || typeof l?.to !== 'object') {
      throw new Error(`${label} link #${i} is malformed`)
    }
  }
}

function validateIO(io: unknown, label: string): void {
  if (!Array.isArray(io)) throw new Error(`${label} is not an array`)
  for (const [i, slot] of io.entries()) {
    const s = slot as Record<string, unknown>
    if (typeof s?.name !== 'string' || typeof s.type !== 'string') {
      throw new Error(`${label} slot #${i} is malformed`)
    }
  }
}
