import type { LGraphCanvas, LGraphNode, LLink } from '@comfyorg/litegraph'
import { describe, expect, it, vi } from 'vitest'
import { installLinkStyles } from '../../src/ui/links'

const LINK = { origin_id: 1, id: 1 } as unknown as LLink

function setup(engine: { hasOutputs: boolean; hasFailure: boolean }, highlighted = false) {
  const origin = { id: 1 } as LGraphNode
  const original = vi.fn()
  const canvas = {
    renderLink: original,
    graph: { getNodeById: () => origin },
    highlighted_links: highlighted ? { 1: true } : {},
  }
  const fakeEngine = {
    hasOutputs: () => engine.hasOutputs,
    hasFailure: () => engine.hasFailure,
  }
  installLinkStyles(canvas as unknown as LGraphCanvas, fakeEngine as never)
  const ctx = { save: vi.fn(), restore: vi.fn(), setLineDash: vi.fn(), globalAlpha: 1 }
  return { canvas, original, ctx }
}

/** Renders through the wrapper; returns the colour argument the library call saw. */
function render(canvas: ReturnType<typeof setup>['canvas'], ctx: ReturnType<typeof setup>['ctx']) {
  canvas.renderLink(ctx as unknown as CanvasRenderingContext2D, [0, 0], [10, 10], LINK)
}

describe('link styles', () => {
  it('dashes and dims a link whose origin produced nothing', () => {
    const { canvas, original, ctx } = setup({ hasOutputs: false, hasFailure: false })
    render(canvas, ctx)
    expect(ctx.setLineDash).toHaveBeenCalledWith([6, 6])
    expect(ctx.globalAlpha).toBe(0.55)
    expect(original).toHaveBeenCalled()
    expect(ctx.restore).toHaveBeenCalled()
  })

  it('paints a failing link rust red, dashed but not dimmed', () => {
    const { canvas, original, ctx } = setup({ hasOutputs: false, hasFailure: true })
    render(canvas, ctx)
    expect(ctx.setLineDash).toHaveBeenCalledWith([6, 6])
    expect(ctx.globalAlpha).toBe(1)
    expect(original.mock.calls[0]?.[6]).toBe('#a83a32')
  })

  it('paints a selected-node link amber instead of the library white', () => {
    const { canvas, original, ctx } = setup({ hasOutputs: true, hasFailure: false }, true)
    render(canvas, ctx)
    expect(original.mock.calls[0]?.[6]).toBe('#a16207')
    expect(ctx.setLineDash).not.toHaveBeenCalled()
    // The highlight map is hidden only for the call's duration.
    expect((canvas as unknown as { highlighted_links: Record<number, unknown> }).highlighted_links[1]).toBe(true)
  })

  it('lets failure red win over selection amber', () => {
    const { canvas, original, ctx } = setup({ hasOutputs: false, hasFailure: true }, true)
    render(canvas, ctx)
    expect(original.mock.calls[0]?.[6]).toBe('#a83a32')
  })

  it('leaves a value-carrying link solid', () => {
    const { canvas, original, ctx } = setup({ hasOutputs: true, hasFailure: false })
    render(canvas, ctx)
    expect(ctx.setLineDash).not.toHaveBeenCalled()
    expect(ctx.globalAlpha).toBe(1)
    expect(original).toHaveBeenCalled()
  })

  it('ignores non-link segments (in-flight drags, reroutes)', () => {
    const { canvas, ctx } = setup({ hasOutputs: false, hasFailure: false })
    canvas.renderLink(ctx as unknown as CanvasRenderingContext2D, [0, 0], [10, 10], null)
    expect(ctx.setLineDash).not.toHaveBeenCalled()
  })
})
