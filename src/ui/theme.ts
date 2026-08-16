import { LiteGraph } from '@comfyorg/litegraph'
import type { LGraphCanvas } from '@comfyorg/litegraph'

/**
 * CyberWizard dark theme, applied once at startup. LiteGraph reads these
 * globals live while rendering. Per-category node accent colors are set on
 * the node classes themselves (see src/demo/nodes.ts).
 */
export function applyTheme(canvas: LGraphCanvas): void {
  canvas.clear_background_color = '#0b0e14'

  LiteGraph.NODE_DEFAULT_COLOR = '#2a3142'
  LiteGraph.NODE_DEFAULT_BGCOLOR = '#161b26'
  LiteGraph.NODE_DEFAULT_BOXCOLOR = '#22d3ee'
  LiteGraph.NODE_BOX_OUTLINE_COLOR = '#0b0e14'
  LiteGraph.NODE_TITLE_COLOR = '#9fb0c3'
  LiteGraph.NODE_SELECTED_TITLE_COLOR = '#ffffff'
  LiteGraph.NODE_TEXT_COLOR = '#e6edf3'
  LiteGraph.NODE_TEXT_HIGHLIGHT_COLOR = '#22d3ee'
  LiteGraph.DEFAULT_SHADOW_COLOR = 'rgba(0, 0, 0, 0.5)'

  LiteGraph.WIDGET_BGCOLOR = '#0f1420'
  LiteGraph.WIDGET_OUTLINE_COLOR = '#2a3142'
  LiteGraph.WIDGET_TEXT_COLOR = '#e6edf3'
  LiteGraph.WIDGET_SECONDARY_TEXT_COLOR = '#8b98ab'

  LiteGraph.LINK_COLOR = '#4cc9f0'
  LiteGraph.EVENT_LINK_COLOR = '#f72585'
  LiteGraph.CONNECTING_LINK_COLOR = '#a5f3fc'
}
