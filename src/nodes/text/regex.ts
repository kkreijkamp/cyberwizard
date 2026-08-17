import { defineNode } from '../../core/registry'
import { BOOLEAN, NUMBER, STRING, listOf } from '../../core/types'

/** Extracts every regex match (a chosen capture group, 0 = full match) as a list. */
defineNode({
  type: 'text/regex-extract',
  title: 'Regex Extract',
  category: 'Text',
  inputs: [{ name: 'text', type: STRING }] as const,
  outputs: [{ name: 'matches', type: listOf(STRING) }] as const,
  params: [
    { kind: 'string', name: 'pattern', label: 'Pattern', default: '' },
    { kind: 'string', name: 'flags', label: 'Flags', default: 'g' },
    { kind: 'number', name: 'group', label: 'Group', default: 0, min: 0, step: 1 },
  ] as const,
  run: (inputs, params) => {
    if (params.pattern === '') return { matches: [] }
    const flags = params.flags.includes('g') ? params.flags : params.flags + 'g'
    const re = new RegExp(params.pattern, flags)
    const matches = [...(inputs.text ?? '').matchAll(re)].map((m) => m[params.group] ?? '')
    return { matches }
  },
})

/** Tests whether the regex matches anywhere. */
defineNode({
  type: 'text/regex-match',
  title: 'Regex Match',
  category: 'Text',
  inputs: [{ name: 'text', type: STRING }] as const,
  outputs: [{ name: 'matches', type: BOOLEAN }] as const,
  params: [
    { kind: 'string', name: 'pattern', label: 'Pattern', default: '' },
    { kind: 'string', name: 'flags', label: 'Flags', default: '' },
  ] as const,
  run: (inputs, params) => {
    if (params.pattern === '') return { matches: false }
    return { matches: new RegExp(params.pattern, params.flags).test(inputs.text ?? '') }
  },
})

/** Counts regex matches. */
defineNode({
  type: 'text/regex-count',
  title: 'Regex Count',
  category: 'Text',
  inputs: [{ name: 'text', type: STRING }] as const,
  outputs: [{ name: 'count', type: NUMBER }] as const,
  params: [
    { kind: 'string', name: 'pattern', label: 'Pattern', default: '' },
    { kind: 'string', name: 'flags', label: 'Flags', default: 'g' },
  ] as const,
  run: (inputs, params) => {
    if (params.pattern === '') return { count: 0 }
    const flags = params.flags.includes('g') ? params.flags : params.flags + 'g'
    return { count: [...(inputs.text ?? '').matchAll(new RegExp(params.pattern, flags))].length }
  },
})
