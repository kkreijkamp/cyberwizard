import { LGraphCanvas, LiteGraph, LGraphNode, RenderShape } from '@comfyorg/litegraph'

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
  canvas.clear_background_color = '#f6f1e7'
  // The library's default viewport frame (#235) — invisible on the old dark
  // theme, an unwanted rectangle on paper.
  canvas.render_canvas_border = false
  // No background_image tile: a bitmap tile upscales blurry under canvas
  // zoom. The dot grid is drawn as vectors below, crisp at every scale.
  canvas.background_image = ''
  canvas.onDrawBackground = (ctx, visible) => drawDotGrid(canvas, ctx, visible)

  LiteGraph.NODE_FONT = SERIF
  LiteGraph.GROUP_FONT = SERIF
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
 * Every slot renders as a hollow circle straddling the node frame's edge.
 * Shape is per-slot with no library default, and slots are created long
 * before this module runs (the initial graph predates applyTheme) — so the
 * stamp goes through drawSlots, the per-frame choke point that sees every
 * slot: existing nodes, future adds, variadic growth, converted params, and
 * subgraph instance syncs. `??=` preserves any deliberately-set shape.
 */
function installSlotShapes(): void {
  if (slotShapesInstalled) return
  slotShapesInstalled = true

  const original = LGraphNode.prototype.drawSlots
  LGraphNode.prototype.drawSlots = function (this: LGraphNode, ...args: Parameters<LGraphNode['drawSlots']>) {
    for (const slot of this.inputs ?? []) slot.shape ??= RenderShape.HollowCircle
    for (const slot of this.outputs ?? []) slot.shape ??= RenderShape.HollowCircle
    return original.apply(this, args)
  } as LGraphNode['drawSlots']
}
