import { defineNode } from '../../core/registry'
import { STRING } from '../../core/types'

defineNode({
  type: 'io/text-input',
  title: 'Text Input',
  category: 'IO',
  description: 'Source node: emits the entered text.',
  inputs: [] as const,
  outputs: [{ name: 'text', type: STRING }] as const,
  params: [{ kind: 'string', name: 'text', label: 'Text', default: '', multiline: true }] as const,
  run: (_inputs, params) => ({ text: params.text }),
})
