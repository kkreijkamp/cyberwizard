import { LGraph, LiteGraph } from '@comfyorg/litegraph'
import { describe, expect, it } from 'vitest'
import { Engine } from '../../src/core/engine'
import { installComputeMenu } from '../../src/ui/compute-menu'
import '../../src/nodes'

describe('compute menu', () => {
  it('adds a Compute entry whose callback computes the clicked node', async () => {
    const graph = new LGraph()
    const engine = new Engine(graph)
    installComputeMenu(engine)

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
})
