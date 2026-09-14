import { LGraph, LiteGraph } from '@comfyorg/litegraph'
import type { LGraphNode } from '@comfyorg/litegraph'
import { describe, expect, it } from 'vitest'
import { Engine } from '../../src/core/engine'
import {
  convertParamToInput,
  getNodeDef,
  installConnectionRules,
  revertParamToWidget,
  setParam,
} from '../../src/core/registry'
import { deserializeGraph, parseGraphDocument, serializeGraph } from '../../src/core/serialize'
import '../../src/nodes'

installConnectionRules()

function spawn(graph: LGraph, type: string): LGraphNode {
  const node = LiteGraph.createNode(type)
  if (!node) throw new Error(`not registered: ${type}`)
  graph.add(node)
  return node
}

/** Range(count) → take.items, count → take's n (converted slot), take → preview. */
function buildTakePipeline(graph: LGraph, count: number, n: number): { take: LGraphNode; range: LGraphNode; source: LGraphNode } {
  const range = spawn(graph, 'flow/list-range')
  setParam(range, 'count', count)
  const take = spawn(graph, 'flow/list-take')
  const def = getNodeDef(take)
  const nParam = def?.params?.find((p) => p.name === 'n')
  if (!nParam) throw new Error('no n param')
  convertParamToInput(take, nParam)
  const source = spawn(graph, 'io/integer-input')
  setParam(source, 'value', n)
  const sink = spawn(graph, 'io/preview')
  range.connect(0, take, 0)
  source.connect(0, take, 1) // the converted slot
  take.connect(0, sink, 0)
  return { take, range, source }
}

describe('widget params as connection points', () => {
  it('a converted param takes its value from the wire', async () => {
    const graph = new LGraph()
    const engine = new Engine(graph)
    const { take } = buildTakePipeline(graph, 5, 2)

    await engine.whenIdle()
    expect(engine.outputsOf(take)).toEqual([[0, 1]])
    engine.dispose()
  })

  it('unwired converted slot falls back to the widget value; wired overrides it', async () => {
    const graph = new LGraph()
    const engine = new Engine(graph)
    const { take, source } = buildTakePipeline(graph, 5, 2)
    setParam(take, 'n', 3) // widget says 3, wire says 2

    await engine.whenIdle()
    expect(engine.outputsOf(take)).toEqual([[0, 1]]) // wire wins

    source.disconnectOutput(0, take)
    await engine.whenIdle()
    expect(engine.outputsOf(take)).toEqual([[0, 1, 2]]) // unwired: widget value stands
    engine.dispose()
  })

  it('reverts back to the widget', async () => {
    const graph = new LGraph()
    const engine = new Engine(graph)
    const { take, source } = buildTakePipeline(graph, 5, 2)
    setParam(take, 'n', 4)
    source.disconnectOutput(0, take)

    revertParamToWidget(take, 'n', 1)
    expect(take.inputs).toHaveLength(1)

    await engine.whenIdle()
    expect(engine.outputsOf(take)).toEqual([[0, 1, 2, 3]])
    engine.dispose()
  })

  it('reverts back to the widget', async () => {
    const graph = new LGraph()
    const engine = new Engine(graph)
    const { take, source } = buildTakePipeline(graph, 5, 2)
    setParam(take, 'n', 4)
    source.disconnectOutput(0, take)

    revertParamToWidget(take, 'n', 1)
    expect(take.inputs).toHaveLength(1)

    await engine.whenIdle()
    expect(engine.outputsOf(take)).toEqual([[0, 1, 2, 3]])
    engine.dispose()
  })

  it('refuses to revert while wired', () => {
    const graph = new LGraph()
    const { take } = buildTakePipeline(graph, 5, 2)
    revertParamToWidget(take, 'n', 1)
    expect(take.inputs).toHaveLength(2) // still there: the wire protects it
  })

  it('round-trips conversion and links through serialization', async () => {
    const graph = new LGraph()
    const engine = new Engine(graph)
    buildTakePipeline(graph, 5, 2)
    await engine.whenIdle()

    const doc = parseGraphDocument(JSON.parse(JSON.stringify(serializeGraph(graph))))
    const saved = doc.nodes.find((n) => n.type === 'flow/list-take')
    expect(saved?.widgetInputs).toEqual(['n'])
    engine.dispose()

    const restored = new LGraph()
    const { warnings } = deserializeGraph(doc, restored)
    expect(warnings).toEqual([])
    const engine2 = new Engine(restored)
    const take = restored._nodes.find((n) => n.type === 'flow/list-take')
    if (!take) throw new Error('take not restored')
    expect(take.inputs).toHaveLength(2)

    await engine2.whenIdle()
    expect(engine2.outputsOf(take)).toEqual([[0, 1]])
    engine2.dispose()
  })

  it('warns (but loads) when a converted param no longer exists', () => {
    const graph = new LGraph()
    buildTakePipeline(graph, 5, 2)
    const doc = parseGraphDocument(JSON.parse(JSON.stringify(serializeGraph(graph))))
    const saved = doc.nodes.find((n) => n.type === 'flow/list-take')
    if (!saved) throw new Error('no take')
    saved.widgetInputs = ['nonexistent-param']

    const restored = new LGraph()
    const { warnings } = deserializeGraph(doc, restored)
    expect(warnings.some((w) => w.includes('nonexistent-param'))).toBe(true)
    const take = restored._nodes.find((n) => n.type === 'flow/list-take')
    expect(take?.inputs).toHaveLength(1)
  })
})
