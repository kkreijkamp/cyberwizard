/**
 * Cell layout: keeps every node aligned to the 50px cell grid.
 *
 * Sizes always snap to whole cells minus the margin between nodes: width
 * and height ≡ 30 (mod 50), snapping UP so content always fits. Note the
 * fork's size model: node.size is the BODY only, the 30px title bar
 * renders ABOVE pos, outside node.size (see LGraphNode.measure). So the
 * body's height snaps to ≡ 0 (mod 50), putting title+body on the cell
 * rhythm, and all stacking/reflow math works in visual bounds:
 * visualTop = pos − 30, visualBottom = pos + size.
 *
 * Enforcement is a prototype-level LGraphNode.onResize: in 0.17.2 every
 * size change funnels through setSize → onResize (creation, widget/slot
 * adds, subgraph IO sync, manual corner-drags), so one hook covers all of
 * them. Positions snap to the 50px cell grid at add time (drags are
 * handled by LiteGraph.alwaysSnapToGrid with CANVAS_GRID_SIZE=50, see
 * main.ts).
 *
 * Resizing reflows the column below: growing pushes overlapped neighbours
 * down so the one-row margin is restored (transitively); shrinking pulls
 * directly-underneath neighbours back up. A node is "directly underneath"
 * when it overlaps horizontally and has at most one margin (20px) of
 * vertical gap. Pull-ups are clamped so a rising node never collides with
 * an unrelated node above it.
 */

import { LGraphGroup, LGraphNode, LiteGraph } from '@comfyorg/litegraph'
import type { LGraph, Size } from '@comfyorg/litegraph'
import { onSubgraphDefsChange } from '../core/subgraph'

/** Five grid squares (LiteGraph.CANVAS_GRID_SIZE is 10). */
export const LAYOUT_CELL = 50
/** The margin between stacked/side-by-side nodes. */
export const LAYOUT_MARGIN = 20
/** Title bar height: rendered above pos, outside node.size. */
export const TITLE_HEIGHT = LiteGraph.NODE_TITLE_HEIGHT
const MIN_DIM = LAYOUT_CELL - LAYOUT_MARGIN

/**
 * Group bounds snap to the node grid shifted by this offset: a group's edges
 * sit 10px left of / 20px above the grid lines nodes sit on.
 */
export const GROUP_SNAP_OFFSET: readonly [number, number] = [-10, -20]

/** Snaps one dimension up to the next cell size: 40, 90, 140, 190, … */
export function snapDim(x: number): number {
  return Math.max(MIN_DIM, Math.ceil((x - MIN_DIM) / LAYOUT_CELL) * LAYOUT_CELL + MIN_DIM)
}

/** Snaps a BODY height so title + body lands on the cell rule (total ≡ 40 mod 50). */
function snapHeight(bodyH: number): number {
  return snapDim(bodyH + TITLE_HEIGHT) - TITLE_HEIGHT
}

/** Visual bounds: the title bar occupies the 30px above pos. */
function topOf(node: LGraphNode): number {
  return node.pos[1] - TITLE_HEIGHT
}

function bottomOf(node: LGraphNode): number {
  return node.pos[1] + node.size[1]
}

/**
 * Installs the layout hooks: the onResize prototype patch (once, global)
 * plus per-graph onNodeAdded snapping for the root graph and every
 * definition interior (present and future).
 */
export function installNodeLayout(rootGraph: LGraph): void {
  installResizeHook()
  installGroupSnap()
  installGroupMenu()
  hookAdds(rootGraph)
  for (const subgraph of rootGraph.subgraphs.values()) hookAdds(subgraph)
  onSubgraphDefsChange(rootGraph, () => {
    for (const subgraph of rootGraph.subgraphs.values()) hookAdds(subgraph)
  })
}

// ─── Group snapping ──────────────────────────────────────────────────────────

let groupSnapInstalled = false

/**
 * Groups share the library's uniform snapPoint (plain grid multiples); patch
 * the group's snapToGrid to use the offset lattice instead. Drags flow
 * through here; creation is snapped by the Add Group menu wrapper
 * (ui/subgraphs). Resize sizes snap to plain multiples, which keeps edges on
 * the lattice as long as the position is on it.
 */
function installGroupSnap(): void {
  if (groupSnapInstalled) return
  groupSnapInstalled = true
  LGraphGroup.prototype.snapToGrid = function (this: LGraphGroup, snapTo?: number): boolean {
    if (this.pinned) return false
    const grid = snapTo ?? LiteGraph.CANVAS_GRID_SIZE
    if (!grid) return false
    const [ox, oy] = GROUP_SNAP_OFFSET
    this.pos[0] = Math.round((this.pos[0] - ox) / grid) * grid + ox
    this.pos[1] = Math.round((this.pos[1] - oy) / grid) * grid + oy
    return true
  }
}

/**
 * The library's group menu (Pin / Title / Color / Font size) has no delete:
 * removing a group required selecting it and pressing Delete. Append a
 * direct "Delete Group" entry.
 */
function installGroupMenu(): void {
  const previous = LGraphGroup.prototype.getMenuOptions
  LGraphGroup.prototype.getMenuOptions = function (this: LGraphGroup) {
    const options = previous.call(this) as unknown[]
    options.push(null, {
      content: 'Delete Group',
      callback: () => {
        this.graph?.remove(this)
        this.setDirtyCanvas(true, true)
      },
    })
    return options as never
  }
}

// ─── Size snapping (onResize) ────────────────────────────────────────────────

/** Last snapped size per node: setSize overwrites node.size before firing onResize, so the previous height is tracked here. */
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
  const h = snapHeight(Math.max(min[1], requested[1]))
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

/** The lowest y (pos) a rising node may occupy: one row below anything directly above it. */
function topFloor(graph: LGraph, node: LGraphNode): number {
  let floor = Number.NEGATIVE_INFINITY
  for (const c of graph._nodes) {
    if (c === node || !xOverlap(c, node)) continue
    if (bottomOf(c) <= topOf(node)) floor = Math.max(floor, bottomOf(c) + LAYOUT_MARGIN + TITLE_HEIGHT)
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
    const moverBottom = bottomOf(mover)
    for (const other of graph._nodes) {
      if (other === mover || other.pinned || seen.has(other)) continue
      if (other.pos[1] < mover.pos[1]) continue // above or enclosing: not underneath
      if (!xOverlap(mover, other)) continue
      if (bottomDelta > 0) {
        const gap = topOf(other) - moverBottom
        if (gap >= LAYOUT_MARGIN) continue
        const d = LAYOUT_MARGIN - gap
        other.pos[1] += d
        other.setDirtyCanvas(true, false)
        queue.push([other, d])
      } else {
        // Only nodes that were directly underneath before the shrink (their
        // gap against the mover's previous bottom was at most one row).
        const oldGap = topOf(other) - (moverBottom - bottomDelta)
        if (oldGap > LAYOUT_MARGIN) continue
        // other's pos must restore the margin against the mover's VISUAL bottom.
        let d = moverBottom + LAYOUT_MARGIN + TITLE_HEIGHT - other.pos[1]
        if (d >= 0) continue // already at/past the new margin: never push on shrink
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
    node.pos[0] = Math.round(node.pos[0] / LAYOUT_CELL) * LAYOUT_CELL
    node.pos[1] = Math.round(node.pos[1] / LAYOUT_CELL) * LAYOUT_CELL
    // Routes the constructor's natural size through the onResize snap.
    node.setSize(node.computeSize())
  }
}
