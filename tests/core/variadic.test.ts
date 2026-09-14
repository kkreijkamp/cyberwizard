import { LGraph, LiteGraph } from '@comfyorg/litegraph'
import type { LGraphNode } from '@comfyorg/litegraph'
import { describe, expect, it } from 'vitest'
import { Engine } from '../../src/core/engine'
import { installConnectionRules, setParam } from '../../src/core/registry'
import { deserializeGraph, parseGraphDocument, serializeGraph } from '../../src/core/serialize'
import '../../src/nodes'

installConnectionRules()

function spawn(graph: LGraph, type: string): LGraphNode {
  const node = LiteGraph.createNode(type)
  if (!node) throw new Error(`unregistered: ${type}`)
  graph.add(node)
  return node
}

function text(graph: LGraph, value: string): LGraphNode {
  const node = spawn(graph, 'io/text-input')
  setParam(node, 'text', value)
  return node
}

describe('variadic inputs', () => {
  it('grows a slot when all inputs are wired, and keeps exactly one trailing empty', () => {
    const graph = new LGraph()
    const concat = spawn(graph, 'flow/list-concat')
    expect(concat.inputs.map((s) => s.name)).toEqual(['a', 'b'])

    text(graph, 'x').connect(0, concat, 0) // a
    expect(concat.inputs.map((s) => s.name)).toEqual(['a', 'b'])
    text(graph, 'y').connect(0, concat, 1) // b: all wired → grow c
    expect(concat.inputs.map((s) => s.name)).toEqual(['a', 'b', 'c'])
    text(graph, 'z').connect(0, concat, 2) // c wired → grow d
    expect(concat.inputs.map((s) => s.name)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('prunes surplus trailing empty slots on disconnect', () => {
    const graph = new LGraph()
    const concat = spawn(graph, 'flow/list-concat')
    const x = text(graph, 'x')
    const y = text(graph, 'y')
    const z = text(graph, 'z')
    x.connect(0, concat, 0)
    y.connect(0, concat, 1)
    z.connect(0, concat, 2)
    expect(concat.inputs).toHaveLength(4) // a b c d

    z.disconnectOutput(0, concat)
    expect(concat.inputs.map((s) => s.name)).toEqual(['a', 'b', 'c']) // d pruned, c kept as the empty one
    y.disconnectOutput(0, concat)
    expect(concat.inputs.map((s) => s.name)).toEqual(['a', 'b']) // c pruned too: b is now the single empty trailing slot
  })

  it('concatenates every wired list in slot order (3+ inputs)', async () => {
    const graph = new LGraph()
    const engine = new Engine(graph)
    const concat = spawn(graph, 'flow/list-concat')
    const sink = spawn(graph, 'io/preview')
    text(graph, 'x').connect(0, concat, 0)
    text(graph, 'y').connect(0, concat, 1)
    text(graph, 'z').connect(0, concat, 2) // grew c on the previous wire
    concat.connect(0, sink, 0)

    await engine.whenIdle()
    expect(engine.outputsOf(concat)).toEqual([['x', 'y', 'z']])
    engine.dispose()
  })

  it('packs every wired input in slot order (4+ inputs)', async () => {
    const graph = new LGraph()
    const engine = new Engine(graph)
    const pack = spawn(graph, 'flow/list-pack')
    const sink = spawn(graph, 'io/preview')
    text(graph, 'x').connect(0, pack, 0)
    text(graph, 'y').connect(0, pack, 1)
    text(graph, 'z').connect(0, pack, 2)
    text(graph, 'w').connect(0, pack, 3) // grew d
    pack.connect(0, sink, 0)

    await engine.whenIdle()
    expect(engine.outputsOf(pack)).toEqual([['x', 'y', 'z', 'w']])
    engine.dispose()
  })

  it('round-trips dynamic slots and their links through serialization', async () => {
    const graph = new LGraph()
    const engine = new Engine(graph)
    const concat = spawn(graph, 'flow/list-concat')
    const sink = spawn(graph, 'io/preview')
    text(graph, 'x').connect(0, concat, 0)
    text(graph, 'y').connect(0, concat, 1)
    text(graph, 'z').connect(0, concat, 2)
    concat.connect(0, sink, 0)
    await engine.whenIdle()
    expect(engine.outputsOf(concat)).toEqual([['x', 'y', 'z']])
    engine.dispose()

    const doc = parseGraphDocument(JSON.parse(JSON.stringify(serializeGraph(graph))))
    const saved = doc.nodes.find((n) => n.type === 'flow/list-concat')
    expect(saved?.variadicInputs).toBe(2) // c (wired) + d (trailing empty)

    const restored = new LGraph()
    const { warnings } = deserializeGraph(doc, restored)
    expect(warnings).toEqual([])
    const engine2 = new Engine(restored)
    const rc = restored._nodes.find((n) => n.type === 'flow/list-concat')
    if (!rc) throw new Error('concat not restored')
    expect(rc.inputs.map((s) => s.name)).toEqual(['a', 'b', 'c', 'd'])

    await engine2.whenIdle()
    expect(engine2.outputsOf(rc)).toEqual([['x', 'y', 'z']])
    engine2.dispose()
  })
})
