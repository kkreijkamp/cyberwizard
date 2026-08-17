import { defineNode } from '../../core/registry'
import { STRING } from '../../core/types'

/**
 * Find & replace. Regex mode uses the JS engine directly, including $-refs
 * in the replacement ($1, $&, $<name>).
 */
defineNode({
  type: 'text/find-replace',
  title: 'Find & Replace',
  category: 'Text',
  inputs: [{ name: 'text', type: STRING }] as const,
  outputs: [{ name: 'text', type: STRING }] as const,
  params: [
    { kind: 'string', name: 'find', label: 'Find', default: '' },
    { kind: 'string', name: 'replace', label: 'Replace', default: '' },
    { kind: 'boolean', name: 'regex', label: 'Regex', default: false },
    { kind: 'string', name: 'flags', label: 'Flags', default: 'g' },
  ] as const,
  run: (inputs, params) => {
    const text = inputs.text ?? ''
    if (params.find === '') return { text }
    if (params.regex) {
      return { text: text.replace(new RegExp(params.find, params.flags), params.replace) }
    }
    return { text: text.replaceAll(params.find, params.replace) }
  },
})
