import { describe, expect, it } from 'vitest'
import { asBufferSource, bytesToBinaryString, xorBytes } from '../src/core/binary'
import { utf8Encode } from '../src/core/coerce'
import { Engine } from '../src/core/engine'
import { installConnectionRules, setParam } from '../src/core/registry'
import { buildShowcaseGraph } from '../src/showcase'
import '../src/nodes'

installConnectionRules()

async function sha256Hex(text: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', asBufferSource(utf8Encode(text))))
  return [...digest].map((b) => b.toString(16).padStart(2, '0')).join('')
}

describe('showcase graph (integration)', () => {
  it('computes both branches: async hash and XOR→Base64', async () => {
    const { graph, nodes } = buildShowcaseGraph()
    const engine = new Engine(graph)
    await engine.whenIdle()

    expect(engine.outputsOf(nodes.sha)?.[1]).toBe(await sha256Hex('Hello, Wizard'))

    const expectedCipher = xorBytes(utf8Encode('Hello, Wizard'), utf8Encode('s3cret'))
    const expectedB64 = btoa(bytesToBinaryString(expectedCipher))
    expect(engine.outputsOf(nodes.xor)?.[0]).toEqual(expectedCipher)
    expect(engine.outputsOf(nodes.b64)?.[0]).toBe(expectedB64)
    engine.dispose()
  })

  it('reacts to input edits across the whole graph', async () => {
    const { graph, nodes } = buildShowcaseGraph()
    const engine = new Engine(graph)
    await engine.whenIdle()

    setParam(nodes.input, 'text', 'abc')
    await engine.whenIdle()

    expect(engine.outputsOf(nodes.sha)?.[1]).toBe(await sha256Hex('abc'))
    const expectedB64 = btoa(bytesToBinaryString(xorBytes(utf8Encode('abc'), utf8Encode('s3cret'))))
    expect(engine.outputsOf(nodes.b64)?.[0]).toBe(expectedB64)
    engine.dispose()
  })
})
