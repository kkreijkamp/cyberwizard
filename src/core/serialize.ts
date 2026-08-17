/**
 * Graph persistence — CyberWizard's own versioned document format.
 *
 * We deliberately do NOT use LiteGraph's built-in serialize(): our document
 * is stable across litegraph versions, contains exactly what a graph needs
 * (node types, positions, params, links, view), and stays small enough for
 * URL sharing.
 */

import { LiteGraph } from '@comfyorg/litegraph'
import type { LGraph, LGraphCanvas } from '@comfyorg/litegraph'
import { binaryStringToBytes, bytesToBinaryString } from './binary'
import { getNodeDef, setParam } from './registry'

export const GRAPH_FORMAT_VERSION = 1

/** File-input contents above this size are not embedded in documents. */
const FILE_EMBED_LIMIT = 1024 * 1024 // 1 MiB

export interface SerializedNode {
  id: number
  type: string
  pos: [number, number]
  /** Only set when the user renamed the node. */
  title?: string
  params: Record<string, string | number | boolean>
  /** Base64-encoded file bytes for io/file-input nodes. */
  fileData?: string
  fileName?: string
}

export interface SerializedLink {
  from: { node: number; slot: number }
  to: { node: number; slot: number }
}

export interface GraphDocument {
  app: 'cyberwizard'
  version: number
  nodes: SerializedNode[]
  links: SerializedLink[]
  view?: { offset: [number, number]; scale: number }
}

// ─── Serialise ───────────────────────────────────────────────────────────────

export function serializeGraph(graph: LGraph, canvas?: LGraphCanvas): GraphDocument {
  const nodes: SerializedNode[] = []
  for (const node of graph._nodes) {
    const def = getNodeDef(node)
    if (!def) continue // foreign node — can't be recreated, skip

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

  const doc: GraphDocument = { app: 'cyberwizard', version: GRAPH_FORMAT_VERSION, nodes, links }
  if (canvas) {
    doc.view = { offset: [...canvas.ds.offset], scale: canvas.ds.scale }
  }
  return doc
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

  const byId = new Map<number, ReturnType<typeof LiteGraph.createNode>>()
  for (const saved of doc.nodes) {
    const node = LiteGraph.createNode(saved.type)
    if (!node) {
      warnings.push(`unknown node type "${saved.type}" — skipped`)
      continue
    }
    node.pos = [saved.pos[0], saved.pos[1]]
    if (saved.title !== undefined) node.title = saved.title
    graph.add(node)

    for (const [name, value] of Object.entries(saved.params)) {
      setParam(node, name, value)
    }
    if (saved.fileData !== undefined) {
      node.properties.fileData = binaryStringToBytes(atob(saved.fileData))
      if (saved.fileName !== undefined) node.properties.fileName = saved.fileName
    }
    byId.set(saved.id, node)
  }

  for (const link of doc.links) {
    const origin = byId.get(link.from.node)
    const target = byId.get(link.to.node)
    if (!origin || !target) {
      warnings.push(`link ${link.from.node}→${link.to.node} references a missing node — skipped`)
      continue
    }
    const created = origin.connect(link.from.slot, target, link.to.slot)
    if (!created) warnings.push(`could not connect ${origin.title} → ${target.title} — skipped`)
  }

  if (canvas && doc.view) {
    canvas.ds.offset = [...doc.view.offset]
    canvas.ds.scale = doc.view.scale
  }

  return { warnings }
}

// ─── Validation ──────────────────────────────────────────────────────────────

export function parseGraphDocument(data: unknown): GraphDocument {
  if (typeof data !== 'object' || data === null) throw new Error('document is not an object')
  const doc = data as Record<string, unknown>

  if (doc.version !== GRAPH_FORMAT_VERSION) {
    throw new Error(`unsupported format version: ${String(doc.version)} (expected ${GRAPH_FORMAT_VERSION})`)
  }
  if (!Array.isArray(doc.nodes)) throw new Error('document has no nodes array')
  if (!Array.isArray(doc.links)) throw new Error('document has no links array')

  for (const [i, node] of doc.nodes.entries()) {
    const n = node as Record<string, unknown>
    if (typeof n?.id !== 'number' || typeof n.type !== 'string' || !Array.isArray(n.pos)) {
      throw new Error(`node #${i} is malformed`)
    }
  }
  for (const [i, link] of doc.links.entries()) {
    const l = link as { from?: unknown; to?: unknown }
    if (typeof l?.from !== 'object' || typeof l?.to !== 'object') {
      throw new Error(`link #${i} is malformed`)
    }
  }
  return doc as unknown as GraphDocument
}
