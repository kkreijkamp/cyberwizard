/**
 * Graph undo/redo: whole-document snapshots driven by a change-detecting poll.
 *
 * Why poll-and-hash instead of hooking every mutation source: edits arrive
 * through too many paths (node add/remove/move, links, param widgets typing
 * straight into node.properties, note edits, group drags, subgraph IO panel
 * edits) — a serialized-JSON comparison catches all of them uniformly,
 * including ones we forgot to hook. The poll interval only sets how fast
 * the BUTTONS update; undo() itself flushes first, so no edit is ever lost
 * to timing.
 *
 * Snapshots exclude the viewport (serializeGraph without canvas): panning
 * doesn't create entries, and undo never yanks the camera. The currently
 * open definition is re-entered after a restore when it survives (definitions
 * have stable UUIDs in the document).
 */

import { Subgraph } from '@comfyorg/litegraph'
import type { LGraph, LGraphCanvas } from '@comfyorg/litegraph'
import { History } from '../core/history'
import type { GraphDocument } from '../core/serialize'
import { deserializeGraph, serializeGraph } from '../core/serialize'

const POLL_MS = 500
const ENTRY_LIMIT = 50

export interface HistoryDriver {
  undo(): void
  redo(): void
  /** Flush pending changes into an entry now (the poll does this too, slower). */
  flush(): void
  /**
   * Mark an external document replacement (New / Load / example scene): the
   * pre-replacement state becomes undoable, and the next poll adopts the new
   * document without recording it as an edit.
   */
  checkpoint(): void
  canUndo(): boolean
  canRedo(): boolean
  dispose(): void
  /** Fired whenever canUndo/canRedo may have changed (drives button state). */
  onChange(listener: () => void): () => void
}

export function installHistory(graph: LGraph, canvas: LGraphCanvas): HistoryDriver {
  const history = new History<GraphDocument>(ENTRY_LIMIT)
  const listeners = new Set<() => void>()
  let lastDoc: GraphDocument = serializeGraph(graph)
  let lastJson = JSON.stringify(lastDoc)
  let adopting = false

  function emit(): void {
    for (const listener of listeners) listener()
  }

  function check(): void {
    const doc = serializeGraph(graph)
    const json = JSON.stringify(doc)
    if (json === lastJson) return
    if (adopting) {
      adopting = false
      lastDoc = doc
      lastJson = json
      return
    }
    history.push(lastDoc)
    lastDoc = doc
    lastJson = json
    emit()
  }

  function restore(target: GraphDocument): void {
    const openId = canvas.graph instanceof Subgraph ? canvas.graph.id : null
    deserializeGraph(target, graph)
    lastDoc = target
    lastJson = JSON.stringify(target)
    if (openId !== null) {
      const sub = graph.subgraphs.get(openId as never) as Subgraph | undefined
      canvas.setGraph(sub ?? graph)
    } else if (canvas.graph !== graph) {
      canvas.setGraph(graph)
    }
  }

  function undo(): void {
    check() // flush — undo always sees the freshest state
    const target = history.undo(lastDoc)
    if (target === undefined) return
    restore(target)
    emit()
  }

  function redo(): void {
    check()
    const target = history.redo(lastDoc)
    if (target === undefined) return
    restore(target)
    emit()
  }

  const timer = setInterval(check, POLL_MS)

  // Keybindings exist only where a DOM does (the driver is DOM-free: tests
  // and any headless use skip the listener and lose nothing else).
  const hasDom = typeof document !== 'undefined'
  const onKey = (e: KeyboardEvent): void => {
    if (!(e.ctrlKey || e.metaKey)) return
    const key = e.key.toLowerCase()
    const isUndo = key === 'z' && !e.shiftKey
    const isRedo = (key === 'z' && e.shiftKey) || key === 'y'
    if (!isUndo && !isRedo) return
    const target = e.target
    // Text fields keep their native field-level undo.
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return
    if (target instanceof HTMLElement && target.isContentEditable) return
    e.preventDefault()
    if (isUndo) undo()
    else redo()
  }
  if (hasDom) document.addEventListener('keydown', onKey)

  return {
    undo,
    redo,
    flush: check,
    checkpoint(): void {
      check()
      history.push(lastDoc)
      adopting = true
      emit()
    },
    canUndo: () => history.canUndo,
    canRedo: () => history.canRedo,
    dispose(): void {
      clearInterval(timer)
      if (hasDom) document.removeEventListener('keydown', onKey)
      listeners.clear()
    },
    onChange(listener: () => void): () => void {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

/** The ↶/↷ header buttons, prepended to the header actions; disabled state tracks the stacks. */
export function wireHistoryButtons(host: HTMLElement, driver: HistoryDriver): void {
  const undoButton = document.createElement('button')
  undoButton.id = 'btn-undo'
  undoButton.textContent = '↶'
  undoButton.title = 'Undo (Ctrl+Z)'
  undoButton.addEventListener('click', () => driver.undo())
  const redoButton = document.createElement('button')
  redoButton.id = 'btn-redo'
  redoButton.textContent = '↷'
  redoButton.title = 'Redo (Ctrl+Shift+Z)'
  redoButton.addEventListener('click', () => driver.redo())

  function refresh(): void {
    undoButton.disabled = !driver.canUndo()
    redoButton.disabled = !driver.canRedo()
  }
  driver.onChange(refresh)
  refresh()
  host.prepend(redoButton, undoButton)
}
