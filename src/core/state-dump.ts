/**
 * The state-trace export: a self-contained JSON snapshot of everything the
 * engine currently knows — every root node's state, and every recorded
 * subgraph call (the full recursion tree) with its per-call values.
 *
 * Values are encoded losslessly by KIND, not by slot type: strings/numbers/
 * booleans inline, bytes as base64 (with length), lists and plain objects
 * recursively. The graph document itself is embedded, so a trace file is
 * readable on its own — structure, wiring, params, and live values in one.
 */

import type { LGraphNode, NodeId, Subgraph } from '@comfyorg/litegraph'
import { bytesToBinaryString } from './binary'
import type { CallInfo, Engine, NodeState } from './engine'
import { getNodeDef } from './registry'
import { serializeGraph } from './serialize'
import { getSubgraphDef } from './subgraph'

// ─── Value encoding ──────────────────────────────────────────────────────────

export type EncodedValue =
  | { kind: 'undefined' }
  | { kind: 'null' }
  | { kind: 'string'; value: string }
  | { kind: 'number'; value: number | null; text?: string }
  | { kind: 'boolean'; value: boolean }
  | { kind: 'bytes'; length: number; base64: string }
  | { kind: 'list'; items: EncodedValue[] }
  | { kind: 'object'; entries: Record<string, EncodedValue> }
  | { kind: 'other'; text: string }

/** Encodes a runtime value losslessly-ish: bytes → base64, containers recurse, exotica → text. */
export function encodeValue(value: unknown): EncodedValue {
  if (value === undefined) return { kind: 'undefined' }
  if (value === null) return { kind: 'null' }
  if (value instanceof Uint8Array) {
    return { kind: 'bytes', length: value.length, base64: btoa(bytesToBinaryString(value)) }
  }
  if (typeof value === 'string') return { kind: 'string', value }
  if (typeof value === 'number') {
    return Number.isFinite(value)
      ? { kind: 'number', value }
      : { kind: 'number', value: null, text: String(value) } // NaN/±Infinity aren't JSON
  }
  if (typeof value === 'boolean') return { kind: 'boolean', value }
  if (Array.isArray(value)) return { kind: 'list', items: value.map(encodeValue) }
  if (typeof value === 'object') {
    const entries: Record<string, EncodedValue> = {}
    for (const [key, item] of Object.entries(value)) entries[key] = encodeValue(item)
    return { kind: 'object', entries }
  }
  // bigint, function, symbol — nothing the graph produces, but never throw.
  return { kind: 'other', text: String(value) }
}

// ─── Dump structure ──────────────────────────────────────────────────────────

interface DumpedNode {
  id: NodeId
  title: string
  type: string | null
  /** Subgraph instances only: the definition's display name. */
  def?: string
  params?: Record<string, unknown>
  state: 'ok' | 'error' | 'blocked' | 'running' | 'dirty'
  inputs?: Record<string, EncodedValue>
  outputs?: EncodedValue[]
  error?: string
  blockedBy?: { nodeId: NodeId; title: string; message: string }
}

/**
 * A full state trace of the engine: the serialized document, every root
 * node's live state, and every recorded subgraph call (pre-order — a call
 * precedes its children) with boundary inputs and interior node states.
 */
export function buildStateDump(engine: Engine): Record<string, unknown> {
  const graph = engine.graph
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    lens: engine.getLensPath(),
    traceComplete: !engine.traceOverflow(),
    document: serializeGraph(graph),
    root: {
      nodes: graph._nodes.map((node) => dumpNode(node, engine.rootStates().get(node.id))),
    },
    calls: engine.allCalls().map((call) => dumpCall(call, engine)),
  }
}

function dumpCall(call: { path: string } & CallInfo, engine: Engine): Record<string, unknown> {
  const graph = engine.graph
  const meta = getSubgraphDef(graph, call.defId)
  const subgraph = graph.subgraphs.get(call.defId as never) as Subgraph | undefined
  const store = engine.callStore(call.path)
  const nodes: DumpedNode[] = []
  for (const node of subgraph?._nodes ?? []) {
    nodes.push(dumpNode(node, store?.get(node.id)))
  }
  return {
    path: call.path,
    defId: call.defId,
    def: meta?.name ?? call.defId,
    depth: call.depth,
    origin: engine.callStoreOrigin(call.path) ?? 'unknown',
    inputs: call.inputs.map(encodeValue),
    nodes,
  }
}

function dumpNode(node: LGraphNode, s: NodeState | undefined): DumpedNode {
  const def = getNodeDef(node)
  const dumped: DumpedNode = {
    id: node.id,
    title: node.title,
    type: node.type,
    state: stateKind(s),
  }
  if (node.isSubgraphNode() && node.graph) {
    const meta = getSubgraphDef(node.graph.rootGraph, node.type ?? '')
    if (meta) dumped.def = meta.name
  }
  if (def?.params?.length) {
    dumped.params = {}
    for (const p of def.params) dumped.params[p.name] = node.properties[p.name] ?? p.default
  }
  if (s?.inputs !== undefined) {
    dumped.inputs = {}
    for (const [name, value] of Object.entries(s.inputs)) dumped.inputs[name] = encodeValue(value)
  }
  if (s?.outputs !== undefined) dumped.outputs = s.outputs.map(encodeValue)
  if (s?.error) dumped.error = s.error.message
  if (s?.blocked && s.cause) {
    dumped.blockedBy = { nodeId: s.cause.nodeId, title: s.cause.title, message: s.cause.message }
  }
  return dumped
}

function stateKind(s: NodeState | undefined): DumpedNode['state'] {
  if (!s) return 'dirty'
  if (s.error) return 'error'
  if (s.blocked) return 'blocked'
  if (s.running) return 'running'
  if (s.dirty) return 'dirty'
  return 'ok'
}
