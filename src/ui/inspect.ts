/**
 * The inspect overlay: clicking a node's preview well opens a themed card
 * with the FULL value — the contract is that nothing is ever cut off; the
 * card scrolls instead. Content is repr(value, { full: true }) of every
 * output (or the Preview sink's last input), or the failure message.
 * One card at a time; Esc / outside click / the × closes it.
 */

import type { LGraphCanvas, LGraphNode } from '@comfyorg/litegraph'
import type { Engine } from '../core/engine'
import { setPreviewClickHandler } from '../core/preview-widget'
import { PREVIEW_WIDGET_NAME, getNodeDef } from '../core/registry'
import { getSubgraphDef } from '../core/subgraph'
import { repr } from '../core/types'
import { LAST_INPUT_PROPERTY } from '../nodes/io/preview'

const CARD_WIDTH = 460

export function installInspect(engine: Engine, canvas: LGraphCanvas): void {
  let openCard: { element: HTMLElement; onKey: (e: KeyboardEvent) => void; onPointerDown: (e: PointerEvent) => void } | undefined

  function close(): void {
    if (!openCard) return
    openCard.element.remove()
    document.removeEventListener('keydown', openCard.onKey)
    document.removeEventListener('pointerdown', openCard.onPointerDown, true)
    openCard = undefined
  }

  function open(node: LGraphNode): void {
    close()
    const host = document.querySelector<HTMLElement>('#graph-host')
    if (!host) return

    const card = document.createElement('div')
    card.className = 'inspect-card'

    const header = document.createElement('div')
    header.className = 'inspect-header'
    const title = document.createElement('span')
    title.className = 'inspect-title'
    title.textContent = node.title
    const closeButton = document.createElement('button')
    closeButton.className = 'inspect-close'
    closeButton.textContent = '×'
    closeButton.title = 'Close'
    closeButton.addEventListener('click', close)
    header.append(title, closeButton)

    const pre = document.createElement('pre')
    pre.className = 'inspect-value'
    pre.textContent = contentFor(engine, node)

    card.append(header, pre)
    host.append(card)

    // Near the node, clamped into the host: right of it if there's room, else left.
    const scale = canvas.ds.scale
    const [nx = 0, ny = 0] = canvas.convertCanvasToOffset([node.pos[0] ?? 0, (node.pos[1] ?? 0) - 30])
    const nodeW = (node.size[0] ?? 0) * scale
    const hostW = host.clientWidth
    const left = nx + nodeW + 12 + CARD_WIDTH <= hostW ? nx + nodeW + 12 : Math.max(8, nx - CARD_WIDTH - 12)
    card.style.left = `${Math.round(left)}px`
    card.style.top = `${Math.round(Math.max(8, ny))}px`

    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        close()
      }
    }
    const onPointerDown = (e: PointerEvent): void => {
      if (!card.contains(e.target as Node)) close()
    }
    // Defer the outside-click listener past this opening click.
    setTimeout(() => document.addEventListener('pointerdown', onPointerDown, true), 0)
    document.addEventListener('keydown', onKey)
    openCard = { element: card, onKey, onPointerDown }
  }

  setPreviewClickHandler((node) => open(node))
}

/** Full-content lines for the card: failure first, then raw values, never truncated. */
function contentFor(engine: Engine, node: LGraphNode): string {
  const state = engine.stateOf(node)
  if (state.error) return `⚠ ${state.error.message}`
  if (state.blocked) {
    const cause = state.cause
    return cause ? `⚠ ${cause.title}: ${cause.message}` : '⚠ blocked upstream'
  }

  const lastInput = node.properties[LAST_INPUT_PROPERTY]
  if (lastInput !== undefined) return repr(lastInput, { full: true })

  const outputs = engine.outputsOf(node)
  if (outputs) {
    const defs = node.isSubgraphNode()
      ? node.graph
        ? getSubgraphDef(node.graph.rootGraph, node.type)?.outputs
        : undefined
      : getNodeDef(node)?.outputs
    return outputs.map((value, i) => `${defs?.[i]?.name ?? String(i)}: ${repr(value, { full: true })}`).join('\n')
  }

  // Never ran: whatever the well currently shows.
  const well = node.widgets?.find((w) => w.name === PREVIEW_WIDGET_NAME || w.name === 'preview') as
    | { value?: unknown }
    | undefined
  return String(well?.value ?? '∅')
}
