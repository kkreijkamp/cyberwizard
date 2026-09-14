/**
 * Link styles, by what flows on the wire:
 *  - origin failing (its own error or blocked by one): rust red, dashed:
 *    the failure shows up along the whole downstream path, not just on nodes.
 *  - origin never executed (undemanded, dirty): dashed and dimmed warm grey.
 *  - origin produced a value: solid.
 * Links of the selected node render amber: the library highlights them in
 * hardcoded bright white (#FFF), illegible on the paper background.
 *
 * Implemented as a canvas.renderLink wrapper (the one per-link choke point);
 * state changes reach the canvas through Engine.paint's dirty marking.
 */

import type { LGraphCanvas, LLink } from '@comfyorg/litegraph'
import { COLOR_ERROR } from '../core/engine'
import type { Engine } from '../core/engine'

/** Selection indigo: distinct from the amber UI accents and the rust errors. */
const COLOR_SELECTED = '#3a5580'

export function installLinkStyles(canvas: LGraphCanvas, engine: Engine): void {
  type RenderLinkParams = Parameters<LGraphCanvas['renderLink']>
  const original = canvas.renderLink.bind(canvas) as (...args: RenderLinkParams) => void

  canvas.renderLink = function renderLink(this: LGraphCanvas, ...args: RenderLinkParams) {
    const [ctx, a, b, link] = args
    tameSplineControls(args, a, b)
    const origin = originOf(link)
    if (!origin) return original(...args)

    // renderLink checks highlighted_links BEFORE the colour argument and
    // forces #FFF: hide the entry for the duration of the (synchronous)
    // call so our colour actually lands. State (dash/dim) composes on top:
    // selection tints, it never erases the dotted "no value" signal.
    const highlights = highlightedLinks()
    const id = linkIdOf(link)
    const highlighted = id !== undefined && highlights !== undefined && id in highlights
    if (highlighted) delete highlights[id]
    try {
      if (engine.hasFailure(origin)) {
        args[6] = COLOR_ERROR
        return stroked(ctx, 1, () => original(...args))
      }
      if (highlighted) args[6] = COLOR_SELECTED
      if (!engine.hasOutputs(origin)) {
        return stroked(ctx, 0.55, () => original(...args))
      }
      return original(...args)
    } finally {
      if (highlighted && highlights) highlights[id] = true
    }
  } as LGraphCanvas['renderLink']

  function originOf(link: unknown): Parameters<Engine['hasOutputs']>[0] | undefined {
    if (link === null || typeof link !== 'object' || !('origin_id' in link)) return undefined
    return canvas.graph?.getNodeById((link as LLink).origin_id) ?? undefined
  }

  function highlightedLinks(): Record<number, unknown> | undefined {
    return (canvas as unknown as { highlighted_links?: Record<number, unknown> }).highlighted_links
  }

  function linkIdOf(link: unknown): number | undefined {
    if (link === null || typeof link !== 'object' || !('id' in link)) return undefined
    return (link as LLink).id as number
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

// ─── Spline taming ───────────────────────────────────────────────────────────

/**
 * The library's bezier control points sit at dist × 0.25 from each end,
 * uncapped: long links sweep far out, and links whose target is BEHIND the
 * source hook back on themselves in a big loop. We pass our own control
 * points (renderLink's startControl/endControl option): a smaller factor, a
 * hard cap, and a tighter cap when the target is behind: the curve stays a
 * gentle S that never swings back past itself.
 */
const SPLINE_FACTOR = 0.18
const SPLINE_MIN = 18
const SPLINE_MAX = 64
const SPLINE_MAX_BEHIND = 36

/** LinkDirection values in 0.17.2 (UP=1, DOWN=2, LEFT=3, RIGHT=4). */
function dirVector(direction: number, amount: number): [number, number] {
  switch (direction) {
    case 3: return [-amount, 0]
    case 1: return [0, -amount]
    case 2: return [0, amount]
    default: return [amount, 0] // RIGHT (4) and anything else
  }
}

type RenderLinkArgs = Parameters<LGraphCanvas['renderLink']>

function tameSplineControls(
  args: RenderLinkArgs,
  a: RenderLinkArgs[1],
  b: RenderLinkArgs[2],
): void {
  const options = (args[9] ??= {})
  if (options.startControl && options.endControl) return // explicit controls win

  const startDir = (args[7] ?? 4) as number // default RIGHT, like renderLink
  const endDir = (args[8] ?? 3) as number // default LEFT
  const dx = (b[0] ?? 0) - (a[0] ?? 0)
  const dy = (b[1] ?? 0) - (a[1] ?? 0)
  const dist = Math.hypot(dx, dy)
  let sweep = Math.min(Math.max(dist * SPLINE_FACTOR, SPLINE_MIN), SPLINE_MAX)

  // Target behind the source (against the start direction): clamp the loop.
  const [ux, uy] = dirVector(startDir, 1)
  if (dx * ux + dy * uy < 0) sweep = Math.min(sweep, SPLINE_MAX_BEHIND)

  options.startControl ??= dirVector(startDir, sweep)
  options.endControl ??= dirVector(endDir, sweep)
}
