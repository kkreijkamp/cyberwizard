import { LGraph, LiteGraph } from '@comfyorg/litegraph'
import type { LGraphCanvas, LGraphNode } from '@comfyorg/litegraph'
import { describe, expect, it, vi } from 'vitest'
import { Engine } from '../../src/core/engine'
import { installConnectionRules } from '../../src/core/registry'
import { installComputeMenu } from '../../src/ui/compute-menu'
import '../../src/nodes'

installConnectionRules()

function fakeCanvas(graph: LGraph) {
  return {
    graph,
    setGraph: vi.fn(),
    centerOnNode: vi.fn(),
    selectNode: vi.fn<(node: LGraphNode) => void>(),
  }
}

describe('compute menu', () => {
  it('adds a Compute entry whose callback computes the clicked node', async () => {
    const graph = new LGraph()
    const engine = new Engine(graph)
    installComputeMenu(engine, () => fakeCanvas(graph) as unknown as LGraphCanvas)

    const src = LiteGraph.createNode('io/text-input')
    const mid = LiteGraph.createNode('text/to-upper-case')
    if (!src || !mid) throw new Error('unregistered')
    graph.add(src)
    graph.add(mid)
    src.connect(0, mid, 0)
    await engine.whenIdle()
    expect(engine.outputsOf(mid)).toBeUndefined() // no sink: rests

    const entries = mid.getExtraMenuOptions?.(undefined as never, [])
    expect(entries).toHaveLength(1)
    expect(entries?.[0]?.content).toBe('Compute')

    const callback = entries?.[0]?.callback as unknown as () => void
    callback()
    await engine.whenIdle()
    expect(engine.outputsOf(mid)).toEqual([''])
    engine.dispose()
  })

  it('adds a Go to failure source entry on blocked nodes, jumping to the cause', async () => {
    const graph = new LGraph()
    const engine = new Engine(graph)
    const canvas = fakeCanvas(graph)
    installComputeMenu(engine, () => canvas as unknown as LGraphCanvas)

    // text input (empty) → JSON Parse throws → downstream never runs.
    const src = LiteGraph.createNode('io/text-input')
    const json = LiteGraph.createNode('data/json-parse')
    const mid = LiteGraph.createNode('text/to-upper-case')
    if (!src || !json || !mid) throw new Error('unregistered')
    graph.add(src)
    graph.add(json)
    graph.add(mid)
    src.connect(0, json, 0)
    json.connect(0, mid, 0)
    await engine.compute(mid)

    expect(engine.hasFailure(json)).toBe(true)
    expect(engine.hasFailure(mid)).toBe(true)

    // The node at fault gets no jump entry: it IS the source.
    const jsonEntries = json.getExtraMenuOptions?.(undefined as never, [])
    expect(jsonEntries?.map((e) => e?.content)).toEqual(['Compute'])

    // The blocked dependent does, and its callback navigates to the cause.
    const midEntries = mid.getExtraMenuOptions?.(undefined as never, [])
    expect(midEntries?.map((e) => e?.content)).toEqual(['Go to failure source', 'Compute'])
    const callback = midEntries?.[0]?.callback as unknown as () => void
    callback()
    expect(canvas.setGraph).not.toHaveBeenCalled() // same graph: no navigation needed
    expect(canvas.centerOnNode).toHaveBeenCalledWith(json)
    expect(canvas.selectNode).toHaveBeenCalledWith(json)
    engine.dispose()
  })
})
