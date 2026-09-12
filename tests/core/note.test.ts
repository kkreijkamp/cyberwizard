import { LGraph, LiteGraph } from '@comfyorg/litegraph'
import { describe, expect, it } from 'vitest'
import {
  PREVIEW_WIDGET_NAME,
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
  it('constructs with hidden param widgets, a note body widget, and no preview well', () => {
    const node = mkNote(new LGraph())
    const def = getNodeDef(node)
    expect(def?.type).toBe('notes/note')
    expect(node.inputs.length).toBe(0)
    expect(node.outputs.length).toBe(0)

    const byName = new Map((node.widgets ?? []).map((w) => [w.name, w]))
    expect(byName.has(PREVIEW_WIDGET_NAME)).toBe(false)
    expect((paramWidgets(node).get('text') as { hidden?: boolean } | undefined)?.hidden).toBe(true)
    expect((paramWidgets(node).get('tint') as { hidden?: boolean } | undefined)?.hidden).toBe(true)
    expect(byName.has('note')).toBe(true)
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
