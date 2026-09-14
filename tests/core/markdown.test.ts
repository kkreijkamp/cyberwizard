import { describe, expect, it } from 'vitest'
import { layoutMarkdown } from '../../src/core/markdown'
import type { Measure, PositionedSpan } from '../../src/core/markdown'

/** Deterministic fake: every character is 10px wide, whatever the style. */
const measure: Measure = (text) => text.length * 10

const texts = (spans: readonly PositionedSpan[]): string[] => spans.map((s) => s.text)

describe('layoutMarkdown: blocks', () => {
  it('renders a paragraph line as plain spans', () => {
    const { spans, height } = layoutMarkdown('hello', 500, measure)
    expect(texts(spans)).toEqual(['hello'])
    expect(spans[0]!.style.bold).toBe(false)
    // One 13px line: lh = 18.
    expect(height).toBe(18)
  })

  it('wraps paragraphs greedily at the width', () => {
    // 'aaaa '(50) fits 65; +'bbbb' → 90 > 65 → break.
    const { spans, height } = layoutMarkdown('aaaa bbbb cccc', 65, measure)
    expect(texts(spans)).toEqual(['aaaa', 'bbbb', 'cccc'])
    expect(spans[0]!.y).not.toBe(spans[1]!.y)
    expect(height).toBe(54)
  })

  it('splits words longer than a full line', () => {
    const { spans } = layoutMarkdown('abcdefghij', 40, measure)
    expect(texts(spans)).toEqual(['abcd', 'efgh', 'ij'])
  })

  it('sizes headings and marks them bold', () => {
    const h1 = layoutMarkdown('# Title', 500, measure)
    expect(h1.spans[0]!.text).toBe('Title')
    expect(h1.spans[0]!.style.bold).toBe(true)
    expect(h1.spans[0]!.style.size).toBe(17)
    const h3 = layoutMarkdown('### Sub', 500, measure)
    expect(h3.spans[0]!.style.size).toBe(13)
    // '#' alone is not a heading.
    expect(layoutMarkdown('#nope', 500, measure).spans[0]!.style.bold).toBe(false)
  })

  it('renders bullets and ordered items with hanging markers', () => {
    const bullet = layoutMarkdown('- item', 500, measure)
    expect(texts(bullet.spans)).toEqual(['•', 'item'])
    expect(bullet.spans[1]!.x).toBeGreaterThan(0)
    const ordered = layoutMarkdown('3. item', 500, measure)
    expect(texts(ordered.spans)).toEqual(['3.', 'item'])
  })

  it('collects quote bars and horizontal rules as decorations', () => {
    const quote = layoutMarkdown('> wise words', 500, measure)
    expect(quote.decorations).toHaveLength(1)
    expect(quote.decorations[0]!.kind).toBe('quote-bar')
    expect(quote.spans[0]!.x).toBeGreaterThan(quote.decorations[0]!.rect.w)
    const hr = layoutMarkdown('---', 500, measure)
    expect(hr.decorations[0]!.kind).toBe('hr')
    expect(hr.spans).toHaveLength(0)
  })

  it('keeps fenced code verbatim under one shared background', () => {
    const { spans, decorations } = layoutMarkdown('```\nx **not bold** y\nz\n```', 500, measure)
    expect(texts(spans)).toEqual(['x', '**not', 'bold**', 'y', 'z'])
    expect(spans.every((s) => s.style.code)).toBe(true)
    expect(spans.every((s) => !s.style.bold)).toBe(true)
    const bgs = decorations.filter((d) => d.kind === 'code-bg')
    expect(bgs).toHaveLength(1)
    expect(bgs[0]!.rect.h).toBe(2 * (Math.round(12 * 1.4) + 6)) // two lines (lh + y-pad) share one rect
  })

  it('treats blank lines as gaps and collapses runs of them', () => {
    const one = layoutMarkdown('a\n\nb', 500, measure)
    const many = layoutMarkdown('a\n\n\n\nb', 500, measure)
    expect(one.height).toBe(many.height)
    expect(many.spans[1]!.y - many.spans[0]!.y).toBeGreaterThan(18)
  })

  it('each source line is its own rendered line (soft breaks)', () => {
    const { spans } = layoutMarkdown('a\nb', 500, measure)
    expect(spans[0]!.y).not.toBe(spans[1]!.y)
  })
})

describe('layoutMarkdown: inline', () => {
  it('parses bold, italic, code and strike', () => {
    const { spans } = layoutMarkdown('a **b** *c* `d` ~~e~~', 500, measure)
    const byText = Object.fromEntries(spans.map((s) => [s.text, s.style]))
    expect(byText['a']!.bold).toBe(false)
    expect(byText['b']!.bold).toBe(true)
    expect(byText['c']!.italic).toBe(true)
    expect(byText['d']!.code).toBe(true)
    expect(byText['e']!.strike).toBe(true)
  })

  it('nests italic inside bold', () => {
    const { spans } = layoutMarkdown('**a *b* c**', 500, measure)
    const b = spans.find((s) => s.text === 'b')!
    expect(b.style.bold).toBe(true)
    expect(b.style.italic).toBe(true)
  })

  it('leaves unmatched delimiters literal', () => {
    const { spans } = layoutMarkdown('a **b', 500, measure)
    expect(texts(spans).join(' ')).toBe('a **b')
  })

  it('collects link rects for click-through', () => {
    const { spans, links } = layoutMarkdown('see [the docs](https://example.com) now', 500, measure)
    const link = spans.find((s) => s.text === 'the')!
    expect(link.style.link).toBe('https://example.com')
    expect(links).toHaveLength(2) // 'the' and 'docs' are separate words
    expect(links[0]!.url).toBe('https://example.com')
    expect(links[0]!.rect.x).toBe(link.x)
  })
})
