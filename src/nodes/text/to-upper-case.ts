import { defineNode } from '../../core/registry'
import { STRING } from '../../core/types'

defineNode({
  type: 'text/to-upper-case',
  title: 'To Upper Case',
  category: 'Text',
  inputs: [{ name: 'text', type: STRING }] as const,
  outputs: [{ name: 'text', type: STRING }] as const,
  run: (inputs) => ({ text: (inputs.text ?? '').toUpperCase() }),
})
