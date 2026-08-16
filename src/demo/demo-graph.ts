import { LGraph, LiteGraph } from '@comfyorg/litegraph'
import type { LGraphNode } from '@comfyorg/litegraph'
import { DEMO_TYPES, registerDemoNodes } from './nodes'

/**
 * The M0 demo graph: one text input fans out into two parallel transform
 * branches (uppercase + reverse), each ending in a live preview — the
 * simplest graph a linear CyberChef recipe cannot express.
 */
export function buildDemoGraph(): LGraph {
  registerDemoNodes()

  const graph = new LGraph()

  const input = spawn(graph, DEMO_TYPES.textInput, [40, 260])
  const upper = spawn(graph, DEMO_TYPES.toUpperCase, [400, 140])
  const reverse = spawn(graph, DEMO_TYPES.reverse, [400, 380])
  const upperPreview = spawn(graph, DEMO_TYPES.preview, [760, 140], 'Preview — Uppercase')
  const reversePreview = spawn(graph, DEMO_TYPES.preview, [760, 380], 'Preview — Reverse')

  input.connect(0, upper, 0)
  input.connect(0, reverse, 0)
  upper.connect(0, upperPreview, 0)
  reverse.connect(0, reversePreview, 0)

  return graph
}

function spawn(
  graph: LGraph,
  type: string,
  pos: [number, number],
  title?: string,
): LGraphNode {
  const node = LiteGraph.createNode(type, title)
  if (!node) throw new Error(`Demo node type not registered: ${type}`)
  node.pos = pos
  graph.add(node)
  return node
}
