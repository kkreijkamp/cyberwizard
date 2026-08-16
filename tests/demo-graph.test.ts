import { describe, expect, it } from 'vitest'
import type { LGraph } from '@comfyorg/litegraph'
import { buildDemoGraph } from '../src/demo/demo-graph'
import { PreviewNode, TextInputNode } from '../src/demo/nodes'

/** Preview widget values, ordered top-to-bottom by node position. */
function previewValues(graph: LGraph): string[] {
  return graph._nodes
    .filter((n): n is PreviewNode => n instanceof PreviewNode)
    .sort((a, b) => a.pos[1] - b.pos[1])
    .map((n) => String(n.widgets?.[0]?.value ?? ''))
}

describe('M0 demo graph', () => {
  it('fans one input out to uppercase and reverse branches', () => {
    const graph = buildDemoGraph()
    graph.runStep(1, true)
    expect(previewValues(graph)).toEqual(['HELLO, WIZARD', 'draziW ,olleH'])
  })

  it('re-runs downstream nodes when the input changes', () => {
    const graph = buildDemoGraph()
    const input = graph._nodes.find((n): n is TextInputNode => n instanceof TextInputNode)
    expect(input).toBeDefined()
    if (!input) return

    input.properties.text = 'abc'
    graph.runStep(1, true)
    expect(previewValues(graph)).toEqual(['ABC', 'cba'])
  })
})
