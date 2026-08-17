/**
 * Persistence UI: header buttons (Save / Load / Share / New), autosave to
 * localStorage, and the boot-time document pick (URL hash → autosave → none).
 */

import type { LGraph, LGraphCanvas } from '@comfyorg/litegraph'
import type { GraphDocument } from '../core/serialize'
import { deserializeGraph, parseGraphDocument, serializeGraph } from '../core/serialize'
import { decodeShareHash, encodeShareHash, shareHashFromLocation } from '../core/share'
import { clearSubgraphDefs } from '../core/subgraph'

const AUTOSAVE_KEY = 'cyberwizard.autosave.v1'

/** The graph to boot with: shared URL wins, then autosave, else null (showcase). */
export function initialDocument(): GraphDocument | null {
  try {
    const hash = shareHashFromLocation(location.hash)
    if (hash) return decodeShareHash(hash)
  } catch (err) {
    console.warn('ignoring invalid share hash:', err)
  }
  try {
    const saved = localStorage.getItem(AUTOSAVE_KEY)
    if (saved) return parseGraphDocument(JSON.parse(saved))
  } catch (err) {
    console.warn('ignoring invalid autosave:', err)
  }
  return null
}

export function startAutosave(graph: LGraph, canvas: LGraphCanvas): () => void {
  let lastWritten = ''
  const save = (): void => {
    try {
      const json = JSON.stringify(serializeGraph(graph, canvas))
      if (json !== lastWritten) {
        if (lastWritten !== '' && location.hash.startsWith('#g=')) {
          // The user edited past the shared snapshot — the hash no longer
          // represents this graph, and boot gives it priority over the
          // autosave. Drop it or every refresh resurrects the old state.
          history.replaceState(null, '', location.pathname + location.search)
        }
        localStorage.setItem(AUTOSAVE_KEY, json)
        lastWritten = json
      }
    } catch (err) {
      // Quota exceeded or serialisation edge — autosave is best-effort, but
      // never *silent*: a save that always fails loses work on refresh.
      console.warn('autosave failed:', err)
    }
  }
  const timer = setInterval(save, 3000)
  window.addEventListener('beforeunload', save)
  return () => {
    clearInterval(timer)
    window.removeEventListener('beforeunload', save)
  }
}

export function wirePersistence(graph: LGraph, canvas: LGraphCanvas): void {
  bind('btn-save', () => {
    const json = JSON.stringify(serializeGraph(graph, canvas), null, 2)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'graph.cyberwizard.json'
    a.click()
    URL.revokeObjectURL(url)
  })

  bind('btn-load', () => {
    const picker = document.createElement('input')
    picker.type = 'file'
    picker.accept = '.json,application/json'
    picker.onchange = async () => {
      const file = picker.files?.[0]
      if (!file) return
      try {
        const doc = parseGraphDocument(JSON.parse(await file.text()))
        const { warnings } = deserializeGraph(doc, graph, canvas)
        if (warnings.length > 0) alert(`Loaded with warnings:\n${warnings.join('\n')}`)
      } catch (err) {
        alert(`Could not load graph: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    picker.click()
  })

  bind('btn-share', (button) => {
    const hash = encodeShareHash(serializeGraph(graph, canvas))
    history.replaceState(null, '', hash)
    const original = button.textContent
    navigator.clipboard
      ?.writeText(location.href)
      .then(() => flash(button, 'Copied ✓', original))
      .catch(() => flash(button, 'URL in address bar', original))
  })

  bind('btn-new', () => {
    if (!confirm('Clear the whole graph?')) return
    graph.clear()
    clearSubgraphDefs(graph) // clear() wipes graph.subgraphs but not our factories/metadata
    if (canvas.graph !== graph) canvas.setGraph(graph) // don't show a ghost subgraph
    history.replaceState(null, '', location.pathname)
    localStorage.removeItem(AUTOSAVE_KEY)
  })
}

function bind(id: string, onClick: (button: HTMLButtonElement) => void): void {
  document.querySelector<HTMLButtonElement>(`#${id}`)?.addEventListener('click', () => {
    const button = document.querySelector<HTMLButtonElement>(`#${id}`)
    if (button) onClick(button)
  })
}

function flash(button: HTMLButtonElement, text: string, restore: string | null): void {
  button.textContent = text
  setTimeout(() => {
    button.textContent = restore
  }, 1500)
}
