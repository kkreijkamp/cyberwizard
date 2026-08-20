/** Byte-level helpers shared by ops (hex, binary strings, XOR). */

export function bytesToHex(bytes: Uint8Array): string {
  let out = ''
  for (const b of bytes) out += b.toString(16).padStart(2, '0')
  return out
}

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/[^0-9a-fA-F]/g, '')
  if (clean.length % 2 !== 0) throw new Error(`hex string has odd length: ${clean.length}`)
  const out = new Uint8Array(clean.length / 2)
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16)
  }
  return out
}

/** ISO-8859-1 style binary string (one char per byte) — what btoa/atob consume. */
export function bytesToBinaryString(bytes: Uint8Array): string {
  const CHUNK = 0x8000
  const parts: string[] = []
  for (let i = 0; i < bytes.length; i += CHUNK) {
    parts.push(String.fromCharCode(...bytes.subarray(i, i + CHUNK)))
  }
  return parts.join('')
}

export function binaryStringToBytes(bin: string): Uint8Array {
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i) & 0xff
  return out
}

/** Repeating-key XOR. Empty key returns the input unchanged. */
export function xorBytes(data: Uint8Array, key: Uint8Array): Uint8Array {
  if (key.length === 0) return data.slice()
  const out = new Uint8Array(data.length)
  for (let i = 0; i < data.length; i++) {
    out[i] = (data[i] as number) ^ (key[i % key.length] as number)
  }
  return out
}

/** Concatenates byte arrays in order — b''.join for our byte type. */
export function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  let total = 0
  for (const p of parts) total += p.length
  const out = new Uint8Array(total)
  let offset = 0
  for (const p of parts) {
    out.set(p, offset)
    offset += p.length
  }
  return out
}

/** Big-endian bignum view of a byte string: [0x1f, 0x4a] ↔ 8010n. */
export function bytesToBigInt(data: Uint8Array): bigint {
  let n = 0n
  for (const b of data) n = (n << 8n) | BigInt(b)
  return n
}

/** Minimal-length big-endian encoding (leading zeros dropped); 0n → [0x00]. */
export function bigIntToBytes(n: bigint): Uint8Array {
  if (n === 0n) return new Uint8Array([0])
  const hex = n.toString(16)
  const padded = hex.length % 2 ? `0${hex}` : hex
  const out = new Uint8Array(padded.length / 2)
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(padded.slice(i * 2, i * 2 + 2), 16)
  }
  return out
}

/**
 * WebCrypto wants ArrayBuffer-backed views (BufferSource); our byte type is
 * the wider Uint8Array<ArrayBufferLike>. Pass through when actually backed by
 * an ArrayBuffer (always, in practice), copy otherwise.
 */
export function asBufferSource(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  if (bytes.buffer instanceof ArrayBuffer) return bytes as Uint8Array<ArrayBuffer>
  return new Uint8Array(bytes)
}
