/**
 * The note body widget: the whole node body as a rendered markdown document.
 * Clicking opens the in-place editor (ui/notes); links open in a new tab.
 *
 * Follows the preview well's pattern (core/preview-widget): a legacy custom
 * widget with computeSize/draw/mouse hooks. The markdown source lives in the
 * hidden `text` param (so it serializes as an ordinary param), the chosen
 * color in the hidden `tint` param — applied here, lazily at draw time, so
 * restored documents recolor themselves with no serializer involvement.
 */

import type { LGraphNode } from '@comfyorg/litegraph'
import { layoutMarkdown } from './markdown'
import type { MarkdownLayout, TextStyle } from './markdown'
import { categoryColors } from './registry'
import type { CustomWidgetParam } from './preview-widget'

/** Keep in sync with --serif/--mono in ui/app.css and SERIF in ui/theme. */
const SERIF = "'Iowan Old Style', 'Palatino Linotype', 'Book Antiqua', 'Source Serif 4', Georgia, serif"
const MONO = "ui-monospace, 'SF Mono', 'Cascadia Code', Menlo, Consolas, monospace"

const INK = '#2b2620'
const INK_SOFT = '#8a7f6a'
const LINK = '#3a5580'
const TINT_BG = 'rgba(80, 66, 53, 0.07)'
const FRAME = '#b4aba0'

const PAD_X = 10
const PAD_Y = 8

export const NOTE_TEXT_PARAM = 'text'
export const NOTE_TINT_PARAM = 'tint'
export const NOTE_TYPE = 'notes/note'

/** Rendered in place of an empty note — doubles as the markdown cheat sheet. */
const PLACEHOLDER = '_Click to write… markdown: **bold**, *italic*, `code`, lists, quotes, links._'

/** Click bridge (core → ui): ui/notes registers the editor at startup. */
let clickHandler: ((node: LGraphNode) => void) | undefined

export function setNoteClickHandler(handler: ((node: LGraphNode) => void) | undefined): void {
  clickHandler = handler
}

export function fontFor(style: TextStyle): string {
  const italic = style.italic ? 'italic ' : ''
  const bold = style.bold ? 'bold ' : ''
  return `${italic}${bold}${style.size}px ${style.code ? MONO : SERIF}`
}

/** Character-width approximation for headless runs (tests) — never used in the browser. */
function approximateMeasure(text: string, style: TextStyle): number {
  return text.length * style.size * (style.code ? 0.62 : 0.5)
}

let measureCtx: CanvasRenderingContext2D | null | undefined

function measure(text: string, style: TextStyle): number {
  if (measureCtx === undefined) {
    measureCtx = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d')
  }
  if (!measureCtx) return approximateMeasure(text, style)
  measureCtx.font = fontFor(style)
  return measureCtx.measureText(text).width
}

interface NoteWidgetShape {
  name: string
  value: string
  /** Written by litegraph's widget layout: the widget's top edge in node space. */
  y?: number
  cache: { text?: string; width: number; layout?: MarkdownLayout }
  appliedTint?: string
  /** The laid-out markdown for the current text at the given node width (cached). */
  layoutFor(width: number): MarkdownLayout
  computeSize(width: number): [number, number]
  draw(ctx: CanvasRenderingContext2D, node: LGraphNode, width: number, y: number, height: number): void
  mouse(event: { type?: string }, offset: [number, number], node: LGraphNode): boolean
}

export function makeNoteWidget(node: LGraphNode): CustomWidgetParam {
  const widget: NoteWidgetShape = {
    name: 'note',
    value: '',
    cache: { width: -1 },

    layoutFor(width: number): MarkdownLayout {
      const raw = String(node.properties[NOTE_TEXT_PARAM] ?? '')
      const text = raw === '' ? PLACEHOLDER : raw
      const inner = Math.max(40, width - PAD_X * 2)
      if (widget.cache.text !== text || widget.cache.width !== inner) {
        widget.cache = { text, width: inner, layout: layoutMarkdown(text, inner, measure) }
      }
      return widget.cache.layout as MarkdownLayout
    },

    computeSize(width) {
      return [width, PAD_Y * 2 + widget.layoutFor(width).height]
    },

    draw(ctx, drawNode, width, y) {
      // Lazy tint apply: covers construction, the Color menu (setParam), and
      // document restore, none of which pass through here directly.
      const tint = String(drawNode.properties[NOTE_TINT_PARAM] ?? 'Notes')
      if (tint !== widget.appliedTint) {
        const palette = categoryColors(tint)
        drawNode.color = palette.color
        drawNode.bgcolor = palette.bgcolor
        widget.appliedTint = tint
      }

      const layout = widget.layoutFor(width)
      const placeholder = String(drawNode.properties[NOTE_TEXT_PARAM] ?? '') === ''

      ctx.save()
      ctx.beginPath()
      ctx.rect(0, y, width, PAD_Y * 2 + layout.height)
      ctx.clip()
      ctx.translate(PAD_X, y + PAD_Y)

      for (const deco of layout.decorations) {
        ctx.fillStyle = deco.kind === 'code-bg' ? TINT_BG : FRAME
        if (deco.kind === 'code-bg') {
          ctx.beginPath()
          ctx.roundRect(deco.rect.x - 2, deco.rect.y, deco.rect.w + 4, deco.rect.h, 3)
          ctx.fill()
        } else {
          ctx.fillRect(deco.rect.x, deco.rect.y, deco.rect.w, deco.rect.h)
        }
      }

      ctx.textAlign = 'left'
      ctx.textBaseline = 'alphabetic'
      for (const span of layout.spans) {
        ctx.font = fontFor(span.style)
        const color = span.style.link !== undefined ? LINK : placeholder ? INK_SOFT : INK
        // Inline-code chip (fenced blocks already share a background).
        if (span.style.code && !span.style.fence) {
          ctx.fillStyle = TINT_BG
          ctx.beginPath()
          ctx.roundRect(span.x - 1.5, span.y - span.style.size, span.w + 3, span.style.size + 4, 2)
          ctx.fill()
        }
        ctx.fillStyle = color
        ctx.fillText(span.text, span.x, span.y)
        if (span.style.link !== undefined) {
          ctx.fillRect(span.x, span.y + 2, span.w, 1)
        }
        if (span.style.strike) {
          ctx.fillRect(span.x, span.y - Math.round(span.style.size * 0.3), span.w, 1)
        }
      }
      ctx.restore()
    },

    mouse(event, offset, hitNode) {
      const type = event.type ?? ''
      if (type !== 'pointerdown' && type !== 'mousedown' && type !== 'click') return false

      // Links win over edit: hit-test in layout space (node-local → widget-local).
      const localX = offset[0] - PAD_X
      const localY = offset[1] - (widget.y ?? 0) - PAD_Y
      const { links } = widget.layoutFor(hitNode.size[0])
      for (const { rect, url } of links) {
        if (localX >= rect.x && localX <= rect.x + rect.w && localY >= rect.y && localY <= rect.y + rect.h) {
          if (/^(https?:|mailto:)/i.test(url)) window.open(url, '_blank', 'noopener,noreferrer')
          return true
        }
      }
      clickHandler?.(hitNode)
      return true
    },
  }
  return widget as unknown as CustomWidgetParam
}
