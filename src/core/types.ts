/**
 * The CyberWizard data type system.
 *
 * `bytes` (Uint8Array) is the canonical currency type: every value can be
 * coerced to/from it (see core/coerce.ts). Types are plain data so they can
 * be serialised, compared, and carried on graph edges at runtime — while the
 * ValueOf mapped type gives node definitions fully static `run()` signatures.
 */

export type DataType =
  | { kind: 'bytes' }
  | { kind: 'string' }
  | { kind: 'number' }
  | { kind: 'boolean' }
  | { kind: 'json' }
  | { kind: 'any' }
  | { kind: 'list'; element: DataType }

export const BYTES = { kind: 'bytes' } as const
export const STRING = { kind: 'string' } as const
export const NUMBER = { kind: 'number' } as const
export const BOOLEAN = { kind: 'boolean' } as const
export const JSON = { kind: 'json' } as const
export const ANY = { kind: 'any' } as const
export function listOf<E extends DataType>(element: E): { kind: 'list'; element: E } {
  return { kind: 'list', element }
}

/** Maps a DataType to its runtime value shape. */
export type ValueOf<T extends DataType> =
  T extends { kind: 'bytes' } ? Uint8Array
    : T extends { kind: 'string' } ? string
      : T extends { kind: 'number' } ? number
        : T extends { kind: 'boolean' } ? boolean
          : T extends { kind: 'json' } ? unknown
            : T extends { kind: 'any' } ? unknown
              : T extends { kind: 'list'; element: infer E extends DataType } ? ValueOf<E>[]
                : never

export function typesEqual(a: DataType, b: DataType): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === 'list' && b.kind === 'list') return typesEqual(a.element, b.element)
  return true
}

/**
 * Slot type tag used on LiteGraph slots. List element types are erased —
 * connection validity is decided by the coercion layer anyway
 * (registry installs the LiteGraph.isValidConnection override).
 * `any` maps to LiteGraph's wildcard 0.
 */
export type SlotTypeTag = DataType['kind']

export function toSlotType(t: DataType): string | 0 {
  return t.kind === 'any' ? 0 : t.kind
}

export function fromSlotType(t: string | number): SlotTypeTag {
  if (t === 0 || t === '') return 'any'
  return t as SlotTypeTag
}

/** DataType from its kind string (as stored on IO slots and in documents). */
export function dataTypeFromKind(kind: string): DataType {
  switch (kind) {
    case 'bytes': return BYTES
    case 'string': return STRING
    case 'number': return NUMBER
    case 'boolean': return BOOLEAN
    case 'json': return JSON
    // List element types are erased at the slot level; validated at run time.
    case 'list': return listOf(ANY)
    default: return ANY
  }
}

const REPR_LIMIT = 120

function truncate(s: string): string {
  return s.length > REPR_LIMIT ? `${s.slice(0, REPR_LIMIT)}…` : s
}

/** Human-readable one-line rendering of a value, for previews and debugging. */
export function repr(value: unknown): string {
  if (value === undefined) return '∅'
  if (value === null) return 'null'
  if (value instanceof Uint8Array) {
    const hex = [...value.subarray(0, 24)].map((b) => b.toString(16).padStart(2, '0')).join(' ')
    return truncate(`⟨${value.length}B⟩ ${hex}${value.length > 24 ? ' …' : ''}`)
  }
  if (typeof value === 'string') return truncate(value)
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return truncate(`[${value.length} items] ${safeStringify(value)}`)
  return truncate(safeStringify(value) ?? String(value))
}

function safeStringify(value: unknown): string | undefined {
  try {
    return globalThis.JSON.stringify(value)
  } catch {
    return undefined
  }
}
