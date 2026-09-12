/**
 * Link styles, by what flows on the wire:
 *  - origin failing (its own error or blocked by one): rust red, dashed —
 *    the failure shows up along the whole downstream path, not just on nodes.
 *  - origin never executed (undemanded, dirty): dashed and dimmed warm grey.
 *  - origin produced a value: solid.
 *
 * Implemented as a canvas.renderLink wrapper (the one per-link choke point);
 * state changes reach the canvas through Engine.paint's dirty marking.
 */

import type { LGraphCanvas, LLink } from '@comfyorg/litegraph'
import { COLOR_ERROR } from '../core/engine'
import type { Engine } from '../core/engine'

export function installLinkStyles(canvas: LGraphCanvas, engine: Engine): void {
  type RenderLinkParams = Parameters<LGraphCanvas['renderLink']>
  const original = canvas.renderLink.bind(canvas) as (...args: RenderLinkParams) => void

  canvas.renderLink = function renderLink(this: LGraphCanvas, ...args: RenderLinkParams) {
    const [ctx, , , link] = args
    const origin = originOf(link)
    if (!origin) return original(...args)

    if (engine.hasFailure(origin)) {
      // Red overrides the colour argument (index 6) — renderLink prefers it.
      args[6] = COLOR_ERROR
      return stroked(ctx, 1, () => original(...args))
    }
    if (!engine.hasOutputs(origin)) {
      return stroked(ctx, 0.55, () => original(...args))
    }
    return original(...args)
  } as LGraphCanvas['renderLink']

  function originOf(link: unknown): Parameters<Engine['hasOutputs']>[0] | undefined {
    if (link === null || typeof link !== 'object' || !('origin_id' in link)) return undefined
    return canvas.graph?.getNodeById((link as LLink).origin_id) ?? undefined
  }

  /** Dashed, alpha-scaled render of one link. */
  function stroked(ctx: CanvasRenderingContext2D, alpha: number, draw: () => void): void {
    ctx.save()
    ctx.setLineDash([6, 6])
    ctx.globalAlpha *= alpha
    try {
      draw()
    } finally {
      ctx.restore()
    }
  }
}
