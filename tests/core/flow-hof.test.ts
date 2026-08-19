import { LGraph, LiteGraph } from '@comfyorg/litegraph'
import type { LGraphNode, Subgraph } from '@comfyorg/litegraph'
import { describe, expect, it } from 'vitest'
import { Engine } from '../../src/core/engine'
import { defineNode, installConnectionRules, setParam } from '../../src/core/registry'
import {
  addDefInput,
  addDefOutput,
  attachSubgraphSupport,
  createSubgraphDef,
  rawSubgraph,
  spawnSubgraphNode,
} from '../../src/core/subgraph'
import { ANY, BOOLEAN, NUMBER, STRING, listOf } from '../../src/core/types'
import '../../src/nodes'

installConnectionRules()

// ─── Test ops for predicate/accumulator/error interiors ─────────────────────

defineNode({
  type: 'test-hof/longer',
  title: 'Longer Than',
  category: 'Test',
  inputs: [{ name: 'text', type: STRING }] as const,
  outputs: [{ name: 'pass', type: BOOLEAN }] as const,
  params: [{ kind: 'number', name: 'min', default: 2 }] as const,
  run: (inputs, params) => ({ pass: (inputs.text ?? '').length >= params.min }),
})

defineNode({
  type: 'test-hof/add',
  title: 'Add',
  category: 'Test',
  inputs: [
    { name: 'a', type: NUMBER },
    { name: 'b', type: NUMBER },
  ] as const,
  outputs: [{ name: 'sum', type: NUMBER }] as const,
  run: (inputs) => ({ sum: (inputs.a ?? 0) + (inputs.b ?? 0) }),
})

defineNode({
  type: 'test-hof/boom-on-b',
  title: 'Boom On B',
  category: 'Test',
  inputs: [{ name: 'text', type: STRING }] as const,
  outputs: [{ name: 'out', type: STRING }] as const,
  run: (inputs) => {
    if (inputs.text === 'b') throw new Error('no bees allowed')
    return { out: inputs.text ?? '' }
  },
})

defineNode({
  type: 'test-hof/affix',
  title: 'Affix',
  category: 'Test',
  inputs: [{ name: 'text', type: STRING }] as const,
  outputs: [{ name: 'out', type: STRING }] as const,
  params: [{ kind: 'string', name: 'pre', default: '' }] as const,
  run: (inputs, params) => ({ out: params.pre + (inputs.text ?? '') }),
})

// ─── Helpers ─────────────────────────────────────────────────────────────────

function spawn(graph: LGraph, type: string): LGraphNode {
  const node = LiteGraph.createNode(type)
  if (!node) throw new Error(`not registered: ${type}`)
  graph.add(node)
  return node
}

function interiorOf(graph: LGraph, defId: string): Subgraph {
  const sub = rawSubgraph(graph, defId)
  if (!sub) throw new Error('no subgraph')
  return sub
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

/** Attaches a Preview sink so the engine demands this node's output. */
function demand(graph: LGraph, node: LGraphNode): void {
  const sink = spawn(graph, 'io/preview')
  node.connect(0, sink, 0)
}

/** Def "Shout": text → to-upper-case → text (1-in-1-out). */
function buildShout(graph: LGraph): string {
  const meta = createSubgraphDef(graph, 'Shout')
  addDefInput(graph, meta.id, 'text', STRING)
  addDefOutput(graph, meta.id, 'text', STRING)
  const sub = interiorOf(graph, meta.id)
  const upper = spawnInterior(sub, 'text/to-upper-case')
  wirePanelIn(sub, 0, upper, 0)
  wirePanelOut(sub, upper, 0, 0)
  return meta.id
}

/** Builds: text-input(splitCsv) → split → map/filter/fold node. Returns the op node. */
function buildListPipeline(graph: LGraph, opType: string, csv: string): LGraphNode {
  const input = spawn(graph, 'io/text-input')
  setParam(input, 'text', csv)
  const split = spawn(graph, 'text/split')
  const op = spawn(graph, opType)
  input.connect(0, split, 0)
  split.connect(0, op, 0)
  return op
}

describe('higher-order flow ops', () => {
  it('map applies a 1-in-1-out subgraph per element', async () => {
    const { graph, engine, dispose } = rig()
    buildShout(graph)
    const map = buildListPipeline(graph, 'flow/map', 'a,b,c')
    setParam(map, 'fn', 'Shout')
    demand(graph, map)

    await engine.whenIdle()
    expect(engine.outputsOf(map)).toEqual([['A', 'B', 'C']])
    dispose()
  })

  it('map works over nested lists (list of lists)', async () => {
    const { graph, engine, dispose } = rig()
    // Def "How Long": items(any) → length(number) via text/length.
    const meta = createSubgraphDef(graph, 'How Long')
    addDefInput(graph, meta.id, 'items', ANY)
    addDefOutput(graph, meta.id, 'n', NUMBER)
    const sub = interiorOf(graph, meta.id)
    const length = spawnInterior(sub, 'text/length')
    wirePanelIn(sub, 0, length, 0)
    wirePanelOut(sub, length, 0, 0)

    // Pack two lists into a list-of-lists: [ [a,b], [c] ].
    const innerA = spawn(graph, 'flow/list-pack')
    const innerB = spawn(graph, 'flow/list-pack')
    const srcA = spawn(graph, 'io/text-input')
    const srcB = spawn(graph, 'io/text-input')
    setParam(srcA, 'text', 'a')
    setParam(srcB, 'text', 'b')
    srcA.connect(0, innerA, 0)
    srcB.connect(0, innerA, 1)
    srcA.connect(0, innerB, 0)
    const outer = spawn(graph, 'flow/list-pack')
    innerA.connect(0, outer, 0)
    innerB.connect(0, outer, 1)
    const map = spawn(graph, 'flow/map')
    setParam(map, 'fn', 'How Long')
    outer.connect(0, map, 0)
    demand(graph, map)

    await engine.whenIdle()
    expect(engine.outputsOf(map)).toEqual([[2, 1]])
    dispose()
  })

  it('filter keeps elements whose predicate output is truthy', async () => {
    const { graph, engine, dispose } = rig()
    const meta = createSubgraphDef(graph, 'Long Enough')
    addDefInput(graph, meta.id, 'text', STRING)
    addDefOutput(graph, meta.id, 'pass', BOOLEAN)
    const sub = interiorOf(graph, meta.id)
    const longer = spawnInterior(sub, 'test-hof/longer')
    setParam(longer, 'min', 2)
    wirePanelIn(sub, 0, longer, 0)
    wirePanelOut(sub, longer, 0, 0)

    const filter = buildListPipeline(graph, 'flow/filter', 'a,bb,c,dd')
    setParam(filter, 'fn', 'Long Enough')
    demand(graph, filter)

    await engine.whenIdle()
    expect(engine.outputsOf(filter)).toEqual([['bb', 'dd']])
    dispose()
  })

  it('fold reduces with a 2-in-1-out subgraph', async () => {
    const { graph, engine, dispose } = rig()
    const meta = createSubgraphDef(graph, 'Sum')
    addDefInput(graph, meta.id, 'acc', NUMBER)
    addDefInput(graph, meta.id, 'n', NUMBER)
    addDefOutput(graph, meta.id, 'acc', NUMBER)
    const sub = interiorOf(graph, meta.id)
    const add = spawnInterior(sub, 'test-hof/add')
    wirePanelIn(sub, 0, add, 0)
    wirePanelIn(sub, 1, add, 1)
    wirePanelOut(sub, add, 0, 0)

    const range = spawn(graph, 'flow/list-range')
    setParam(range, 'count', 3) // [0,1,2]
    const init = spawn(graph, 'io/number-input')
    setParam(init, 'value', 10)
    const fold = spawn(graph, 'flow/fold')
    setParam(fold, 'fn', 'Sum')
    range.connect(0, fold, 0)
    init.connect(0, fold, 1)
    demand(graph, fold)

    await engine.whenIdle()
    expect(engine.outputsOf(fold)).toEqual([13])
    dispose()
  })

  it('errors helpfully: no pick, unknown name, wrong arity, element failure', async () => {
    const { graph, engine, dispose } = rig()
    buildShout(graph)
    // A 2-in-1-out def (wrong arity for map).
    const binary = createSubgraphDef(graph, 'Binary')
    addDefInput(graph, binary.id, 'a', STRING)
    addDefInput(graph, binary.id, 'b', STRING)
    addDefOutput(graph, binary.id, 'out', STRING)
    // A def that throws on 'b'.
    const boomy = createSubgraphDef(graph, 'Boomy')
    addDefInput(graph, boomy.id, 'text', STRING)
    addDefOutput(graph, boomy.id, 'out', STRING)
    const sub = interiorOf(graph, boomy.id)
    const boom = spawnInterior(sub, 'test-hof/boom-on-b')
    wirePanelIn(sub, 0, boom, 0)
    wirePanelOut(sub, boom, 0, 0)

    const unpicked = buildListPipeline(graph, 'flow/map', 'a,b')
    const unknown = buildListPipeline(graph, 'flow/map', 'a,b')
    setParam(unknown, 'fn', 'Nope')
    const wrongArity = buildListPipeline(graph, 'flow/map', 'a,b')
    setParam(wrongArity, 'fn', 'Binary')
    const failing = buildListPipeline(graph, 'flow/map', 'a,b,c')
    setParam(failing, 'fn', 'Boomy')
    for (const op of [unpicked, unknown, wrongArity, failing]) demand(graph, op)

    await engine.whenIdle()
    expect(engine.stateOf(unpicked).error?.message).toMatch(/no subgraph selected/)
    expect(engine.stateOf(unknown).error?.message).toMatch(/"Nope" not found/)
    expect(engine.stateOf(wrongArity).error?.message).toMatch(/1-in-1-out/)
    expect(engine.stateOf(failing).error?.message).toMatch(/map element 1.*no bees/)
    dispose()
  })

  it('maps inside a subgraph interior (apply nesting)', async () => {
    const { graph, engine, dispose } = rig()
    buildShout(graph)

    // Outer def: list in → flow/map(fn=Shout) → list out.
    const outer = createSubgraphDef(graph, 'Shout Each')
    addDefInput(graph, outer.id, 'items', listOf(ANY))
    addDefOutput(graph, outer.id, 'items', listOf(ANY))
    const sub = interiorOf(graph, outer.id)
    const map = spawnInterior(sub, 'flow/map')
    setParam(map, 'fn', 'Shout')
    wirePanelIn(sub, 0, map, 0)
    wirePanelOut(sub, map, 0, 0)

    const input = spawn(graph, 'io/text-input')
    setParam(input, 'text', 'x,y')
    const split = spawn(graph, 'text/split')
    const instance = spawnSubgraphNode(outer.id)
    if (!instance) throw new Error('no factory')
    graph.add(instance)
    input.connect(0, split, 0)
    split.connect(0, instance, 0)
    demand(graph, instance)

    await engine.whenIdle()
    expect(engine.outputsOf(instance)).toEqual([['X', 'Y']])
    dispose()
  })

  it('maps over thousands of elements (fresh budget per element)', async () => {
    const { graph, engine, dispose } = rig()
    buildShout(graph)
    const range = spawn(graph, 'flow/list-range')
    setParam(range, 'count', 3000)
    const map = spawn(graph, 'flow/map')
    setParam(map, 'fn', 'Shout')
    range.connect(0, map, 0)
    const length = spawn(graph, 'text/length')
    map.connect(0, length, 0)
    demand(graph, length)

    await engine.whenIdle()
    expect(engine.outputsOf(length)).toEqual([3000])
    expect(engine.stateOf(map).error).toBeUndefined()
    dispose()
  })
})

describe('subgraph-name consumers (hof)', () => {
  it('editing the fn definition re-runs the map that applies it', async () => {
    const { graph, engine, dispose } = rig()
    // Def "Affix": text → pre + text.
    const meta = createSubgraphDef(graph, 'Affix')
    addDefInput(graph, meta.id, 'text', STRING)
    addDefOutput(graph, meta.id, 'out', STRING)
    const sub = interiorOf(graph, meta.id)
    const affix = spawnInterior(sub, 'test-hof/affix')
    setParam(affix, 'pre', '[')
    wirePanelIn(sub, 0, affix, 0)
    wirePanelOut(sub, affix, 0, 0)

    const map = buildListPipeline(graph, 'flow/map', 'a,b')
    setParam(map, 'fn', 'Affix')
    demand(graph, map)
    await engine.whenIdle()
    expect(engine.outputsOf(map)).toEqual([['[a', '[b']])

    setParam(affix, 'pre', '<') // interior edit — the map must re-run
    await engine.whenIdle()
    expect(engine.outputsOf(map)).toEqual([['<a', '<b']])
    dispose()
  })
})
