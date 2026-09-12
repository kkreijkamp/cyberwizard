/**
 * Link styles: a connection carrying no value renders dashed and dimmed —
 * its origin node hasn't executed (undemanded, dirty, blocked, or errored),
 * so nothing flows on that wire. Solid means a produced value sits there.
 *
 * Implemented as a canvas.renderLink wrapper (the one per-link choke point);
 * state changes reach the canvas through Engine.paint's dirty marking.
 */

import type { LGraphCanvas, LLink } from '@comfyorg/litegraph'
import type { Engine } from '../core/engine'

export function installLinkStyles(canvas: LGraphCanvas, engine: Engine): void {
  type RenderLinkParams = Parameters<LGraphCanvas['renderLink']>
  const original = canvas.renderLink.bind(canvas) as (...args: RenderLinkParams) => void

  canvas.renderLink = function renderLink(this: LGraphCanvas, ...args: RenderLinkParams) {
    const [ctx, , , link] = args
    if (!isDormant(link)) return original(...args)
    ctx.save()
    ctx.setLineDash([6, 6])
    ctx.globalAlpha *= 0.55
    try {
      return original(...args)
    } finally {
      ctx.restore()
    }
  } as LGraphCanvas['renderLink']

  /** No cached outputs at the origin — nothing flows on this wire. */
  function isDormant(link: unknown): boolean {
    if (link === null || typeof link !== 'object' || !('origin_id' in link)) return false
    const origin = canvas.graph?.getNodeById((link as LLink).origin_id)
    return origin != null && !engine.hasOutputs(origin)
  }
}
