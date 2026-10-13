import { LGraph } from '@comfyorg/litegraph'
import type { LGraphNode } from '@comfyorg/litegraph'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Engine } from '../src/core/engine'
import { installConnectionRules, setParam } from '../src/core/registry'
import { deserializeGraph } from '../src/core/serialize'
import { allSubgraphDefs, attachSubgraphSupport, scopeChainOf, visibleSubgraphDefs } from '../src/core/subgraph'
import { sha1FromScratch } from '../src/scenes/sha1-from-scratch'
import { installNodeLayout } from '../src/ui/layout'
import '../src/nodes'

installConnectionRules()

/**
 * The SHA-1 From Scratch scene must be a real SHA-1, twice: every digest
 * either implementation produces is checked against published FIPS 180
 * vectors or WebCrypto, and against the built-in node sitting next to it in
 * the same graph. Inputs are chosen to hit every padding boundary
 * (55/56/63/64 bytes…), multi-block messages, non-ASCII, and words with
 * leading zero bytes (the case minimal-length bignums make easy to get
 * wrong).
 */

const encoder = new TextEncoder()

async function webCryptoHex(text: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-1', encoder.encode(text)))
  return [...digest].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function hexOf(bytes: unknown): string {
  expect(bytes).toBeInstanceOf(Uint8Array)
  return [...(bytes as Uint8Array)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

let graph: LGraph
let engine: Engine
let dispose: () => void
let message: LGraphNode
let builtin: LGraphNode
let byHand: LGraphNode
let recursive: LGraphNode
let sameByHand: LGraphNode
let sameRecursive: LGraphNode

function rootNode(title: string): LGraphNode {
  const node = graph._nodes.find((n) => n.title === title)
  if (!node) throw new Error(`no root node titled "${title}"`)
  return node
}

beforeAll(() => {
  // Through JSON, exactly as a saved/shared document would load.
  const doc = JSON.parse(JSON.stringify(sha1FromScratch()))
  graph = new LGraph()
  installNodeLayout(graph)
  engine = new Engine(graph)
  const detach = attachSubgraphSupport(graph, engine)
  const { warnings } = deserializeGraph(doc, graph)
  expect(warnings).toEqual([])
  dispose = () => (detach(), engine.dispose())
  message = rootNode('Message')
  builtin = rootNode('SHA-1 (built-in)')
  byHand = rootNode('SHA-1 (by hand)')
  recursive = rootNode('SHA-1 (recursive)')
  sameByHand = rootNode('by hand = built-in?')
  sameRecursive = rootNode('recursive = built-in?')
})

afterAll(() => dispose())

interface Result {
  hex: string
  digestHex: string
  identical: unknown
}

interface Results {
  byHand: Result
  recursive: Result
  builtinHex: string
}

function resultOf(impl: LGraphNode, same: LGraphNode): Result {
  expect(engine.stateOf(impl).error, `${impl.title} errored`).toBeUndefined()
  const [digest, hex] = engine.outputsOf(impl) ?? []
  return { hex: hex as string, digestHex: hexOf(digest), identical: engine.outputsOf(same)?.[0] }
}

async function hash(text: string): Promise<Results> {
  setParam(message, 'text', text)
  await engine.whenIdle()
  const [builtinDigest] = engine.outputsOf(builtin) ?? []
  return {
    byHand: resultOf(byHand, sameByHand),
    recursive: resultOf(recursive, sameRecursive),
    builtinHex: hexOf(builtinDigest),
  }
}

function expectBoth(results: Results, expected: string): void {
  for (const impl of [results.byHand, results.recursive]) {
    expect(impl.hex).toBe(expected)
    expect(impl.digestHex).toBe(expected)
    expect(impl.identical).toBe(true)
  }
}

describe('SHA-1 From Scratch: correctness', () => {
  const FIPS_VECTORS: Array<[string, string, string]> = [
    ['empty message', '', 'da39a3ee5e6b4b0d3255bfef95601890afd80709'],
    ['"abc"', 'abc', 'a9993e364706816aba3e25717850c26c9cd0d89d'],
    [
      '448-bit message (two blocks)',
      'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq',
      '84983e441c3bd26ebaae4aa1f95129e5e54670f1',
    ],
    ['the quick brown fox', 'The quick brown fox jumps over the lazy dog', '2fd4e1c67a2d28fced849ee1bb76e7391b93eb12'],
    ['…lazy cog', 'The quick brown fox jumps over the lazy cog', 'de9f2c7fd25e1b3afad3e85a0bd17d9b100db4b3'],
  ]

  for (const [label, text, expected] of FIPS_VECTORS) {
    it(`known vector: ${label}`, async () => {
      const results = await hash(text)
      expect(results.builtinHex).toBe(expected)
      expectBoth(results, expected)
    }, 60_000)
  }

  // Padding boundaries: 55 is the last length that fits one block, 56 spills
  // the length field into a second; 64/119/120/128 straddle block edges.
  for (const length of [1, 54, 55, 56, 57, 63, 64, 65, 119, 120, 128]) {
    it(`matches WebCrypto at ${length} bytes`, async () => {
      const text = 'a'.repeat(length)
      expectBoth(await hash(text), await webCryptoHex(text))
    }, 60_000)
  }

  const AWKWARD: Array<[string, string]> = [
    ['non-ASCII (hashed as UTF-8 bytes)', 'héllo wörld ✓ 🔐'],
    ['leading NUL bytes', '\u0000\u0000\u0000abc'],
    ['a whole block of NULs (all-zero words)', '\u0000'.repeat(64)],
    ['high bytes everywhere', 'ÿ'.repeat(40)],
    ['four blocks', 'The quick brown fox jumps over the lazy dog. '.repeat(5)],
    // The recursive version's ceiling: one evaluation budget for the whole
    // call tree is enough for five blocks (see the note inside it).
    ['five blocks (311 bytes, the recursive ceiling)', 'x'.repeat(311)],
  ]

  for (const [label, text] of AWKWARD) {
    it(`matches WebCrypto: ${label}`, async () => {
      const results = await hash(text)
      const expected = await webCryptoHex(text)
      expect(results.builtinHex).toBe(expected)
      expectBoth(results, expected)
    }, 60_000)
  }
})

describe('SHA-1 From Scratch: structure', () => {
  const defs = () => allSubgraphDefs(graph)
  const nameOf = (id: string) => defs().find((d) => d.id === id)?.name
  /** The definition called `name` whose scope chain ends at `root`. */
  const byName = (name: string, root: string) => {
    const def = defs().find((d) => d.name === name && nameOf(scopeChainOf(graph, d.id).at(-1)!) === root)
    if (!def) throw new Error(`no definition "${name}" under ${root}`)
    return def
  }
  const chain = (name: string, root: string) => scopeChainOf(graph, byName(name, root).id).map(nameOf)
  /** Every interior node under `root`'s subtree. */
  const interiorsOf = (root: string) =>
    defs()
      .filter((d) => nameOf(scopeChainOf(graph, d.id).at(-1)!) === root)
      .flatMap((d) => graph.subgraphs.get(d.id as never)?._nodes ?? [])

  it('is genuinely from scratch: no hashing node inside any definition', () => {
    const interiors = [...graph.subgraphs.values()].flatMap((sub) => sub._nodes)
    expect(interiors.length).toBeGreaterThan(200)
    expect(interiors.filter((n) => n.type?.startsWith('hashing/')).map((n) => n.title)).toEqual([])
  })

  it('the recursive version uses no higher-order node at all', () => {
    const hof = ['flow/fold', 'flow/map', 'flow/filter', 'flow/if']
    const used = interiorsOf('SHA-1 (recursive)').filter((n) => hof.includes(n.type ?? ''))
    expect(used.map((n) => n.title)).toEqual([])
    // …while the by-hand twin leans on them.
    const byHandHof = interiorsOf('SHA-1 (by hand)').filter((n) => hof.includes(n.type ?? ''))
    expect(byHandHof.length).toBeGreaterThanOrEqual(5)
  })

  it('only the two top-level definitions are visible from the root; every helper is scoped', () => {
    expect(visibleSubgraphDefs(graph, graph).map((d) => d.name)).toEqual(['SHA-1 (by hand)', 'SHA-1 (recursive)'])
    expect(chain('Ch', 'SHA-1 (by hand)')).toEqual(['Ch', 'Round', 'Compress', 'SHA-1 (by hand)'])
    expect(chain('Extend', 'SHA-1 (by hand)')).toEqual(['Extend', 'Compress', 'SHA-1 (by hand)'])
    expect(chain('Xor', 'SHA-1 (by hand)')).toEqual(['Xor', 'SHA-1 (by hand)'])
    expect(chain('Schedule', 'SHA-1 (recursive)')).toEqual(['Schedule', 'Compress', 'SHA-1 (recursive)'])
    expect(chain('Blocks', 'SHA-1 (recursive)')).toEqual(['Blocks', 'SHA-1 (recursive)'])
    expect(
      defs()
        .filter((d) => nameOf(scopeChainOf(graph, d.id).at(-1)!) === 'SHA-1 (by hand)')
        .map((d) => d.name)
        .sort(),
    ).toEqual(['Add32', 'Ch', 'Chunk', 'Compress', 'Extend', 'Maj', 'Pad', 'Parity', 'Round', 'RotL', 'SHA-1 (by hand)', 'Word Hex', 'Xor'].sort())
    expect(
      defs()
        .filter((d) => nameOf(scopeChainOf(graph, d.id).at(-1)!) === 'SHA-1 (recursive)')
        .map((d) => d.name)
        .sort(),
    ).toEqual(['Add32', 'Blocks', 'Ch Rounds', 'Chunk', 'Compress', 'Maj Rounds', 'Pad', 'Parity Rounds', 'SHA-1 (recursive)', 'Schedule', 'Word Hex'].sort())
  })
})
