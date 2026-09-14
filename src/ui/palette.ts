/**
 * The node palette: a sidebar of registered operations behind a vertical
 * category tab rail: one category visible at a time instead of one long
 * list. Typing in the search box ignores the tabs and shows grouped results
 * across every category; clicking a tab clears the search. Double-click
 * spawns at the mouse position; drag onto the canvas spawns at the drop
 * point; Enter spawns the first visible item.
 *
 * (Dragging a link out of a slot and releasing on empty canvas opens
 * LiteGraph's own search box, which our coercion-driven isValidConnection
 * already type-filters: the two complement each other.)
 *
 * Subgraph definitions appear under a "Subgraphs" tab and refresh live as
 * definitions are created/renamed/edited. Spawning adds to the canvas's
 * *current* graph: while editing inside a definition, that is its interior
 * (which is also how recursive self-instances are placed).
 */

import { LiteGraph } from '@comfyorg/litegraph'
import type { LGraph, LGraphCanvas } from '@comfyorg/litegraph'
import { allNodeDefs, categoryColors } from '../core/registry'
import { SUBGRAPH_CATEGORY, onSubgraphDefsChange, reScopeDef, scopeChainOf, visibleSubgraphDefs } from '../core/subgraph'
import { fuzzyMatch } from './fuzzy'
import { onSetGraph } from './subgraphs'

const DRAG_MIME = 'application/x-cyberwizard-node'

/** Subgraphs sort first in the palette; every other category alphabetical. */
const categoryRank = (category: string): string => (category === SUBGRAPH_CATEGORY ? '' : category)

interface PaletteEntry {
  readonly type: string
  readonly title: string
  readonly category: string
  readonly description?: string
  /** Subgraph definitions only: the parent scope id (undefined = global). */
  readonly scope?: string
}

export function createPalette(host: HTMLElement, canvas: LGraphCanvas, graph: LGraph): void {
  const search = document.createElement('input')
  search.className = 'palette-search'
  search.type = 'search'
  search.placeholder = 'Search nodes…  ( / )'

  const body = document.createElement('div')
  body.className = 'palette-body'
  const tabs = document.createElement('nav')
  tabs.className = 'palette-tabs'
  const list = document.createElement('div')
  list.className = 'palette-list'
  body.append(tabs, list)

  // Land ahead of the IO panel, which already lives inside #palette.
  host.prepend(search)
  search.after(body)

  /** The tab on screen. Undefined until the first render picks a default. */
  let activeCategory: string | undefined

  function currentEntries(): PaletteEntry[] {
    const ops: PaletteEntry[] = allNodeDefs().map((d) => ({
      type: d.type,
      title: d.title,
      category: d.category,
      description: d.description,
    }))
    // Only definitions visible from the graph currently on screen: globals
    // at root, globals + the lexical chain inside a definition.
    const subs: PaletteEntry[] = visibleSubgraphDefs(graph, canvas.graph).map((d) => ({
      type: d.id,
      title: d.name,
      category: SUBGRAPH_CATEGORY,
      scope: d.scope,
      description: `${d.scope ? 'local · ' : ''}${d.inputs.map((i) => i.name).join(', ') || '∅'} → ${d.outputs.map((o) => o.name).join(', ') || '∅'}`,
    }))
    return [...ops, ...subs].sort(
      // Subgraphs sit above every other category; the rest sort alphabetically.
      (a, b) => categoryRank(a.category).localeCompare(categoryRank(b.category)) || a.title.localeCompare(b.title),
    )
  }

  /** Entries matching the search, narrowed to the active tab when not searching. */
  function visibleEntries(entries: PaletteEntry[], filter: string): PaletteEntry[] {
    const matched = entries.filter((d) => fuzzyMatch(filter, `${d.category}/${d.type} ${d.title}`))
    return filter === '' ? matched.filter((d) => d.category === activeCategory) : matched
  }

  function spawnAt(entry: PaletteEntry, [x, y]: [number, number]): void {
    const node = LiteGraph.createNode(entry.type)
    const target = canvas.graph
    if (!node || !target) return
    node.pos = [x - node.size[0] / 2, y - 15]
    // Spawn into the graph currently on screen (root or a definition interior).
    target.add(node)
    canvas.selectNode(node)
  }

  function renderTabs(categories: string[], searching: boolean): void {
    tabs.innerHTML = ''
    for (const category of categories) {
      const tab = document.createElement('button')
      tab.className = 'palette-tab'
      if (category === activeCategory && !searching) tab.classList.add('active')
      tab.textContent = category
      tab.addEventListener('click', () => {
        activeCategory = category
        search.value = ''
        render('')
      })
      tabs.append(tab)
    }
  }

  function render(filter: string): void {
    const entries = currentEntries()
    // Categories in entry order (Subgraphs first when definitions exist).
    const categories = [...new Set(entries.map((e) => e.category))]
    if (activeCategory === undefined || !categories.includes(activeCategory)) {
      // IO holds the nodes you reach for first (Text Input, Preview).
      activeCategory = categories.includes('IO') ? 'IO' : categories[0]
    }
    renderTabs(categories, filter !== '')

    list.innerHTML = ''
    const searching = filter !== ''
    const shown = visibleEntries(entries, filter)

    let firstItem: HTMLElement | undefined
    let category = ''
    for (const def of shown) {
      // Group headers only while searching: the tab already names the category.
      if (searching && def.category !== category) {
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
      // Entries wear their node's title-bar colour.
      item.style.color = categoryColors(def.category).color
      item.draggable = true
      item.addEventListener('dblclick', () => spawnAt(def, [canvas.graph_mouse[0] ?? 0, canvas.graph_mouse[1] ?? 0]))
      item.addEventListener('dragstart', (e) => {
        e.dataTransfer?.setData(DRAG_MIME, def.type)
        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy'
      })
      if (def.category === SUBGRAPH_CATEGORY) {
        item.addEventListener('contextmenu', (e) => {
          e.preventDefault()
          openScopeMenu(e, def)
        })
      }
      firstItem ??= item
      list.append(item)
    }
  }

  search.addEventListener('input', () => render(search.value.trim()))
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const first = visibleEntries(currentEntries(), search.value.trim())[0]
      if (first) spawnAt(first, centerOfView())
    } else if (e.key === 'Escape') {
      search.value = ''
      render('')
    }
  })

  // Subgraph definitions come and go: refresh the listing on any change,
  // and on navigation (visible defs differ between root and interiors).
  onSubgraphDefsChange(graph, () => render(search.value.trim()))
  onSetGraph(canvas, () => render(search.value.trim()))

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
    const def = type && currentEntries().find((d) => d.type === type)
    if (!def) return
    e.preventDefault()
    const pos = canvas.convertEventToCanvasOffset(e)
    spawnAt(def, [pos[0] ?? 0, pos[1] ?? 0])
  })

  function centerOfView(): [number, number] {
    const rect = canvasEl.getBoundingClientRect()
    return canvas.ds.convertOffsetToCanvas([rect.width / 2, rect.height / 2]) as [number, number]
  }

  /**
   * Right-click on a Subgraphs item: move the definition between scopes:
   * up to Global, or down/sideways into any visible definition that isn't
   * itself or one of its descendants (cycles are hidden, and reScopeDef
   * refuses them too). The current scope is ticked.
   */
  function openScopeMenu(e: MouseEvent, def: PaletteEntry): void {
    const descendants = new Set(scopeChainOf(graph, def.type))
    const targets: Array<{ label: string; value: string | undefined }> = [
      { label: 'Global', value: undefined },
      ...visibleSubgraphDefs(graph, canvas.graph)
        .filter((d) => d.id !== def.type && !descendants.has(d.id))
        .map((d) => ({ label: d.name, value: d.id })),
    ]
    const current = def.scope
    new LiteGraph.ContextMenu(
      targets.map((t) => ({
        content: `${t.value === current ? '✓ ' : ''}${t.label}`,
        callback: () => reScopeDef(graph, def.type, t.value),
      })),
      { event: e, title: `Scope of “${def.title}”` },
    )
  }

  render('')
}
