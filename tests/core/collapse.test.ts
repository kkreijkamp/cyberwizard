import { LGraph, LiteGraph } from '@comfyorg/litegraph'
import type { LGraphNode, Subgraph } from '@comfyorg/litegraph'
import { describe, expect, it } from 'vitest'
import { collapseToSubgraph } from '../../src/core/collapse'
import { Engine } from '../../src/core/engine'
import { defineNode, installConnectionRules, setParam } from '../../src/core/registry'
import {
  addDefInput,
  addDefOutput,
  attachSubgraphSupport,
  createSubgraphDef,
  getSubgraphDef,
  rawSubgraph,
  spawnSubgraphNode,
} from '../../src/core/subgraph'
import { STRING } from '../../src/core/types'

installConnectionRules()

const counters = { suffix: 0, sink: 0 }

defineNode({
  type: 'test-col/src',
  title: 'Source',
  category: 'Test',
  inputs: [],
  outputs: [{ name: 'text', type: STRING }] as const,
  params: [{ kind: 'string', name: 'text', default: 'x' }] as const,
  run: (_inputs, params) => ({ text: params.text }),
})

defineNode({
  type: 'test-col/suffix',
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

const sinkCaptured: unknown[] = []
defineNode({
  type: 'test-col/sink',
  title: 'Sink',
  category: 'Test',
  inputs: [{ name: 'value', type: STRING }] as const,
  outputs: [] as const,
  run: (inputs) => {
    counters.sink++
    sinkCaptured.push(inputs.value)
    return {}
  },
})

defineNode({
  type: 'test-col/join',
  title: 'Join',
  category: 'Test',
  inputs: [
    { name: 'a', type: STRING },
    { name: 'b', type: STRING },
  ] as const,
  outputs: [{ name: 'out', type: STRING }] as const,
  run: (inputs) => ({ out: `${inputs.a ?? ''}|${inputs.b ?? ''}` }),
})

function spawn(graph: LGraph, type: string): LGraphNode {
  const node = LiteGraph.createNode(type)
  if (!node) throw new Error(`not registered: ${type}`)
  graph.add(node)
  return node
}

function reset(): void {
  counters.suffix = 0
  counters.sink = 0
  sinkCaptured.length = 0
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

describe('collapseToSubgraph', () => {
  it('throws on an empty selection', () => {
    const { graph, dispose } = rig()
    expect(() => collapseToSubgraph(graph, [])).toThrow(/nothing selected/)
    dispose()
  })

  it('collapses the middle of a chain, preserving values', async () => {
    reset()
    const { graph, engine, dispose } = rig()
    const src = spawn(graph, 'test-col/src')
    setParam(src, 'text', 'v')
    const a = spawn(graph, 'test-col/suffix')
    const b = spawn(graph, 'test-col/suffix')
    setParam(a, 'suffix', '1')
    setParam(b, 'suffix', '2')
    const sink = spawn(graph, 'test-col/sink')
    src.connect(0, a, 0)
    a.connect(0, b, 0)
    b.connect(0, sink, 0)

    await engine.whenIdle()
    expect(sinkCaptured).toEqual(['v12'])
    sinkCaptured.length = 0

    const { defId, instance } = collapseToSubgraph(graph, [a, b], 'Both')
    const meta = getSubgraphDef(graph, defId)
    expect(meta?.name).toBe('Both')
    expect(meta?.inputs).toEqual([{ name: 'data', type: STRING }])
    expect(meta?.outputs).toEqual([{ name: 'out', type: STRING }])

    // Parent rewired through the instance.
    expect(src.outputs[0]?.links).toHaveLength(1)
    expect(sink.inputs[0]?.link).not.toBeNull()
    expect(instance.inputs).toHaveLength(1)
    expect(instance.outputs).toHaveLength(1)

    // Interior: a and b moved, internal edge + panel wiring recreated.
    const sub = rawSubgraph(graph, defId) as Subgraph
    expect(sub._nodes).toHaveLength(2)
    expect(sub._links.size).toBe(3) // a→b, panel→a, b→panel

    await engine.whenIdle()
    expect(sinkCaptured).toEqual(['v12'])
    dispose()
  })

  it('creates one declared input per outside origin (fan-in)', async () => {
    reset()
    const { graph, engine, dispose } = rig()
    const srcA = spawn(graph, 'test-col/src')
    const srcB = spawn(graph, 'test-col/src')
    setParam(srcA, 'text', 'L')
    setParam(srcB, 'text', 'R')
    const join = spawn(graph, 'test-col/join')
    const sink = spawn(graph, 'test-col/sink')
    srcA.connect(0, join, 0)
    srcB.connect(0, join, 1)
    join.connect(0, sink, 0)

    const { defId } = collapseToSubgraph(graph, [join])
    const meta = getSubgraphDef(graph, defId)
    expect(meta?.inputs.map((i) => i.name)).toEqual(['a', 'b'])
    expect(meta?.outputs.map((o) => o.name)).toEqual(['out'])

    await engine.whenIdle()
    expect(sinkCaptured).toEqual(['L|R'])
    dispose()
  })

  it('preserves fan-out across the boundary (one input, interior split)', async () => {
    reset()
    const { graph, engine, dispose } = rig()
    const src = spawn(graph, 'test-col/src')
    const a = spawn(graph, 'test-col/suffix')
    const b = spawn(graph, 'test-col/suffix')
    setParam(a, 'suffix', 'A')
    setParam(b, 'suffix', 'B')
    const sinkA = spawn(graph, 'test-col/sink')
    const sinkB = spawn(graph, 'test-col/sink')
    src.connect(0, a, 0)
    src.connect(0, b, 0)
    a.connect(0, sinkA, 0)
    b.connect(0, sinkB, 0)

    const { defId } = collapseToSubgraph(graph, [a, b])
    const meta = getSubgraphDef(graph, defId)
    // One outside origin slot → ONE declared input; two output groups.
    expect(meta?.inputs).toHaveLength(1)
    expect(meta?.outputs).toHaveLength(2)

    await engine.whenIdle()
    expect(sinkCaptured).toEqual(['xA', 'xB'])
    dispose()
  })

  it('collapses a selection containing a subgraph instance (nesting)', async () => {
    reset()
    const { graph, engine, dispose } = rig()
    const inner = createSubgraphDef(graph, 'Inner')
    addDefInput(graph, inner.id, 'text', STRING)
    addDefOutput(graph, inner.id, 'out', STRING)
    const innerSub = rawSubgraph(graph, inner.id) as Subgraph
    const innerOp = LiteGraph.createNode('test-col/suffix')
    if (!innerOp) throw new Error('unregistered')
    innerSub.add(innerOp)
    setParam(innerOp, 'suffix', '!')
    innerSub.inputs[0]?.connect(innerOp.inputs[0]!, innerOp)
    innerSub.outputs[0]?.connect(innerOp.outputs[0]!, innerOp)

    const src = spawn(graph, 'test-col/src')
    const instance = spawnSubgraphNode(inner.id)
    if (!instance) throw new Error('no factory')
    graph.add(instance)
    const sink = spawn(graph, 'test-col/sink')
    src.connect(0, instance, 0)
    instance.connect(0, sink, 0)

    const { defId } = collapseToSubgraph(graph, [instance], 'Outer')
    await engine.whenIdle()
    expect(sinkCaptured).toEqual(['x!'])
    expect(getSubgraphDef(graph, defId)?.name).toBe('Outer')
    dispose()
  })

  it('collapses within a definition interior (definition rooted at document level)', async () => {
    reset()
    const { graph, engine, dispose } = rig()
    const outer = createSubgraphDef(graph, 'Outer')
    addDefInput(graph, outer.id, 'text', STRING)
    addDefOutput(graph, outer.id, 'out', STRING)
    const outerSub = rawSubgraph(graph, outer.id) as Subgraph

    const a = LiteGraph.createNode('test-col/suffix')
    const b = LiteGraph.createNode('test-col/suffix')
    if (!a || !b) throw new Error('unregistered')
    outerSub.add(a)
    outerSub.add(b)
    setParam(a, 'suffix', '1')
    setParam(b, 'suffix', '2')
    outerSub.inputs[0]?.connect(a.inputs[0]!, a)
    a.connect(0, b, 0)
    outerSub.outputs[0]?.connect(b.outputs[0]!, b)

    // Collapse a+b while "inside" the outer definition.
    const { defId } = collapseToSubgraph(outerSub, [a, b], 'Pair')
    expect(getSubgraphDef(graph, defId)?.name).toBe('Pair')
    expect(outerSub._nodes.some((n) => n.isSubgraphNode())).toBe(true)

    const src = spawn(graph, 'test-col/src')
    const outerInstance = spawnSubgraphNode(outer.id)
    if (!outerInstance) throw new Error('no factory')
    graph.add(outerInstance)
    const sink = spawn(graph, 'test-col/sink')
    src.connect(0, outerInstance, 0)
    outerInstance.connect(0, sink, 0)

    await engine.whenIdle()
    expect(sinkCaptured).toEqual(['x12'])
    dispose()
  })
})
