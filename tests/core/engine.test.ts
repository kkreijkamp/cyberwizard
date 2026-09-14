import { LGraph, LiteGraph } from '@comfyorg/litegraph'
import type { LGraphNode } from '@comfyorg/litegraph'
import { describe, expect, it, vi } from 'vitest'
import { Engine } from '../../src/core/engine'
import { PREVIEW_WIDGET_NAME, defineNode, installConnectionRules, setParam } from '../../src/core/registry'
import { ANY, STRING } from '../../src/core/types'

installConnectionRules()

// ─── Test ops (unique 'test-eng/' types; registration is global) ────────────

const counters = { src: 0, suffix: 0, deferred: 0, boom: 0, sink: 0, join: 0 }

defineNode({
  type: 'test-eng/src',
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
  type: 'test-eng/suffix',
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

/** Async op whose completion the test controls, to exercise cancellation. */
const deferredResolvers: Array<() => void> = []
defineNode({
  type: 'test-eng/deferred',
  title: 'Deferred',
  category: 'Test',
  inputs: [{ name: 'data', type: STRING }] as const,
  outputs: [{ name: 'out', type: STRING }] as const,
  run: (inputs) => {
    counters.deferred++
    const value = inputs.data ?? ''
    return new Promise<{ out: string }>((resolve) => {
      deferredResolvers.push(() => resolve({ out: value }))
    })
  },
})

defineNode({
  type: 'test-eng/boom',
  title: 'Boom',
  category: 'Test',
  inputs: [{ name: 'data', type: STRING }] as const,
  outputs: [{ name: 'out', type: STRING }] as const,
  run: () => {
    counters.boom++
    throw new Error('boom')
  },
})

/** Throws only while its mode param is 'fail', so tests can flip it back to success. */
defineNode({
  type: 'test-eng/flaky',
  title: 'Flaky',
  category: 'Test',
  inputs: [] as const,
  outputs: [{ name: 'out', type: STRING }] as const,
  params: [{ kind: 'string', name: 'mode', default: 'fail' }] as const,
  run: (_inputs, params) => {
    if (params.mode === 'fail') throw new Error('boom')
    return { out: 'ok' }
  },
})

const sinkCaptured: unknown[] = []
defineNode({
  type: 'test-eng/sink',
  title: 'Sink',
  category: 'Test',
  inputs: [{ name: 'value', type: ANY }] as const,
  outputs: [] as const,
  run: (inputs) => {
    counters.sink++
    sinkCaptured.push(inputs.value)
    return {}
  },
})

const joinCaptured: Array<[unknown, unknown]> = []
defineNode({
  type: 'test-eng/join',
  title: 'Join',
  category: 'Test',
  inputs: [
    { name: 'a', type: ANY },
    { name: 'b', type: ANY },
  ] as const,
  outputs: [] as const,
  run: (inputs) => {
    counters.join++
    joinCaptured.push([inputs.a, inputs.b])
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

function reset(): void {
  for (const key of Object.keys(counters)) counters[key as keyof typeof counters] = 0
  sinkCaptured.length = 0
  joinCaptured.length = 0
  deferredResolvers.length = 0
}

function settleDeferredRuns(): void {
  for (const resolve of deferredResolvers.splice(0)) resolve()
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Engine', () => {
  it('evaluates a linear chain', async () => {
    reset()
    const graph = new LGraph()
    const src = spawn(graph, 'test-eng/src')
    const mid = spawn(graph, 'test-eng/suffix')
    const sink = spawn(graph, 'test-eng/sink')
    setParam(src, 'text', 'abc')
    setParam(mid, 'suffix', '!')
    src.connect(0, mid, 0)
    mid.connect(0, sink, 0)

    const engine = new Engine(graph)
    await engine.whenIdle()
    expect(sinkCaptured).toEqual(['abc!'])
    engine.dispose()
  })

  it('runs the fan-in node of a diamond exactly once, after both branches', async () => {
    reset()
    const graph = new LGraph()
    const src = spawn(graph, 'test-eng/src')
    const a = spawn(graph, 'test-eng/suffix')
    const b = spawn(graph, 'test-eng/suffix')
    const join = spawn(graph, 'test-eng/join')
    setParam(src, 'text', 'q')
    setParam(a, 'suffix', '1')
    setParam(b, 'suffix', '2')
    src.connect(0, a, 0)
    src.connect(0, b, 0)
    a.connect(0, join, 0)
    b.connect(0, join, 1)

    const engine = new Engine(graph)
    await engine.whenIdle()
    expect(counters.join).toBe(1)
    expect(joinCaptured).toEqual([['q1', 'q2']])
    engine.dispose()
  })

  it('re-runs only the edited node and its downstream (output caching)', async () => {
    reset()
    const graph = new LGraph()
    const src = spawn(graph, 'test-eng/src')
    const a = spawn(graph, 'test-eng/suffix')
    const b = spawn(graph, 'test-eng/suffix')
    const sink = spawn(graph, 'test-eng/sink')
    src.connect(0, a, 0)
    a.connect(0, b, 0)
    b.connect(0, sink, 0)

    const engine = new Engine(graph)
    await engine.whenIdle()
    reset()

    setParam(b, 'suffix', '?')
    await engine.whenIdle()

    expect(counters.src).toBe(0)
    expect(counters.suffix).toBe(1) // only b
    expect(counters.sink).toBe(1)
    expect(sinkCaptured).toEqual(['x?'])
    engine.dispose()
  })

  it('discards a stale async result superseded mid-flight', async () => {
    reset()
    const graph = new LGraph()
    const src = spawn(graph, 'test-eng/src')
    const deferred = spawn(graph, 'test-eng/deferred')
    const sink = spawn(graph, 'test-eng/sink')
    src.connect(0, deferred, 0)
    deferred.connect(0, sink, 0)

    const engine = new Engine(graph)
    // Let the initial run ('x') start and settle.
    await vi.waitFor(() => expect(counters.deferred).toBe(1))
    settleDeferredRuns()
    await engine.whenIdle()
    expect(sinkCaptured).toEqual(['x'])

    // 'a' starts running; before it settles, 'b' supersedes it.
    setParam(src, 'text', 'a')
    await vi.waitFor(() => expect(counters.deferred).toBe(2))
    setParam(src, 'text', 'b')
    settleDeferredRuns() // settles the stale 'a' run: must be discarded
    await vi.waitFor(() => expect(counters.deferred).toBe(3))
    settleDeferredRuns() // settles the fresh 'b' run

    await engine.whenIdle()
    expect(sinkCaptured).toEqual(['x', 'b'])
    expect(engine.outputsOf(deferred)).toEqual(['b'])
    engine.dispose()
  })

  it('captures errors per node and blocks downstream instead of cascading', async () => {
    reset()
    const graph = new LGraph()
    const src = spawn(graph, 'test-eng/src')
    const boom = spawn(graph, 'test-eng/boom')
    const sink = spawn(graph, 'test-eng/sink')
    src.connect(0, boom, 0)
    boom.connect(0, sink, 0)

    const engine = new Engine(graph)
    await engine.whenIdle()

    expect(counters.boom).toBe(1)
    expect(counters.sink).toBe(0)
    expect(engine.stateOf(boom).error?.message).toBe('boom')
    expect(engine.stateOf(sink).blocked).toBe(true)
    expect(engine.stateOf(sink).error).toBeUndefined()
    engine.dispose()
  })

  it('paints an errored node red and restores its colors on recovery', async () => {
    reset()
    const graph = new LGraph()
    const flaky = spawn(graph, 'test-eng/flaky')
    const sink = spawn(graph, 'test-eng/sink')
    flaky.connect(0, sink, 0)

    const originalColor = flaky.color
    const originalBgcolor = flaky.bgcolor

    const engine = new Engine(graph)
    await engine.whenIdle()

    expect(engine.stateOf(flaky).error?.message).toBe('boom')
    expect(flaky.color).toBe('#a83a32')
    expect(flaky.bgcolor).toBe('#f7e3e0')
    expect(flaky.boxcolor).toBe('#a83a32')

    setParam(flaky, 'mode', 'ok')
    await engine.whenIdle()

    expect(engine.stateOf(flaky).error).toBeUndefined()
    expect(flaky.color).toBe(originalColor)
    expect(flaky.bgcolor).toBe(originalBgcolor)
    expect(flaky.boxcolor).toBeUndefined()
    engine.dispose()
  })

  it('hasOutputs reflects whether a node has cached values', async () => {
    reset()
    const graph = new LGraph()
    const src = spawn(graph, 'test-eng/src')
    const sink = spawn(graph, 'test-eng/sink')
    src.connect(0, sink, 0)

    const engine = new Engine(graph)
    expect(engine.hasOutputs(src)).toBe(false)
    await engine.whenIdle()
    expect(engine.hasOutputs(src)).toBe(true)
    engine.dispose()
  })

  it('propagates failure downstream as a red blocked state naming the cause', async () => {
    reset()
    const graph = new LGraph()
    const flaky = spawn(graph, 'test-eng/flaky')
    const mid = spawn(graph, 'test-eng/suffix')
    const sink = spawn(graph, 'test-eng/sink')
    flaky.connect(0, mid, 0)
    mid.connect(0, sink, 0)

    const midColor = mid.color
    const engine = new Engine(graph)
    await engine.whenIdle()

    // mid never ran, yet it shows a failure too: red, blaming Flaky.
    expect(counters.suffix).toBe(0)
    expect(engine.stateOf(mid).blocked).toBe(true)
    expect(mid.color).toBe('#a83a32')
    expect(mid.bgcolor).toBe('#f7e3e0')
    expect(engine.stateOf(mid).cause).toMatchObject({ nodeId: flaky.id, title: 'Flaky', message: 'boom' })
    expect(engine.hasFailure(mid)).toBe(true)
    expect(engine.failureSource(mid)?.node).toBe(flaky)
    expect(engine.failureSource(flaky)).toBeUndefined() // Flaky is itself the source
    const badge = mid.widgets?.find((w) => w.name === PREVIEW_WIDGET_NAME) as
      | { value?: unknown }
      | undefined
    expect(badge?.value).toBe('⚠ Flaky: boom')

    // Recovery re-runs mid and restores its colors.
    setParam(flaky, 'mode', 'ok')
    await engine.whenIdle()
    expect(engine.stateOf(mid).blocked).toBe(false)
    expect(mid.color).toBe(midColor)
    engine.dispose()
  })

  it('leaves an undemanded cycle inert, and errors once a sink demands it', async () => {
    reset()
    const graph = new LGraph()
    const a = spawn(graph, 'test-eng/suffix')
    const b = spawn(graph, 'test-eng/suffix')
    a.connect(0, b, 0)
    b.connect(0, a, 0)

    const engine = new Engine(graph)
    await engine.whenIdle()

    // Nothing demands the cycle: it never evaluates and shows no errors.
    expect(counters.suffix).toBe(0)
    expect(engine.stateOf(a).error).toBeUndefined()
    expect(engine.stateOf(b).error).toBeUndefined()

    // A sink demands it: the cycle is diagnosed, its nodes never execute.
    const sink = spawn(graph, 'test-eng/sink')
    a.connect(0, sink, 0)
    await engine.whenIdle()
    expect(counters.suffix).toBe(0)
    expect(engine.stateOf(a).error?.message).toMatch(/cycle/)
    expect(engine.stateOf(b).error?.message).toMatch(/cycle/)
    expect(engine.stateOf(sink).blocked).toBe(true)
    engine.dispose()
  })

  it('evaluates nodes added after attach', async () => {
    reset()
    const graph = new LGraph()
    const engine = new Engine(graph)
    await engine.whenIdle()

    const src = spawn(graph, 'test-eng/src')
    const sink = spawn(graph, 'test-eng/sink')
    src.connect(0, sink, 0)
    await engine.whenIdle()
    expect(sinkCaptured).toEqual(['x'])
    engine.dispose()
  })

  it('never runs nodes that no sink demands, and activates them when one does', async () => {
    reset()
    const graph = new LGraph()
    const src = spawn(graph, 'test-eng/src')
    const mid = spawn(graph, 'test-eng/suffix')
    const boom = spawn(graph, 'test-eng/boom') // would error if it ran
    src.connect(0, mid, 0)
    mid.connect(0, boom, 0)

    const engine = new Engine(graph)
    await engine.whenIdle()
    // No sink anywhere: the whole chain rests, no previews, no errors.
    expect(counters.src).toBe(0)
    expect(counters.suffix).toBe(0)
    expect(counters.boom).toBe(0)
    expect(engine.outputsOf(mid)).toBeUndefined()

    // Attaching a sink backpropagates demand along the path: boom errors.
    const sink = spawn(graph, 'test-eng/sink')
    boom.connect(0, sink, 0)
    await engine.whenIdle()
    expect(counters.src).toBe(1)
    expect(counters.suffix).toBe(1)
    expect(counters.boom).toBe(1)
    expect(engine.stateOf(boom).error?.message).toBe('boom')
    expect(engine.stateOf(sink).blocked).toBe(true)

    // A second, unrelated chain still rests.
    reset()
    const stray = spawn(graph, 'test-eng/suffix')
    await engine.whenIdle()
    expect(counters.suffix).toBe(0)
    expect(engine.outputsOf(stray)).toBeUndefined()
    engine.dispose()
  })

  it('compute() pulls one node on demand, exactly as if a sink demanded it', async () => {
    reset()
    const graph = new LGraph()
    const src = spawn(graph, 'test-eng/src')
    const mid = spawn(graph, 'test-eng/suffix')
    const boom = spawn(graph, 'test-eng/boom')
    setParam(mid, 'suffix', '!')
    src.connect(0, mid, 0)
    mid.connect(0, boom, 0) // downstream of the computed node: never demanded

    const engine = new Engine(graph)
    await engine.whenIdle()
    expect(counters.suffix).toBe(0) // no sink anywhere: everything rests

    await engine.compute(mid)
    expect(counters.src).toBe(1)
    expect(counters.suffix).toBe(1)
    expect(counters.boom).toBe(0)
    expect(engine.outputsOf(mid)).toEqual(['x!'])

    // A compute on a clean node memo-hits; an edit re-dirties it.
    await engine.compute(mid)
    expect(counters.suffix).toBe(1)
    setParam(src, 'text', 'y')
    await engine.compute(mid)
    expect(counters.suffix).toBe(2)
    expect(engine.outputsOf(mid)).toEqual(['y!'])
    engine.dispose()
  })

  it('paints live previews: value on success, warning on error', async () => {
    reset()
    const graph = new LGraph()
    const src = spawn(graph, 'test-eng/src')
    const mid = spawn(graph, 'test-eng/suffix')
    const boom = spawn(graph, 'test-eng/boom')
    const sink = spawn(graph, 'test-eng/sink')
    setParam(mid, 'suffix', '!')
    src.connect(0, mid, 0)
    mid.connect(0, boom, 0)
    boom.connect(0, sink, 0)

    const engine = new Engine(graph)
    await engine.whenIdle()

    const previewOf = (n: LGraphNode): unknown =>
      (n.widgets?.find((w) => w.name === PREVIEW_WIDGET_NAME) as { value?: unknown } | undefined)
        ?.value
    expect(previewOf(src)).toBe('text: x')
    expect(previewOf(mid)).toBe('out: x!')
    expect(previewOf(boom)).toBe('⚠ boom')
    engine.dispose()
  })
})
