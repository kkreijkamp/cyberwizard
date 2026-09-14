/**
 * The Note: a sticky note that behaves like any other node, palette spawn,
 * drag/resize/snap, save/share, but computes nothing. Its body is a markdown
 * document (core/markdown, core/note-widget); click it to write, double-click
 * the title bar to rename, right-click → Color for the node category colors.
 *
 * Both params are hidden: the text is edited through the note's own overlay
 * editor (ui/notes) and the tint through its context menu, so no widget rows
 * clutter the body. They serialize as ordinary params: no format support
 * needed. With zero inputs and outputs the engine treats the note as a sink
 * whose run is a free no-op; it can never fail, so the error repaint and the
 * tint never fight.
 */

import { LiteGraph } from '@comfyorg/litegraph'
import { NOTE_TINTS, defineNode } from '../../core/registry'
import { NOTE_TEXT_PARAM, NOTE_TINT_PARAM, drawNoteFold, makeNoteWidget } from '../../core/note-widget'

defineNode({
  type: 'notes/note',
  title: 'Note',
  category: 'Notes',
  description: 'A writable sticky note: markdown supported. Click the body to write, double-click the title to rename, right-click for colors.',
  inputs: [] as const,
  outputs: [] as const,
  params: [
    { kind: 'string', name: NOTE_TEXT_PARAM, label: 'Text', default: '', multiline: true, hidden: true },
    { kind: 'enum', name: NOTE_TINT_PARAM, label: 'Color', default: 'Notes', options: NOTE_TINTS, hidden: true },
  ] as const,
  setup(node) {
    // The library's computeSize clamps every node to ≥1 slot row: a slotless
    // note pays ~20px of dead space at its foot, which also pushes the
    // snapped height across a grid cell about a line before the text visibly
    // reaches it. Subtract the phantom row so the height hugs the content.
    const baseComputeSize = node.computeSize.bind(node)
    node.computeSize = (out) => {
      const size = baseComputeSize(out)
      size[1] = Math.max(0, size[1] - LiteGraph.NODE_SLOT_HEIGHT)
      return size
    }
    node.addCustomWidget(makeNoteWidget(node))
    // The sticky-note affordance: a folded corner, tinted from the bgcolor.
    node.onDrawForeground = (ctx) => drawNoteFold(ctx, node)
    node.onNodeTitleDblClick = (e, _pos, canvas) => {
      canvas.prompt('Title', node.title, (value: string) => {
        if (value !== '') {
          node.title = value
          node.setDirtyCanvas(true, false)
        }
      }, e)
    }
  },
  run: () => ({}),
})
