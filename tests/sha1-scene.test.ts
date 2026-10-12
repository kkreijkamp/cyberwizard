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
 * The SHA-1 From Scratch scene must be a real SHA-1: every digest it
 * produces is checked against published FIPS 180 vectors or WebCrypto,
 * and against the built-in node sitting next to it in the same graph.
 * Inputs are chosen to hit every padding boundary (55/56/63/64 bytes…),
 * multi-block messages, non-ASCII, and words with leading zero bytes (the
 * case minimal-length bignums make easy to get wrong).
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
let same: LGraphNode

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
  same = rootNode('digests equal?')
})

afterAll(() => dispose())

async function hash(text: string): Promise<{ hex: string; digestHex: string; builtinHex: string; identical: unknown }> {
  setParam(message, 'text', text)
  await engine.whenIdle()
  expect(engine.stateOf(byHand).error, 'by-hand SHA-1 errored').toBeUndefined()
  const [digest, hex] = engine.outputsOf(byHand) ?? []
  const [builtinDigest] = engine.outputsOf(builtin) ?? []
  return {
    hex: hex as string,
    digestHex: hexOf(digest),
    builtinHex: hexOf(builtinDigest),
    identical: engine.outputsOf(same)?.[0],
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
      const { hex, digestHex, builtinHex, identical } = await hash(text)
      expect(hex).toBe(expected)
      expect(digestHex).toBe(expected)
      expect(builtinHex).toBe(expected)
      expect(identical).toBe(true)
    }, 60_000)
  }

  // Padding boundaries: 55 is the last length that fits one block, 56 spills
  // the length field into a second; 64/119/120/128 straddle block edges.
  for (const length of [1, 54, 55, 56, 57, 63, 64, 65, 119, 120, 128]) {
    it(`matches WebCrypto at ${length} bytes`, async () => {
      const text = 'a'.repeat(length)
      const { hex, digestHex, identical } = await hash(text)
      const expected = await webCryptoHex(text)
      expect(hex).toBe(expected)
      expect(digestHex).toBe(expected)
      expect(identical).toBe(true)
    }, 60_000)
  }

  const AWKWARD: Array<[string, string]> = [
    ['non-ASCII (hashed as UTF-8 bytes)', 'héllo wörld ✓ 🔐'],
    ['leading NUL bytes', '\u0000\u0000\u0000abc'],
    ['a whole block of NULs (all-zero words)', '\u0000'.repeat(64)],
    ['high bytes everywhere', 'ÿ'.repeat(40)],
    ['four blocks', 'The quick brown fox jumps over the lazy dog. '.repeat(5)],
  ]

  for (const [label, text] of AWKWARD) {
    it(`matches WebCrypto: ${label}`, async () => {
      const { hex, digestHex, builtinHex, identical } = await hash(text)
      const expected = await webCryptoHex(text)
      expect(hex).toBe(expected)
      expect(digestHex).toBe(expected)
      expect(builtinHex).toBe(expected)
      expect(identical).toBe(true)
    }, 60_000)
  }
})

describe('SHA-1 From Scratch: structure', () => {
  it('is genuinely from scratch: no hashing node inside any definition', () => {
    const interiors = [...graph.subgraphs.values()].flatMap((sub) => sub._nodes)
    expect(interiors.length).toBeGreaterThan(100)
    expect(interiors.filter((n) => n.type?.startsWith('hashing/')).map((n) => n.title)).toEqual([])
  })

  it('only the top-level definition is visible from the root; every helper is scoped', () => {
    expect(visibleSubgraphDefs(graph, graph).map((d) => d.name)).toEqual(['SHA-1 (by hand)'])
    const defs = allSubgraphDefs(graph)
    const byName = (name: string) => {
      const def = defs.find((d) => d.name === name)
      if (!def) throw new Error(`no definition "${name}"`)
      return def
    }
    const chain = (name: string) => scopeChainOf(graph, byName(name).id).map((id) => defs.find((d) => d.id === id)?.name)
    expect(chain('Ch')).toEqual(['Ch', 'Round', 'Compress', 'SHA-1 (by hand)'])
    expect(chain('Extend')).toEqual(['Extend', 'Compress', 'SHA-1 (by hand)'])
    expect(chain('Xor')).toEqual(['Xor', 'SHA-1 (by hand)'])
    expect(defs.map((d) => d.name).sort()).toEqual(
      ['Add32', 'Ch', 'Chunk', 'Compress', 'Extend', 'Maj', 'Pad', 'Parity', 'Round', 'RotL', 'SHA-1 (by hand)', 'Word Hex', 'Xor'].sort(),
    )
  })
})
