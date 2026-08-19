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
import { NUMBER } from '../../src/core/types'
import '../../src/nodes'

installConnectionRules()

// ─── Test op with an observable side effect (proves (non-)evaluation) ───────

let boomCount = 0

defineNode({
  type: 'test-control/boom',
  title: 'Boom',
  category: 'Test',
  inputs: [{ name: 'n', type: NUMBER }] as const,
  outputs: [{ name: 'n', type: NUMBER }] as const,
  run: (inputs) => {
    boomCount++
    throw new Error(`kaboom ${String(inputs.n)}`)
  },
})

// ─── Helpers (same shape as flow-hof.test.ts) ───────────────────────────────

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

/** A number-input node holding a constant, in any (sub)graph. */
function constNum(parent: LGraph | Subgraph, value: number): LGraphNode {
  const node = spawnInterior(parent as Subgraph, 'io/number-input')
  setParam(node, 'value', value)
  return node
}

/** Def "Inc": n → n + 1 (1-in-1-out). */
function buildInc(graph: LGraph): string {
  const meta = createSubgraphDef(graph, 'Inc')
  addDefInput(graph, meta.id, 'n', NUMBER)
  addDefOutput(graph, meta.id, 'result', NUMBER)
  const sub = interiorOf(graph, meta.id)
  const add = spawnInterior(sub, 'math/add')
  wirePanelIn(sub, 0, add, 0)
  constNum(sub, 1).connect(0, add, 1)
  wirePanelOut(sub, add, 0, 0)
  return meta.id
}

/** Def "Double": n → n × 2 (1-in-1-out). */
function buildDouble(graph: LGraph): string {
  const meta = createSubgraphDef(graph, 'Double')
  addDefInput(graph, meta.id, 'n', NUMBER)
  addDefOutput(graph, meta.id, 'result', NUMBER)
  const sub = interiorOf(graph, meta.id)
  const mul = spawnInterior(sub, 'math/multiply')
  wirePanelIn(sub, 0, mul, 0)
  constNum(sub, 2).connect(0, mul, 1)
  wirePanelOut(sub, mul, 0, 0)
  return meta.id
}

/** Def "Boom": always throws (1-in-1-out). */
function buildBoom(graph: LGraph): string {
  const meta = createSubgraphDef(graph, 'Boom')
  addDefInput(graph, meta.id, 'n', NUMBER)
  addDefOutput(graph, meta.id, 'n', NUMBER)
  const sub = interiorOf(graph, meta.id)
  const boom = spawnInterior(sub, 'test-control/boom')
  wirePanelIn(sub, 0, boom, 0)
  wirePanelOut(sub, boom, 0, 0)
  return meta.id
}

/** Root pipeline: const value → if.value, boolean const → if.cond. */
function buildIf(graph: LGraph, value: number, cond: boolean, then: string, els: string): LGraphNode {
  const src = constNum(graph, value)
  const cmpA = constNum(graph, 1)
  const cmpB = constNum(graph, cond ? 1 : 2)
  const equals = spawn(graph, 'math/equals')
  cmpA.connect(0, equals, 0)
  cmpB.connect(0, equals, 1)
  const ifNode = spawn(graph, 'flow/if')
  setParam(ifNode, 'then', then)
  setParam(ifNode, 'else', els)
  equals.connect(0, ifNode, 0)
  src.connect(0, ifNode, 1)
  return ifNode
}

describe('flow/if', () => {
  it('applies the then branch on true, the else branch on false', async () => {
    const { graph, engine, dispose } = rig()
    buildInc(graph)
    buildDouble(graph)
    const ifTrue = buildIf(graph, 10, true, 'Inc', 'Double')
    const ifFalse = buildIf(graph, 10, false, 'Inc', 'Double')

    await engine.whenIdle()
    expect(engine.outputsOf(ifTrue)).toEqual([11])
    expect(engine.outputsOf(ifFalse)).toEqual([20])
    dispose()
  })

  it('never evaluates the untaken branch (laziness)', async () => {
    const { graph, engine, dispose } = rig()
    buildInc(graph)
    buildBoom(graph)
    boomCount = 0
    const ifThen = buildIf(graph, 10, true, 'Inc', 'Boom') // Boom untaken
    const ifElse = buildIf(graph, 10, false, 'Boom', 'Inc') // Boom untaken
    const ifTaken = buildIf(graph, 10, true, 'Boom', 'Inc') // Boom taken

    await engine.whenIdle()
    expect(engine.outputsOf(ifThen)).toEqual([11])
    expect(engine.outputsOf(ifElse)).toEqual([11])
    expect(engine.stateOf(ifThen).error).toBeUndefined()
    expect(engine.stateOf(ifElse).error).toBeUndefined()
    expect(engine.stateOf(ifTaken).error?.message).toMatch(/kaboom/)
    expect(boomCount).toBeGreaterThan(0) // only the taken Boom ever ran
    const runsPerTaken = boomCount
    expect(runsPerTaken).toBeLessThan(3) // and not per untaken branch
    dispose()
  })

  it('recursion terminates through If: factorial via a self-instancing definition', async () => {
    const { graph, engine, dispose } = rig()

    // "One": 0-in, 1-out — the constant base case.
    const one = createSubgraphDef(graph, 'One')
    addDefOutput(graph, one.id, 'result', NUMBER)
    const oneSub = interiorOf(graph, one.id)
    wirePanelOut(oneSub, constNum(oneSub, 1), 0, 0)

    // "Fact": n → If (n ≤ 1) then One else Fact Step — declared now, filled in
    // after Fact Step exists (it holds the recursive instance).
    const fact = createSubgraphDef(graph, 'Fact')
    addDefInput(graph, fact.id, 'n', NUMBER)
    addDefOutput(graph, fact.id, 'result', NUMBER)

    // "Fact Step": n → n × Fact(n − 1) — the recursive branch.
    const step = createSubgraphDef(graph, 'Fact Step')
    addDefInput(graph, step.id, 'n', NUMBER)
    addDefOutput(graph, step.id, 'result', NUMBER)
    const stepSub = interiorOf(graph, step.id)
    const subtr = spawnInterior(stepSub, 'math/subtract')
    wirePanelIn(stepSub, 0, subtr, 0)
    constNum(stepSub, 1).connect(0, subtr, 1)
    const factInstance = spawnSubgraphNode(fact.id)
    if (!factInstance) throw new Error('no factory')
    stepSub.add(factInstance)
    subtr.connect(0, factInstance, 0)
    const mul = spawnInterior(stepSub, 'math/multiply')
    wirePanelIn(stepSub, 0, mul, 0)
    factInstance.connect(0, mul, 1)
    wirePanelOut(stepSub, mul, 0, 0)

    const factSub = interiorOf(graph, fact.id)
    const lessEq = spawnInterior(factSub, 'math/less-eq')
    wirePanelIn(factSub, 0, lessEq, 0)
    constNum(factSub, 1).connect(0, lessEq, 1)
    const ifNode = spawnInterior(factSub, 'flow/if')
    setParam(ifNode, 'then', 'One')
    setParam(ifNode, 'else', 'Fact Step')
    lessEq.connect(0, ifNode, 0)
    wirePanelIn(factSub, 0, ifNode, 1)
    wirePanelOut(factSub, ifNode, 0, 0)

    const five = constNum(graph, 5)
    const fact5 = spawnSubgraphNode(fact.id)
    if (!fact5) throw new Error('no factory')
    graph.add(fact5)
    five.connect(0, fact5, 0)

    const zero = constNum(graph, 0)
    const fact0 = spawnSubgraphNode(fact.id)
    if (!fact0) throw new Error('no factory')
    graph.add(fact0)
    zero.connect(0, fact0, 0)

    await engine.whenIdle()
    expect(engine.stateOf(fact5).error).toBeUndefined()
    expect(engine.outputsOf(fact5)).toEqual([120])
    expect(engine.outputsOf(fact0)).toEqual([1])
    dispose()
  })

  it('runaway recursion still surfaces the depth limit, through If', async () => {
    const { graph, engine, dispose } = rig()
    // "Loop": n → If true then Loop(n) else n — recursion purely via apply;
    // the cond never saves it.
    const loop = createSubgraphDef(graph, 'Loop')
    addDefInput(graph, loop.id, 'n', NUMBER)
    addDefOutput(graph, loop.id, 'result', NUMBER)
    const loopSub = interiorOf(graph, loop.id)
    const tru = spawnInterior(loopSub, 'math/equals')
    constNum(loopSub, 1).connect(0, tru, 0)
    constNum(loopSub, 1).connect(0, tru, 1)
    const ifNode = spawnInterior(loopSub, 'flow/if')
    setParam(ifNode, 'then', 'Loop')
    setParam(ifNode, 'else', 'Loop')
    tru.connect(0, ifNode, 0)
    wirePanelIn(loopSub, 0, ifNode, 1)
    wirePanelOut(loopSub, ifNode, 0, 0)

    const src = constNum(graph, 1)
    const instance = spawnSubgraphNode(loop.id)
    if (!instance) throw new Error('no factory')
    graph.add(instance)
    src.connect(0, instance, 0)

    await engine.whenIdle() // must terminate
    expect(engine.stateOf(instance).error?.message).toMatch(/depth limit/)
    dispose()
  })

  it('errors helpfully: unpicked branches, unknown names, bad branch arity', async () => {
    const { graph, engine, dispose } = rig()
    buildInc(graph)
    // A 2-in-1-out def (invalid as an If branch).
    const binary = createSubgraphDef(graph, 'Binary')
    addDefInput(graph, binary.id, 'a', NUMBER)
    addDefInput(graph, binary.id, 'b', NUMBER)
    addDefOutput(graph, binary.id, 'out', NUMBER)

    const unpicked = buildIf(graph, 1, true, '', 'Inc')
    const unknown = buildIf(graph, 1, true, 'Nope', 'Inc')
    const badArity = buildIf(graph, 1, true, 'Binary', 'Inc')

    await engine.whenIdle()
    expect(engine.stateOf(unpicked).error?.message).toMatch(/no subgraph selected for then/)
    expect(engine.stateOf(unknown).error?.message).toMatch(/"Nope" not found/)
    expect(engine.stateOf(badArity).error?.message).toMatch(/0-in or 1-in, 1-out/)
    dispose()
  })
})
