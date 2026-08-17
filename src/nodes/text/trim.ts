import { defineNode } from '../../core/registry'
import { STRING } from '../../core/types'

defineNode({
  type: 'text/trim',
  title: 'Trim',
  category: 'Text',
  inputs: [{ name: 'text', type: STRING }] as const,
  outputs: [{ name: 'text', type: STRING }] as const,
  params: [
    { kind: 'enum', name: 'mode', label: 'Mode', default: 'both', options: ['both', 'start', 'end'] },
  ] as const,
  run: (inputs, params) => {
    const text = inputs.text ?? ''
    switch (params.mode) {
      case 'start': return { text: text.trimStart() }
      case 'end': return { text: text.trimEnd() }
      default: return { text: text.trim() }
    }
  },
})
