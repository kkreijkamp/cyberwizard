import { defineNode } from '../../core/registry'
import { ANY, NUMBER, STRING, listOf } from '../../core/types'

defineNode({
  type: 'text/split',
  title: 'Split',
  category: 'Text',
  description: 'Empty separator splits into characters.',
  inputs: [{ name: 'text', type: STRING }] as const,
  outputs: [{ name: 'items', type: listOf(STRING) }] as const,
  params: [{ kind: 'string', name: 'separator', label: 'Separator', default: ',' }] as const,
  run: (inputs, params) => ({ items: (inputs.text ?? '').split(params.separator) }),
})

defineNode({
  type: 'text/join',
  title: 'Join',
  category: 'Text',
  inputs: [{ name: 'items', type: listOf(STRING) }] as const,
  outputs: [{ name: 'text', type: STRING }] as const,
  params: [{ kind: 'string', name: 'separator', label: 'Separator', default: ', ' }] as const,
  run: (inputs, params) => ({ text: (inputs.items ?? []).join(params.separator) }),
})

/** Length of a string, byte array, or list: polymorphic via the ANY slot. */
defineNode({
  type: 'text/length',
  title: 'Length',
  category: 'Text',
  inputs: [{ name: 'value', type: ANY }] as const,
  outputs: [{ name: 'length', type: NUMBER }] as const,
  run: (inputs) => {
    const v = inputs.value
    if (v === undefined) return { length: 0 }
    if (typeof v === 'string' || v instanceof Uint8Array || Array.isArray(v)) {
      return { length: v.length }
    }
    throw new Error('value has no length (expected string, bytes, or list)')
  },
})
