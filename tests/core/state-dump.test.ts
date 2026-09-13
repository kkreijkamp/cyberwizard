import { LGraph, LiteGraph } from '@comfyorg/litegraph'
import type { LGraphNode, Subgraph } from '@comfyorg/litegraph'
import { describe, expect, it } from 'vitest'
import { binaryStringToBytes, bytesToBinaryString } from '../../src/core/binary'
import { Engine } from '../../src/core/engine'
import { installConnectionRules, setParam } from '../../src/core/registry'
import { buildStateDump, encodeValue } from '../../src/core/state-dump'
import {
  addDefInput,
  addDefOutput,
  attachSubgraphSupport,
  createSubgraphDef,
  rawSubgraph,
  spawnSubgraphNode,
} from '../../src/core/subgraph'
import { NUMBER } from '../../src/core/types'
import '../../src/nodes'

installConnectionRules()

// ─── Helpers (same shape as flow-control.test.ts) ───────────────────────────

function spawn(graph: LGraph, type: string): LGraphNode {
  const node = LiteGraph.createNode(type)
  if (!node) throw new Error(`not registered: ${type}`)
  graph.add(node)
  return node
}

function spawnInterior(sub: Subgraph, type: string): LGraphNode {
  const node = LiteGraph.createNode(type)
  if (!node) throw new Error(`not registered: ${type}`)
  sub.add(node)
  return node
}

function wirePanelIn(sub: Subgraph, inputIndex: number, node: LGraphNode, slot: number): void {
  const link = sub.inputs[inputIndex]?.connect(node.inputs[slot]!, node)
  if (!link) throw new Error('panel-in wiring failed')
}

function wirePanelOut(sub: Subgraph, node: LGraphNode, slot: number, outputIndex: number): void {
  const link = sub.outputs[outputIndex]?.connect(node.outputs[slot]!, node)
  if (!link) throw new Error('panel-out wiring failed')
}

function rig(): { graph: LGraph; engine: Engine; dispose: () => void } {
  const graph = new LGraph()
  const engine = new Engine(graph)
  const detach = attachSubgraphSupport(graph, engine)
  return {
    graph,
    engine,
    dispose: () => {
      detach()
      engine.dispose()
    },
  }
}

function constNum(parent: LGraph | Subgraph, value: number): LGraphNode {
  const node = spawnInterior(parent as Subgraph, 'io/number-input')
  setParam(node, 'value', value)
  return node
}

// ─── Value encoding ──────────────────────────────────────────────────────────

describe('encodeValue', () => {
  it('encodes primitives inline', () => {
    expect(encodeValue('hi')).toEqual({ kind: 'string', value: 'hi' })
    expect(encodeValue(4.5)).toEqual({ kind: 'number', value: 4.5 })
    expect(encodeValue(true)).toEqual({ kind: 'boolean', value: true })
    expect(encodeValue(null)).toEqual({ kind: 'null' })
    expect(encodeValue(undefined)).toEqual({ kind: 'undefined' })
  })

  it('encodes bytes as base64 with length, round-trippable', () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 255])
    const encoded = encodeValue(bytes)
    expect(encoded).toEqual({ kind: 'bytes', length: 5, base64: btoa(bytesToBinaryString(bytes)) })
    const back = binaryStringToBytes(atob((encoded as { base64: string }).base64))
    expect(back).toEqual(bytes)
  })

  it('keeps non-finite numbers as text (they are not JSON)', () => {
    expect(encodeValue(Number.NaN)).toEqual({ kind: 'number', value: null, text: 'NaN' })
    expect(encodeValue(Number.POSITIVE_INFINITY)).toEqual({ kind: 'number', value: null, text: 'Infinity' })
  })

  it('recurses into lists and plain objects', () => {
    const encoded = encodeValue({ a: [1, new Uint8Array([7])], b: { c: 'x' } })
    expect(encoded).toEqual({
      kind: 'object',
      entries: {
        a: {
          kind: 'list',
          items: [
            { kind: 'number', value: 1 },
            { kind: 'bytes', length: 1, base64: btoa('\x07') },
          ],
        },
        b: { kind: 'object', entries: { c: { kind: 'string', value: 'x' } } },
      },
    })
  })

  it('never throws on exotica', () => {
    expect(encodeValue(10n)).toEqual({ kind: 'other', text: '10' })
  })
})

// ─── The dump ────────────────────────────────────────────────────────────────

interface DumpedNodeShape {
  id: number | string
  title: string
  state: string
  params?: Record<string, unknown>
  outputs?: Array<{ kind: string; value?: unknown }>
  error?: string
}

interface DumpedCallShape {
  path: string
  def: string
  depth: number
  origin: string
  inputs: Array<{ kind: string; value?: unknown }>
  nodes: DumpedNodeShape[]
}

describe('buildStateDump', () => {
  it('captures root nodes and the full recursive call tree with values', async () => {
    const { graph, engine, dispose } = rig()

    // "DumpFact": n → Select (n ≤ 1) ? 1 : n × DumpFact(n − 1).
    const meta = createSubgraphDef(graph, 'DumpFact')
    addDefInput(graph, meta.id, 'n', NUMBER)
    addDefOutput(graph, meta.id, 'result', NUMBER)
    const sub = rawSubgraph(graph, meta.id)
    if (!sub) throw new Error('no subgraph')
    const lessEq = spawnInterior(sub, 'math/less-eq')
    wirePanelIn(sub, 0, lessEq, 0)
    constNum(sub, 1).connect(0, lessEq, 1)
    const select = spawnInterior(sub, 'flow/select')
    lessEq.connect(0, select, 0)
    constNum(sub, 1).connect(0, select, 1)
    const subtr = spawnInterior(sub, 'math/subtract')
    wirePanelIn(sub, 0, subtr, 0)
    constNum(sub, 1).connect(0, subtr, 1)
    const self = spawnSubgraphNode(meta.id)
    if (!self) throw new Error('no factory')
    sub.add(self)
    subtr.connect(0, self, 0)
    const mul = spawnInterior(sub, 'math/multiply')
    wirePanelIn(sub, 0, mul, 0)
    self.connect(0, mul, 1)
    mul.connect(0, select, 2)
    wirePanelOut(sub, select, 0, 0)

    const input = constNum(graph, 4)
    const instance = spawnSubgraphNode(meta.id)
    if (!instance) throw new Error('no factory')
    graph.add(instance)
    input.connect(0, instance, 0)
    const sink = spawn(graph, 'io/preview')
    instance.connect(0, sink, 0)
    await engine.whenIdle()

    const dump = buildStateDump(engine)
    // The whole file stays JSON-safe.
    const roundTripped = JSON.parse(JSON.stringify(dump)) as {
      lens: string | null
      traceComplete: boolean
      document: { nodes: unknown[] }
      root: { nodes: DumpedNodeShape[] }
      calls: DumpedCallShape[]
    }

    expect(roundTripped.traceComplete).toBe(true)
    expect(roundTripped.document.nodes.length).toBeGreaterThan(0)

    // Root: the constant (with params), the instance (with its output value),
    // and the Preview sink (with its recorded input).
    const rootConst = roundTripped.root.nodes.find((n) => n.title === input.title)
    expect(rootConst?.params).toMatchObject({ value: 4 })
    const rootInstance = roundTripped.root.nodes.find((n) => n.id === instance.id)
    expect(rootInstance?.state).toBe('ok')
    expect(rootInstance?.outputs).toEqual([{ kind: 'number', value: 24 }])
    const rootSink = roundTripped.root.nodes.find((n) => n.id === sink.id)
    expect(rootSink?.state).toBe('ok')

    // Calls: one per recursion layer, pre-order, with boundary inputs.
    expect(roundTripped.calls.map((c) => [c.depth, c.inputs])).toEqual([
      [1, [{ kind: 'number', value: 4 }]],
      [2, [{ kind: 'number', value: 3 }]],
      [3, [{ kind: 'number', value: 2 }]],
      [4, [{ kind: 'number', value: 1 }]],
    ])
    expect(roundTripped.calls[0]?.origin).toBe('retained')
    expect(roundTripped.calls[1]?.origin).toBe('traced')
    expect(roundTripped.calls[0]?.def).toBe('DumpFact')

    // Interior values per call: mul at the n=2 call is 2; the base-case call
    // never demanded mul (lazy Select else) — it stays dirty with no outputs.
    const n2 = roundTripped.calls[2]
    const mulAtN2 = n2?.nodes.find((n) => n.id === mul.id)
    expect(mulAtN2?.outputs).toEqual([{ kind: 'number', value: 2 }])
    const base = roundTripped.calls[3]
    const mulAtBase = base?.nodes.find((n) => n.id === mul.id)
    expect(mulAtBase?.state).toBe('dirty')
    expect(mulAtBase?.outputs).toBeUndefined()
    const selectAtBase = base?.nodes.find((n) => n.id === select.id)
    expect(selectAtBase?.outputs).toEqual([{ kind: 'number', value: 1 }])
    dispose()
  })

  it('captures errors and blocked propagation', async () => {
    const { graph, engine, dispose } = rig()
    const bad = constNum(graph, 0)
    const div = spawn(graph, 'math/divide')
    bad.connect(0, div, 0)
    constNum(graph, 0).connect(0, div, 1)
    const upper = spawn(graph, 'math/add')
    div.connect(0, upper, 0)
    constNum(graph, 1).connect(0, upper, 1)
    const sink = spawn(graph, 'io/preview')
    upper.connect(0, sink, 0)
    await engine.whenIdle()

    const dump = buildStateDump(engine) as {
      root: { nodes: DumpedNodeShape[] }
    }
    const failed = dump.root.nodes.find((n) => n.id === div.id)
    expect(failed?.state).toBe('error')
    expect(failed?.error).toMatch(/zero|division/i)
    const blocked = dump.root.nodes.find((n) => n.id === upper.id)
    expect(blocked?.state).toBe('blocked')
    dispose()
  })
})
