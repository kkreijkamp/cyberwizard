/**
 * Note UI: the in-place editor and the Color context menu.
 *
 * Editor — clicking a note's body overlays a textarea exactly on the body
 * (graph coords → fixed CSS px via the canvas's DragAndScale), re-anchored
 * every animation frame so pan/zoom/drag keep it glued. Text commits live on
 * every keystroke (setParam → properties → markdown re-renders underneath
 * and the node re-fits its height), so closing (blur / Esc / Cmd+Enter)
 * never loses anything.
 *
 * Color — a chained getExtraMenuOptions hook (same pattern as
 * ui/compute-menu and ui/widget-inputs), shown on note nodes only. The
 * choices are the node category colors; the pick lands in the hidden `tint`
 * param and the widget applies it (core/note-widget).
 */

import { LGraphNode } from '@comfyorg/litegraph'
import type { IContextMenuValue, LGraphCanvas } from '@comfyorg/litegraph'
import { NOTE_TINTS, getNodeDef, setParam } from '../core/registry'
import { NOTE_TEXT_PARAM, NOTE_TINT_PARAM, NOTE_TYPE, setNoteClickHandler } from '../core/note-widget'

export function installNotes(canvas: LGraphCanvas): void {
  installColorMenu()

  let activeClose: (() => void) | undefined
  const closeActive = (): void => {
    activeClose?.()
    activeClose = undefined
  }

  setNoteClickHandler((node) => {
    // Notes in a definition we're not looking at can't be clicked anyway;
    // this is the graph-switch guard for the click bridge.
    if (node.graph !== canvas.graph) return
    closeActive()

    const textarea = document.createElement('textarea')
    textarea.className = 'note-editor'
    textarea.value = String(node.properties[NOTE_TEXT_PARAM] ?? '')
    textarea.spellcheck = true
    document.body.append(textarea)

    let open = true
    const close = (): void => {
      if (!open) return
      open = false
      textarea.remove()
      if (activeClose === close) activeClose = undefined
    }

    const anchor = (): void => {
      const rect = canvas.canvas.getBoundingClientRect()
      const [ox = 0, oy = 0] = canvas.ds.convertCanvasToOffset(node.pos)
      const scale = canvas.ds.scale
      textarea.style.left = `${rect.left + ox}px`
      textarea.style.top = `${rect.top + oy}px`
      textarea.style.width = `${node.size[0] * scale}px`
      textarea.style.height = `${node.size[1] * scale}px`
      textarea.style.fontSize = `${13 * scale}px`
      textarea.style.padding = `${8 * scale}px ${10 * scale}px`
    }

    const frame = (): void => {
      if (!open) return
      // Node deleted or we navigated into/out of a definition mid-edit.
      if (!node.graph || node.graph !== canvas.graph) {
        close()
        return
      }
      anchor()
      requestAnimationFrame(frame)
    }

    textarea.addEventListener('input', () => {
      setParam(node, NOTE_TEXT_PARAM, textarea.value)
      node.setSize(node.computeSize())
    })
    textarea.addEventListener('keydown', (e) => {
      // Keep canvas hotkeys (Delete, '/'…) out of the edit session.
      e.stopPropagation()
      if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) {
        e.preventDefault()
        close()
      }
    })
    textarea.addEventListener('blur', close)

    activeClose = close
    anchor()
    requestAnimationFrame(frame)
    textarea.focus()
    textarea.setSelectionRange(textarea.value.length, textarea.value.length)
  })
}

function installColorMenu(): void {
  const previous = LGraphNode.prototype.getExtraMenuOptions
  LGraphNode.prototype.getExtraMenuOptions = function (this: LGraphNode, canvas, options) {
    const inherited = previous?.call(this, canvas, options) ?? []
    if (getNodeDef(this)?.type !== NOTE_TYPE) return inherited

    const current = String(this.properties[NOTE_TINT_PARAM] ?? 'Notes')
    const tints: IContextMenuValue<string>[] = NOTE_TINTS.map((name) => ({
      content: name === current ? `✓ ${name}` : name,
      callback: () => setParam(this, NOTE_TINT_PARAM, name),
    }))
    return [...inherited, { content: 'Color', has_submenu: true, submenu: { options: tints } }]
  }
}
