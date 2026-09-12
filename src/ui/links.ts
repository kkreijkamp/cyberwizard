/**
 * Link styles, by what flows on the wire:
 *  - origin failing (its own error or blocked by one): rust red, dashed —
 *    the failure shows up along the whole downstream path, not just on nodes.
 *  - origin never executed (undemanded, dirty): dashed and dimmed warm grey.
 *  - origin produced a value: solid.
 * Links of the selected node render amber — the library highlights them in
 * hardcoded bright white (#FFF), illegible on the paper background.
 *
 * Implemented as a canvas.renderLink wrapper (the one per-link choke point);
 * state changes reach the canvas through Engine.paint's dirty marking.
 */

import type { LGraphCanvas, LLink } from '@comfyorg/litegraph'
import { COLOR_ERROR } from '../core/engine'
import type { Engine } from '../core/engine'

/** Selection accent — matches the selection halo (NODE_BOX_OUTLINE_COLOR). */
const COLOR_SELECTED = '#a16207'

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
    if (isHighlighted(link)) {
      args[6] = COLOR_SELECTED
      return original(...args)
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

  /** Selected-node link — the library checks this before forcing #FFF. */
  function isHighlighted(link: unknown): boolean {
    if (link === null || typeof link !== 'object' || !('id' in link)) return false
    const highlights = (canvas as unknown as { highlighted_links?: Record<number, unknown> }).highlighted_links
    return Boolean(highlights?.[(link as LLink).id as number])
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
