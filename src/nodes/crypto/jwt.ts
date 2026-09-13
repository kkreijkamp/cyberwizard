import { defineNode } from '../../core/registry'
import { BYTES, JSON as JSON_TYPE, STRING } from '../../core/types'

/** Base64url → bytes (JWT's alphabet: - and _ instead of + and /, padding optional). */
function base64UrlDecode(segment: string): Uint8Array {
  const b64 = segment.replaceAll('-', '+').replaceAll('_', '/')
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
  try {
    const bin = atob(padded)
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return out
  } catch {
    throw new Error(`invalid base64url segment: ${JSON.stringify(segment.slice(0, 24))}`)
  }
}

function decodeJsonSegment(segment: string, which: string): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(base64UrlDecode(segment)))
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('invalid base64url')) throw err
    throw new Error(`JWT ${which} is not valid JSON`)
  }
}

/**
 * JWT decoder — splits a token into header/payload JSON and the raw signature,
 * without verifying anything. The signedData output carries the exact bytes
 * that were signed ("header.payload"), ready to wire into HMAC / RSA Verify /
 * ECDSA Verify / Ed25519 Verify for manual verification pipelines.
 */
defineNode({
  type: 'crypto/jwt-decode',
  title: 'JWT Decode',
  category: 'Crypto',
  description:
    'Splits a JSON Web Token into header/payload JSON and the raw signature — unverified. signedData is the exact signed byte string ("header.payload") for feeding signature-verification nodes.',
  inputs: [{ name: 'token', type: STRING }] as const,
  outputs: [
    { name: 'header', type: JSON_TYPE },
    { name: 'payload', type: JSON_TYPE },
    { name: 'signature', type: BYTES },
    { name: 'signedData', type: BYTES },
  ] as const,
  run: (inputs) => {
    const token = (inputs.token ?? '').trim()
    const parts = token.split('.')
    if (parts.length !== 3) {
      throw new Error(`a JWT has 3 dot-separated parts, got ${parts.length}`)
    }
    const [head, body, sig] = parts as [string, string, string]
    return {
      header: decodeJsonSegment(head, 'header'),
      payload: decodeJsonSegment(body, 'payload'),
      signature: base64UrlDecode(sig),
      signedData: new TextEncoder().encode(`${head}.${body}`),
    }
  },
})
