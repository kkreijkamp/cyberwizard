/**
 * The node palette: a sidebar listing every registered operation, grouped by
 * category, with fuzzy search. Double-click spawns at the mouse position;
 * drag onto the canvas spawns at the drop point.
 *
 * (Dragging a link out of a slot and releasing on empty canvas opens
 * LiteGraph's own search box, which our coercion-driven isValidConnection
 * already type-filters — the two complement each other.)
 */

import { LiteGraph } from '@comfyorg/litegraph'
import type { LGraph, LGraphCanvas } from '@comfyorg/litegraph'
import type { UntypedNodeDef } from '../core/registry'
import { allNodeDefs } from '../core/registry'
import { fuzzyMatch } from './fuzzy'

const DRAG_MIME = 'application/x-cyberwizard-node'

export function createPalette(host: HTMLElement, canvas: LGraphCanvas, graph: LGraph): void {
  const search = document.createElement('input')
  search.className = 'palette-search'
  search.type = 'search'
  search.placeholder = 'Search nodes…  ( / )'

  const list = document.createElement('div')
  list.className = 'palette-list'

  host.append(search, list)

  const defs = [...allNodeDefs()].sort(
    (a, b) => a.category.localeCompare(b.category) || a.title.localeCompare(b.title),
  )

  function spawnAt(def: UntypedNodeDef, [x, y]: [number, number]): void {
    const node = LiteGraph.createNode(def.type)
    if (!node) return
    node.pos = [x - node.size[0] / 2, y - 15]
    graph.add(node)
    canvas.selectNode(node)
  }

  function render(filter: string): void {
    list.innerHTML = ''
    const matched = defs.filter((d) => fuzzyMatch(filter, `${d.category}/${d.type} ${d.title}`))

    let firstItem: HTMLElement | undefined
    let category = ''
    for (const def of matched) {
      if (def.category !== category) {
        category = def.category
        const header = document.createElement('div')
        header.className = 'palette-category'
        header.textContent = category
        list.append(header)
      }
      const item = document.createElement('div')
      item.className = 'palette-item'
      item.textContent = def.title
      item.title = def.description ?? def.type
      item.draggable = true
      item.addEventListener('dblclick', () => spawnAt(def, [canvas.graph_mouse[0] ?? 0, canvas.graph_mouse[1] ?? 0]))
      item.addEventListener('dragstart', (e) => {
        e.dataTransfer?.setData(DRAG_MIME, def.type)
        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy'
      })
      firstItem ??= item
      list.append(item)
    }

    list.dataset.firstMatch = firstItem?.textContent ?? ''
  }

  search.addEventListener('input', () => render(search.value.trim()))
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const first = defs.find((d) => fuzzyMatch(search.value.trim(), `${d.category}/${d.type} ${d.title}`))
      if (first) spawnAt(first, centerOfView())
    } else if (e.key === 'Escape') {
      search.value = ''
      render('')
    }
  })

  // '/' focuses the palette search from anywhere (unless already typing).
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) {
      e.preventDefault()
      search.focus()
    }
  })

  // Drop-to-spawn at the cursor.
  const canvasEl = canvas.canvas
  canvasEl.addEventListener('dragover', (e) => {
    if (e.dataTransfer?.types.includes(DRAG_MIME)) {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
    }
  })
  canvasEl.addEventListener('drop', (e) => {
    const type = e.dataTransfer?.getData(DRAG_MIME)
    const def = type && defs.find((d) => d.type === type)
    if (!def) return
    e.preventDefault()
    const pos = canvas.convertEventToCanvasOffset(e)
    spawnAt(def, [pos[0] ?? 0, pos[1] ?? 0])
  })

  function centerOfView(): [number, number] {
    const rect = canvasEl.getBoundingClientRect()
    return canvas.ds.convertOffsetToCanvas([rect.width / 2, rect.height / 2]) as [number, number]
  }

  render('')
}
