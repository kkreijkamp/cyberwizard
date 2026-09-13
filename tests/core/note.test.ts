import { LGraph, LiteGraph } from '@comfyorg/litegraph'
import { describe, expect, it } from 'vitest'
import {
  getNodeDef,
  installConnectionRules,
  isConvertibleParam,
  paramWidgets,
  setParam,
} from '../../src/core/registry'
import { deserializeGraph, serializeGraph } from '../../src/core/serialize'
import '../../src/nodes'

installConnectionRules()

function mkNote(graph: LGraph) {
  const node = LiteGraph.createNode('notes/note')
  if (!node) throw new Error('unregistered: notes/note')
  graph.add(node)
  return node
}

describe('notes/note', () => {
  it('constructs with no param widgets (only the body widget), and no preview well', () => {
    const node = mkNote(new LGraph())
    const def = getNodeDef(node)
    expect(def?.type).toBe('notes/note')
    expect(node.inputs.length).toBe(0)
    expect(node.outputs.length).toBe(0)

    // Hidden params are pure properties: no widget rows, nothing for
    // litegraph's widget layout to leave gaps with.
    expect((node.widgets ?? []).map((w) => w.name)).toEqual(['note'])
    expect(paramWidgets(node).has('text')).toBe(false)
    expect(paramWidgets(node).has('tint')).toBe(false)
    expect(node.properties.text).toBe('')
    expect(node.properties.tint).toBe('Notes')
  })

  it('sizes its body to the content without the phantom slot row', () => {
    const node = mkNote(new LGraph())
    const widget = (node.widgets ?? [])[0] as unknown as { computeSize(w?: number): [number, number] }
    // The library's computeSize lays widgets out at its own min width
    // (NODE_WIDTH × 1.5 when widgets exist), not node.size.
    const content = widget.computeSize(LiteGraph.NODE_WIDTH * 1.5)[1]
    // Content + litegraph's per-widget margins and footer (4 + 8 + 6 on
    // pinned 0.17.2) — the slotless node's clamped 20px slot row is
    // subtracted by the note.
    expect(node.computeSize()[1]).toBe(content + 18)
  })

  it('never offers its params as connection points', () => {
    const node = mkNote(new LGraph())
    const def = getNodeDef(node)
    for (const param of def?.params ?? []) {
      expect(isConvertibleParam(param)).toBe(false)
    }
  })

  it('round-trips text, tint, and a renamed title through serialization', () => {
    const graph = new LGraph()
    const note = mkNote(graph)
    setParam(note, 'text', '# Hello\n\n- a\n- b')
    setParam(note, 'tint', 'Hashing')
    note.title = 'Read me first'

    const doc = serializeGraph(graph)
    const saved = doc.nodes.find((n) => n.type === 'notes/note')
    expect(saved?.params.text).toBe('# Hello\n\n- a\n- b')
    expect(saved?.params.tint).toBe('Hashing')
    expect(saved?.title).toBe('Read me first')

    const restored = new LGraph()
    const { warnings } = deserializeGraph(doc, restored)
    expect(warnings).toEqual([])
    const back = restored._nodes.find((n) => getNodeDef(n)?.type === 'notes/note')
    expect(back?.properties.text).toBe('# Hello\n\n- a\n- b')
    expect(back?.properties.tint).toBe('Hashing')
    expect(back?.title).toBe('Read me first')
  })

  it('keeps the default tint and title out of the document', () => {
    const graph = new LGraph()
    mkNote(graph)
    const doc = serializeGraph(graph)
    const saved = doc.nodes.find((n) => n.type === 'notes/note')
    expect(saved?.title).toBeUndefined()
    expect(saved?.params.tint).toBe('Notes')
  })
})
