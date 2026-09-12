import { LGraphCanvas, LinkMarkerShape, LiteGraph, LGraphNode, RenderShape } from '@comfyorg/litegraph'
import type { INodeInputSlot } from '@comfyorg/litegraph'
import { NODE_FRAME_COLOR, NODE_FRAME_PADDING } from '../core/registry'

/**
 * CyberWizard paper theme, applied once at startup. LiteGraph reads these
 * globals live while rendering. Per-category node accent colors are set on
 * the node classes themselves (core/registry).
 *
 * Warm cream paper + book serif, in the spirit of rawbit.io's default skin —
 * kept distinct via the amber/brass accent (theirs is rust, which we reserve
 * for errors) and a dot grid (theirs is ruled lines). The serif stack is
 * system fonts only: Iowan Old Style on macOS, Palatino Linotype on Windows.
 */
const SERIF = "'Iowan Old Style', 'Palatino Linotype', 'Book Antiqua', 'Source Serif 4', Georgia, serif"

/** The cream canvas ground — also the slot-ring punch colour. */
const PAPER = '#f6f1e7'

/**
 * Warm dot grid on the snap cell, vector-drawn per frame: spacing and radius
 * are constant in graph units, so the lattice zooms with the graph — dots
 * grow on zoom in, shrink on zoom out — always crisp, never pixelated.
 * Fades out when zoomed far out, like the library's old tile.
 */
function drawDotGrid(
  canvas: LGraphCanvas,
  ctx: CanvasRenderingContext2D,
  visible: [number, number, number, number],
): void {
  const scale = canvas.ds.scale
  if (scale < 0.5) return
  const cell = LiteGraph.CANVAS_GRID_SIZE
  const [x, y, w, h] = visible
  const radius = 1.2
  ctx.fillStyle = 'rgba(153, 138, 112, 0.55)'
  ctx.beginPath()
  const startX = Math.floor(x / cell) * cell
  const startY = Math.floor(y / cell) * cell
  for (let gx = startX; gx <= x + w; gx += cell) {
    for (let gy = startY; gy <= y + h; gy += cell) {
      ctx.moveTo(gx + radius, gy)
      ctx.arc(gx, gy, radius, 0, Math.PI * 2)
    }
  }
  ctx.fill()
  ctx.fillStyle = 'transparent'
}

export function applyTheme(canvas: LGraphCanvas): void {
  canvas.clear_background_color = PAPER
  // The library's default viewport frame (#235) — invisible on the old dark
  // theme, an unwanted rectangle on paper.
  canvas.render_canvas_border = false
  // No background_image tile: a bitmap tile upscales blurry under canvas
  // zoom. The dot grid is drawn as vectors below, crisp at every scale.
  canvas.background_image = ''
  canvas.onDrawBackground = (ctx, visible) => drawDotGrid(canvas, ctx, visible)

  LiteGraph.NODE_FONT = SERIF
  LiteGraph.GROUP_FONT = SERIF
  // Baseline 2px up: the stock 20 sits low in the 30px bar for the serif.
  LiteGraph.NODE_TITLE_TEXT_Y = 18
  // Ships undefined in 0.17.2 — and the group titlebar's hit area is computed
  // as font_size × 1.4, i.e. NaN, so groups can never be selected (or
  // deleted). Restoring the classic default repairs both.
  LiteGraph.DEFAULT_GROUP_FONT_SIZE = 24

  // No low-quality cutout: below 0.6 zoom the library stops drawing node
  // titles entirely; our graphs are small enough to render fully always.
  canvas.low_quality_zoom_threshold = 0

  // The canvas copies NODE_TITLE_COLOR at construction, before this runs —
  // set its instance copy too or unselected titles stay the stock #999.
  canvas.node_title_color = '#ffffff'

  LiteGraph.NODE_DEFAULT_SHAPE = RenderShape.BOX
  LiteGraph.NODE_DEFAULT_COLOR = '#8a7f6a'
  LiteGraph.NODE_DEFAULT_BGCOLOR = '#fdfbf5'
  LiteGraph.NODE_DEFAULT_BOXCOLOR = '#a16207'
  LiteGraph.NODE_BOX_OUTLINE_COLOR = '#a16207' // the selection halo
  LiteGraph.NODE_TITLE_COLOR = '#ffffff'
  LiteGraph.NODE_SELECTED_TITLE_COLOR = '#ffffff'
  LiteGraph.NODE_TEXT_COLOR = '#2b2620'
  LiteGraph.NODE_TEXT_HIGHLIGHT_COLOR = '#a16207'
  LiteGraph.DEFAULT_SHADOW_COLOR = 'rgba(80, 66, 53, 0.25)'

  LiteGraph.WIDGET_BGCOLOR = '#f1ead9'
  LiteGraph.WIDGET_OUTLINE_COLOR = '#d8cfbc'
  LiteGraph.WIDGET_TEXT_COLOR = '#2b2620'
  LiteGraph.WIDGET_SECONDARY_TEXT_COLOR = '#8a7f6a'

  LiteGraph.LINK_COLOR = '#8a7f6a'
  LiteGraph.EVENT_LINK_COLOR = '#a83a32'
  LiteGraph.CONNECTING_LINK_COLOR = '#c2841a'
  // Snapshotted by the canvas at construction (same early-copy trap as the
  // title colour) — set its instance copy too.
  canvas.default_link_color = '#8a7f6a'
  // Thin wires.
  canvas.connections_width = 1.5
  // No midpoint dot, no border/outline behind links.
  canvas.linkMarkerShape = LinkMarkerShape.None
  canvas.render_connections_border = false
  // The stock per-type overrides ('number', 'node') are off-palette.
  LGraphCanvas.link_type_colors = {}

  // Slot dots wear their type colour (connected = full, unconnected = half).
  canvas.default_connection_color_byType = { ...SLOT_TYPE_COLORS }
  canvas.default_connection_color_byTypeOff = Object.fromEntries(
    Object.entries(SLOT_TYPE_COLORS).map(([kind, color]) => [kind, `${color}80`]),
  )

  // Book-heading titles: the library's titleFontStyle getter carries no
  // weight — patch the prototype getter (same slot) to add bold.
  Object.defineProperty(LGraphNode.prototype, 'titleFontStyle', {
    configurable: true,
    get: () => `bold ${LiteGraph.NODE_TEXT_SIZE}px ${LiteGraph.NODE_FONT}`,
  })

  installSlotShapes()
}

/** Slot dot colours per value type, in the paper palette's deep tones. */
const SLOT_TYPE_COLORS: Record<string, string> = {
  bytes: '#7d5119',
  string: '#47603f',
  number: '#3a5580',
  boolean: '#7d3a52',
  json: '#5f4a7d',
  list: '#2f5f68',
}

let slotShapesInstalled = false

/**
 * Slot dots as open rings straddling the node frame, like the reference
 * design. Two patches combine:
 *
 * 1. Connection points move from 10px inside the node onto the frame edge
 *    (getInputSlotPos/getOutputPos) — the ring, the link endpoints, and the
 *    hover boxes all derive from that one point, so they stay coherent.
 *    Widget-input slots keep their inline dot, collapsed nodes untouched.
 * 2. The library's own HollowCircle is radius 3 with a 3px stroke — a
 *    nearly-filled disk — so after the library draws its dots we punch a
 *    paper-coloured disc over each and stroke a ring in the slot's type
 *    colour (the centre follows #measureSlot → the patched positions).
 */
function installSlotShapes(): void {
  if (slotShapesInstalled) return
  slotShapesInstalled = true

  const originalInputPos = LGraphNode.prototype.getInputSlotPos
  LGraphNode.prototype.getInputSlotPos = function (this: LGraphNode, input: INodeInputSlot) {
    if (input?.pos || this.flags.collapsed) return originalInputPos.call(this, input)
    const [, y] = originalInputPos.call(this, input)
    return [(this.pos[0] ?? 0) - NODE_FRAME_PADDING, y ?? 0] as [number, number]
  } as LGraphNode['getInputSlotPos']

  const originalOutputPos = LGraphNode.prototype.getOutputPos
  LGraphNode.prototype.getOutputPos = function (this: LGraphNode, slot: number) {
    if (this.outputs?.[slot]?.pos || this.flags.collapsed) return originalOutputPos.call(this, slot)
    const [, y] = originalOutputPos.call(this, slot)
    return [(this.pos[0] ?? 0) + (this.size[0] ?? 0) + NODE_FRAME_PADDING, y ?? 0] as [number, number]
  } as LGraphNode['getOutputPos']

  const original = LGraphNode.prototype.drawSlots
  LGraphNode.prototype.drawSlots = function (this: LGraphNode, ...args: Parameters<LGraphNode['drawSlots']>) {
    original.apply(this, args)
    drawHollowSlots(this, args[0], args[1])
  } as LGraphNode['drawSlots']

  // The slot hotspot rect extends past the node edge with the ring, but slot
  // hit tests only run for points inside the node's bounding rect — the
  // ring's outer half was culled as empty canvas, making the effective
  // hotspot the (offset) inner half. Relax the hit test itself by the ring's
  // grab margin; the bounding rect is left alone because the node body is
  // rendered from it (inflating it widened the node — see the revert).
  const originalIsPointInside = LGraphNode.prototype.isPointInside
  LGraphNode.prototype.isPointInside = function (this: LGraphNode, x: number, y: number): boolean {
    if (originalIsPointInside.call(this, x, y)) return true
    const r = this.boundingRect
    const left = (r[0] ?? 0) - SLOT_GRAB_MARGIN
    const right = (r[0] ?? 0) + (r[2] ?? 0) + SLOT_GRAB_MARGIN
    const top = r[1] ?? 0
    const bottom = top + (r[3] ?? 0)
    return x >= left && x <= right && y >= top && y <= bottom
  }
}

const SLOT_RING_RADIUS = 5.5
/** Ring spec = the node frame's: 1px in NODE_FRAME_COLOR. */
const SLOT_RING_WIDTH = 1
/** Horizontal hit-test margin past the node edge, covering the ring's grab zone. */
const SLOT_GRAB_MARGIN = 10

/** Structural view of the concrete NodeSlot members (absent from the public slot interfaces). */
interface ConcreteSlot {
  boundingRect: ArrayLike<number>
  isWidgetInputSlot: boolean
  isConnected: boolean
  isValidTarget(fromSlot: unknown): boolean
}

function drawHollowSlots(
  node: LGraphNode,
  ctx: CanvasRenderingContext2D,
  options: Parameters<LGraphNode['drawSlots']>[1],
): void {
  const { fromSlot, editorAlpha } = options
  for (const slot of [...(node.inputs ?? []), ...(node.outputs ?? [])] as unknown as ConcreteSlot[]) {
    // Mirrors the library's own visibility rule (sans hover): widget-input
    // dots show only when connected or a valid drop target.
    if (slot.isWidgetInputSlot && !slot.isConnected && !(fromSlot && slot.isValidTarget(fromSlot))) {
      continue
    }
    const valid = !fromSlot || slot.isValidTarget(fromSlot)
    // Slot centre in node-local space, replicating NodeSlot.#centreOffset.
    const rect = slot.boundingRect
    const cx = (rect[0] ?? 0) - (node.pos[0] ?? 0) + (rect[3] ?? 0) / 2
    const cy = (rect[1] ?? 0) - (node.pos[1] ?? 0) + (rect[3] ?? 0) / 2
    ctx.globalAlpha = (valid ? 1 : 0.4) * (editorAlpha ?? 1)
    ctx.beginPath()
    ctx.arc(cx, cy, SLOT_RING_RADIUS, 0, Math.PI * 2)
    ctx.fillStyle = PAPER
    ctx.fill()
    ctx.lineWidth = SLOT_RING_WIDTH
    ctx.strokeStyle = NODE_FRAME_COLOR
    ctx.stroke()
  }
}
