/**
 * The Examples picker: a header dropdown offering the annotated example
 * scenes (src/scenes). Loading one replaces the current graph: with a
 * confirm, like New: through the ordinary document restore path.
 */

import type { LGraph, LGraphCanvas } from '@comfyorg/litegraph'
import { deserializeGraph } from '../core/serialize'
import { SCENES } from '../scenes'
import type { HistoryDriver } from './history'

export function installExamplesPicker(
  host: HTMLElement,
  graph: LGraph,
  canvas: LGraphCanvas,
  history?: HistoryDriver,
): void {
  const select = document.createElement('select')
  select.id = 'examples-picker'
  select.title = 'Load an annotated example scene'

  function rebuild(): void {
    select.innerHTML = ''
    const placeholder = document.createElement('option')
    placeholder.textContent = '📚 Examples…'
    placeholder.disabled = true
    placeholder.selected = true
    select.append(placeholder)
    for (const scene of SCENES) {
      const option = document.createElement('option')
      option.value = scene.id
      option.textContent = scene.title
      option.title = scene.description
      select.append(option)
    }
  }

  select.addEventListener('change', () => {
    const scene = SCENES.find((s) => s.id === select.value)
    rebuild() // snap back to the placeholder even if the user cancels
    if (!scene) return
    if (!window.confirm(`Load the "${scene.title}" example, replacing the current graph?\n\n${scene.description}`)) return
    history?.checkpoint() // scene loads are undoable
    const { warnings } = deserializeGraph(scene.build(), graph, canvas)
    if (canvas.graph !== graph) canvas.setGraph(graph) // don't stay inside a vanished subgraph
    if (warnings.length > 0) console.warn(`scene "${scene.id}" loaded with warnings:`, warnings)
  })

  rebuild()
  host.append(select)
}
