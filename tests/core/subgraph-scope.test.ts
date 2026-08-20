import { LGraph, LiteGraph } from '@comfyorg/litegraph'
import type { LGraphNode, Subgraph } from '@comfyorg/litegraph'
import { describe, expect, it } from 'vitest'
import { Engine } from '../../src/core/engine'
import { defineNode, installConnectionRules, setParam } from '../../src/core/registry'
import { deserializeGraph, parseGraphDocument, serializeGraph } from '../../src/core/serialize'
import {
  addDefInput,
  addDefOutput,
  attachSubgraphSupport,
  createSubgraphDef,
  deleteSubgraphDef,
  reScopeDef,
  rawSubgraph,
  scopeChainOf,
  spawnSubgraphNode,
  visibleSubgraphDefs,
} from '../../src/core/subgraph'
import { ANY, NUMBER } from '../../src/core/types'
import '../../src/nodes'

installConnectionRules()

// ─── Test ops ────────────────────────────────────────────────────────────────

let addKRuns = 0

defineNode({
  type: 'test-scope/add-k',
  title: 'Add K',
  category: 'Test',
  inputs: [{ name: 'n', type: NUMBER }] as const,
  outputs: [{ name: 'out', type: NUMBER }] as const,
  params: [{ kind: 'number', name: 'k', default: 0 }] as const,
  run: (inputs, params) => {
    addKRuns++
    return { out: (inputs.n ?? 0) + params.k }
  },
})

// ─── Helpers ─────────────────────────────────────────────────────────────────

function spawn(graph: LGraph, type: string): LGraphNode {
  const node = LiteGraph.createNode(type)
  if (!node) throw new Error(`not registered: ${type}`)
  graph.add(node)
  return node
}

function spawnInstance(graph: LGraph | Subgraph, defId: string): LGraphNode {
  const node = spawnSubgraphNode(defId)
  if (!node) throw new Error('no factory')
  graph.add(node)
  return node as LGraphNode
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

/** 1-in-1-out def "name": n → n + k, optionally scoped to a parent. */
function buildAddK(graph: LGraph, name: string, k: number, scope?: string): string {
  const meta = createSubgraphDef(graph, name, scope)
  addDefInput(graph, meta.id, 'n', NUMBER)
  addDefOutput(graph, meta.id, 'out', NUMBER)
  const sub = interiorOf(graph, meta.id)
  const add = spawnInterior(sub, 'test-scope/add-k')
  setParam(add, 'k', k)
  wirePanelIn(sub, 0, add, 0)
  wirePanelOut(sub, add, 0, 0)
  return meta.id
}

const names = (defs: readonly { name: string }[]): string[] => defs.map((d) => d.name).sort()

// ─── Visibility ──────────────────────────────────────────────────────────────

describe('scoped definitions — visibility', () => {
  it('globals everywhere, scoped defs only inside their parent subtree', () => {
    const { graph, dispose } = rig()
    const g1 = createSubgraphDef(graph, 'G1')
    const g2 = createSubgraphDef(graph, 'G2')
    const l1 = createSubgraphDef(graph, 'L1', g1.id)
    const l2 = createSubgraphDef(graph, 'L2', l1.id)
    const l3 = createSubgraphDef(graph, 'L3', g2.id)

    expect(names(visibleSubgraphDefs(graph, graph))).toEqual(['G1', 'G2'])
    expect(names(visibleSubgraphDefs(graph, interiorOf(graph, g1.id)))).toEqual(['G1', 'G2', 'L1'])
    // Nested interior sees the whole chain (lexical: inner sees outer).
    expect(names(visibleSubgraphDefs(graph, interiorOf(graph, l1.id)))).toEqual(['G1', 'G2', 'L1', 'L2'])
    expect(names(visibleSubgraphDefs(graph, interiorOf(graph, l2.id)))).toEqual(['G1', 'G2', 'L1', 'L2'])
    // Sibling scope: L3 is not visible inside G1's subtree, and vice versa.
    expect(names(visibleSubgraphDefs(graph, interiorOf(graph, g2.id)))).toEqual(['G1', 'G2', 'L3'])
    expect(names(visibleSubgraphDefs(graph, interiorOf(graph, l3.id)))).toEqual(['G1', 'G2', 'L3'])
    dispose()
  })

  it('scopeChainOf walks parents and survives a hand-made cycle', () => {
    const { graph, dispose } = rig()
    const a = createSubgraphDef(graph, 'A')
    const b = createSubgraphDef(graph, 'B', a.id)
    expect(scopeChainOf(graph, b.id)).toEqual([b.id, a.id])
    // Hand-edited cycle: A scoped to B. The walk terminates.
    a.scope = b.id
    expect(scopeChainOf(graph, a.id)).toEqual([a.id, b.id])
    dispose()
  })
})

// ─── Resolution through the engine ───────────────────────────────────────────

describe('scoped definitions — resolution', () => {
  it('a fn picker inside the parent resolves the scoped def; at root it errors as out of scope', async () => {
    const { graph, engine, dispose } = rig()
    const parent = createSubgraphDef(graph, 'Parent')
    addDefInput(graph, parent.id, 'n', NUMBER)
    addDefOutput(graph, parent.id, 'out', ANY)
    buildAddK(graph, 'Local', 10, parent.id)

    // Parent's interior: map(fn='Local') over [1] → 11.
    const psub = interiorOf(graph, parent.id)
    const map = spawnInterior(psub, 'flow/map')
    setParam(map, 'fn', 'Local')
    wirePanelIn(psub, 0, map, 0)
    wirePanelOut(psub, map, 0, 0)

    const instance = spawnInstance(graph, parent.id)
    constNum(graph, 1).connect(0, instance, 0)
    const sink = spawn(graph, 'io/preview')
    instance.connect(0, sink, 0)

    // At root: another map with fn='Local' — same name, wrong scope.
    const range = spawn(graph, 'flow/list-range')
    setParam(range, 'count', 1)
    const rootMap = spawn(graph, 'flow/map')
    setParam(rootMap, 'fn', 'Local')
    range.connect(0, rootMap, 0)
    const rootSink = spawn(graph, 'io/preview')
    rootMap.connect(0, rootSink, 0)

    await engine.whenIdle()
    expect(engine.outputsOf(instance)).toEqual([[11]])
    expect(engine.stateOf(rootMap).error?.message).toMatch(/scoped to "Parent" — not visible here/)
    dispose()
  })

  it('duplicate names in different scopes resolve locally', async () => {
    const { graph, engine, dispose } = rig()
    const a = createSubgraphDef(graph, 'A')
    const b = createSubgraphDef(graph, 'B')
    buildAddK(graph, 'Step', 10, a.id)
    buildAddK(graph, 'Step', 100, b.id)

    // Both parents: n → map(fn='Step') — each resolves its own Step.
    for (const parentId of [a.id, b.id]) {
      const sub = interiorOf(graph, parentId)
      addDefInput(graph, parentId, 'n', NUMBER)
      addDefOutput(graph, parentId, 'out', ANY)
      const map = spawnInterior(sub, 'flow/map')
      setParam(map, 'fn', 'Step')
      wirePanelIn(sub, 0, map, 0)
      wirePanelOut(sub, map, 0, 0)
    }

    const instA = spawnInstance(graph, a.id)
    constNum(graph, 1).connect(0, instA, 0)
    const sinkA = spawn(graph, 'io/preview')
    instA.connect(0, sinkA, 0)
    const instB = spawnInstance(graph, b.id)
    constNum(graph, 1).connect(0, instB, 0)
    const sinkB = spawn(graph, 'io/preview')
    instB.connect(0, sinkB, 0)

    await engine.whenIdle()
    expect(engine.outputsOf(instA)).toEqual([[11]])
    expect(engine.outputsOf(instB)).toEqual([[101]])
    dispose()
  })
})

// ─── Re-scoping ──────────────────────────────────────────────────────────────

describe('scoped definitions — reScopeDef', () => {
  it('moves defs up to global and down into a parent, flipping visibility', () => {
    const { graph, dispose } = rig()
    const a = createSubgraphDef(graph, 'A')
    const x = createSubgraphDef(graph, 'X') // global

    reScopeDef(graph, x.id, a.id) // down into A
    expect(names(visibleSubgraphDefs(graph, graph))).toEqual(['A'])
    expect(names(visibleSubgraphDefs(graph, interiorOf(graph, a.id)))).toEqual(['A', 'X'])

    reScopeDef(graph, x.id, undefined) // back up to global
    expect(names(visibleSubgraphDefs(graph, graph))).toEqual(['A', 'X'])
    dispose()
  })

  it('refuses to scope a definition into its own descendant (cycle)', () => {
    const { graph, dispose } = rig()
    const a = createSubgraphDef(graph, 'A')
    const b = createSubgraphDef(graph, 'B', a.id)

    reScopeDef(graph, a.id, b.id) // B is scoped to A — would cycle
    expect(a.scope).toBeUndefined()
    reScopeDef(graph, a.id, a.id) // self-scope is a no-op
    expect(a.scope).toBeUndefined()
    dispose()
  })

  it('uniquifies the name within the new scope', () => {
    const { graph, dispose } = rig()
    const a = createSubgraphDef(graph, 'A')
    createSubgraphDef(graph, 'Dup', a.id) // 'Dup' taken inside A
    const g = createSubgraphDef(graph, 'Dup') // global 'Dup'

    reScopeDef(graph, g.id, a.id)
    expect(g.name).toBe('Dup 2')
    expect(names(visibleSubgraphDefs(graph, interiorOf(graph, a.id)))).toEqual(['A', 'Dup', 'Dup 2'])
    dispose()
  })
})

// ─── Cascade delete ──────────────────────────────────────────────────────────

describe('scoped definitions — cascade delete', () => {
  it('deleting a definition deletes its scope subtree and their instances', () => {
    const { graph, dispose } = rig()
    const a = createSubgraphDef(graph, 'A')
    const b = createSubgraphDef(graph, 'B', a.id)
    const c = createSubgraphDef(graph, 'C', b.id)
    const other = createSubgraphDef(graph, 'Other')
    const instance = spawnInstance(graph, c.id)

    deleteSubgraphDef(graph, a.id)
    expect(names(visibleSubgraphDefs(graph, graph))).toEqual(['Other'])
    expect(graph.getNodeById(instance.id)).toBeFalsy()
    expect(() => interiorOf(graph, b.id)).toThrow()
    expect(() => interiorOf(graph, c.id)).toThrow()
    dispose()
  })
})

// ─── Consumer dirty accuracy ─────────────────────────────────────────────────

describe('scoped definitions — consumer dirtying', () => {
  it('editing a scoped def dirties only consumers that resolve to it, not same-named shadows', async () => {
    const { graph, engine, dispose } = rig()
    const a = createSubgraphDef(graph, 'A')
    const b = createSubgraphDef(graph, 'B')
    const stepA = buildAddK(graph, 'Step', 10, a.id)
    buildAddK(graph, 'Step', 100, b.id)
    for (const parentId of [a.id, b.id]) {
      const sub = interiorOf(graph, parentId)
      addDefInput(graph, parentId, 'n', NUMBER)
      addDefOutput(graph, parentId, 'out', ANY)
      const map = spawnInterior(sub, 'flow/map')
      setParam(map, 'fn', 'Step')
      wirePanelIn(sub, 0, map, 0)
      wirePanelOut(sub, map, 0, 0)
    }
    const instA = spawnInstance(graph, a.id)
    constNum(graph, 1).connect(0, instA, 0)
    const sinkA = spawn(graph, 'io/preview')
    instA.connect(0, sinkA, 0)
    const instB = spawnInstance(graph, b.id)
    constNum(graph, 1).connect(0, instB, 0)
    const sinkB = spawn(graph, 'io/preview')
    instB.connect(0, sinkB, 0)

    await engine.whenIdle()
    expect(engine.outputsOf(instA)).toEqual([[11]])
    expect(engine.outputsOf(instB)).toEqual([[101]])

    // Edit A's Step interior (k: 10 → 20): A's consumer must re-run, B's must NOT.
    addKRuns = 0
    const stepSub = interiorOf(graph, stepA)
    setParam(stepSub._nodes[0]!, 'k', 20)

    await engine.whenIdle()
    expect(engine.outputsOf(instA)).toEqual([[21]])
    expect(engine.outputsOf(instB)).toEqual([[101]]) // untouched: B's Step shadows A's from B's view
    dispose()
  })
})

// ─── Serialization ───────────────────────────────────────────────────────────

describe('scoped definitions — serialization', () => {
  it('round-trips the scope field', () => {
    const { graph, dispose } = rig()
    const a = createSubgraphDef(graph, 'A')
    createSubgraphDef(graph, 'Local', a.id)

    const doc = parseGraphDocument(JSON.parse(JSON.stringify(serializeGraph(graph))))
    const entry = doc.subgraphs?.find((s) => s.name === 'Local')
    expect(entry?.scope).toBe(a.id)

    const restored = new LGraph()
    const { warnings } = deserializeGraph(doc, restored)
    expect(warnings).toEqual([])
    const localMeta = visibleSubgraphDefs(restored, rawSubgraph(restored, a.id)).find((d) => d.name === 'Local')
    expect(localMeta?.scope).toBe(a.id)
    expect(names(visibleSubgraphDefs(restored, restored))).toEqual(['A'])
    dispose()
  })

  it('degrades a missing scope target to global with a warning', () => {
    const { graph, dispose } = rig()
    const a = createSubgraphDef(graph, 'A')
    createSubgraphDef(graph, 'Local', a.id)
    const doc = parseGraphDocument(JSON.parse(JSON.stringify(serializeGraph(graph))))
    // Remove the parent but keep the scoped child, referencing a ghost scope.
    doc.subgraphs = doc.subgraphs?.filter((s) => s.name !== 'A')

    const restored = new LGraph()
    const { warnings } = deserializeGraph(doc, restored)
    expect(warnings.some((w) => w.includes('scopes to a missing definition'))).toBe(true)
    expect(names(visibleSubgraphDefs(restored, restored))).toEqual(['Local'])
    dispose()
  })
})
