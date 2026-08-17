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
import '../../src/nodes'

installConnectionRules()

function mk(graph: LGraph, type: string, pos: [number, number] = [0, 0]): LGraphNode {
  const node = LiteGraph.createNode(type)
  if (!node) throw new Error(`unregistered: ${type}`)
  node.pos = pos
  graph.add(node)
  return node
}

function buildSample(): { graph: LGraph; input: LGraphNode; upper: LGraphNode } {
  const graph = new LGraph()
  const input = mk(graph, 'io/text-input', [10, 20])
  setParam(input, 'text', 'persist me')
  const upper = mk(graph, 'text/to-upper-case', [300, 20])
  const sink = mk(graph, 'io/preview', [600, 20])
  input.connect(0, upper, 0)
  upper.connect(0, sink, 0)
  return { graph, input, upper }
}

describe('serialize round-trip', () => {
  it('preserves nodes, params, positions, links, and computed values', async () => {
    const { graph } = buildSample()
    const engine = new Engine(graph)
    await engine.whenIdle()
    const doc = serializeGraph(graph)
    engine.dispose()

    const restored = new LGraph()
    const { warnings } = deserializeGraph(doc, restored)
    expect(warnings).toEqual([])

    const engine2 = new Engine(restored)
    await engine2.whenIdle()

    expect(restored._nodes.length).toBe(3)
    expect(restored._links.size).toBe(2)

    const restoredInput = restored._nodes.find((n) => n.title === 'Text Input')
    expect(restoredInput?.properties.text).toBe('persist me')
    expect([restoredInput?.pos[0], restoredInput?.pos[1]]).toEqual([10, 20])

    const restoredUpper = restored._nodes.find((n) => n.title === 'To Upper Case')
    expect(engine2.outputsOf(restoredUpper as LGraphNode)).toEqual(['PERSIST ME'])
    engine2.dispose()
  })

  it('syncs restored params into widget values', () => {
    const { graph } = buildSample()
    const doc = serializeGraph(graph)
    const restored = new LGraph()
    deserializeGraph(doc, restored)

    const input = restored._nodes.find((n) => n.title === 'Text Input')
    const widget = input?.widgets?.find((w) => 'value' in w) as { value?: unknown } | undefined
    expect(widget?.value).toBe('persist me')
  })

  it('round-trips embedded file data', () => {
    const graph = new LGraph()
    const file = mk(graph, 'io/file-input')
    file.properties.fileData = new Uint8Array([1, 2, 3, 255])
    file.properties.fileName = 'tiny.bin'

    const doc = serializeGraph(graph)
    expect(doc.nodes[0]?.fileData).toBe('AQID/w==')

    const restored = new LGraph()
    deserializeGraph(doc, restored)
    const restoredFile = restored._nodes[0]
    expect(restoredFile?.properties.fileData).toEqual(new Uint8Array([1, 2, 3, 255]))
    expect(restoredFile?.properties.fileName).toBe('tiny.bin')
  })

  it('warns on unknown node types and keeps loading the rest', () => {
    const { graph } = buildSample()
    const doc = serializeGraph(graph)
    doc.nodes[0]!.type = 'io/does-not-exist'

    const restored = new LGraph()
    const { warnings } = deserializeGraph(doc, restored)

    expect(warnings.some((w) => w.includes('io/does-not-exist'))).toBe(true)
    // two links reference the missing input → two more warnings
    expect(restored._nodes.length).toBe(2)
  })

  it('survives json stringification (the storage/transport form)', () => {
    const { graph } = buildSample()
    const doc = parseGraphDocument(JSON.parse(JSON.stringify(serializeGraph(graph))))
    const restored = new LGraph()
    const { warnings } = deserializeGraph(doc, restored)
    expect(warnings).toEqual([])
    expect(restored._links.size).toBe(2)
  })
})

describe('parseGraphDocument validation', () => {
  it('rejects non-objects, wrong versions, and malformed entries', () => {
    expect(() => parseGraphDocument('nope')).toThrow(/not an object/)
    expect(() => parseGraphDocument({ version: 99, nodes: [], links: [] })).toThrow(/version/)
    expect(() => parseGraphDocument({ version: 1, nodes: [{}], links: [] })).toThrow(/malformed/)
    expect(() => parseGraphDocument({ version: 1, nodes: [], links: [{}] })).toThrow(/malformed/)
  })
})
