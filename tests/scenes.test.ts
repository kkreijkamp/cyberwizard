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

interface EncodedValue {
  kind: string
  value?: unknown
  base64?: string
  items?: EncodedValue[]
}

interface DumpedNode {
  id: number | string
  title: string
  type: string | null
  state: string
  inputs?: Record<string, EncodedValue>
  outputs?: EncodedValue[]
  error?: string
}

interface Dump {
  root: { nodes: DumpedNode[] }
  calls: Array<{ path: string; nodes: DumpedNode[] }>
}

/** Finds a root node by title (titles in scenes are stable on purpose). */
function rootNode(dump: Dump, title: string): DumpedNode {
  const node = dump.root.nodes.find((n) => n.title === title)
  if (!node) throw new Error(`no root node titled "${title}"`)
  return node
}

/** A Preview sink's displayed value (sinks have no outputs: inputs carry it). */
function sinkValue(dump: Dump, title: string): EncodedValue | undefined {
  const sink = dump.root.nodes.find((n) => n.title === title && n.type === 'io/preview')
  if (!sink) throw new Error(`no Preview titled "${title}"`)
  return sink.inputs?.value
}

/**
 * Teaching-critical values: "no errors" isn't enough, a scene must produce
 * the exact values its notes promise.
 */
const EXPECTED_VALUES: Record<string, (dump: Dump) => void> = {
  'welcome-tour': (dump) => {
    expect(rootNode(dump, 'Base64 Encode').outputs).toEqual([{ kind: 'string', value: 'SGVsbG8sIFdpemFyZA==' }])
  },
  'hashes-avalanche': (dump) => {
    const a = rootNode(dump, 'SHA-256 of A').outputs?.[1]?.value
    const bDigest = rootNode(dump, 'SHA-256 of B').outputs?.[1]?.value
    expect(a).toMatch(/^[0-9a-f]{64}$/)
    expect(bDigest).toMatch(/^[0-9a-f]{64}$/)
    expect(a).not.toBe(bDigest)
  },
  'aes-gcm': (dump) => {
    expect(sinkValue(dump, 'Decrypted ✓')).toEqual({ kind: 'string', value: 'meet me at midnight, bring the kraken' })
    expect(rootNode(dump, 'Nonce used').state).toBe('ok')
  },
  'pbkdf2-passwords': (dump) => {
    expect(sinkValue(dump, 'Decrypted ✓')).toEqual({ kind: 'string', value: 'the eagle lands at dawn' })
  },
  'rsa-hybrid': (dump) => {
    expect(sinkValue(dump, 'Decrypted ✓')).toEqual({
      kind: 'string',
      value: 'a whole message, far longer than 190 bytes could ever be',
    })
  },
  signatures: (dump) => {
    expect(sinkValue(dump, 'Verdict')).toEqual({ kind: 'string', value: '✓ authentic: the signature matches' })
  },
  'ecdh-agreement': (dump) => {
    const a = sinkValue(dump, 'Shared secret (Alice)')
    const bS = sinkValue(dump, 'Shared secret (Bob, identical!)')
    expect(a?.kind).toBe('bytes')
    expect(a?.base64).toBe(bS?.base64) // the whole point: identical secrets
  },
  'jwt-anatomy': (dump) => {
    expect(sinkValue(dump, 'Name claim')).toEqual({ kind: 'string', value: 'John Doe' })
    expect(sinkValue(dump, 'Signature valid?')).toEqual({ kind: 'boolean', value: true })
  },
  'recursion-lens': (dump) => {
    expect(rootNode(dump, 'Factorial').outputs).toEqual([{ kind: 'number', value: 720 }])
  },
  'list-pipelines': (dump) => {
    expect(sinkValue(dump, 'Result')).toEqual({ kind: 'string', value: 'ENCRYPTION TEAM SPORT' })
  },
  'peeling-layers': (dump) => {
    expect(sinkValue(dump, 'Plaintext ✓')).toEqual({ kind: 'string', value: 'meet me at midnight' })
  },
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

      const dump = buildStateDump(engine) as unknown as Dump
      const failing = [
        ...dump.root.nodes.map((n) => ({ ...n, where: 'root' })),
        ...dump.calls.flatMap((c) => c.nodes.map((n) => ({ ...n, where: c.path }))),
      ].filter((n) => n.state === 'error' || n.state === 'blocked')
      expect(
        failing.map((n) => `${n.title} (${n.type}, ${n.where}): ${n.error ?? 'blocked'}`),
        'scene has failing nodes after evaluation',
      ).toEqual([])

      // Teaching-critical values, per scene.
      EXPECTED_VALUES[scene.id]?.(dump)

      // Every scene teaches: at least two notes and one live preview.
      // Notes inside subgraph definitions count: they explain the interior.
      const allNodes = [
        ...graph._nodes,
        ...[...graph.subgraphs.values()].flatMap((sub) => sub._nodes),
      ]
      const notes = allNodes.filter((n) => n.type === 'notes/note')
      expect(notes.length, 'scene should explain itself with notes').toBeGreaterThanOrEqual(2)
      const previews = allNodes.filter((n) => n.type === 'io/preview')
      expect(previews.length, 'scene should show values live').toBeGreaterThanOrEqual(1)
      dispose()
    }, 20_000)
  }
})
