import { defineNode } from '../../core/registry'
import { JSON as JSON_TYPE, STRING } from '../../core/types'

defineNode({
  type: 'data/json-parse',
  title: 'JSON Parse',
  category: 'Data',
  inputs: [{ name: 'text', type: STRING }] as const,
  outputs: [{ name: 'value', type: JSON_TYPE }] as const,
  run: (inputs) => ({ value: globalThis.JSON.parse(inputs.text ?? 'null') }),
})

defineNode({
  type: 'data/json-stringify',
  title: 'JSON Stringify',
  category: 'Data',
  inputs: [{ name: 'value', type: JSON_TYPE }] as const,
  outputs: [{ name: 'text', type: STRING }] as const,
  params: [
    { kind: 'number', name: 'indent', label: 'Indent', default: 2, min: 0, max: 8, step: 1 },
  ] as const,
  run: (inputs, params) => {
    if (inputs.value === undefined) return { text: '' }
    return { text: globalThis.JSON.stringify(inputs.value, null, params.indent) ?? '' }
  },
})

/**
 * Mini path picker: dot and bracket segments, `a.b[0].c`.
 * (Full JSONPath is a phase-2+ consideration.)
 */
defineNode({
  type: 'data/json-pick',
  title: 'JSON Pick',
  category: 'Data',
  description: 'Path like a.b[0].c: empty path returns the whole value.',
  inputs: [{ name: 'value', type: JSON_TYPE }] as const,
  outputs: [{ name: 'picked', type: JSON_TYPE }] as const,
  params: [{ kind: 'string', name: 'path', label: 'Path', default: '' }] as const,
  run: (inputs, params) => ({ picked: pickPath(inputs.value, params.path) }),
})

export function pickPath(value: unknown, path: string): unknown {
  const segments = path
    .trim()
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter((s) => s !== '')
  let current: unknown = value
  for (const segment of segments) {
    if (current == null) return undefined
    if (Array.isArray(current)) {
      const index = Number(segment)
      if (!Number.isInteger(index)) throw new Error(`"${segment}" is not an array index`)
      current = current[index]
    } else if (typeof current === 'object') {
      current = (current as Record<string, unknown>)[segment]
    } else {
      throw new Error(`cannot descend into ${typeof current} at "${segment}"`)
    }
  }
  return current
}
