import { LGraph, LiteGraph, RenderShape } from '@comfyorg/litegraph'
import type { LGraphCanvas } from '@comfyorg/litegraph'
import { describe, expect, it } from 'vitest'
import { applyTheme } from '../../src/ui/theme'
import '../../src/nodes'

function fakeCanvas(): LGraphCanvas {
  return {} as LGraphCanvas
}

describe('theme slot shapes', () => {
  it('stamps hollow-circle shape on slots — including nodes created before applyTheme', () => {
    const graph = new LGraph()
    const node = LiteGraph.createNode('text/to-upper-case')
    if (!node) throw new Error('unregistered')
    graph.add(node)
    // Node and slots exist BEFORE the theme install (the bug this regressed).
    expect(node.inputs[0]?.shape).toBeUndefined()

    applyTheme(fakeCanvas())
    try {
      node.drawSlots({} as never, {} as never)
    } catch {
      // The library's slot drawing needs a real ctx; the stamp runs first.
    }
    expect(node.inputs[0]?.shape).toBe(RenderShape.HollowCircle)
    expect(node.outputs[0]?.shape).toBe(RenderShape.HollowCircle)
  })
})
