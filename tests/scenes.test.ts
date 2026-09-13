import { LGraph } from '@comfyorg/litegraph'
import { describe, expect, it } from 'vitest'
import { Engine } from '../src/core/engine'
import { installConnectionRules } from '../src/core/registry'
import type { GraphDocument } from '../src/core/serialize'
import { deserializeGraph } from '../src/core/serialize'
import { buildStateDump } from '../src/core/state-dump'
import { attachSubgraphSupport } from '../src/core/subgraph'
import { SCENES } from '../src/scenes'
import '../src/nodes'

installConnectionRules()

interface DumpedNode {
  id: number | string
  title: string
  type: string | null
  state: string
  error?: string
}

function loadScene(build: () => GraphDocument) {
  const doc = build()
  // Documents must be JSON-clean (they're saved/shared as JSON).
  const json = JSON.parse(JSON.stringify(doc)) as GraphDocument
  const graph = new LGraph()
  const engine = new Engine(graph)
  const detach = attachSubgraphSupport(graph, engine)
  const { warnings } = deserializeGraph(json, graph)
  return { graph, engine, warnings, dispose: () => (detach(), engine.dispose()) }
}

describe('example scenes', () => {
  for (const scene of SCENES) {
    it(`"${scene.title}" loads and computes with zero failures`, async () => {
      const { graph, engine, warnings, dispose } = loadScene(scene.build)
      expect(warnings).toEqual([])
      await engine.whenIdle()

      const dump = buildStateDump(engine) as unknown as {
        root: { nodes: DumpedNode[] }
        calls: Array<{ path: string; nodes: DumpedNode[] }>
      }
      const failing = [
        ...dump.root.nodes.map((n) => ({ ...n, where: 'root' })),
        ...dump.calls.flatMap((c) => c.nodes.map((n) => ({ ...n, where: c.path }))),
      ].filter((n) => n.state === 'error' || n.state === 'blocked')
      expect(
        failing.map((n) => `${n.title} (${n.type}, ${n.where}): ${n.error ?? 'blocked'}`),
        'scene has failing nodes after evaluation',
      ).toEqual([])

      // Every scene teaches: at least two notes and one live preview.
      const notes = graph._nodes.filter((n) => n.type === 'notes/note')
      expect(notes.length, 'scene should explain itself with notes').toBeGreaterThanOrEqual(2)
      const previews = graph._nodes.filter((n) => n.type === 'io/preview')
      expect(previews.length, 'scene should show values live').toBeGreaterThanOrEqual(1)
      dispose()
    }, 20_000)
  }
})
