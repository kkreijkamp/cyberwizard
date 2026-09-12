import { LGraph, LiteGraph } from '@comfyorg/litegraph'
import type { LGraphCanvas } from '@comfyorg/litegraph'
import { describe, expect, it, vi } from 'vitest'
import { applyTheme } from '../../src/ui/theme'
import '../../src/nodes'

describe('theme slot rings', () => {
  it('overdraws a paper-filled ring in the slot colour at each slot', () => {
    const graph = new LGraph()
    const node = LiteGraph.createNode('text/to-upper-case')
    if (!node) throw new Error('unregistered')
    graph.add(node)
    node._setConcreteSlots()

    applyTheme({} as LGraphCanvas)

    const ctx = {
      globalAlpha: 1,
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 1,
      beginPath: vi.fn(),
      arc: vi.fn(),
      rect: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
    }
    const colorContext = { getConnectedColor: () => '#123456', getDisconnectedColor: () => '#654321' }
    node.drawSlots(ctx as never, { colorContext, editorAlpha: 1, lowQuality: true } as never)

    // One ring per slot (1 input + 1 output): paper punch + coloured stroke.
    expect(ctx.arc).toHaveBeenCalledTimes(2)
    expect(ctx.arc).toHaveBeenCalledWith(expect.any(Number), expect.any(Number), 5.5, 0, Math.PI * 2)
    expect(ctx.fill).toHaveBeenCalled()
    expect(ctx.stroke).toHaveBeenCalled()
    expect(ctx.fillStyle).toBe('#f6f1e7')
    expect(ctx.strokeStyle).toBe('#b4aba0') // the node frame colour, opaque
  })

  it('puts connection points on the frame edge, not 10px inside', () => {
    const graph = new LGraph()
    const node = LiteGraph.createNode('text/to-upper-case')
    if (!node) throw new Error('unregistered')
    node.pos = [100, 200]
    graph.add(node)

    applyTheme({} as LGraphCanvas)

    expect(node.getInputPos(0)[0]).toBe(99.5) // frame centre sits 0.5px outside the edge
    expect(node.getOutputPos(0)[0]).toBe(100 + node.size[0] + 0.5)
  })
})
