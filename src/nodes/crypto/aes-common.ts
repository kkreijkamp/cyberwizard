/** Shared AES key handling for the cipher nodes. */

import { asBufferSource } from '../../core/binary'

export const GCM_NONCE_BYTES = 12
export const CBC_IV_BYTES = 16

/** Imports raw key material for AES, validating the length (16/24/32 bytes → AES-128/192/256). */
export async function importAesKey(
  key: Uint8Array | undefined,
  algorithm: 'AES-GCM' | 'AES-CBC',
  usages: KeyUsage[],
): Promise<CryptoKey> {
  const raw = key ?? new Uint8Array()
  if (raw.length !== 16 && raw.length !== 24 && raw.length !== 32) {
    throw new Error(`AES key must be 16, 24 or 32 bytes (128/192/256-bit), got ${raw.length}`)
  }
  return crypto.subtle.importKey('raw', asBufferSource(raw), { name: algorithm }, false, usages)
}

/** Fresh random bytes for IV/nonce generation. */
export function randomBytes(count: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(count))
}
