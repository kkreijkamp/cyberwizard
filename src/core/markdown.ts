/**
 * Markdown layout for the note widget: a small, deliberate subset of
 * markdown compiled to positioned, styled text spans for canvas drawing.
 *
 * Pure and DOM-free — the width measurer is injected, so tests drive it
 * with a fixed-width fake (tests/core/markdown.test.ts) and the widget
 * with an offscreen canvas context (core/note-widget.ts). Line breaks are
 * GitHub-style: every source line is its own block, a blank line is a gap.
 *
 * Supported:
 *  - blocks: `#`/`##`/`###` headings, `-`/`*`/`+` bullets, `1.` ordered,
 *    `>` quotes (left bar), ``` fenced code (verbatim, tinted background),
 *    `---`/`***`/`___` rules, paragraphs (word-wrapped)
 *  - inline: `**bold**`, `*italic*` / `_em_`, `` `code` ``, `~~strike~~`,
 *    `[text](url)` (link rects collected for click-through)
 */

export interface TextStyle {
  readonly bold: boolean
  readonly italic: boolean
  readonly code: boolean
  /** Code span from a fenced block (verbatim, block background) rather than inline. */
  readonly fence: boolean
  readonly strike: boolean
  readonly link: string | undefined
  /** Font size in px — drives both the font string and the line height. */
  readonly size: number
}

export interface PositionedSpan {
  readonly x: number
  /** Baseline y, relative to the content box's top. */
  readonly y: number
  readonly text: string
  /** Measured width — the widget needs it for underlines/strikes. */
  readonly w: number
  readonly style: TextStyle
}

export interface Rect {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
}

export interface Decoration {
  readonly kind: 'code-bg' | 'quote-bar' | 'hr'
  readonly rect: Rect
}

export interface LinkRect {
  readonly rect: Rect
  readonly url: string
}

export interface MarkdownLayout {
  readonly spans: readonly PositionedSpan[]
  readonly decorations: readonly Decoration[]
  readonly links: readonly LinkRect[]
  /** Total content height in px. */
  readonly height: number
}

export type Measure = (text: string, style: TextStyle) => number

// ─── Block parsing ───────────────────────────────────────────────────────────

type BlockKind = 'p' | 'h1' | 'h2' | 'h3' | 'li' | 'quote' | 'code' | 'hr' | 'blank'

interface Block {
  readonly kind: BlockKind
  readonly text: string
  /** List marker ('•' or '3.'), emitted at the block's left edge. */
  readonly marker?: string
}

const BASE_SIZE = 13

function blockSize(kind: BlockKind): number {
  switch (kind) {
    case 'h1': return 17
    case 'h2': return 15
    case 'code': return 12
    default: return BASE_SIZE
  }
}

function lineHeight(kind: BlockKind): number {
  return Math.round(blockSize(kind) * 1.4)
}

function parseBlocks(source: string): Block[] {
  const blocks: Block[] = []
  let inFence = false
  for (const line of source.split('\n')) {
    if (line.trimStart().startsWith('```')) {
      inFence = !inFence
      continue
    }
    if (inFence) {
      blocks.push({ kind: 'code', text: line.replace(/\s+$/, '') })
      continue
    }
    let m: RegExpExecArray | null
    if (/^\s*$/.test(line)) {
      blocks.push({ kind: 'blank', text: '' })
    } else if ((m = /^\s{0,3}(#{1,3})\s+(.*)$/.exec(line))) {
      blocks.push({ kind: `h${m[1]!.length}` as BlockKind, text: m[2]! })
    } else if (/^\s{0,3}(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      blocks.push({ kind: 'hr', text: '' })
    } else if ((m = /^\s{0,3}>\s?(.*)$/.exec(line))) {
      blocks.push({ kind: 'quote', text: m[1]! })
    } else if ((m = /^\s{0,3}[-*+]\s+(.*)$/.exec(line))) {
      blocks.push({ kind: 'li', text: m[1]!, marker: '•' })
    } else if ((m = /^\s{0,3}(\d{1,9})[.)]\s+(.*)$/.exec(line))) {
      blocks.push({ kind: 'li', text: m[2]!, marker: `${m[1]}.` })
    } else {
      blocks.push({ kind: 'p', text: line.trim() })
    }
  }
  // Collapse runs of blanks into one; drop leading/trailing blanks.
  const out: Block[] = []
  for (const block of blocks) {
    if (block.kind === 'blank' && out[out.length - 1]?.kind === 'blank') continue
    out.push(block)
  }
  while (out[0]?.kind === 'blank') out.shift()
  while (out[out.length - 1]?.kind === 'blank') out.pop()
  return out
}

// ─── Inline parsing ──────────────────────────────────────────────────────────

interface Segment {
  readonly text: string
  readonly style: TextStyle
}

/**
 * Recursive descent on the nearest closing delimiter. Unmatched delimiters
 * stay literal text; code spans are verbatim (no further parsing inside).
 */
function parseInline(text: string, style: TextStyle, out: Segment[]): void {
  let buf = ''
  const flush = (): void => {
    if (buf !== '') out.push({ text: buf, style })
    buf = ''
  }
  let i = 0
  while (i < text.length) {
    const rest = text.slice(i)
    if (rest.startsWith('**')) {
      const close = text.indexOf('**', i + 2)
      if (close > i + 2) {
        flush()
        parseInline(text.slice(i + 2, close), { ...style, bold: true }, out)
        i = close + 2
        continue
      }
    }
    if (rest.startsWith('~~')) {
      const close = text.indexOf('~~', i + 2)
      if (close > i + 2) {
        flush()
        parseInline(text.slice(i + 2, close), { ...style, strike: true }, out)
        i = close + 2
        continue
      }
    }
    const ch = text[i]!
    if (ch === '`') {
      const close = text.indexOf('`', i + 1)
      if (close > i + 1) {
        flush()
        out.push({ text: text.slice(i + 1, close), style: { ...style, code: true } })
        i = close + 1
        continue
      }
    }
    if (ch === '*' || ch === '_') {
      const close = text.indexOf(ch, i + 1)
      if (close > i + 1) {
        flush()
        parseInline(text.slice(i + 1, close), { ...style, italic: true }, out)
        i = close + 1
        continue
      }
    }
    if (ch === '[') {
      const m = /^\[([^\]]*)\]\(([^)\s]+)\)/.exec(rest)
      if (m) {
        flush()
        parseInline(m[1]!, { ...style, link: m[2] }, out)
        i += m[0].length
        continue
      }
    }
    buf += ch
    i++
  }
  flush()
}

// ─── Wrapping ────────────────────────────────────────────────────────────────

interface Word {
  readonly text: string
  readonly style: TextStyle
  readonly width: number
  /** Whitespace token — kept for spacing, dropped at line edges. */
  readonly space: boolean
}

function wordsOf(segments: readonly Segment[], measure: Measure): Word[] {
  const words: Word[] = []
  for (const seg of segments) {
    for (const token of seg.text.split(/(\s+)/)) {
      if (token === '') continue
      const space = /^\s+$/.test(token)
      words.push({ text: space ? ' ' : token, style: seg.style, width: measure(space ? ' ' : token, seg.style), space })
    }
  }
  return words
}

/** Splits a word longer than a full line into chunks that fit. */
function splitLongWord(word: Word, maxWidth: number, measure: Measure): Word[] {
  const chunks: Word[] = []
  let current = ''
  let width = 0
  for (const ch of word.text) {
    const cw = measure(ch, word.style)
    if (current !== '' && width + cw > maxWidth) {
      chunks.push({ text: current, style: word.style, width, space: false })
      current = ''
      width = 0
    }
    current += ch
    width += cw
  }
  if (current !== '') chunks.push({ text: current, style: word.style, width, space: false })
  return chunks
}

/** Greedy word-wrap; spaces attach to the preceding word or vanish at line edges. */
function wrapWords(words: readonly Word[], maxWidth: number, measure: Measure): Word[][] {
  const lines: Word[][] = []
  let line: Word[] = []
  let lineWidth = 0
  const pushLine = (): void => {
    if (line.length > 0) lines.push(line)
    line = []
    lineWidth = 0
  }
  for (const word of words) {
    if (word.space) {
      if (line.length > 0 && lineWidth + word.width <= maxWidth) {
        line.push(word)
        lineWidth += word.width
      }
      continue
    }
    if (line.length > 0 && lineWidth + word.width > maxWidth) pushLine()
    if (word.width > maxWidth) {
      const chunks = splitLongWord(word, maxWidth, measure)
      for (const chunk of chunks.slice(0, -1)) {
        line.push(chunk)
        pushLine()
      }
      const last = chunks[chunks.length - 1]
      if (last) {
        line.push(last)
        lineWidth = last.width
      }
      continue
    }
    line.push(word)
    lineWidth += word.width
  }
  pushLine()
  return lines
}

// ─── Layout ──────────────────────────────────────────────────────────────────

const QUOTE_BAR_W = 3
const QUOTE_PAD = 8
const CODE_PAD_X = 6
const CODE_PAD_Y = 3
const BLANK_GAP = 8
const HR_SLOT = 10
const HEADING_MARGIN: Partial<Record<BlockKind, number>> = { h1: 8, h2: 7, h3: 6 }

export function layoutMarkdown(source: string, maxWidth: number, measure: Measure): MarkdownLayout {
  const spans: PositionedSpan[] = []
  const decorations: Decoration[] = []
  const links: LinkRect[] = []
  let y = 0

  const emitLine = (words: readonly Word[], x: number, baseline: number, lh: number): void => {
    let cursor = x
    for (const word of words) {
      if (!word.space) {
        spans.push({ x: cursor, y: baseline, text: word.text, w: word.width, style: word.style })
        if (word.style.link !== undefined) {
          links.push({ rect: { x: cursor, y: baseline - word.style.size, w: word.width, h: lh }, url: word.style.link })
        }
      }
      cursor += word.width
    }
  }

  const blocks = parseBlocks(source)
  let inCodeRun = false
  for (const [index, block] of blocks.entries()) {
    if (block.kind === 'blank') {
      y += BLANK_GAP
      inCodeRun = false
      continue
    }
    if (block.kind === 'hr') {
      decorations.push({ kind: 'hr', rect: { x: 0, y: y + HR_SLOT / 2, w: maxWidth, h: 1 } })
      y += HR_SLOT
      inCodeRun = false
      continue
    }
    // Headings breathe a little above (except at the very top).
    const margin = index > 0 ? (HEADING_MARGIN[block.kind] ?? 0) : 0
    y += margin

    const size = blockSize(block.kind)
    const lh = lineHeight(block.kind)
    const base: TextStyle = {
      bold: block.kind === 'h1' || block.kind === 'h2' || block.kind === 'h3',
      italic: false,
      code: block.kind === 'code',
      fence: block.kind === 'code',
      strike: false,
      link: undefined,
      size,
    }

    // Indent: code and quote shift text right; list markers hang at the left.
    let textX = 0
    if (block.kind === 'code') textX = CODE_PAD_X
    if (block.kind === 'quote') textX = QUOTE_BAR_W + QUOTE_PAD
    let marker: Word | undefined
    if (block.marker !== undefined) {
      marker = { text: block.marker, style: base, width: measure(`${block.marker} `, base), space: false }
      textX = marker.width
    }

    const segments = block.kind === 'code'
      ? [{ text: block.text, style: base }]
      : (() => { const segs: Segment[] = []; parseInline(block.text, base, segs); return segs })()
    const lines = wrapWords(wordsOf(segments, measure), maxWidth - textX, measure)

    // Decorations span the whole block, so they're emitted once its height is
    // known — quote bar behind the text, code background behind the run.
    const blockHeight = (lines.length === 0 ? 1 : lines.length) * lh + (block.kind === 'code' ? CODE_PAD_Y * 2 : 0)
    if (block.kind === 'quote') {
      decorations.push({ kind: 'quote-bar', rect: { x: 0, y, w: QUOTE_BAR_W, h: blockHeight } })
    }
    if (block.kind === 'code') {
      // Adjacent code lines share one background — extend the previous rect.
      const prev = decorations[decorations.length - 1]
      if (inCodeRun && prev?.kind === 'code-bg' && prev.rect.y + prev.rect.h === y) {
        decorations[decorations.length - 1] = { ...prev, rect: { ...prev.rect, h: prev.rect.h + blockHeight } }
      } else {
        decorations.push({ kind: 'code-bg', rect: { x: 0, y, w: maxWidth, h: blockHeight } })
      }
    }

    if (lines.length === 0) {
      y += blockHeight
      inCodeRun = block.kind === 'code'
      continue
    }
    if (marker !== undefined) emitLine([marker], 0, y + Math.round(size * 0.8) + (block.kind === 'code' ? CODE_PAD_Y : 0), lh)
    for (const [lineIndex, line] of lines.entries()) {
      const baseline = y + (block.kind === 'code' ? CODE_PAD_Y : 0) + lineIndex * lh + Math.round(size * 0.8)
      emitLine(line, textX, baseline, lh)
    }
    y += blockHeight
    inCodeRun = block.kind === 'code'
  }

  return { spans, decorations, links, height: y }
}
