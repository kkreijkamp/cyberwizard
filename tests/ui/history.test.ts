import { LGraph, LiteGraph } from '@comfyorg/litegraph'
import type { LGraphCanvas, LGraphNode, Subgraph } from '@comfyorg/litegraph'
import { describe, expect, it } from 'vitest'
import { installConnectionRules, setParam } from '../../src/core/registry'
import { serializeGraph, deserializeGraph } from '../../src/core/serialize'
import { clearSubgraphDefs, createSubgraphDef, rawSubgraph } from '../../src/core/subgraph'
import type { HistoryDriver } from '../../src/ui/history'
import { installHistory } from '../../src/ui/history'
import { installNodeLayout } from '../../src/ui/layout'
import '../../src/nodes'

installConnectionRules()

interface FakeCanvas {
  graph: LGraph | Subgraph
  setGraph(g: LGraph | Subgraph): void
}

function rig(): { graph: LGraph; canvas: FakeCanvas; driver: HistoryDriver } {
  const graph = new LGraph()
  installNodeLayout(graph) // the app's real restore environment
  const canvas: FakeCanvas = {
    graph,
    setGraph(g) {
      this.graph = g
    },
  }
  const driver = installHistory(graph, canvas as unknown as LGraphCanvas)
  return { graph, canvas, driver }
}

function spawn(graph: LGraph, type: string, title?: string): LGraphNode {
  const node = LiteGraph.createNode(type)
  if (!node) throw new Error(`unregistered: ${type}`)
  if (title !== undefined) node.title = title
  graph.add(node)
  return node
}

describe('graph undo/redo', () => {
  it('undoes and redoes a node addition', () => {
    const { graph, driver } = rig()
    spawn(graph, 'io/text-input', 'A')
    driver.flush()

    const b = spawn(graph, 'io/text-input', 'B')
    driver.flush()
    expect(graph._nodes).toHaveLength(2)

    driver.undo()
    expect(graph._nodes.map((n) => n.title)).toEqual(['A'])

    driver.redo()
    expect(graph._nodes.map((n) => n.title)).toEqual(['A', 'B'])
    expect(graph._nodes[1]?.id).toBe(b.id) // ids are stable across undo
    driver.dispose()
  })

  it('undoes a param edit (widget-level changes are caught by the poll model)', () => {
    const { graph, driver } = rig()
    const a = spawn(graph, 'io/text-input')
    setParam(a, 'text', 'before')
    driver.flush()

    setParam(a, 'text', 'after')
    driver.flush()
    driver.undo()
    expect(graph._nodes[0]?.properties.text).toBe('before')
    driver.redo()
    expect(graph._nodes[0]?.properties.text).toBe('after')
    driver.dispose()
  })

  it('restores a deleted node and its links', () => {
    const { graph, driver } = rig()
    const a = spawn(graph, 'io/text-input')
    const bNode = spawn(graph, 'io/preview')
    a.connect(0, bNode, 0)
    driver.flush()

    graph.remove(bNode)
    driver.flush()
    expect(graph._nodes).toHaveLength(1)
    expect(graph._links.size).toBe(0)

    driver.undo()
    expect(graph._nodes).toHaveLength(2)
    expect(graph._links.size).toBe(1)
    driver.dispose()
  })

  it('a fresh edit after undo kills the redo future', () => {
    const { graph, driver } = rig()
    spawn(graph, 'io/text-input', 'A')
    driver.flush()
    spawn(graph, 'io/text-input', 'B')
    driver.flush()

    driver.undo()
    expect(driver.canRedo()).toBe(true)

    spawn(graph, 'io/text-input', 'C')
    driver.flush()
    expect(driver.canRedo()).toBe(false)
    expect(graph._nodes.map((n) => n.title)).toEqual(['A', 'C'])
    driver.dispose()
  })

  it('checkpoint makes an external replacement (New/Load) undoable', () => {
    const { graph, driver } = rig()
    spawn(graph, 'io/text-input', 'work-in-progress')
    driver.flush()

    driver.checkpoint()
    graph.clear()
    clearSubgraphDefs(graph) // what btn-new does
    driver.flush()
    expect(graph._nodes).toHaveLength(0)
    expect(driver.canUndo()).toBe(true)

    driver.undo()
    expect(graph._nodes.map((n) => n.title)).toEqual(['work-in-progress'])
    driver.dispose()
  })

  it('stays inside the open definition across an undo when it survives', () => {
    const { graph, canvas, driver } = rig()
    const meta = createSubgraphDef(graph, 'Box')
    driver.flush() // baseline INCLUDES the definition
    const sub = rawSubgraph(graph, meta.id)
    if (!sub) throw new Error('no subgraph')
    canvas.setGraph(sub) // user is inside the definition

    const inner = LiteGraph.createNode('io/text-input')
    if (!inner) throw new Error('unregistered')
    sub.add(inner)
    driver.flush()
    expect(sub._nodes).toHaveLength(1)

    driver.undo()
    // Interior node undone, and the canvas is re-pointed at the NEW Subgraph
    // object for the same definition (the old one was discarded on restore).
    const fresh = rawSubgraph(graph, meta.id)
    expect(canvas.graph).toBe(fresh)
    expect(canvas.graph).not.toBe(sub)
    expect(fresh?._nodes).toHaveLength(0)
    driver.dispose()
  })

  it('drops to root when the open definition is deleted by the undo', () => {
    const { graph, canvas, driver } = rig()
    driver.flush() // baseline: no definition
    const meta = createSubgraphDef(graph, 'Box')
    const sub = rawSubgraph(graph, meta.id)
    if (!sub) throw new Error('no subgraph')
    canvas.setGraph(sub)
    driver.flush()

    driver.undo() // removes the definition entirely
    expect(rawSubgraph(graph, meta.id)).toBeUndefined()
    expect(canvas.graph).toBe(graph)
    driver.dispose()
  })

  it('flush without changes creates no entries', () => {
    const { driver } = rig()
    driver.flush()
    driver.flush()
    expect(driver.canUndo()).toBe(false)
    driver.dispose()
  })

  it('redo survives a restore whose geometry would previously have reflowed', () => {
    // An UNSETTLED document (built without layout): a tall note one margin
    // above a preview. Restoring it used to trigger the add-time reflow,
    // moving the preview off its snapshot position; the history poll saw
    // that as a fresh edit and clobbered the redo stack.
    const source = new LGraph()
    const note = LiteGraph.createNode('notes/note')
    if (!note) throw new Error('unregistered')
    note.pos = [50, 50]
    setParam(note, 'text', 'line\n'.repeat(80))
    source.add(note)
    const preview = LiteGraph.createNode('io/preview')
    if (!preview) throw new Error('unregistered')
    preview.pos = [50, 550]
    source.add(preview)
    const doc = serializeGraph(source)

    const { graph, driver } = rig()
    driver.checkpoint()
    deserializeGraph(doc, graph)
    driver.flush() // adopt the document

    const marker = spawn(graph, 'io/text-input', 'edit')
    driver.flush()

    driver.undo()
    driver.flush() // simulates the poll after the restore
    expect(driver.canRedo()).toBe(true)

    driver.redo()
    expect(graph._nodes.some((n) => n.id === marker.id)).toBe(true)
    driver.dispose()
  })
})
