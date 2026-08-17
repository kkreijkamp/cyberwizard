import { describe, expect, it } from 'vitest'
import { bytesOf, runOp, textOf } from './run-op'
import '../../src/nodes'

describe('base64', () => {
  it('RFC 4648 vectors', async () => {
    expect((await runOp('encoding/base64-encode', { data: bytesOf('Man') })).text).toBe('TWFu')
    expect((await runOp('encoding/base64-encode', { data: bytesOf('foobar') })).text).toBe('Zm9vYmFy')
  })

  it('url-safe alphabet and round-trip', async () => {
    const data = bytesOf('\xff\xfe.sub?')
    const { text } = await runOp('encoding/base64-encode', { data }, { alphabet: 'url-safe' })
    expect(text).not.toMatch(/[+/]/)
    const { data: back } = await runOp('encoding/base64-decode', { text }, { alphabet: 'url-safe' })
    expect(back).toEqual(data)
  })

  it('decode tolerates missing padding', async () => {
    expect(textOf((await runOp('encoding/base64-decode', { text: 'TWFu' })).data)).toBe('Man')
  })
})

describe('base32', () => {
  it.each([
    ['', ''],
    ['f', 'MY======'],
    ['fo', 'MZXQ===='],
    ['foo', 'MZXW6==='],
    ['foob', 'MZXW6YQ='],
    ['fooba', 'MZXW6YTB'],
    ['foobar', 'MZXW6YTBOI======'],
  ])('RFC 4648 vector %s → %s', async (input, expected) => {
    expect((await runOp('encoding/base32-encode', { data: bytesOf(input) })).text).toBe(expected)
    expect(textOf((await runOp('encoding/base32-decode', { text: expected })).data)).toBe(input)
  })
})

describe('base58', () => {
  it('known vector: hello → Cn8eVZg', async () => {
    expect((await runOp('encoding/base58-encode', { data: bytesOf('hello') })).text).toBe('Cn8eVZg')
    expect(textOf((await runOp('encoding/base58-decode', { text: 'Cn8eVZg' })).data)).toBe('hello')
  })

  it('preserves leading zero bytes as leading 1s', async () => {
    const { text } = await runOp('encoding/base58-encode', { data: new Uint8Array([0, 0, 97, 98]) })
    expect(String(text).startsWith('11')).toBe(true)
    expect(await runOp('encoding/base58-decode', { text })).toEqual({
      data: new Uint8Array([0, 0, 97, 98]),
    })
  })
})

describe('hex', () => {
  it('encode/decode with case param', async () => {
    expect((await runOp('encoding/hex-encode', { data: bytesOf('Hi') })).text).toBe('4869')
    expect((await runOp('encoding/hex-encode', { data: new Uint8Array([0xde, 0xad]) }, { uppercase: true })).text).toBe('DEAD')
    expect(await runOp('encoding/hex-decode', { text: '48 69' })).toEqual({ data: bytesOf('Hi') })
  })
})

describe('url', () => {
  it('component mode encodes reserved chars', async () => {
    expect((await runOp('encoding/url-encode', { text: 'a b&c=' })).text).toBe('a%20b%26c%3D')
    expect((await runOp('encoding/url-decode', { text: 'a%20b%26c%3D' })).text).toBe('a b&c=')
  })

  it('full URL mode keeps URL structure', async () => {
    expect((await runOp('encoding/url-encode', { text: 'https://x.y/a b' }, { mode: 'full URL' })).text)
      .toBe('https://x.y/a%20b')
  })
})

describe('html entities', () => {
  it('encodes the basic five', async () => {
    expect((await runOp('encoding/html-entities-encode', { text: `<a href="x">&` })).text)
      .toBe('&lt;a href=&quot;x&quot;&gt;&amp;')
  })

  it('optionally encodes non-ASCII as numeric entities', async () => {
    expect((await runOp('encoding/html-entities-encode', { text: 'é' }, { nonAscii: true })).text)
      .toBe('&#xe9;')
  })

  it('decodes named and numeric entities', async () => {
    expect((await runOp('encoding/html-entities-decode', { text: '&lt;&#x41;&#65;&nbsp;' })).text)
      .toBe('<AA ')
  })
})

describe('binary', () => {
  it('encodes octets space-separated, decodes ignoring separators', async () => {
    expect((await runOp('encoding/binary-encode', { data: bytesOf('Hi') })).text)
      .toBe('01001000 01101001')
    expect(await runOp('encoding/binary-decode', { text: '0100100001101001' }))
      .toEqual({ data: bytesOf('Hi') })
  })

  it('rejects bit strings not multiple of 8', async () => {
    await expect(runOp('encoding/binary-decode', { text: '0101' })).rejects.toThrow(/multiple of 8/)
  })
})
