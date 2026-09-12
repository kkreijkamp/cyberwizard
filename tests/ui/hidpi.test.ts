import type { LGraphCanvas } from '@comfyorg/litegraph'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { installHiDPICanvas } from '../../src/ui/hidpi'

/** Structural stand-in for the bits of LGraphCanvas the patch touches. */
function fakeCanvas(cssW: number, cssH: number) {
  const element = {
    width: 0,
    height: 0,
    parentElement: { offsetWidth: cssW, offsetHeight: cssH },
  }
  return {
    canvas: element,
    bgcanvas: { width: 0, height: 0 },
    ctx: { setTransform: vi.fn() },
    setDirty: vi.fn(),
    resize: undefined as unknown as LGraphCanvas['resize'],
  }
}

function setDpr(value: number | undefined): void {
  const g = globalThis as Record<string, unknown>
  if (value === undefined) delete g.devicePixelRatio
  else g.devicePixelRatio = value
}

afterEach(() => setDpr(undefined))

describe('hidpi canvas', () => {
  it('sizes the backing store in device pixels', () => {
    setDpr(2)
    const c = fakeCanvas(800, 600)
    installHiDPICanvas(c as unknown as LGraphCanvas)
    expect(c.canvas.width).toBe(1600)
    expect(c.canvas.height).toBe(1200)
    expect(c.bgcanvas.width).toBe(1600)
    expect(c.bgcanvas.height).toBe(1200)
    expect(c.ctx.setTransform).toHaveBeenCalledWith(2, 0, 0, 2, 0, 0)
    expect(c.setDirty).toHaveBeenCalledWith(true, true)
  })

  it('defaults to 1x when devicePixelRatio is unavailable', () => {
    setDpr(undefined)
    const c = fakeCanvas(800, 600)
    installHiDPICanvas(c as unknown as LGraphCanvas)
    expect(c.canvas.width).toBe(800)
    expect(c.canvas.height).toBe(600)
    expect(c.ctx.setTransform).toHaveBeenCalledWith(1, 0, 0, 1, 0, 0)
  })

  it('reapplies the transform when only the DPR changes', () => {
    setDpr(1)
    const c = fakeCanvas(800, 600)
    installHiDPICanvas(c as unknown as LGraphCanvas)

    // Zoom such that CSS size and DPR move inversely: same device-pixel size.
    setDpr(2)
    c.canvas.parentElement = { offsetWidth: 400, offsetHeight: 300 }
    c.ctx.setTransform.mockClear()
    c.setDirty.mockClear()
    c.resize()

    expect(c.canvas.width).toBe(800) // unchanged device size…
    expect(c.ctx.setTransform).toHaveBeenCalledWith(2, 0, 0, 2, 0, 0) // …transform reapplied
    expect(c.setDirty).toHaveBeenCalledWith(true, true)
  })

  it('is a no-op when neither size nor DPR changed', () => {
    setDpr(1)
    const c = fakeCanvas(800, 600)
    installHiDPICanvas(c as unknown as LGraphCanvas)
    c.setDirty.mockClear()
    c.resize()
    expect(c.setDirty).not.toHaveBeenCalled()
  })
})
