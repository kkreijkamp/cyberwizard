/**
 * Drag-end snap repair (src/ui/layout.ts): the library only snaps dragged
 * items from CanvasPointer.onDragEnd on a clean pointerup; pointercancel, a
 * second pointerdown mid-drag, and a lost pointerup all abandon the drag
 * silently. The repair snaps the dragged selection before each of those.
 *
 * The repair wraps LGraphCanvas's pointer-entry methods, so the heavy
 * originals (they need a real DOM canvas) are stubbed BEFORE the first
 * installNodeLayout call below: the wrappers then chain into the stubs and
 * the tests can drive them with a minimal fake canvas. processMouseCancel's
 * real body (console.warn + pointer.reset()) survives the fake, so it is
 * kept: its test also proves the original reset still runs.
 */
import { CanvasPointer, LGraph, LGraphCanvas, LiteGraph } from '@comfyorg/litegraph'
import type { CanvasPointerEvent, LGraphNode } from '@comfyorg/litegraph'
import { beforeEach, describe, expect, it } from 'vitest'
import { LAYOUT_CELL, installNodeLayout } from '../../src/ui/layout'
import '../../src/nodes'

// Mirror main.ts: 50px cells, unconditional snapping.
LiteGraph.CANVAS_GRID_SIZE = LAYOUT_CELL
LiteGraph.alwaysSnapToGrid = true

const stubbedDown: PointerEvent[] = []
const stubbedMove: PointerEvent[] = []
LGraphCanvas.prototype.processMouseDown = function (this: LGraphCanvas, e: PointerEvent): void {
  stubbedDown.push(e)
}
LGraphCanvas.prototype.processMouseMove = function (this: LGraphCanvas, e: PointerEvent): void {
  stubbedMove.push(e)
}

function fakeElement(): Element {
  return {
    setPointerCapture: () => {},
    hasPointerCapture: () => false,
    releasePointerCapture: () => {},
  } as unknown as Element
}

function ev(overrides: Record<string, unknown> = {}): CanvasPointerEvent {
  return {
    pointerId: 1,
    button: 0,
    buttons: 1,
    isPrimary: true,
    timeStamp: 1000,
    clientX: 100,
    clientY: 100,
    ...overrides,
  } as unknown as CanvasPointerEvent
}

interface DragInFlight {
  canvas: LGraphCanvas
  node: LGraphNode
  moved: Array<LGraphNode | undefined>
}

/**
 * A canvas mid-item-drag: the pointer is past the click-drift threshold
 * (dragStarted), the canvas isDragging, and the node sits at a raw,
 * off-grid position the way the library's move loop leaves it.
 */
function dragInFlight(graph: LGraph): DragInFlight {
  const node = LiteGraph.createNode('io/text-input')
  if (!node) throw new Error('unregistered')
  graph.add(node)
  const pointer = new CanvasPointer(fakeElement())
  const moved: Array<LGraphNode | undefined> = []
  const canvas = {
    pointer,
    graph,
    isDragging: false,
    dragZoomEnabled: false,
    selectedItems: new Set([node]),
    setDirty: () => {},
    onNodeMoved: (n: LGraphNode | undefined) => moved.push(n),
  } as unknown as LGraphCanvas
  pointer.down(ev())
  pointer.move(ev({ clientX: 140, clientY: 130, timeStamp: 1100 }))
  if (!pointer.dragStarted) throw new Error('drag did not start')
  // What #startDraggingItems + the raw move loop would have done:
  canvas.isDragging = true
  node.pos = [137, 213]
  return { canvas, node, moved }
}

const onGrid = (node: LGraphNode): boolean => node.pos[0] % LAYOUT_CELL === 0 && node.pos[1] % LAYOUT_CELL === 0

describe('drag-end snap repair', () => {
  beforeEach(() => {
    stubbedDown.length = 0
    stubbedMove.length = 0
  })

  it('snaps when a second pointerdown interrupts the drag', () => {
    const graph = new LGraph()
    installNodeLayout(graph)
    const { canvas, node, moved } = dragInFlight(graph)

    LGraphCanvas.prototype.processMouseDown.call(
      canvas,
      ev({ clientX: 400, clientY: 400, button: 2, buttons: 3, timeStamp: 1200 }),
    )

    expect(onGrid(node)).toBe(true)
    expect(moved).toEqual([node])
    expect(stubbedDown).toHaveLength(1) // the drag is still abandoned, as before
  })

  it('snaps when the pointerup is lost and a move arrives with no buttons', () => {
    const graph = new LGraph()
    installNodeLayout(graph)
    const { canvas, node, moved } = dragInFlight(graph)

    LGraphCanvas.prototype.processMouseMove.call(canvas, ev({ clientX: 145, clientY: 133, buttons: 0, timeStamp: 1200 }))

    expect(onGrid(node)).toBe(true)
    expect(moved).toEqual([node])
    expect(stubbedMove).toHaveLength(1)
  })

  it('snaps when the browser cancels the pointer, and still resets', () => {
    const graph = new LGraph()
    installNodeLayout(graph)
    const { canvas, node, moved } = dragInFlight(graph)

    LGraphCanvas.prototype.processMouseCancel.call(canvas)

    expect(onGrid(node)).toBe(true)
    expect(moved).toEqual([node])
    expect(canvas.pointer.dragStarted).toBe(false) // the real reset still ran
  })

  it('does not snap mid-drag while the gesture is healthy', () => {
    const graph = new LGraph()
    installNodeLayout(graph)
    const { canvas, node, moved } = dragInFlight(graph)

    LGraphCanvas.prototype.processMouseMove.call(canvas, ev({ clientX: 145, clientY: 133, timeStamp: 1150 }))

    expect(node.pos[0]).toBe(137) // untouched until the drag ends
    expect(moved).toHaveLength(0)
    expect(stubbedMove).toHaveLength(1)
  })

  it('leaves non-item drags (links, marquee) on the old silent path', () => {
    const graph = new LGraph()
    installNodeLayout(graph)
    const { canvas, node, moved } = dragInFlight(graph)
    canvas.isDragging = false // link drags and marquee selects never set it

    LGraphCanvas.prototype.processMouseCancel.call(canvas)

    expect(node.pos[0]).toBe(137)
    expect(moved).toHaveLength(0)
  })
})
