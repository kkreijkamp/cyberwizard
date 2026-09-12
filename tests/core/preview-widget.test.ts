import { describe, expect, it } from 'vitest'
import { fitPreviewLine } from '../../src/core/preview-widget'

/** Deterministic fake: every character is 10px wide. */
const ctx = {
  measureText: (s: string) => ({ width: s.length * 10 }),
} as unknown as CanvasRenderingContext2D

describe('fitPreviewLine', () => {
  it('passes lines that fit through unchanged', () => {
    expect(fitPreviewLine(ctx, 'abc', 40)).toBe('abc')
    expect(fitPreviewLine(ctx, 'abc', 30)).toBe('abc')
  })

  it('ellipsizes to the widest prefix that fits with the ellipsis', () => {
    // maxWidth 40: ellipsis (10) + 3 chars (30) = 40 exactly.
    expect(fitPreviewLine(ctx, 'abcdefgh', 40)).toBe('abc…')
    // maxWidth 25: only 1 char + ellipsis fits (2×10 + 10 = 30 > 25).
    expect(fitPreviewLine(ctx, 'abcdefgh', 25)).toBe('a…')
  })
})
