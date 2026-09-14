/**
 * The output preview widget: an inset "well" at the foot of every node,
 * showing the engine's compact repr of the node's outputs (or the Preview
 * sink's input). Clicking opens the inspect overlay with the full value.
 *
 * Implemented as a legacy custom widget (draw + mouse hooks): the library's
 * own TextWidget opens an *edit* prompt on click, which is wrong for a
 * read-only display. Engine.paint finds it by name and rewrites `value`.
 */

import type { LGraphNode } from '@comfyorg/litegraph'

/** Keep in sync with --serif in ui/app.css and SERIF in ui/theme. */
const SERIF = "'Iowan Old Style', 'Palatino Linotype', 'Book Antiqua', 'Source Serif 4', Georgia, serif"
const INK = '#2b2620'
const RUST = '#a83a32'
const WELL_BG = 'rgba(80, 66, 53, 0.07)'
const WELL_BORDER = 'rgba(80, 66, 53, 0.28)'

const MAX_LINES = 3
const LINE_HEIGHT = 15
const PAD_X = 6
const PAD_Y = 5
const FONT_SIZE = 11

/** Click bridge (core → ui): ui/inspect registers the handler at startup. */
let clickHandler: ((node: LGraphNode) => void) | undefined

/**
 * Widget name of the Preview sink's value well (nodes/io/preview). Sinks have
 * no ⇒ badge (no outputs), so the engine's lens repaint rewrites this widget
 * from the call state's recorded inputs.
 */
export const SINK_WIDGET_NAME = 'preview'

export function setPreviewClickHandler(handler: ((node: LGraphNode) => void) | undefined): void {
  clickHandler = handler
}

interface PreviewWidgetShape {
  name: string
  value: string
  y?: number
  computeSize(width: number): [number, number]
  draw(ctx: CanvasRenderingContext2D, node: LGraphNode, width: number, y: number, height: number): void
  mouse(event: { type?: string }, offset: unknown, node: LGraphNode): boolean
}

/** What addCustomWidget accepts (IBaseWidget-shaped; our POJO satisfies it at runtime via LegacyWidget). */
export type CustomWidgetParam = Parameters<LGraphNode['addCustomWidget']>[0]

/** Lines the well displays (also drives its height via computeSize). */
function wellLines(value: unknown): string[] {
  return String(value ?? '∅')
    .split('\n')
    .slice(0, MAX_LINES)
}

/**
 * Longest prefix of `line` that fits `maxWidth`, with an ellipsis when cut.
 * In-node only: the inspect overlay always shows the full, uncut value.
 */
export function fitPreviewLine(ctx: CanvasRenderingContext2D, line: string, maxWidth: number): string {
  if (ctx.measureText(line).width <= maxWidth) return line
  const ellWidth = ctx.measureText('…').width
  let lo = 0
  let hi = line.length
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (ctx.measureText(line.slice(0, mid)).width + ellWidth <= maxWidth) lo = mid
    else hi = mid - 1
  }
  return `${line.slice(0, lo)}…`
}

export function makePreviewWidget(name: string): CustomWidgetParam {
  const widget: PreviewWidgetShape = {
    name,
    value: '∅',

    computeSize(width) {
      return [width, PAD_Y * 2 + wellLines(widget.value).length * LINE_HEIGHT + 4]
    },

    draw(ctx, _node, width, y) {
      const lines = wellLines(widget.value)
      const wellH = PAD_Y * 2 + lines.length * LINE_HEIGHT
      const x = PAD_X
      const w = width - PAD_X * 2

      // Inset well.
      ctx.beginPath()
      const r = 3
      ctx.moveTo(x + r, y)
      ctx.arcTo(x + w, y, x + w, y + wellH, r)
      ctx.arcTo(x + w, y + wellH, x, y + wellH, r)
      ctx.arcTo(x, y + wellH, x, y, r)
      ctx.arcTo(x, y, x + w, y, r)
      ctx.closePath()
      ctx.fillStyle = WELL_BG
      ctx.fill()
      ctx.lineWidth = 1
      ctx.strokeStyle = WELL_BORDER
      ctx.stroke()

      // Value lines, rust on failure (⚠ prefix), ink otherwise: clipped to
      // the well with an ellipsis (the overlay shows the full text).
      const text = lines.join('\n')
      ctx.fillStyle = text.startsWith('⚠') ? RUST : INK
      ctx.font = `${FONT_SIZE}px ${SERIF}`
      ctx.textAlign = 'left'
      ctx.textBaseline = 'alphabetic'
      const maxTextWidth = w - PAD_X * 2
      for (const [i, line] of lines.entries()) {
        ctx.fillText(fitPreviewLine(ctx, line, maxTextWidth), x + PAD_X, y + PAD_Y + i * LINE_HEIGHT + (FONT_SIZE + 1))
      }
    },

    mouse(event, _offset, node) {
      const type = event.type ?? ''
      if (type === 'pointerdown' || type === 'mousedown' || type === 'click') {
        clickHandler?.(node)
        return true
      }
      return false
    },
  }
  return widget as unknown as CustomWidgetParam
}
