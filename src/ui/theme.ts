import { LiteGraph, RenderShape } from '@comfyorg/litegraph'
import type { LGraphCanvas } from '@comfyorg/litegraph'

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
 * Warm dot grid, vector-drawn per frame as a screen-fixed lattice: the
 * graph-unit cell shrinks as you zoom in (cell = snap size ÷ scale), so on
 * screen the dots always sit at the same 50px pitch with a constant 1.2px
 * radius — the grid pans with the graph but never stretches with zoom.
 */
function drawDotGrid(
  canvas: LGraphCanvas,
  ctx: CanvasRenderingContext2D,
  visible: [number, number, number, number],
): void {
  const scale = canvas.ds.scale
  const cell = LiteGraph.CANVAS_GRID_SIZE / scale
  const [x, y, w, h] = visible
  const radius = 1.2 / scale
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

  LiteGraph.NODE_DEFAULT_SHAPE = RenderShape.BOX
  LiteGraph.NODE_DEFAULT_COLOR = '#e8e0cd'
  LiteGraph.NODE_DEFAULT_BGCOLOR = '#fdfbf5'
  LiteGraph.NODE_DEFAULT_BOXCOLOR = '#a16207'
  LiteGraph.NODE_BOX_OUTLINE_COLOR = '#a16207' // the selection halo
  LiteGraph.NODE_TITLE_COLOR = '#fdf6e9'
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
}
