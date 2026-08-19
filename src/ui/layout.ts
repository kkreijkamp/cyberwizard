/**
 * Cell layout — keeps every node aligned to the 50px cell grid.
 *
 * Sizes always snap to whole cells minus the one-row margin: width and
 * height ≡ 40 (mod 50), snapping UP so content always fits. Enforcement is
 * a prototype-level LGraphNode.onResize: in 0.17.2 every size change
 * funnels through setSize → onResize (creation, widget/slot adds, subgraph
 * IO sync, manual corner-drags), so one hook covers all of them. Positions
 * snap to the 10px grid at add time (drags are handled by
 * LiteGraph.alwaysSnapToGrid, see main.ts).
 *
 * Resizing reflows the column below: growing pushes overlapped neighbours
 * down so the one-row margin is restored (transitively); shrinking pulls
 * directly-underneath neighbours back up. A node is "directly underneath"
 * when it overlaps horizontally and has at most one grid row (10px) of
 * vertical gap. Pull-ups are clamped so a rising node never collides with
 * an unrelated node above it.
 */

import { LGraphNode } from '@comfyorg/litegraph'
import type { LGraph, Size } from '@comfyorg/litegraph'
import { onSubgraphDefsChange } from '../core/subgraph'

/** Five grid squares (LiteGraph.CANVAS_GRID_SIZE is 10). */
export const LAYOUT_CELL = 50
/** The one-row margin between stacked nodes. */
export const LAYOUT_MARGIN = 10
const MIN_DIM = LAYOUT_CELL - LAYOUT_MARGIN

/** Snaps one dimension up to the next cell size: 40, 90, 140, 190, … */
export function snapDim(x: number): number {
  return Math.max(MIN_DIM, Math.ceil((x - MIN_DIM) / LAYOUT_CELL) * LAYOUT_CELL + MIN_DIM)
}

/**
 * Installs the layout hooks: the onResize prototype patch (once, global)
 * plus per-graph onNodeAdded snapping for the root graph and every
 * definition interior (present and future).
 */
export function installNodeLayout(rootGraph: LGraph): void {
  installResizeHook()
  hookAdds(rootGraph)
  for (const subgraph of rootGraph.subgraphs.values()) hookAdds(subgraph)
  onSubgraphDefsChange(rootGraph, () => {
    for (const subgraph of rootGraph.subgraphs.values()) hookAdds(subgraph)
  })
}

// ─── Size snapping (onResize) ────────────────────────────────────────────────

/** Last snapped size per node — setSize overwrites node.size before firing onResize, so the previous height is tracked here. */
const snappedSizes = new WeakMap<LGraphNode, [number, number]>()

let resizeHookInstalled = false

function installResizeHook(): void {
  if (resizeHookInstalled) return
  resizeHookInstalled = true
  // Nothing in the app or the library assigns per-instance onResize, so a
  // prototype default is total. Same library-patch approach as
  // installConnectionRules (core/registry).
  LGraphNode.prototype.onResize = function (this: LGraphNode, requested: Size): void {
    onNodeResize(this, requested)
  }
}

function onNodeResize(node: LGraphNode, requested: Size): void {
  const min = node.computeSize()
  const w = snapDim(Math.max(min[0], requested[0]))
  const h = snapDim(Math.max(min[1], requested[1]))
  const prevH = snappedSizes.get(node)?.[1] ?? node.size[1]
  snappedSizes.set(node, [w, h])
  if (w !== requested[0] || h !== requested[1]) {
    // Re-entrant onResize: snappedSizes already holds [w, h], so the second
    // pass is a no-op (no setSize, no reflow).
    node.setSize([w, h])
  }
  if (prevH !== h) reflowBelow(node, h - prevH)
}

// ─── Column reflow ───────────────────────────────────────────────────────────

function xOverlap(a: LGraphNode, b: LGraphNode): boolean {
  return a.pos[0] < b.pos[0] + b.size[0] && b.pos[0] < a.pos[0] + a.size[0]
}

/** The lowest y a rising node may occupy: one row below anything directly above it. */
function topFloor(graph: LGraph, node: LGraphNode): number {
  let floor = Number.NEGATIVE_INFINITY
  for (const c of graph._nodes) {
    if (c === node || !xOverlap(c, node)) continue
    const cBottom = c.pos[1] + c.size[1]
    if (cBottom <= node.pos[1]) floor = Math.max(floor, cBottom + LAYOUT_MARGIN)
  }
  return floor
}

/**
 * The node's height changed by `delta` (negative = shrank). Cascades
 * through the column: pushes neighbours down past the grown bottom edge, or
 * pulls previously-stacked neighbours up past the shrunk one. Deltas share
 * a sign per cascade, so moves are monotonic and the walk terminates.
 */
function reflowBelow(node: LGraphNode, delta: number): void {
  const graph = node.graph
  if (!graph || delta === 0) return
  const queue: Array<[mover: LGraphNode, bottomDelta: number]> = [[node, delta]]
  const seen = new Set<LGraphNode>()
  while (queue.length > 0) {
    const [mover, bottomDelta] = queue.shift() as [LGraphNode, number]
    if (seen.has(mover)) continue
    seen.add(mover)
    const moverBottom = mover.pos[1] + mover.size[1]
    for (const other of graph._nodes) {
      if (other === mover || other.pinned || seen.has(other)) continue
      if (other.pos[1] < mover.pos[1]) continue // above or enclosing — not underneath
      if (!xOverlap(mover, other)) continue
      if (bottomDelta > 0) {
        const gap = other.pos[1] - moverBottom
        if (gap >= LAYOUT_MARGIN) continue
        const d = LAYOUT_MARGIN - gap
        other.pos[1] += d
        other.setDirtyCanvas(true, false)
        queue.push([other, d])
      } else {
        // Only nodes that were directly underneath before the shrink (their
        // gap against the mover's previous bottom was at most one row).
        const oldGap = other.pos[1] - (moverBottom - bottomDelta)
        if (oldGap > LAYOUT_MARGIN) continue
        let d = moverBottom + LAYOUT_MARGIN - other.pos[1]
        if (d >= 0) continue // already at/past the new margin — never push on shrink
        const floor = topFloor(graph, other)
        if (other.pos[1] + d < floor) d = floor - other.pos[1]
        if (d >= 0) continue
        other.pos[1] += d
        other.setDirtyCanvas(true, false)
        queue.push([other, d])
      }
    }
  }
}

// ─── Add-time snapping ───────────────────────────────────────────────────────

const addHooked = new WeakSet<LGraph>()

function hookAdds(graph: LGraph): void {
  if (addHooked.has(graph)) return
  addHooked.add(graph)
  const previous = graph.onNodeAdded
  graph.onNodeAdded = function (node: LGraphNode) {
    previous?.call(graph, node)
    node.pos[0] = Math.round(node.pos[0] / LAYOUT_MARGIN) * LAYOUT_MARGIN
    node.pos[1] = Math.round(node.pos[1] / LAYOUT_MARGIN) * LAYOUT_MARGIN
    // Routes the constructor's natural size through the onResize snap.
    node.setSize(node.computeSize())
  }
}
