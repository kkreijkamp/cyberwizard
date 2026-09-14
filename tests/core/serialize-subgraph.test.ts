import { LGraph, LiteGraph } from '@comfyorg/litegraph'
import type { LGraphNode } from '@comfyorg/litegraph'
import { describe, expect, it } from 'vitest'
import { Engine } from '../../src/core/engine'
import { installConnectionRules, setParam } from '../../src/core/registry'
import {
  deserializeGraph,
  parseGraphDocument,
  serializeGraph,
} from '../../src/core/serialize'
import { decodeShareHash, encodeShareHash } from '../../src/core/share'
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
import '../../src/nodes'

installConnectionRules()

function mk(graph: LGraph, type: string): LGraphNode {
  const node = LiteGraph.createNode(type)
  if (!node) throw new Error(`unregistered: ${type}`)
  graph.add(node)
  return node
}

/** Def "Shout": input text → to-upper-case → output text. */
function buildShoutDef(graph: LGraph): string {
  const meta = createSubgraphDef(graph, 'Shout')
  addDefInput(graph, meta.id, 'text', STRING)
  addDefOutput(graph, meta.id, 'text', STRING)
  const sub = rawSubgraph(graph, meta.id)
  if (!sub) throw new Error('no subgraph')
  const upper = LiteGraph.createNode('text/to-upper-case')
  if (!upper) throw new Error('unregistered')
  sub.add(upper)
  const inLink = sub.inputs[0]?.connect(upper.inputs[0]!, upper)
  const outLink = sub.outputs[0]?.connect(upper.outputs[0]!, upper)
  if (!inLink || !outLink) throw new Error('panel wiring failed')
  return meta.id
}

function buildDoc(): { graph: LGraph; defId: string } {
  const graph = new LGraph()
  const defId = buildShoutDef(graph)
  const input = mk(graph, 'io/text-input')
  setParam(input, 'text', 'mixed Case')
  const instance = spawnSubgraphNode(defId)
  if (!instance) throw new Error('no factory')
  graph.add(instance)
  const preview = mk(graph, 'io/preview') // sink: demands the instance's output
  input.connect(0, instance, 0)
  instance.connect(0, preview, 0)
  return { graph, defId }
}

function restoredRig(doc: ReturnType<typeof serializeGraph>): {
  restored: LGraph
  engine: Engine
  dispose: () => void
} {
  const restored = new LGraph()
  const { warnings } = deserializeGraph(doc, restored)
  expect(warnings).toEqual([])
  const engine = new Engine(restored)
  const detach = attachSubgraphSupport(restored, engine)
  return {
    restored,
    engine,
    dispose: () => {
      detach()
      engine.dispose()
    },
  }
}

describe('serialize v2: subgraph round-trip', () => {
  it('preserves definitions, instances, and computed values', async () => {
    const { graph, defId } = buildDoc()
    const engine = new Engine(graph)
    await engine.whenIdle()
    const instance = graph._nodes.find((n) => n.isSubgraphNode())
    expect(engine.outputsOf(instance as LGraphNode)).toEqual(['MIXED CASE'])
    engine.dispose()

    const doc = parseGraphDocument(JSON.parse(JSON.stringify(serializeGraph(graph))))
    expect(doc.subgraphs).toHaveLength(1)
    expect(doc.subgraphs?.[0]?.name).toBe('Shout')
    expect(doc.subgraphs?.[0]?.nodes).toHaveLength(1) // interior stored once…
    expect(doc.nodes.filter((n) => n.type === defId)).toHaveLength(1) // …instance references it

    const rig = restoredRig(doc)
    expect(rig.restored.subgraphs.size).toBe(1)
    const restoredInstance = rig.restored._nodes.find((n) => n.isSubgraphNode())
    expect(restoredInstance?.inputs.map((i) => i.name)).toEqual(['text'])
    expect(restoredInstance?.outputs.map((o) => o.name)).toEqual(['text'])

    await rig.engine.whenIdle()
    expect(rig.engine.outputsOf(restoredInstance as LGraphNode)).toEqual(['MIXED CASE'])
    rig.dispose()
  })

  it('persists definitions that have no instances', () => {
    const { graph } = buildDoc()
    const lonely = createSubgraphDef(graph, 'Unused')
    addDefOutput(graph, lonely.id, 'out', STRING)

    const doc = serializeGraph(graph)
    expect(doc.subgraphs).toHaveLength(2)

    const rig = restoredRig(doc)
    expect(getSubgraphDef(rig.restored, lonely.id)?.name).toBe('Unused')
    expect(spawnSubgraphNode(lonely.id)?.inputs).toHaveLength(0)
    rig.dispose()
  })

  it('round-trips a recursive definition (and still errors gracefully)', async () => {
    const graph = new LGraph()
    const meta = createSubgraphDef(graph, 'Ouroboros')
    addDefInput(graph, meta.id, 'text', STRING)
    addDefOutput(graph, meta.id, 'text', STRING)
    const sub = rawSubgraph(graph, meta.id)
    if (!sub) throw new Error('no subgraph')
    const selfInstance = spawnSubgraphNode(meta.id)
    if (!selfInstance) throw new Error('no factory')
    sub.add(selfInstance)
    sub.inputs[0]?.connect(selfInstance.inputs[0]!, selfInstance)
    sub.outputs[0]?.connect(selfInstance.outputs[0]!, selfInstance)

    const input = mk(graph, 'io/text-input')
    const instance = spawnSubgraphNode(meta.id)
    if (!instance) throw new Error('no factory')
    graph.add(instance)
    const preview = mk(graph, 'io/preview') // sink: demands the instance
    input.connect(0, instance, 0)
    instance.connect(0, preview, 0)

    const doc = parseGraphDocument(JSON.parse(JSON.stringify(serializeGraph(graph))))
    const rig = restoredRig(doc)
    const restoredInstance = rig.restored._nodes.find((n) => n.isSubgraphNode())
    await rig.engine.whenIdle()
    expect(rig.engine.stateOf(restoredInstance as LGraphNode).error?.message).toMatch(
      /recursion depth limit/,
    )
    rig.dispose()
  })

  it('round-trips through the share codec', () => {
    const { graph } = buildDoc()
    const hash = encodeShareHash(serializeGraph(graph))
    const doc = decodeShareHash(hash)

    const rig = restoredRig(doc)
    expect(rig.restored.subgraphs.size).toBe(1)
    rig.dispose()
  })

  it('loads v1 documents (migration: accepted as-is)', () => {
    const v1 = {
      app: 'cyberwizard',
      version: 1,
      nodes: [
        { id: 1, type: 'io/text-input', pos: [10, 20], params: { text: 'old doc' } },
      ],
      links: [],
    }
    const doc = parseGraphDocument(v1)
    const restored = new LGraph()
    const { warnings } = deserializeGraph(doc, restored)
    expect(warnings).toEqual([])
    expect(restored._nodes).toHaveLength(1)
    expect(restored._nodes[0]?.properties.text).toBe('old doc')
  })

  it('warns on dangling instance types and out-of-range panel slots', () => {
    const { graph, defId } = buildDoc()
    const doc = serializeGraph(graph)

    // An instance whose definition is not in the document.
    doc.nodes.push({ id: 999, type: 'definitely-not-a-def', pos: [0, 0], params: {} })
    // An interior link pointing at a nonexistent panel slot.
    doc.subgraphs![0]!.links.push({ from: { node: -10, slot: 7 }, to: { node: doc.subgraphs![0]!.nodes[0]!.id, slot: 0 } })

    const restored = new LGraph()
    const { warnings } = deserializeGraph(doc, restored)
    expect(warnings.some((w) => w.includes('definitely-not-a-def'))).toBe(true)
    expect(warnings.some((w) => w.includes('input panel link'))).toBe(true)
    // The valid parts still restored.
    expect(restored._nodes.some((n) => n.type === defId)).toBe(true)
  })
})

describe('panel position round-trip', () => {
  it('remembers the IO panel positions of custom nodes', () => {
    const graph = new LGraph()
    const defId = buildShoutDef(graph)
    const sub = rawSubgraph(graph, defId)
    if (!sub) throw new Error('no subgraph')
    sub.inputNode.pos = [120, 260]
    sub.outputNode.pos = [640, 140]

    const doc = parseGraphDocument(JSON.parse(JSON.stringify(serializeGraph(graph))))
    expect(doc.subgraphs?.[0]?.inputNode?.bounding?.[0]).toBe(120)
    expect(doc.subgraphs?.[0]?.inputNode?.bounding?.[1]).toBe(260)
    expect(doc.subgraphs?.[0]?.outputNode?.bounding?.[0]).toBe(640)
    expect(doc.subgraphs?.[0]?.outputNode?.bounding?.[1]).toBe(140)

    const rig = restoredRig(doc)
    const restored = rawSubgraph(rig.restored, defId)
    expect(restored?.inputNode.boundingRect[0]).toBe(120)
    expect(restored?.inputNode.boundingRect[1]).toBe(260)
    expect(restored?.outputNode.boundingRect[0]).toBe(640)
    expect(restored?.outputNode.boundingRect[1]).toBe(140)
    rig.dispose()
  })

  it('falls back to default panel positions when the saved bounds are malformed', () => {
    const graph = new LGraph()
    buildShoutDef(graph)
    const doc = parseGraphDocument(JSON.parse(JSON.stringify(serializeGraph(graph))))
    const entry = doc.subgraphs?.[0] as unknown as Record<string, unknown>
    entry.inputNode = { bounding: 'not-a-bounding' }
    delete entry.outputNode

    const rig = restoredRig(doc)
    const defId = doc.subgraphs?.[0]?.id as string
    const restored = rawSubgraph(rig.restored, defId)
    expect(restored?.inputNode.boundingRect[0]).toBe(0)
    expect(restored?.outputNode.boundingRect[0]).toBe(300)
    rig.dispose()
  })
})
