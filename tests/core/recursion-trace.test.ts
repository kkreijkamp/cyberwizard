import { LGraph, LiteGraph } from '@comfyorg/litegraph'
import type { LGraphNode, Subgraph } from '@comfyorg/litegraph'
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
import { NUMBER } from '../../src/core/types'
import '../../src/nodes'

installConnectionRules()

// ─── Test op: throws when its input equals a chosen value ───────────────────

defineNode({
  type: 'test-trace/boom-when',
  title: 'BoomWhen',
  category: 'Test',
  inputs: [{ name: 'n', type: NUMBER }] as const,
  outputs: [{ name: 'n', type: NUMBER }] as const,
  params: [{ kind: 'number', name: 'bad', default: 0 }] as const,
  run: (inputs, params) => {
    if (inputs.n === params.bad) throw new Error(`n is ${String(params.bad)}`)
    return { n: inputs.n ?? 0 }
  },
})

// ─── Helpers (same shape as flow-control.test.ts) ───────────────────────────

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

function constNum(parent: LGraph | Subgraph, value: number): LGraphNode {
  const node = spawnInterior(parent as Subgraph, 'io/number-input')
  setParam(node, 'value', value)
  return node
}

/**
 * Def "TraceFact": n → Select (n ≤ 1) ? 1 : n × TraceFact(n − 1), with a
 * Preview sink on the panel input (an interior pull root off the recursion
 * path, so it runs at every depth). Returns the nodes tests read state for.
 */
function buildFactorial(graph: LGraph): {
  defId: string
  self: LGraphNode
  mul: LGraphNode
  select: LGraphNode
  spy: LGraphNode
} {
  const meta = createSubgraphDef(graph, 'TraceFact')
  addDefInput(graph, meta.id, 'n', NUMBER)
  addDefOutput(graph, meta.id, 'result', NUMBER)
  const sub = interiorOf(graph, meta.id)
  const lessEq = spawnInterior(sub, 'math/less-eq')
  wirePanelIn(sub, 0, lessEq, 0)
  constNum(sub, 1).connect(0, lessEq, 1)
  const select = spawnInterior(sub, 'flow/select')
  lessEq.connect(0, select, 0)
  constNum(sub, 1).connect(0, select, 1) // then: constant 1
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
  const spy = spawnInterior(sub, 'io/preview')
  wirePanelIn(sub, 0, spy, 0)
  return { defId: meta.id, self, mul, select, spy }
}

/** Root-level instance of the def fed by a constant, demanded by a sink. */
function buildCall(graph: LGraph, defId: string, n: number): { instance: LGraphNode; input: LGraphNode } {
  const input = constNum(graph, n)
  const instance = spawnSubgraphNode(defId)
  if (!instance) throw new Error('no factory')
  graph.add(instance)
  input.connect(0, instance, 0)
  const sink = spawn(graph, 'io/preview')
  instance.connect(0, sink, 0)
  return { instance, input }
}

/** The instance path of the call at depth `depth` (1 = the root-level call). */
function callPath(instance: LGraphNode, self: LGraphNode, depth: number): string {
  return [String(instance.id), ...Array<string>(depth - 1).fill(String(self.id))].join('/')
}

describe('recursion call trace', () => {
  it('records every recursive call with its inputs and per-call values', async () => {
    const { graph, engine, dispose } = rig()
    const { defId, self, mul, select } = buildFactorial(graph)
    const { instance } = buildCall(graph, defId, 5)

    await engine.whenIdle()
    expect(engine.outputsOf(instance)).toEqual([120])

    const calls = engine.callsForDef(defId)
    expect(calls.map((c) => c.path)).toEqual([
      callPath(instance, self, 1),
      callPath(instance, self, 2),
      callPath(instance, self, 3),
      callPath(instance, self, 4),
      callPath(instance, self, 5),
    ])
    expect(calls.map((c) => c.inputs)).toEqual([[5], [4], [3], [2], [1]])
    expect(calls.map((c) => c.depth)).toEqual([1, 2, 3, 4, 5])

    // Per-call values: mul computed 120, 24, 6, 2 down the chain; the base
    // case never demanded mul (Select's else is lazy): no state for it.
    expect(engine.callStore(callPath(instance, self, 2))?.get(mul.id)?.outputs).toEqual([24])
    expect(engine.callStore(callPath(instance, self, 4))?.get(mul.id)?.outputs).toEqual([2])
    const base = engine.callStore(callPath(instance, self, 5))
    expect(base?.get(mul.id)?.outputs).toBeUndefined()
    expect(base?.get(select.id)?.outputs).toEqual([1])
    dispose()
  })

  it('prunes stale deeper calls when a shorter recursion re-runs', async () => {
    const { graph, engine, dispose } = rig()
    const { defId, self } = buildFactorial(graph)
    const { instance, input } = buildCall(graph, defId, 5)
    await engine.whenIdle()
    expect(engine.callsForDef(defId)).toHaveLength(5)

    setParam(input, 'value', 3) // input change → full re-seed → deep prune
    await engine.whenIdle()
    expect(engine.outputsOf(instance)).toEqual([6])
    expect(engine.callsForDef(defId).map((c) => c.path)).toEqual([
      callPath(instance, self, 1),
      callPath(instance, self, 2),
      callPath(instance, self, 3),
    ])
    expect(engine.callStore(callPath(instance, self, 4))).toBeUndefined()
    dispose()
  })

  it('keeps the deep trace readable across interior edits (re-recorded, not lost)', async () => {
    const { graph, engine, dispose } = rig()
    const { defId, self, mul } = buildFactorial(graph)
    const { instance } = buildCall(graph, defId, 4)
    await engine.whenIdle()
    expect(engine.callsForDef(defId)).toHaveLength(4)

    // Seeded interior edit (the comparison constant): the recursion
    // re-evaluates, and every depth's record is there afterwards.
    const sub = interiorOf(graph, defId)
    const constant = sub._nodes.find((n) => n.type === 'io/number-input' && n.properties.value === 1)
    if (!constant) throw new Error('no interior constant')
    setParam(constant, 'value', 1)
    await engine.whenIdle()

    expect(engine.outputsOf(instance)).toEqual([24])
    expect(engine.callsForDef(defId)).toHaveLength(4)
    expect(engine.callStore(callPath(instance, self, 3))?.get(mul.id)?.outputs).toEqual([2])
    dispose()
  })

  it('records per-call sink inputs (Preview inside the recursion)', async () => {
    const { graph, engine, dispose } = rig()
    const { defId, self, spy } = buildFactorial(graph)
    const { instance } = buildCall(graph, defId, 4)
    await engine.whenIdle()

    // The Preview watches the panel input n: each call's state carries it.
    for (const [depth, n] of [4, 3, 2, 1].entries()) {
      const store = engine.callStore(callPath(instance, self, depth + 1))
      expect(store?.get(spy.id)?.inputs?.value).toBe(n)
    }
    dispose()
  })

  it('never records apply() subtrees (Map over a recursive definition)', async () => {
    const { graph, engine, dispose } = rig()
    const { defId } = buildFactorial(graph)
    const range = spawn(graph, 'flow/list-range')
    setParam(range, 'start', 2)
    setParam(range, 'count', 2)
    const map = spawn(graph, 'flow/map')
    setParam(map, 'fn', 'TraceFact')
    range.connect(0, map, 0)
    const sink = spawn(graph, 'io/preview')
    map.connect(0, sink, 0)

    await engine.whenIdle()
    expect(engine.outputsOf(map)).toEqual([[2, 6]])
    expect(engine.callsForDef(defId)).toEqual([])
    dispose()
  })

  it('drops the trace on document replace (no aliasing into reused node ids)', async () => {
    const { graph, engine, dispose } = rig()
    const { defId, self } = buildFactorial(graph)
    const { instance } = buildCall(graph, defId, 3)
    await engine.whenIdle()
    const deepPath = callPath(instance, self, 3)
    expect(engine.callStore(deepPath)).toBeDefined()

    // Replace with a document that has no recursion at all.
    const other = new LGraph()
    const otherEngine = new Engine(other)
    const attach = attachSubgraphSupport(other, otherEngine)
    constNum(other, 7)
    const doc = serializeGraph(other)
    attach()
    otherEngine.dispose()

    deserializeGraph(doc, graph)
    await engine.whenIdle()
    expect(engine.callsForDef(defId)).toEqual([])
    expect(engine.callStore(deepPath)).toBeUndefined()
    dispose()
  })

  it('traces two root instances of one recursive definition independently', async () => {
    const { graph, engine, dispose } = rig()
    const { defId, self, mul } = buildFactorial(graph)
    const first = buildCall(graph, defId, 4)
    const second = buildCall(graph, defId, 2)
    await engine.whenIdle()

    expect(engine.callsForDef(defId).map((c) => c.inputs)).toEqual([[4], [3], [2], [1], [2], [1]])
    expect(engine.callStore(callPath(first.instance, self, 3))?.get(mul.id)?.outputs).toEqual([2])
    expect(engine.callStore(callPath(second.instance, self, 2))?.get(mul.id)).toSatisfy(
      (s) => s === undefined || s.outputs === undefined, // base case: mul never ran
    )
    dispose()
  })

  it('restores original colors after a deep-call failure clears', async () => {
    const { graph, engine, dispose } = rig()

    // "BoomFact": like TraceFact but the panel feeds through an op that throws
    // when n equals `bad`: the failure happens in a deep transient call.
    const meta = createSubgraphDef(graph, 'BoomFact')
    addDefInput(graph, meta.id, 'n', NUMBER)
    addDefOutput(graph, meta.id, 'result', NUMBER)
    const sub = interiorOf(graph, meta.id)
    const boom = spawnInterior(sub, 'test-trace/boom-when')
    setParam(boom, 'bad', 2)
    wirePanelIn(sub, 0, boom, 0)
    const lessEq = spawnInterior(sub, 'math/less-eq')
    boom.connect(0, lessEq, 0)
    constNum(sub, 1).connect(0, lessEq, 1)
    const select = spawnInterior(sub, 'flow/select')
    lessEq.connect(0, select, 0)
    constNum(sub, 1).connect(0, select, 1)
    const subtr = spawnInterior(sub, 'math/subtract')
    boom.connect(0, subtr, 0)
    constNum(sub, 1).connect(0, subtr, 1)
    const self = spawnSubgraphNode(meta.id)
    if (!self) throw new Error('no factory')
    sub.add(self)
    subtr.connect(0, self, 0)
    const mul = spawnInterior(sub, 'math/multiply')
    boom.connect(0, mul, 0)
    self.connect(0, mul, 1)
    mul.connect(0, select, 2)
    wirePanelOut(sub, select, 0, 0)

    const { instance, input } = buildCall(graph, meta.id, 3)
    const originalColor = boom.color
    const originalBgcolor = boom.bgcolor
    await engine.whenIdle()
    // n=3 runs fine; the n=2 call errors deep inside the recursion.
    expect(engine.stateOf(instance).error).toBeDefined()
    expect(boom.color).toBe('#a83a32')

    // Recovery: 1! never touches the failing value, the success repaint must
    // restore the node's own colors even though the failing state was transient.
    setParam(input, 'value', 1)
    await engine.whenIdle()
    expect(engine.stateOf(instance).error).toBeUndefined()
    expect(engine.outputsOf(instance)).toEqual([1])
    expect(boom.color).toBe(originalColor)
    expect(boom.bgcolor).toBe(originalBgcolor)
    dispose()
  })
})

describe('the call lens', () => {
  it('scopes outputsOf/stateOf to the lensed call', async () => {
    const { graph, engine, dispose } = rig()
    const { defId, self, mul, select } = buildFactorial(graph)
    const { instance } = buildCall(graph, defId, 5)
    await engine.whenIdle()

    engine.setLensPath(callPath(instance, self, 3)) // the n=3 call
    expect(engine.outputsOf(mul)).toEqual([6])
    expect(engine.outputsOf(select)).toEqual([6])

    engine.setLensPath(callPath(instance, self, 5)) // the n=1 base case
    expect(engine.outputsOf(mul)).toBeUndefined() // never demanded here
    expect(engine.outputsOf(select)).toEqual([1])

    // Root nodes are never affected by the lens.
    expect(engine.outputsOf(instance)).toEqual([120])

    engine.setLensPath(null)
    expect(engine.getLensPath()).toBeNull()
    expect(engine.outputsOf(mul)).toEqual([120]) // default: the top call
    dispose()
  })

  it('ignores unknown paths', async () => {
    const { graph, engine, dispose } = rig()
    const { defId } = buildFactorial(graph)
    buildCall(graph, defId, 3)
    await engine.whenIdle()

    engine.setLensPath('999/3')
    expect(engine.getLensPath()).toBeNull()
    dispose()
  })

  it('falls back to the first remaining call when the lensed call vanishes', async () => {
    const { graph, engine, dispose } = rig()
    const { defId, self } = buildFactorial(graph)
    const { instance, input } = buildCall(graph, defId, 5)
    await engine.whenIdle()

    engine.setLensPath(callPath(instance, self, 5))
    setParam(input, 'value', 2)
    await engine.whenIdle()
    expect(engine.getLensPath()).toBe(callPath(instance, self, 1))
    dispose()
  })

  it('reads interior nodes through interior stores, never the root store', async () => {
    const { graph, engine, dispose } = rig()
    const { defId } = buildFactorial(graph)
    const { input } = buildCall(graph, defId, 5)
    await engine.whenIdle()

    // Interior and root id spaces overlap: interior lessEq shares an id with
    // a root node. stateOf must resolve through the interior store (5 ≤ 1 is
    // false at the top call), not return the root node's state ([5]).
    const sub = interiorOf(graph, defId)
    const lessEq = sub._nodes.find((n) => n.type === 'math/less-eq')
    if (!lessEq) throw new Error('no lessEq')
    expect(engine.stateOf(lessEq).outputs).toEqual([false])
    expect(engine.stateOf(input).outputs).toEqual([5])
    expect(engine.stateOf(lessEq)).not.toBe(engine.stateOf(input))
    dispose()
  })
})
