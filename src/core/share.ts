/**
 * Share-via-URL: the graph document, deflated and base64url-encoded into the
 * location hash (`#g=…`): the same trick CyberChef uses for recipes.
 */

import { deflate, inflate } from 'pako'
import type { GraphDocument } from './serialize'
import { parseGraphDocument } from './serialize'

const HASH_PREFIX = '#g='

export function encodeShareHash(doc: GraphDocument): string {
  const json = JSON.stringify(doc)
  const compressed = deflate(json)
  return HASH_PREFIX + base64UrlEncode(compressed)
}

export function decodeShareHash(hash: string): GraphDocument {
  if (!hash.startsWith(HASH_PREFIX)) {
    throw new Error(`not a share hash (expected ${HASH_PREFIX}…)`)
  }
  const compressed = base64UrlDecode(hash.slice(HASH_PREFIX.length))
  const json = new TextDecoder().decode(inflate(compressed))
  return parseGraphDocument(JSON.parse(json))
}

/** Extracts the share hash from a location.hash string, or null. */
export function shareHashFromLocation(hash: string): string | null {
  return hash.startsWith(HASH_PREFIX) ? hash : null
}

function base64UrlEncode(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

function base64UrlDecode(text: string): Uint8Array {
  const b64 = text.replaceAll('-', '+').replaceAll('_', '/')
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
  const bin = atob(padded)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}
