import { LGraph, LiteGraph } from '@comfyorg/litegraph'
import type { LGraphNode } from '@comfyorg/litegraph'
import { describe, expect, it } from 'vitest'
import { Engine } from '../../src/core/engine'
import { defineNode, installConnectionRules, setParam } from '../../src/core/registry'
import { deserializeGraph, serializeGraph } from '../../src/core/serialize'
import {
  addDefInput,
  addDefOutput,
  attachSubgraphSupport,
  createSubgraphDef,
  rawSubgraph,
  spawnSubgraphNode,
} from '../../src/core/subgraph'
import { NUMBER, STRING } from '../../src/core/types'
import '../../src/nodes'

installConnectionRules()

// ─── Test ops with run counters ─────────────────────────────────────────────

const counters = { src: 0, suffix: 0, num: 0 }

defineNode({
  type: 'test-recon/src',
  title: 'Source',
  category: 'Test',
  inputs: [],
  outputs: [{ name: 'text', type: STRING }] as const,
  params: [{ kind: 'string', name: 'text', default: 'x' }] as const,
  run: (_inputs, params) => {
    counters.src++
    return { text: params.text }
  },
})

defineNode({
  type: 'test-recon/suffix',
  title: 'Suffix',
  category: 'Test',
  inputs: [{ name: 'data', type: STRING }] as const,
  outputs: [{ name: 'out', type: STRING }] as const,
  params: [{ kind: 'string', name: 'suffix', default: '' }] as const,
  run: (inputs, params) => {
    counters.suffix++
    return { out: (inputs.data ?? '') + params.suffix }
  },
})

defineNode({
  type: 'test-recon/num',
  title: 'Number',
  category: 'Test',
  inputs: [],
  outputs: [{ name: 'n', type: NUMBER }] as const,
  params: [{ kind: 'number', name: 'n', default: 1 }] as const,
  run: (_inputs, params) => {
    counters.num++
    return { n: params.n }
  },
})

// ─── Helpers ─────────────────────────────────────────────────────────────────

function spawn(graph: LGraph, type: string): LGraphNode {
  const node = LiteGraph.createNode(type)
  if (!node) throw new Error(`unregistered: ${type}`)
  graph.add(node)
  return node
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

describe('reconcile after restore', () => {
  it('re-runs only the changed node and its downstream; unchanged branches memo-hit', async () => {
    const { graph, engine, dispose } = rig()
    const a = spawn(graph, 'test-recon/src')
    const b = spawn(graph, 'test-recon/suffix')
    a.connect(0, b, 0)
    const sink = spawn(graph, 'io/preview')
    b.connect(0, sink, 0)
    // An independent branch that must never re-run.
    const d = spawn(graph, 'test-recon/src')
    const sink2 = spawn(graph, 'io/preview')
    d.connect(0, sink2, 0)

    counters.src = 0
    counters.suffix = 0
    await engine.whenIdle()
    expect(counters).toEqual({ src: 2, suffix: 1, num: 0 })
    expect(engine.outputsOf(b)).toEqual(['x'])

    const docBefore = serializeGraph(graph)
    setParam(b, 'suffix', '?')
    await engine.whenIdle()
    expect(counters.suffix).toBe(2)
    expect(engine.outputsOf(b)).toEqual(['x?'])

    // "Undo": restore the pre-edit document. a and d are untouched; b changed.
    deserializeGraph(docBefore, graph)
    await engine.whenIdle()
    expect(engine.outputsOf(b)).toEqual(['x'])
    expect(counters.src).toBe(2) // a and d never re-ran
    expect(counters.suffix).toBe(3) // b re-ran once, with the restored param
    dispose()
  })

  it('repaints survivors from kept state immediately (no ∅ flash)', async () => {
    const { graph, engine, dispose } = rig()
    const a = spawn(graph, 'test-recon/src')
    const b = spawn(graph, 'test-recon/suffix')
    a.connect(0, b, 0)
    const sink = spawn(graph, 'io/preview')
    b.connect(0, sink, 0)
    await engine.whenIdle()

    const docBefore = serializeGraph(graph)
    setParam(b, 'suffix', '?')
    await engine.whenIdle()

    deserializeGraph(docBefore, graph)
    // Before any evaluation: a is unchanged, its badge holds the kept value.
    const restoredA = graph.getNodeById(a.id)
    const widget = restoredA?.widgets?.find((w) => w.name === '⇒') as { value?: unknown } | undefined
    expect(String(widget?.value)).toContain('x')
    expect(String(widget?.value)).not.toBe('∅')
    await engine.whenIdle()
    expect(engine.outputsOf(b)).toEqual(['x'])
    dispose()
  })

  it('keeps the recursion trace and lens data across an unrelated restore', async () => {
    const { graph, engine, dispose } = rig()

    // "CountDown": n → Select (n ≤ 0) ? 0 : CountDown(n − 1). Interior num op
    // has a run counter: unchanged defs must not re-run at all.
    const meta = createSubgraphDef(graph, 'CountDown')
    addDefInput(graph, meta.id, 'n', NUMBER)
    addDefOutput(graph, meta.id, 'result', NUMBER)
    const sub = rawSubgraph(graph, meta.id)
    if (!sub) throw new Error('no subgraph')
    const lessEq = spawn(sub as unknown as LGraph, 'math/less-eq')
    const wire = (panelIndex: number, node: LGraphNode, slot: number) => {
      const link = sub.inputs[panelIndex]?.connect(node.inputs[slot]!, node)
      if (!link) throw new Error('panel wiring failed')
    }
    wire(0, lessEq, 0)
    const zeroA = spawn(sub as unknown as LGraph, 'test-recon/num')
    setParam(zeroA, 'n', 0)
    zeroA.connect(0, lessEq, 1)
    const select = spawn(sub as unknown as LGraph, 'flow/select')
    lessEq.connect(0, select, 0)
    const zeroB = spawn(sub as unknown as LGraph, 'test-recon/num')
    setParam(zeroB, 'n', 0)
    zeroB.connect(0, select, 1)
    const subtr = spawn(sub as unknown as LGraph, 'math/subtract')
    wire(0, subtr, 0)
    const one = spawn(sub as unknown as LGraph, 'test-recon/num')
    setParam(one, 'n', 1)
    one.connect(0, subtr, 1)
    const self = spawnSubgraphNode(meta.id)
    if (!self) throw new Error('no factory')
    sub.add(self)
    subtr.connect(0, self, 0)
    self.connect(0, select, 2) // else: the recursive call
    const outLink = sub.outputs[0]?.connect(select.outputs[0]!, select)
    if (!outLink) throw new Error('panel-out wiring failed')
    void outLink

    const three = spawn(graph, 'test-recon/num')
    setParam(three, 'n', 3)
    const instance = spawnSubgraphNode(meta.id)
    if (!instance) throw new Error('no factory')
    graph.add(instance)
    three.connect(0, instance, 0)
    const sink = spawn(graph, 'io/preview')
    instance.connect(0, sink, 0)

    counters.num = 0
    await engine.whenIdle()
    expect(engine.outputsOf(instance)).toEqual([0])
    const callsBefore = engine.callsForDef(meta.id).length
    expect(callsBefore).toBeGreaterThan(1) // the recursive layers were traced

    // Unrelated root addition, then undo it: the definition and instance are
    // untouched, so the whole recursion memo-hits and the trace survives.
    const docBefore = serializeGraph(graph)
    const other = spawn(graph, 'test-recon/src')
    void other
    await engine.whenIdle()
    const numRunsBefore = counters.num // after the edit's own runs

    deserializeGraph(docBefore, graph)
    await engine.whenIdle()
    expect(engine.outputsOf(graph.getNodeById(instance.id) as LGraphNode)).toEqual([0])
    expect(counters.num).toBe(numRunsBefore) // the restore re-ran nothing
    expect(engine.callsForDef(meta.id).length).toBe(callsBefore)
    dispose()
  })

  it('a definition whose content changed re-runs its instances (and prunes interior state)', async () => {
    const { graph, engine, dispose } = rig()
    const meta = createSubgraphDef(graph, 'Konst')
    addDefOutput(graph, meta.id, 'n', NUMBER)
    const sub = rawSubgraph(graph, meta.id)
    if (!sub) throw new Error('no subgraph')
    const konst = spawn(sub as unknown as LGraph, 'test-recon/num')
    const outLink = sub.outputs[0]?.connect(konst.outputs[0]!, konst)
    if (!outLink) throw new Error('panel-out wiring failed')

    const instance = spawnSubgraphNode(meta.id)
    if (!instance) throw new Error('no factory')
    graph.add(instance)
    const sink = spawn(graph, 'io/preview')
    instance.connect(0, sink, 0)

    counters.num = 0
    await engine.whenIdle()
    expect(engine.outputsOf(instance)).toEqual([1])
    expect(counters.num).toBe(1)

    // Hand-edit the document: the interior constant becomes 5.
    const doc = serializeGraph(graph)
    const savedSub = doc.subgraphs?.find((s) => s.id === meta.id)
    if (!savedSub) throw new Error('def not serialized')
    const savedKonst = savedSub.nodes.find((n) => n.type === 'test-recon/num')
    if (!savedKonst) throw new Error('konst not serialized')
    savedKonst.params.n = 5

    deserializeGraph(doc, graph)
    await engine.whenIdle()
    expect(engine.outputsOf(graph.getNodeById(instance.id) as LGraphNode)).toEqual([5])
    expect(counters.num).toBe(2) // the changed interior re-ran
    expect(engine.callsForDef(meta.id).length).toBe(1) // trace re-recorded cleanly
    dispose()
  })
})
