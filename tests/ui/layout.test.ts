import { LGraph, LiteGraph } from '@comfyorg/litegraph'
import type { LGraphNode } from '@comfyorg/litegraph'
import { describe, expect, it } from 'vitest'
import { LAYOUT_CELL, LAYOUT_MARGIN, TITLE_HEIGHT, installNodeLayout, snapDim } from '../../src/ui/layout'
import '../../src/nodes'

function spawn(graph: LGraph, x: number, y: number): LGraphNode {
  const node = LiteGraph.createNode('io/text-input')
  if (!node) throw new Error('unregistered')
  node.pos = [x, y]
  graph.add(node)
  return node
}

/** Visual bottom (pos + body height). Visual top is pos − TITLE_HEIGHT. */
const bottom = (n: LGraphNode): number => n.pos[1] + n.size[1]
/** Stacked nodes keep one row of margin between visual boxes: gap = margin + title. */
const GAP = LAYOUT_MARGIN + TITLE_HEIGHT

const sizeOf = (n: LGraphNode): [number, number] => [n.size[0]!, n.size[1]!]

const sizesEqual = (n: LGraphNode, size: [number, number]): void => {
  expect([...sizeOf(n)]).toEqual(size)
}

/** Stacks b below a with one row of margin between their visual boxes. */
function stackBelow(a: LGraphNode, b: LGraphNode): void {
  b.pos[1] = bottom(a) + GAP
}

describe('snapDim', () => {
  it('snaps up to the next 40-mod-50 cell size', () => {
    expect(snapDim(0)).toBe(40)
    expect(snapDim(40)).toBe(40)
    expect(snapDim(41)).toBe(90)
    expect(snapDim(89)).toBe(90)
    expect(snapDim(90)).toBe(90)
    expect(snapDim(91)).toBe(140)
    expect(snapDim(140)).toBe(140)
    expect(snapDim(141)).toBe(190)
    expect(snapDim(1000)).toBe(1040)
  })
})

describe('cell layout', () => {
  it('snaps node size on creation, title bar included', () => {
    const graph = new LGraph()
    installNodeLayout(graph)
    const node = spawn(graph, 0, 0)
    expect((node.size[0] - 40) % LAYOUT_CELL).toBe(0)
    // Body ≡ 10 (mod 50), so title + body ≡ 40 (mod 50) — the cell rule.
    expect((node.size[1] + TITLE_HEIGHT - 40) % LAYOUT_CELL).toBe(0)
  })

  it('snaps a manual resize up to the next cell', () => {
    const graph = new LGraph()
    installNodeLayout(graph)
    const node = spawn(graph, 0, 0)
    const [w, h] = sizeOf(node)
    node.setSize([w + 13, h + 7])
    sizesEqual(node, [w + LAYOUT_CELL, h + LAYOUT_CELL])
  })

  it('growing pushes the whole column underneath down', () => {
    const graph = new LGraph()
    installNodeLayout(graph)
    const a = spawn(graph, 0, 0)
    const b = spawn(graph, 0, 0)
    const c = spawn(graph, 0, 0)
    const aside = spawn(graph, 1000, 0)
    stackBelow(a, b)
    stackBelow(b, c)
    aside.pos[1] = b.pos[1]

    a.setSize([a.size[0], a.size[1] + LAYOUT_CELL])

    expect(b.pos[1]).toBe(bottom(a) + GAP)
    expect(c.pos[1]).toBe(bottom(b) + GAP)
    expect(aside.pos[1]).not.toBe(b.pos[1]) // untouched: no horizontal overlap
  })

  it('shrinking pulls directly-underneath nodes back up', () => {
    const graph = new LGraph()
    installNodeLayout(graph)
    const a = spawn(graph, 0, 0)
    const b = spawn(graph, 0, 0)
    const c = spawn(graph, 0, 0)
    stackBelow(a, b)
    stackBelow(b, c)
    const [w, h] = sizeOf(a)

    a.setSize([w, h + LAYOUT_CELL])
    a.setSize([w, h]) // shrink back

    expect(b.pos[1]).toBe(bottom(a) + GAP)
    expect(c.pos[1]).toBe(bottom(b) + GAP)
  })

  it('leaves nodes with more than one row of gap alone', () => {
    const graph = new LGraph()
    installNodeLayout(graph)
    const a = spawn(graph, 0, 0)
    const far = spawn(graph, 0, 0)
    far.pos[1] = bottom(a) + GAP + 500
    const before = far.pos[1]

    a.setSize([a.size[0], a.size[1] + LAYOUT_CELL])
    a.setSize([a.size[0], a.size[1] - LAYOUT_CELL])

    expect(far.pos[1]).toBe(before)
  })

  it('clamps a pull-up so the rising node never collides with an unrelated node above', () => {
    const graph = new LGraph()
    installNodeLayout(graph)
    const a = spawn(graph, 0, 0)
    // b sits under a and horizontally overlaps both a and x…
    const b = spawn(graph, 100, 0)
    stackBelow(a, b)
    // …while x is above b (its visual bottom sits 30px into the margin gap)
    // but does NOT overlap a, so a's reflow ignores it.
    const x = spawn(graph, b.pos[0] + b.size[0] - 40, 0)
    x.pos[1] = bottom(a) + TITLE_HEIGHT - x.size[1]

    a.setSize([a.size[0], a.size[1] + LAYOUT_CELL]) // pushes b below x
    expect(b.pos[1]).toBe(bottom(a) + GAP)

    a.setSize([a.size[0], a.size[1] - LAYOUT_CELL]) // b rises, but x is in the way
    expect(b.pos[1]).toBe(bottom(x) + GAP)
    expect(b.pos[1]).toBeGreaterThan(bottom(a) + GAP) // the clamp beat the naive pull
  })
})
