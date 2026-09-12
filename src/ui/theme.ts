import { LiteGraph } from '@comfyorg/litegraph'
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

/** 50px dot-grid tile (the snap cell), warm gray dots on transparent. */
const DOT_GRID_TILE =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='50' height='50'%3E%3Ccircle cx='1.2' cy='1.2' r='1.2' fill='%23998a70' fill-opacity='0.55'/%3E%3C/svg%3E"

export function applyTheme(canvas: LGraphCanvas): void {
  canvas.clear_background_color = '#f6f1e7'
  canvas.background_image = DOT_GRID_TILE

  LiteGraph.NODE_FONT = SERIF
  LiteGraph.GROUP_FONT = SERIF

  LiteGraph.NODE_DEFAULT_COLOR = '#e8e0cd'
  LiteGraph.NODE_DEFAULT_BGCOLOR = '#fdfbf5'
  LiteGraph.NODE_DEFAULT_BOXCOLOR = '#a16207'
  LiteGraph.NODE_BOX_OUTLINE_COLOR = '#d8cfbc'
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
