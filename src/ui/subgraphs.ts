/**
 * Subgraph UI: authoring flows and navigation.
 *  - New Subgraph button → empty definition → jump inside (openSubgraph)
 *  - Breadcrumb bar + Escape for parent/child navigation
 *  - IO panel in the sidebar: typed inputs/outputs for the open definition
 *  - Collapse selection (canvas context menu + Ctrl/Cmd+G), replacing
 *    LiteGraph 0.17.2's built-in "Convert to Subgraph 🆕" items, which are
 *    broken standalone (they instantiate via an unregistered factory).
 */

import { LGraphCanvas, LGraphNode, LiteGraph, Subgraph } from '@comfyorg/litegraph'
import type { LGraph, LGraphCanvas as LGraphCanvasT } from '@comfyorg/litegraph'
import { collapseToSubgraph } from '../core/collapse'
import { NOTE_TYPE } from '../core/note-widget'
import {
  addDefInput,
  addDefOutput,
  createSubgraphDef,
  deleteSubgraphDef,
  getSubgraphDef,
  onSubgraphDefsChange,
  rawSubgraph,
  removeDefInput,
  removeDefOutput,
  renameDefInput,
  renameDefOutput,
  renameSubgraphDef,
} from '../core/subgraph'
import { dataTypeFromKind } from '../core/types'

const BROKEN_MENU_ITEM = 'Convert to Subgraph 🆕'
const IO_TYPES = ['bytes', 'string', 'number', 'boolean', 'json', 'list', 'any'] as const

// ─── New Subgraph button ─────────────────────────────────────────────────────

export function wireNewSubgraphButton(
  button: HTMLButtonElement,
  canvas: LGraphCanvasT,
  rootGraph: LGraph,
): void {
  button.addEventListener('click', () => {
    const name = window.prompt('Subgraph name:', 'New Subgraph')
    if (name === null) return
    // Created inside a definition? Then it belongs to it (scoped/local).
    const scope = canvas.graph instanceof Subgraph ? canvas.graph.id : undefined
    const meta = createSubgraphDef(rootGraph, name.trim() || 'New Subgraph', scope)
    const subgraph = rawSubgraph(rootGraph, meta.id)
    if (subgraph) canvas.openSubgraph(subgraph)
  })
}

/** Subscribes to canvas graph switches (dispatched as DOM events on the canvas element). */
export function onSetGraph(canvas: LGraphCanvasT, listener: (newGraph: LGraph | Subgraph) => void): void {
  canvas.canvas.addEventListener('litegraph:set-graph', (e: Event) => {
    const newGraph = (e as CustomEvent).detail?.newGraph as LGraph | Subgraph | undefined
    if (newGraph) listener(newGraph)
  })
}

// ─── Navigation: breadcrumb + Escape ─────────────────────────────────────────

/** Handle to the breadcrumb bar: lets adjacent UI keep persistent elements after the crumbs. */
export interface BreadcrumbHandle {
  /** Appends an element after the crumbs; it survives re-renders. */
  addExtra(element: HTMLElement): void
}

export function installBreadcrumb(
  bar: HTMLElement,
  canvas: LGraphCanvasT,
  rootGraph: LGraph,
): BreadcrumbHandle {
  let stack: Array<LGraph | Subgraph> = [rootGraph]
  const extras: HTMLElement[] = []

  function render(): void {
    bar.hidden = stack.length <= 1
    bar.innerHTML = ''
    stack.forEach((g, i) => {
      if (i > 0) bar.append(document.createTextNode(' / '))
      const label = g === rootGraph ? 'Root' : (g as Subgraph).name
      if (i === stack.length - 1) {
        const current = document.createElement('span')
        current.className = 'crumb-current'
        current.textContent = label
        bar.append(current)
      } else {
        const link = document.createElement('a')
        link.textContent = label
        link.href = '#'
        link.addEventListener('click', (e) => {
          e.preventDefault()
          canvas.setGraph(g)
        })
        bar.append(link)
      }
    })
    for (const element of extras) bar.append(element)
  }

  onSetGraph(canvas, (newGraph) => {
    const index = stack.indexOf(newGraph)
    stack = index >= 0 ? stack.slice(0, index + 1) : [...stack, newGraph]
    render()
  })

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || stack.length <= 1) return
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
    const parent = stack[stack.length - 2]
    if (parent) canvas.setGraph(parent)
  })

  render()
  return {
    addExtra(element: HTMLElement): void {
      extras.push(element)
      render()
    },
  }
}

// ─── IO panel ────────────────────────────────────────────────────────────────

export function installIOPanel(host: HTMLElement, canvas: LGraphCanvasT, rootGraph: LGraph): void {
  function currentSubgraph(): Subgraph | null {
    const g = canvas.graph
    return g instanceof Subgraph ? g : null
  }

  function render(): void {
    const subgraph = currentSubgraph()
    const meta = subgraph ? getSubgraphDef(rootGraph, subgraph.id) : undefined
    host.hidden = !meta
    host.innerHTML = ''
    if (!subgraph || !meta) return

    const title = document.createElement('div')
    title.className = 'palette-category io-title'
    title.append(document.createTextNode(`Subgraph “${meta.name}” `))
    title.append(
      iconButton('✎', 'Rename subgraph', () => {
        const name = window.prompt('Subgraph name:', meta.name)
        if (name !== null && name.trim()) renameSubgraphDef(rootGraph, meta.id, name.trim())
      }),
      iconButton('🗑', 'Delete subgraph, its instances, and its scoped helpers', () => {
        if (window.confirm(`Delete subgraph “${meta.name}”, its instances, and its scoped helpers?`)) {
          deleteSubgraphDef(rootGraph, meta.id)
          canvas.setGraph(rootGraph)
        }
      }),
    )
    host.append(title)

    renderSide(host, rootGraph, meta.id, 'inputs')
    renderSide(host, rootGraph, meta.id, 'outputs')
  }

  onSetGraph(canvas, render)
  onSubgraphDefsChange(rootGraph, render)
  render()
}

function renderSide(
  host: HTMLElement,
  rootGraph: LGraph,
  defId: string,
  side: 'inputs' | 'outputs',
): void {
  const meta = getSubgraphDef(rootGraph, defId)
  if (!meta) return
  const slots = side === 'inputs' ? meta.inputs : meta.outputs
  const rename = side === 'inputs' ? renameDefInput : renameDefOutput
  const remove = side === 'inputs' ? removeDefInput : removeDefOutput
  const add = side === 'inputs' ? addDefInput : addDefOutput

  const header = document.createElement('div')
  header.className = 'io-section'
  header.textContent = side === 'inputs' ? 'Inputs' : 'Outputs'
  host.append(header)

  slots.forEach((slot, index) => {
    const row = document.createElement('div')
    row.className = 'io-row'
    const name = document.createElement('span')
    name.className = 'io-name'
    name.textContent = slot.name
    const type = document.createElement('span')
    type.className = 'io-type'
    type.textContent = slot.type.kind
    row.append(
      name,
      type,
      iconButton('✎', 'Rename', () => {
        const next = window.prompt('Slot name:', slot.name)
        if (next !== null && next.trim()) rename(rootGraph, defId, index, next.trim())
      }),
      iconButton('×', 'Remove slot', () => remove(rootGraph, defId, index)),
    )
    host.append(row)
  })

  const form = document.createElement('div')
  form.className = 'io-add'
  const nameInput = document.createElement('input')
  nameInput.placeholder = 'name'
  const typeSelect = document.createElement('select')
  for (const kind of IO_TYPES) {
    const option = document.createElement('option')
    option.value = kind
    option.textContent = kind
    typeSelect.append(option)
  }
  typeSelect.value = 'string'
  const addButton = document.createElement('button')
  addButton.textContent = '+'
  addButton.title = `Add ${side === 'inputs' ? 'input' : 'output'}`
  const submit = (): void => {
    const name = nameInput.value.trim()
    if (!name) return
    add(rootGraph, defId, name, dataTypeFromKind(typeSelect.value))
    nameInput.value = ''
  }
  addButton.addEventListener('click', submit)
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submit()
  })
  form.append(nameInput, typeSelect, addButton)
  host.append(form)
}

function iconButton(text: string, title: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement('button')
  button.className = 'io-icon'
  button.textContent = text
  button.title = title
  button.addEventListener('click', (e) => {
    e.stopPropagation()
    onClick()
  })
  return button
}

// ─── Collapse selection ──────────────────────────────────────────────────────

export function installCollapse(canvas: LGraphCanvasT, rootGraph: LGraph): void {
  void rootGraph // collapseToSubgraph roots definitions itself
  // Replace the whole canvas menu: the default branch contains the library's
  // broken "Convert to Subgraph 🆕" item.
  canvas.getMenuOptions = () => {
    const options: Array<Record<string, unknown>> = [
      { content: 'Add Node', has_submenu: true, callback: LGraphCanvas.onMenuAdd },
      {
        content: 'Add Group',
        callback: (value: unknown, opts: unknown, event: unknown) => {
          LGraphCanvas.onGroupAdd(value as never, opts as never, event as never)
          // Groups are created at the raw mouse position — snap onto the
          // (offset) lattice right away, like nodes at add time.
          const groups = canvas.graph?._groups
          groups?.[groups.length - 1]?.snapToGrid(LiteGraph.CANVAS_GRID_SIZE)
        },
      },
      {
        content: 'Add Note',
        callback: () => {
          const node = LiteGraph.createNode(NOTE_TYPE)
          const target = canvas.graph
          if (!node || !target) return
          // Centred on the menu's click point, like a palette spawn; the
          // add-time hook snaps position and size onto the grid.
          node.pos = [canvas.graph_mouse[0] - node.size[0] / 2, canvas.graph_mouse[1] - 15]
          target.add(node)
          canvas.selectNode(node)
        },
      },
    ]
    const selected = selectedNodes(canvas)
    if (selected.length > 0) {
      options.push({
        content: 'Collapse to Subgraph',
        callback: () => collapseSelection(canvas),
      })
    }
    if (selected.length > 1) {
      options.push({ content: 'Align', has_submenu: true, callback: LGraphCanvas.onGroupAlign })
    }
    return options as never
  }

  // Filter the broken item out of per-node menus.
  const originalNodeMenu = canvas.getNodeMenuOptions.bind(canvas)
  canvas.getNodeMenuOptions = (node) =>
    originalNodeMenu(node).filter((entry) => entry?.content !== BROKEN_MENU_ITEM)

  // Ctrl/Cmd+G — "group" (Figma-style), only with a non-empty selection.
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'g') {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (selectedNodes(canvas).length === 0) return
      e.preventDefault()
      collapseSelection(canvas)
    }
  })
}

function selectedNodes(canvas: LGraphCanvasT): LGraphNode[] {
  return [...canvas.selectedItems].filter(
    (item): item is LGraphNode => item instanceof LGraphNode,
  )
}

function collapseSelection(canvas: LGraphCanvasT): void {
  const nodes = selectedNodes(canvas)
  const graph = canvas.graph
  if (nodes.length === 0 || !graph) return
  const name = window.prompt('Subgraph name:', 'New Subgraph')
  if (name === null) return
  const { instance } = collapseToSubgraph(graph, nodes, name.trim() || 'New Subgraph')
  canvas.selectNode(instance)
}
