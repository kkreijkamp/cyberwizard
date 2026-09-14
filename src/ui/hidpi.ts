/**
 * HiDPI / browser-zoom fix for LiteGraph 0.17.2.
 *
 * The library's resize() sizes the canvas backing store in CSS pixels, but
 * its draw pipeline assumes the store is scaled by devicePixelRatio: the
 * background is painted under a DPR base transform and blitted at
 * `bgcanvas.width / DPR`, and centerOnNode divides canvas.width by DPR. At
 * DPR = 1 everything coincidentally lines up; at any browser zoom (or a
 * non-1x display) the background renders shrunk into a corner or overflows
 * and clips, and node centering lands off-target.
 *
 * The patch: resize() sizes both the front canvas and the background canvas
 * in device pixels, and establishes the matching DPR base transform on the
 * front context. That transform persists: every per-frame transform in the
 * draw loop is save/restore-balanced, and the ctx.start2D hook that would
 * reset it doesn't exist in this build. With store and transform both in
 * device pixels, the pipeline's DPR assumptions all hold (and rendering is
 * retina-crisp as a side effect).
 *
 * DPR changes usually come with a window resize (browser zoom), which
 * autoresize already routes here; moving the window between displays with
 * different pixel ratios does not, so a matchMedia watcher re-applies.
 */

import type { LGraphCanvas } from '@comfyorg/litegraph'

export function installHiDPICanvas(canvas: LGraphCanvas): void {
  const element = canvas.canvas
  let appliedDpr = 0

  canvas.resize = ((width?: number, height?: number) => {
    const parent = element.parentElement
    const cssW = width ?? parent?.offsetWidth ?? element.width
    const cssH = height ?? parent?.offsetHeight ?? element.height
    const dpr = globalThis.devicePixelRatio || 1
    const w = Math.max(1, Math.round(cssW * dpr))
    const h = Math.max(1, Math.round(cssH * dpr))
    // Browser zoom can leave the device-pixel size unchanged (CSS size and
    // DPR move inversely): the transform must still be reapplied.
    if (element.width === w && element.height === h && appliedDpr === dpr) return
    element.width = w
    element.height = h
    canvas.bgcanvas.width = w
    canvas.bgcanvas.height = h
    appliedDpr = dpr
    canvas.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    canvas.setDirty(true, true)
  }) as LGraphCanvas['resize']

  canvas.resize()

  const watchDpr = (): void => {
    if (typeof globalThis.matchMedia !== 'function') return
    const query = globalThis.matchMedia(`(resolution: ${globalThis.devicePixelRatio || 1}dppx)`)
    query.addEventListener(
      'change',
      () => {
        canvas.resize()
        watchDpr()
      },
      { once: true },
    )
  }
  watchDpr()
}
