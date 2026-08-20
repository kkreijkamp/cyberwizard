/**
 * The coercion layer — CyberChef's "Dish" idea: edges between compatible-but-
 * unequal slot types convert values automatically. Coercion is total and
 * explicit: anything not listed here throws CoercionError rather than
 * silently mangling data.
 */

import type { DataType } from './types'
import { typesEqual } from './types'
import { concatBytes } from './binary'

export class CoercionError extends Error {
  constructor(
    readonly from: DataType,
    readonly to: DataType,
    detail?: string,
  ) {
    super(`cannot coerce ${from.kind} → ${to.kind}${detail ? `: ${detail}` : ''}`)
    this.name = 'CoercionError'
  }
}

export function utf8Encode(s: string): Uint8Array {
  return new TextEncoder().encode(s)
}

export function utf8Decode(b: Uint8Array): string {
  // Lossy by design (invalid sequences become U+FFFD) so previews never crash.
  return new TextDecoder('utf-8').decode(b)
}

export function canCoerce(from: DataType, to: DataType): boolean {
  if (to.kind === 'any' || from.kind === 'any') return true
  if (typesEqual(from, to)) return true

  switch (`${from.kind}→${to.kind}`) {
    // UTF-8 bridge
    case 'string→bytes':
    case 'bytes→string':
    // scalar rendering
    case 'number→string':
    case 'boolean→string':
    case 'number→bytes':
    case 'boolean→bytes':
    // parsing
    case 'string→number':
    case 'bytes→number':
    case 'string→boolean':
    case 'string→json':
    case 'bytes→json':
    // serialising
    case 'json→string':
    case 'json→bytes':
    // lists
    case 'list→string':
    case 'list→bytes':
    case 'list→json':
      return true
    default:
      break
  }

  // list<T> → list<U> element-wise (must precede the lift rule below)
  if (from.kind === 'list' && to.kind === 'list') return canCoerce(from.element, to.element)
  // T → list<T> lifting
  if (to.kind === 'list') return canCoerce(from, to.element)

  return false
}

export function coerce(value: unknown, from: DataType, to: DataType): unknown {
  if (value === undefined) return undefined
  if (to.kind === 'any' || from.kind === 'any') return value
  if (typesEqual(from, to)) return value

  switch (`${from.kind}→${to.kind}`) {
    case 'string→bytes':
      return utf8Encode(expect(value, 'string', from, to))
    case 'bytes→string':
      return utf8Decode(expect(value, 'bytes', from, to))
    case 'number→string':
    case 'boolean→string':
      return String(value)
    case 'number→bytes':
    case 'boolean→bytes':
      return utf8Encode(String(value))
    case 'string→number': {
      const s = expect(value, 'string', from, to).trim()
      const n = parseNumeric(s)
      if (n === undefined) throw new CoercionError(from, to, JSON.stringify(s))
      return n
    }
    case 'bytes→number':
      return bytesToNumber(expect(value, 'bytes', from, to))
    case 'string→boolean': {
      const s = expect(value, 'string', from, to).trim().toLowerCase()
      if (s === 'true') return true
      if (s === 'false') return false
      throw new CoercionError(from, to, `expected "true"/"false", got ${JSON.stringify(s)}`)
    }
    case 'string→json':
      return parseJson(expect(value, 'string', from, to), from, to)
    case 'bytes→json':
      return parseJson(utf8Decode(expect(value, 'bytes', from, to)), from, to)
    case 'json→string':
      return stringifyJson(value, from, to)
    case 'json→bytes':
      return utf8Encode(stringifyJson(value, from, to))
    case 'list→string':
      return stringifyJson(value, from, to)
    case 'list→bytes': {
      // A list of byte arrays means "join these bytes" — chunker output into
      // a bytes input should never become JSON text. Anything else: JSON.
      const items = expect(value, 'list', from, to)
      if (items.every((i) => i instanceof Uint8Array)) return concatBytes(items)
      return utf8Encode(stringifyJson(value, from, to))
    }
    case 'list→json':
      return value
    default:
      break
  }

  if (from.kind === 'list' && to.kind === 'list') {
    const items = expect(value, 'list', from, to)
    return items.map((item) => coerce(item, from.element, to.element))
  }
  if (to.kind === 'list') return [coerce(value, from, to.element)]

  throw new CoercionError(from, to)
}

function parseJson(s: string, from: DataType, to: DataType): unknown {
  try {
    return globalThis.JSON.parse(s)
  } catch (err) {
    throw new CoercionError(from, to, err instanceof Error ? err.message : String(err))
  }
}

/**
 * Unsigned big-endian interpretation: [0x1f, 0x4a] → 8010, empty → 0.
 * Multiplication (not <<) avoids 32-bit truncation. Exact up to 6 bytes
 * (2^48 < 2^53); longer inputs (e.g. a 32-byte digest) lose low-order bits
 * to f64 precision — magnitudes stay right, residues don't.
 */
function bytesToNumber(b: Uint8Array): number {
  let n = 0
  for (const byte of b) n = n * 256 + byte
  return n
}

/**
 * Decimal/scientific via Number() — which already covers the 0x/0b/0o
 * prefixes — falling back to bare hex when the string contains hex letters:
 * '1f', 'deadbeef', '-ff' all parse base 16. Digit-only strings never reach
 * the fallback ('1e5' is decimal, not hex), and non-hex garbage stays an error.
 */
function parseNumeric(s: string): number | undefined {
  if (s === '') return undefined
  const n = Number(s)
  if (!Number.isNaN(n)) return n
  const hex = /^-?(?:0x)?([0-9a-f]+)$/i.exec(s)
  if (!hex || !/[a-f]/i.test(hex[1]!)) return undefined
  const digits = Number.parseInt(hex[1]!, 16)
  return s.startsWith('-') ? -digits : digits
}

function stringifyJson(value: unknown, from: DataType, to: DataType): string {
  try {
    // Bytes embedded in lists/objects serialise as hex, not {"0":…} noise.
    const s = globalThis.JSON.stringify(value, (_key, v: unknown) =>
      v instanceof Uint8Array ? [...v].map((b) => b.toString(16).padStart(2, '0')).join('') : v,
    )
    if (s === undefined) throw new CoercionError(from, to, 'value is not JSON-serialisable')
    return s
  } catch (err) {
    if (err instanceof CoercionError) throw err
    throw new CoercionError(from, to, err instanceof Error ? err.message : String(err))
  }
}

function expect(value: unknown, shape: 'string', from: DataType, to: DataType): string
function expect(value: unknown, shape: 'bytes', from: DataType, to: DataType): Uint8Array
function expect(value: unknown, shape: 'list', from: DataType, to: DataType): unknown[]
function expect(value: unknown, shape: 'string' | 'bytes' | 'list', from: DataType, to: DataType): unknown {
  const ok =
    (shape === 'string' && typeof value === 'string') ||
    (shape === 'bytes' && value instanceof Uint8Array) ||
    (shape === 'list' && Array.isArray(value))
  if (!ok) throw new CoercionError(from, to, `runtime value is not ${shape}`)
  return value
}
