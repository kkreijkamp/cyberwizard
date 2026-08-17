import { describe, expect, it } from 'vitest'
import { decodeShareHash, encodeShareHash, shareHashFromLocation } from '../../src/core/share'
import type { GraphDocument } from '../../src/core/serialize'

const sampleDoc: GraphDocument = {
  app: 'cyberwizard',
  version: 1,
  nodes: [
    { id: 1, type: 'io/text-input', pos: [40, 300], params: { text: 'share me 🧙' } },
    { id: 2, type: 'text/to-upper-case', pos: [400, 300], params: {} },
  ],
  links: [{ from: { node: 1, slot: 0 }, to: { node: 2, slot: 0 } }],
  view: { offset: [12.5, -7], scale: 1.25 },
}

describe('share hash codec', () => {
  it('round-trips a document', () => {
    const hash = encodeShareHash(sampleDoc)
    expect(decodeShareHash(hash)).toEqual(sampleDoc)
  })

  it('uses the url-safe alphabet without padding', () => {
    const hash = encodeShareHash(sampleDoc)
    expect(hash.startsWith('#g=')).toBe(true)
    expect(hash.slice(3)).not.toMatch(/[+/=]/)
  })

  it('deflates repetitive content well below raw json size', () => {
    const big: GraphDocument = {
      ...sampleDoc,
      nodes: Array.from({ length: 50 }, (_, i) => ({
        id: i,
        type: 'io/text-input',
        pos: [i * 10, 0] as [number, number],
        params: { text: 'repetitive repetitive repetitive' },
      })),
    }
    expect(encodeShareHash(big).length).toBeLessThan(JSON.stringify(big).length / 2)
  })

  it('rejects foreign hashes and corrupt payloads', () => {
    expect(() => decodeShareHash('#nope')).toThrow(/share hash/)
    expect(() => decodeShareHash('#g=!!!')).toThrow()
  })

  it('extracts hashes from location.hash', () => {
    expect(shareHashFromLocation('#g=abc')).toBe('#g=abc')
    expect(shareHashFromLocation('#other')).toBeNull()
    expect(shareHashFromLocation('')).toBeNull()
  })
})
