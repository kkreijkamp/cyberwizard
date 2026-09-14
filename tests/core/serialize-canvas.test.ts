import { LGraph, LiteGraph } from '@comfyorg/litegraph'
import type { LGraphCanvas } from '@comfyorg/litegraph'
import { describe, expect, it } from 'vitest'
import { Engine } from '../../src/core/engine'
import { defineNode, installConnectionRules, setParam } from '../../src/core/registry'
import { deserializeGraph, parseGraphDocument, serializeGraph } from '../../src/core/serialize'
import {
  addDefInput, addDefOutput, allSubgraphDefs, attachSubgraphSupport,
  createSubgraphDef, rawSubgraph, spawnSubgraphNode,
} from '../../src/core/subgraph'
import { STRING } from '../../src/core/types'

installConnectionRules()

defineNode({
  type: 'stub/src', title: 'Src', category: 'Test', inputs: [],
  outputs: [{ name: 'text', type: STRING }] as const,
  params: [{ kind: 'string', name: 'text', default: 'x' }] as const,
  run: (_i, p) => ({ text: p.text }),
})
defineNode({
  type: 'stub/suffix', title: 'Suffix', category: 'Test',
  inputs: [{ name: 'data', type: STRING }] as const,
  outputs: [{ name: 'out', type: STRING }] as const,
  params: [{ kind: 'string', name: 'suffix', default: '' }] as const,
  run: (i, p) => ({ out: (i.data ?? '') + p.suffix }),
})

describe('serializeGraph with a canvas argument (the app save path)', () => {
  it('includes subgraphs and survives JSON+parse', async () => {
    const graph = new LGraph()
    const engine = new Engine(graph)
    const detach = attachSubgraphSupport(graph, engine)

    const meta = createSubgraphDef(graph, 'WithCanvas')
    addDefInput(graph, meta.id, 'text', STRING)
    addDefOutput(graph, meta.id, 'out', STRING)
    const sub = rawSubgraph(graph, meta.id)!
    const suffix = LiteGraph.createNode('stub/suffix')!
    sub.add(suffix)
    sub.inputs[0]!.connect(suffix.inputs[0]!, suffix)
    sub.outputs[0]!.connect(suffix.outputs[0]!, suffix)

    const src = LiteGraph.createNode('stub/src')!
    graph.add(src)
    const instance = spawnSubgraphNode(meta.id)!
    graph.add(instance)
    src.connect(0, instance, 0)
    await engine.whenIdle()

    // Minimal canvas stub: serializeGraph only touches .graph and .ds
    const canvasStub = {
      graph,
      ds: { offset: [120, 60], scale: 0.8 },
    } as unknown as LGraphCanvas

    const doc = serializeGraph(graph, canvasStub)
    console.log('DOC KEYS:', Object.keys(doc), 'subgraphs:', doc.subgraphs?.length)
    expect(doc.subgraphs).toHaveLength(1)
    expect(doc.view).toEqual({ offset: [120, 60], scale: 0.8 })

    const parsed = parseGraphDocument(JSON.parse(JSON.stringify(doc)))
    const restored = new LGraph()
    const { warnings } = deserializeGraph(parsed, restored)
    expect(warnings).toEqual([])
    expect(allSubgraphDefs(restored).map((d) => d.name)).toEqual(['WithCanvas'])
    detach(); engine.dispose()
  })

  it('omits view when the canvas is inside a subgraph (but keeps definitions)', async () => {
    const graph = new LGraph()
    const engine = new Engine(graph)
    const detach = attachSubgraphSupport(graph, engine)
    const meta = createSubgraphDef(graph, 'DeepSave')
    addDefOutput(graph, meta.id, 'out', STRING)

    const sub = rawSubgraph(graph, meta.id)!
    const canvasStub = { graph: sub, ds: { offset: [0, 0], scale: 1 } } as unknown as LGraphCanvas
    const doc = serializeGraph(graph, canvasStub)
    expect(doc.view).toBeUndefined()
    expect(doc.subgraphs).toHaveLength(1)
    detach(); engine.dispose()
  })
})
