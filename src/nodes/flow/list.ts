/**
 * Flow — the list op library. Lists are first-class values (`list<T>`); these
 * are the pure building blocks. Higher-order ops (map/filter/fold, which
 * apply a subgraph per element) live in flow/hof.ts.
 *
 * Conventions: undefined inputs are tolerated as empty lists (`?? []`); all
 * list slots are listOf(ANY) — element types are erased at the slot level and
 * handled by the coercion layer on the next edge.
 */

import { defineNode } from '../../core/registry'
import { ANY, NUMBER, listOf } from '../../core/types'
import { repr, valueKey } from '../../core/types'

const listIn = { name: 'items', type: listOf(ANY) } as const
const listOut = { name: 'items', type: listOf(ANY) } as const

/** Packs the *connected* inputs into a list, in slot order. */
defineNode({
  type: 'flow/list-pack',
  title: 'List Pack',
  category: 'Flow',
  description: 'Combines the wired inputs (a, b, c) into a list; unwired slots are skipped.',
  inputs: [
    { name: 'a', type: ANY },
    { name: 'b', type: ANY },
    { name: 'c', type: ANY },
  ] as const,
  outputs: [listOut],
  run: (inputs, _params, ctx) => {
    const items: unknown[] = []
    const slots = ['a', 'b', 'c'] as const
    for (const [i, name] of slots.entries()) {
      if (ctx.node.inputs[i]?.link != null) items.push(inputs[name])
    }
    return { items }
  },
})

/** Element access; negative indexes count from the end. */
defineNode({
  type: 'flow/list-get',
  title: 'List Get',
  category: 'Flow',
  description: 'Element at index (negative counts from the end).',
  inputs: [listIn, { name: 'index', type: NUMBER }] as const,
  outputs: [{ name: 'element', type: ANY }] as const,
  run: (inputs) => {
    const items = inputs.items ?? []
    const index = inputs.index
    if (index === undefined) throw new Error('index input is not connected')
    const i = index < 0 ? items.length + Math.trunc(index) : Math.trunc(index)
    if (i < 0 || i >= items.length) {
      throw new Error(`index ${index} out of range (list has ${items.length} items)`)
    }
    return { element: items[i] }
  },
})

defineNode({
  type: 'flow/list-take',
  title: 'Take',
  category: 'Flow',
  description: 'Keeps the first n items.',
  inputs: [listIn] as const,
  outputs: [listOut],
  params: [{ kind: 'number', name: 'n', default: 1, min: 0, step: 1 }] as const,
  run: (inputs, params) => ({ items: (inputs.items ?? []).slice(0, Math.max(0, params.n)) }),
})

defineNode({
  type: 'flow/list-drop',
  title: 'Drop',
  category: 'Flow',
  description: 'Drops the first n items.',
  inputs: [listIn] as const,
  outputs: [listOut],
  params: [{ kind: 'number', name: 'n', default: 1, min: 0, step: 1 }] as const,
  run: (inputs, params) => ({ items: (inputs.items ?? []).slice(Math.max(0, params.n)) }),
})

defineNode({
  type: 'flow/list-reverse',
  title: 'Reverse List',
  category: 'Flow',
  inputs: [listIn] as const,
  outputs: [listOut],
  run: (inputs) => ({ items: [...(inputs.items ?? [])].reverse() }),
})

/** Stable dedup — first occurrence wins. Structural identity (core/types valueKey). */
defineNode({
  type: 'flow/list-unique',
  title: 'Unique',
  category: 'Flow',
  inputs: [listIn] as const,
  outputs: [listOut],
  run: (inputs) => {
    const seen = new Set<string>()
    const items: unknown[] = []
    for (const item of inputs.items ?? []) {
      const key = valueKey(item)
      if (seen.has(key)) continue
      seen.add(key)
      items.push(item)
    }
    return { items }
  },
})

/** Numbers sort numerically; everything else by its repr. Mixed lists sort by repr. */
defineNode({
  type: 'flow/list-sort',
  title: 'Sort',
  category: 'Flow',
  inputs: [listIn] as const,
  outputs: [listOut],
  params: [
    { kind: 'enum', name: 'order', default: 'asc', options: ['asc', 'desc'] },
  ] as const,
  run: (inputs, params) => {
    const items = [...(inputs.items ?? [])]
    const allNumbers = items.every((i) => typeof i === 'number')
    const direction = params.order === 'desc' ? -1 : 1
    items.sort((a, b) => {
      if (allNumbers) return ((a as number) - (b as number)) * direction
      const ra = repr(a)
      const rb = repr(b)
      return (ra < rb ? -1 : ra > rb ? 1 : 0) * direction
    })
    return { items }
  },
})

/** One-level flatten; elements that aren't lists pass through unchanged. */
defineNode({
  type: 'flow/list-flatten',
  title: 'Flatten',
  category: 'Flow',
  description: 'One level only — apply twice for deeply nested lists.',
  inputs: [listIn] as const,
  outputs: [listOut],
  run: (inputs) => {
    const items: unknown[] = []
    for (const item of inputs.items ?? []) {
      if (Array.isArray(item)) items.push(...item)
      else items.push(item)
    }
    return { items }
  },
})

defineNode({
  type: 'flow/list-zip',
  title: 'Zip',
  category: 'Flow',
  description: 'Pairs up items of a and b; stops at the shorter list.',
  inputs: [
    { name: 'a', type: listOf(ANY) },
    { name: 'b', type: listOf(ANY) },
  ] as const,
  outputs: [{ name: 'pairs', type: listOf(ANY) }] as const,
  run: (inputs) => {
    const a = inputs.a ?? []
    const b = inputs.b ?? []
    const pairs: unknown[] = []
    for (let i = 0; i < Math.min(a.length, b.length); i++) pairs.push([a[i], b[i]])
    return { pairs }
  },
})

defineNode({
  type: 'flow/list-concat',
  title: 'Concat',
  category: 'Flow',
  inputs: [
    { name: 'a', type: listOf(ANY) },
    { name: 'b', type: listOf(ANY) },
  ] as const,
  outputs: [listOut],
  run: (inputs) => ({ items: [...(inputs.a ?? []), ...(inputs.b ?? [])] }),
})

defineNode({
  type: 'flow/list-range',
  title: 'Range',
  category: 'Flow',
  description: 'Numbers [start, start+step, …) — count of them.',
  inputs: [] as const,
  outputs: [{ name: 'items', type: listOf(NUMBER) }] as const,
  params: [
    { kind: 'number', name: 'start', default: 0, step: 1 },
    { kind: 'number', name: 'count', default: 10, min: 0, step: 1 },
    { kind: 'number', name: 'step', default: 1 },
  ] as const,
  run: (_inputs, params) => {
    if (params.step === 0) throw new Error('step must not be 0')
    if (params.count > 1_000_000) throw new Error('count too large (max 1 000 000)')
    const items: number[] = []
    for (let i = 0; i < params.count; i++) items.push(params.start + i * params.step)
    return { items }
  },
})
