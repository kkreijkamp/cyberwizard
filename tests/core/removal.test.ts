import { LGraph, LiteGraph } from '@comfyorg/litegraph'
import type { LGraphNode } from '@comfyorg/litegraph'
import { describe, expect, it } from 'vitest'
import { Engine } from '../../src/core/engine'
import { installConnectionRules, setParam } from '../../src/core/registry'
import '../../src/nodes'

installConnectionRules()

function mk(graph: LGraph, type: string): LGraphNode {
  const node = LiteGraph.createNode(type)
  if (!node) throw new Error(`unregistered: ${type}`)
  graph.add(node)
  return node
}

describe('node removal', () => {
  it('engine stays idle after deleting a middle node', async () => {
    const graph = new LGraph()
    const src = mk(graph, 'io/text-input')
    const upper = mk(graph, 'text/to-upper-case')
    const sink = mk(graph, 'io/preview')
    setParam(src, 'text', 'abc')
    src.connect(0, upper, 0)
    upper.connect(0, sink, 0)

    const engine = new Engine(graph)
    await engine.whenIdle()

    graph.remove(upper)
    // Regression: a dirty flag on the removed node used to wedge the
    // evaluation loop forever (page froze). whenIdle must resolve.
    await engine.whenIdle()

    expect(engine.stateOf(sink).error).toBeUndefined()
    engine.dispose()
  })

  it('forgets state and aborts the in-flight run of a removed node', async () => {
    const graph = new LGraph()
    const src = mk(graph, 'io/text-input')
    const sha = mk(graph, 'hashing/sha-256') // genuinely async
    src.connect(0, sha, 0)

    const engine = new Engine(graph)
    // Remove immediately: the sha run may or may not have started yet;
    // either way the engine must settle and drop the ghost state.
    graph.remove(sha)
    await engine.whenIdle()

    expect(engine.outputsOf(sha)).toBeUndefined()
    expect(engine.stateOf(sha).dirty).toBe(true) // fresh state, lazily re-created
    engine.dispose()
  })

  it('upstream deletion re-evaluates downstream with an empty input', async () => {
    const graph = new LGraph()
    const src = mk(graph, 'io/text-input')
    const upper = mk(graph, 'text/to-upper-case')
    const sink = mk(graph, 'io/preview')
    setParam(src, 'text', 'abc')
    src.connect(0, upper, 0)
    upper.connect(0, sink, 0)

    const engine = new Engine(graph)
    await engine.whenIdle()
    expect(engine.outputsOf(upper)).toEqual(['ABC'])

    graph.remove(src)
    await engine.whenIdle()
    expect(engine.outputsOf(upper)).toEqual([''])
    engine.dispose()
  })
})
