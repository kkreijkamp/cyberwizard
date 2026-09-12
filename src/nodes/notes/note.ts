/**
 * The Note: a sticky note that behaves like any other node — palette spawn,
 * drag/resize/snap, save/share — but computes nothing. Its body is a markdown
 * document (core/markdown, core/note-widget); click it to write, double-click
 * the title bar to rename, right-click → Color for the node category colors.
 *
 * Both params are hidden: the text is edited through the note's own overlay
 * editor (ui/notes) and the tint through its context menu, so no widget rows
 * clutter the body. They serialize as ordinary params — no format support
 * needed. With zero inputs and outputs the engine treats the note as a sink
 * whose run is a free no-op; it can never fail, so the error repaint and the
 * tint never fight.
 */

import { NOTE_TINTS, defineNode } from '../../core/registry'
import { NOTE_TEXT_PARAM, NOTE_TINT_PARAM, makeNoteWidget } from '../../core/note-widget'

defineNode({
  type: 'notes/note',
  title: 'Note',
  category: 'Notes',
  description: 'A writable sticky note — markdown supported. Click the body to write, double-click the title to rename, right-click for colors.',
  inputs: [] as const,
  outputs: [] as const,
  params: [
    { kind: 'string', name: NOTE_TEXT_PARAM, label: 'Text', default: '', multiline: true, hidden: true },
    { kind: 'enum', name: NOTE_TINT_PARAM, label: 'Color', default: 'Notes', options: NOTE_TINTS, hidden: true },
  ] as const,
  setup(node) {
    node.addCustomWidget(makeNoteWidget(node))
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
