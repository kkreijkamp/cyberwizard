import { LGraph, LiteGraph } from '@comfyorg/litegraph'
import type { LGraphNode } from '@comfyorg/litegraph'
import { setParam } from './core/registry'

export interface Showcase {
  graph: LGraph
  nodes: {
    input: LGraphNode
    sha: LGraphNode
    hashPreview: LGraphNode
    key: LGraphNode
    xor: LGraphNode
    b64: LGraphNode
    cipherPreview: LGraphNode
  }
}

/**
 * The M1 showcase: one input fans out into an async SHA-256 branch and an
 * XOR-with-key-wire → Base64 branch — fan-out, multi-input, async, and
 * string↔bytes coercion edges in a single graph.
 */
export function buildShowcaseGraph(): Showcase {
  const graph = new LGraph()

  const spawn = (type: string, pos: [number, number], title?: string): LGraphNode => {
    const node = LiteGraph.createNode(type, title)
    if (!node) throw new Error(`node type not registered: ${type}`)
    node.pos = pos
    graph.add(node)
    return node
  }

  const input = spawn('io/text-input', [40, 300])
  setParam(input, 'text', 'Hello, Wizard')

  const sha = spawn('hashing/sha-256', [420, 120])
  const hashPreview = spawn('io/preview', [780, 120], 'SHA-256 (hex)')

  const key = spawn('io/text-input', [40, 560], 'XOR Key')
  setParam(key, 'text', 's3cret')
  const xor = spawn('logic/xor', [420, 440])
  const b64 = spawn('encoding/base64-encode', [700, 440])
  const cipherPreview = spawn('io/preview', [1020, 440], 'XOR → Base64')

  input.connect(0, sha, 0)
  input.connect(0, xor, 0)
  key.connect(0, xor, 1)
  sha.connect(1, hashPreview, 0)
  xor.connect(0, b64, 0)
  b64.connect(0, cipherPreview, 0)

  // connect() silently returns null when isValidConnection rejects a pair —
  // fail loudly instead of building a subtly unwired graph.
  for (const node of graph._nodes) {
    for (const inputSlot of node.inputs) {
      if (inputSlot.link == null) throw new Error(`showcase wiring failed: ${node.title} input "${inputSlot.name}" is unlinked`)
    }
  }

  return { graph, nodes: { input, sha, hashPreview, key, xor, b64, cipherPreview } }
}
