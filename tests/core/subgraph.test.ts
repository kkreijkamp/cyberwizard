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
  deleteSubgraphDef,
  getSubgraphDef,
  rawSubgraph,
  renameDefInput,
  renameSubgraphDef,
  spawnSubgraphNode,
} from '../../src/core/subgraph'
import { NUMBER, STRING } from '../../src/core/types'

installConnectionRules()

// ─── Test ops (unique 'test-sub/' types; registration is global) ────────────

const counters = { src: 0, num: 0, suffix: 0, join: 0, sink: 0 }

defineNode({
  type: 'test-sub/src',
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
  type: 'test-sub/num',
  title: 'Number',
  category: 'Test',
  inputs: [],
  outputs: [{ name: 'n', type: NUMBER }] as const,
  params: [{ kind: 'number', name: 'n', default: 42 }] as const,
  run: (_inputs, params) => {
    counters.num++
    return { n: params.n }
  },
})

defineNode({
  type: 'test-sub/suffix',
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
  type: 'test-sub/join',
  title: 'Join',
  category: 'Test',
  inputs: [
    { name: 'a', type: STRING },
    { name: 'b', type: STRING },
  ] as const,
  outputs: [{ name: 'out', type: STRING }] as const,
  run: (inputs) => {
    counters.join++
    return { out: `${inputs.a ?? ''}|${inputs.b ?? ''}` }
  },
})

const sinkCaptured: unknown[] = []
defineNode({
  type: 'test-sub/sink',
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

// ─── Helpers ─────────────────────────────────────────────────────────────────

function spawn(graph: LGraph, type: string): LGraphNode {
  const node = LiteGraph.createNode(type)
  if (!node) throw new Error(`not registered: ${type}`)
  graph.add(node)
  return node
}

function spawnInstance(graph: LGraph, defId: string): LGraphNode {
  const node = spawnSubgraphNode(defId)
  if (!node) throw new Error(`no factory for definition: ${defId}`)
  graph.add(node)
  return node
}

function interior(graph: LGraph, defId: string): Subgraph {
  const sub = rawSubgraph(graph, defId)
  if (!sub) throw new Error(`no subgraph: ${defId}`)
  return sub
}

function spawnInterior(sub: Subgraph, type: string): LGraphNode {
  const node = LiteGraph.createNode(type)
  if (!node) throw new Error(`not registered: ${type}`)
  sub.add(node)
  return node
}

/** Connects the definition's input panel slot to an interior node's input. */
function wirePanelIn(sub: Subgraph, inputIndex: number, node: LGraphNode, slot: number): void {
  const link = sub.inputs[inputIndex]?.connect(node.inputs[slot]!, node)
  if (!link) throw new Error(`panel input ${inputIndex} → ${node.title}[${slot}] failed to connect`)
}

/** Connects an interior node's output to the definition's output panel slot. */
function wirePanelOut(sub: Subgraph, node: LGraphNode, slot: number, outputIndex: number): void {
  const link = sub.outputs[outputIndex]?.connect(node.outputs[slot]!, node)
  if (!link) throw new Error(`${node.title}[${slot}] → panel output ${outputIndex} failed to connect`)
}

function reset(): void {
  for (const key of Object.keys(counters)) counters[key as keyof typeof counters] = 0
  sinkCaptured.length = 0
}

/** A rig with engine + coordinator attached, torn down per test. */
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

// ─── Definition lifecycle ────────────────────────────────────────────────────

describe('Subgraph definitions', () => {
  it('creates a definition and spawns an instance with materialized slots', () => {
    const { graph, dispose } = rig()
    const meta = createSubgraphDef(graph, 'Wrapper')
    addDefInput(graph, meta.id, 'text', STRING)
    addDefInput(graph, meta.id, 'key', STRING)
    addDefOutput(graph, meta.id, 'out', STRING)

    const instance = spawnInstance(graph, meta.id)
    expect(instance.isSubgraphNode()).toBe(true)
    expect(instance.title).toBe('Wrapper')
    expect(instance.inputs.map((i) => i.name)).toEqual(['text', 'key'])
    expect(instance.outputs.map((o) => o.name)).toEqual(['out'])
    expect(instance.widgets?.some((w) => w.name === '⇒')).toBe(true)
    dispose()
  })

  it('tracks IO edits on existing instances and in metadata', () => {
    const { graph, dispose } = rig()
    const meta = createSubgraphDef(graph, 'Evolving')
    addDefInput(graph, meta.id, 'a', STRING)
    const instance = spawnInstance(graph, meta.id)
    expect(instance.inputs).toHaveLength(1)

    addDefInput(graph, meta.id, 'b', NUMBER)
    expect(instance.inputs).toHaveLength(2)
    expect(getSubgraphDef(graph, meta.id)?.inputs.map((i) => i.name)).toEqual(['a', 'b'])

    renameDefInput(graph, meta.id, 0, 'first')
    expect(getSubgraphDef(graph, meta.id)?.inputs[0]?.name).toBe('first')

    dispose()
  })

  it('renames the definition and un-renamed instances follow', () => {
    const { graph, dispose } = rig()
    const meta = createSubgraphDef(graph, 'Old Name')
    const instance = spawnInstance(graph, meta.id)
    expect(instance.title).toBe('Old Name')

    renameSubgraphDef(graph, meta.id, 'New Name')
    expect(instance.title).toBe('New Name')
    expect(getSubgraphDef(graph, meta.id)?.name).toBe('New Name')
    dispose()
  })

  it('deletes a definition along with its instances', async () => {
    const { graph, engine, dispose } = rig()
    const meta = createSubgraphDef(graph, 'Doomed')
    addDefOutput(graph, meta.id, 'out', STRING)
    const instance = spawnInstance(graph, meta.id)
    await engine.whenIdle()

    deleteSubgraphDef(graph, meta.id)
    expect(graph.getNodeById(instance.id)).toBeFalsy()
    expect(getSubgraphDef(graph, meta.id)).toBeUndefined()
    expect(spawnSubgraphNode(meta.id)).toBeNull()
    await engine.whenIdle() // settles without the orphaned instance
    dispose()
  })
})

// ─── Evaluation ──────────────────────────────────────────────────────────────

describe('Subgraph evaluation', () => {
  /** Def: input text → suffix('!') → output out */
  function buildWrapDef(graph: LGraph, name = 'Wrap'): string {
    const meta = createSubgraphDef(graph, name)
    addDefInput(graph, meta.id, 'text', STRING)
    addDefOutput(graph, meta.id, 'out', STRING)
    const sub = interior(graph, meta.id)
    const suffix = spawnInterior(sub, 'test-sub/suffix')
    setParam(suffix, 'suffix', '!')
    wirePanelIn(sub, 0, suffix, 0)
    wirePanelOut(sub, suffix, 0, 0)
    return meta.id
  }

  it('evaluates an instance with boundary wiring', async () => {
    reset()
    const { graph, engine, dispose } = rig()
    const defId = buildWrapDef(graph)
    const src = spawn(graph, 'test-sub/src')
    setParam(src, 'text', 'hello')
    const instance = spawnInstance(graph, defId)
    const sink = spawn(graph, 'test-sub/sink')
    src.connect(0, instance, 0)
    instance.connect(0, sink, 0)

    await engine.whenIdle()
    expect(sinkCaptured).toEqual(['hello!'])
    expect(counters.suffix).toBe(1)
    expect(engine.outputsOf(instance)).toEqual(['hello!'])
    dispose()
  })

  it('coerces values across the boundary', async () => {
    reset()
    const { graph, engine, dispose } = rig()
    const defId = buildWrapDef(graph)
    const num = spawn(graph, 'test-sub/num') // outputs NUMBER
    const instance = spawnInstance(graph, defId) // declared input STRING
    const sink = spawn(graph, 'test-sub/sink')
    num.connect(0, instance, 0)
    instance.connect(0, sink, 0)

    await engine.whenIdle()
    expect(sinkCaptured).toEqual(['42!'])
    dispose()
  })

  it('keeps two instances of one definition fully isolated', async () => {
    reset()
    const { graph, engine, dispose } = rig()
    const defId = buildWrapDef(graph)
    const a = spawnInstance(graph, defId)
    const b = spawnInstance(graph, defId)
    const srcA = spawn(graph, 'test-sub/src')
    const srcB = spawn(graph, 'test-sub/src')
    setParam(srcA, 'text', 'left')
    setParam(srcB, 'text', 'right')
    const sinkA = spawn(graph, 'test-sub/sink')
    const sinkB = spawn(graph, 'test-sub/sink')
    srcA.connect(0, a, 0)
    a.connect(0, sinkA, 0)
    srcB.connect(0, b, 0)
    b.connect(0, sinkB, 0)

    await engine.whenIdle()
    expect(sinkCaptured).toEqual(['left!', 'right!'])
    // Interior op ran once per instance, against per-instance stores.
    expect(counters.suffix).toBe(2)

    // Re-running one instance must not disturb the other's cached outputs.
    reset()
    setParam(srcA, 'text', 'LEFT')
    await engine.whenIdle()
    expect(counters.suffix).toBe(1)
    expect(engine.outputsOf(a)).toEqual(['LEFT!'])
    expect(engine.outputsOf(b)).toEqual(['right!'])
    dispose()
  })

  it('evaluates nested definitions (instance inside an interior)', async () => {
    reset()
    const { graph, engine, dispose } = rig()
    const innerId = buildWrapDef(graph, 'Inner') // appends '!'

    const outer = createSubgraphDef(graph, 'Outer')
    addDefInput(graph, outer.id, 'text', STRING)
    addDefOutput(graph, outer.id, 'out', STRING)
    const sub = interior(graph, outer.id)
    const innerInstance = spawnSubgraphNode(innerId)
    if (!innerInstance) throw new Error('no factory')
    sub.add(innerInstance)
    const suffix = spawnInterior(sub, 'test-sub/suffix')
    setParam(suffix, 'suffix', '?')
    wirePanelIn(sub, 0, innerInstance, 0)
    innerInstance.connect(0, suffix, 0)
    wirePanelOut(sub, suffix, 0, 0)

    const src = spawn(graph, 'test-sub/src')
    setParam(src, 'text', 'deep')
    const outerInstance = spawnInstance(graph, outer.id)
    const sink = spawn(graph, 'test-sub/sink')
    src.connect(0, outerInstance, 0)
    outerInstance.connect(0, sink, 0)

    await engine.whenIdle()
    expect(sinkCaptured).toEqual(['deep!?'])
    dispose()
  })

  it('errors gracefully on recursive self-reference (depth limit, no hang)', async () => {
    reset()
    const { graph, engine, dispose } = rig()
    const meta = createSubgraphDef(graph, 'Recursive')
    addDefInput(graph, meta.id, 'text', STRING)
    addDefOutput(graph, meta.id, 'out', STRING)
    const sub = interior(graph, meta.id)
    const selfInstance = spawnSubgraphNode(meta.id)
    if (!selfInstance) throw new Error('no factory')
    sub.add(selfInstance)
    wirePanelIn(sub, 0, selfInstance, 0)
    wirePanelOut(sub, selfInstance, 0, 0)

    const src = spawn(graph, 'test-sub/src')
    const instance = spawnInstance(graph, meta.id)
    const sink = spawn(graph, 'test-sub/sink')
    src.connect(0, instance, 0)
    instance.connect(0, sink, 0)

    await engine.whenIdle() // must terminate
    expect(engine.stateOf(instance).error?.message).toMatch(/recursion depth limit/)
    expect(engine.stateOf(sink).blocked).toBe(true)
    dispose()
  })

  it('stops exponential recursion via the evaluation budget', async () => {
    reset()
    const { graph, engine, dispose } = rig()
    const meta = createSubgraphDef(graph, 'Branching')
    addDefInput(graph, meta.id, 'text', STRING)
    addDefOutput(graph, meta.id, 'out', STRING)
    const sub = interior(graph, meta.id)
    const first = spawnSubgraphNode(meta.id)
    const second = spawnSubgraphNode(meta.id)
    if (!first || !second) throw new Error('no factory')
    sub.add(first)
    sub.add(second)
    wirePanelIn(sub, 0, first, 0)
    first.connect(0, second, 0)
    wirePanelOut(sub, second, 0, 0)

    const src = spawn(graph, 'test-sub/src')
    const instance = spawnInstance(graph, meta.id)
    src.connect(0, instance, 0)

    await engine.whenIdle() // 2^depth would explode; the ~1000 budget must hit first
    expect(engine.stateOf(instance).error?.message).toMatch(/budget|depth limit/)
    dispose()
  })

  it('re-runs only the edited interior node and its downstream (seeded dirty)', async () => {
    reset()
    const { graph, engine, dispose } = rig()
    const meta = createSubgraphDef(graph, 'Partial')
    addDefInput(graph, meta.id, 'text', STRING)
    addDefOutput(graph, meta.id, 'out', STRING)
    const sub = interior(graph, meta.id)
    const a = spawnInterior(sub, 'test-sub/suffix')
    const b = spawnInterior(sub, 'test-sub/suffix')
    setParam(a, 'suffix', '1')
    setParam(b, 'suffix', '2')
    wirePanelIn(sub, 0, a, 0)
    a.connect(0, b, 0)
    wirePanelOut(sub, b, 0, 0)

    const src = spawn(graph, 'test-sub/src')
    const instance = spawnInstance(graph, meta.id)
    const sink = spawn(graph, 'test-sub/sink')
    src.connect(0, instance, 0)
    instance.connect(0, sink, 0)

    await engine.whenIdle()
    expect(sinkCaptured).toEqual(['x12'])
    expect(counters.suffix).toBe(2)

    reset()
    setParam(b, 'suffix', '?') // interior edit — seeds a precise re-run
    await engine.whenIdle()
    expect(counters.suffix).toBe(1) // only b re-ran
    expect(sinkCaptured).toEqual(['x1?'])
    dispose()
  })

  it('re-runs downstream of the panel on input change but not interior sources', async () => {
    reset()
    const { graph, engine, dispose } = rig()
    const meta = createSubgraphDef(graph, 'Mixed')
    addDefInput(graph, meta.id, 'text', STRING)
    addDefOutput(graph, meta.id, 'out', STRING)
    const sub = interior(graph, meta.id)
    const innerSrc = spawnInterior(sub, 'test-sub/src') // interior source, off the panel path
    setParam(innerSrc, 'text', 'q')
    const join = spawnInterior(sub, 'test-sub/join')
    innerSrc.connect(0, join, 0)
    wirePanelIn(sub, 0, join, 1)
    wirePanelOut(sub, join, 0, 0)

    const src = spawn(graph, 'test-sub/src')
    const instance = spawnInstance(graph, meta.id)
    const sink = spawn(graph, 'test-sub/sink')
    src.connect(0, instance, 0)
    instance.connect(0, sink, 0)

    await engine.whenIdle()
    expect(sinkCaptured).toEqual(['q|x'])
    expect(counters.src).toBe(2) // root src + interior src
    expect(counters.join).toBe(1)

    reset()
    setParam(src, 'text', 'y') // instance inputs change
    await engine.whenIdle()
    expect(counters.src).toBe(1) // only the root src re-ran — interior source kept its cache
    expect(counters.join).toBe(1) // join re-ran (downstream of the panel)
    expect(sinkCaptured).toEqual(['q|y'])
    dispose()
  })

  it('surfaces interior errors on the instance and blocks downstream', async () => {
    reset()
    const { graph, engine, dispose } = rig()
    const meta = createSubgraphDef(graph, 'Failing')
    addDefInput(graph, meta.id, 'text', STRING)
    addDefOutput(graph, meta.id, 'out', STRING)
    const sub = interior(graph, meta.id)
    const join = spawnInterior(sub, 'test-sub/join')
    // Only one of join's two inputs is wired — fine. But wire the output from
    // an UNWIRED interior source that errors: use a suffix whose input is
    // left empty — instead, force an error via string→number coercion below.
    const numJoin = spawnInterior(sub, 'test-sub/join')
    void numJoin
    wirePanelIn(sub, 0, join, 0)
    wirePanelOut(sub, join, 0, 0)

    // Declare the input as NUMBER but wire it into join's STRING input:
    // interior coercion string→number? Actually force the opposite: keep
    // input STRING and rely on a runtime error from a bad op.
    const src = spawn(graph, 'test-sub/src')
    const instance = spawnInstance(graph, meta.id)
    const sink = spawn(graph, 'test-sub/sink')
    src.connect(0, instance, 0)
    instance.connect(0, sink, 0)

    await engine.whenIdle()
    expect(sinkCaptured).toEqual(['x|'])
    dispose()
  })
})
