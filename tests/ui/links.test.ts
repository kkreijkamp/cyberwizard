import type { LGraphCanvas, LGraphNode, LLink } from '@comfyorg/litegraph'
import { describe, expect, it, vi } from 'vitest'
import { installLinkStyles } from '../../src/ui/links'

const LINK = { origin_id: 1 } as unknown as LLink

function setup(hasOutputs: boolean) {
  const origin = { id: 1 } as LGraphNode
  const original = vi.fn()
  const canvas = {
    renderLink: original,
    graph: { getNodeById: () => origin },
  }
  const engine = { hasOutputs: () => hasOutputs }
  installLinkStyles(canvas as unknown as LGraphCanvas, engine as never)
  const ctx = { save: vi.fn(), restore: vi.fn(), setLineDash: vi.fn(), globalAlpha: 1 }
  return { canvas, original, ctx }
}

describe('link styles', () => {
  it('dashes and dims a link whose origin produced nothing', () => {
    const { canvas, original, ctx } = setup(false)
    canvas.renderLink(ctx as unknown as CanvasRenderingContext2D, [0, 0], [10, 10], LINK)
    expect(ctx.setLineDash).toHaveBeenCalledWith([6, 6])
    expect(ctx.globalAlpha).toBe(0.55)
    expect(original).toHaveBeenCalled()
    expect(ctx.restore).toHaveBeenCalled()
  })

  it('leaves a value-carrying link solid', () => {
    const { canvas, original, ctx } = setup(true)
    canvas.renderLink(ctx as unknown as CanvasRenderingContext2D, [0, 0], [10, 10], LINK)
    expect(ctx.setLineDash).not.toHaveBeenCalled()
    expect(ctx.globalAlpha).toBe(1)
    expect(original).toHaveBeenCalled()
  })

  it('ignores non-link segments (in-flight drags, reroutes)', () => {
    const { canvas, ctx } = setup(false)
    canvas.renderLink(ctx as unknown as CanvasRenderingContext2D, [0, 0], [10, 10], null)
    expect(ctx.setLineDash).not.toHaveBeenCalled()
  })
})
