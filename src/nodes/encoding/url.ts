import { defineNode } from '../../core/registry'
import { STRING } from '../../core/types'

defineNode({
  type: 'encoding/url-encode',
  title: 'URL Encode',
  category: 'Encoding',
  inputs: [{ name: 'text', type: STRING }] as const,
  outputs: [{ name: 'text', type: STRING }] as const,
  params: [
    {
      kind: 'enum',
      name: 'mode',
      label: 'Mode',
      default: 'component',
      options: ['component', 'full URL'],
    },
  ] as const,
  run: (inputs, params) => ({
    text: params.mode === 'component'
      ? encodeURIComponent(inputs.text ?? '')
      : encodeURI(inputs.text ?? ''),
  }),
})

defineNode({
  type: 'encoding/url-decode',
  title: 'URL Decode',
  category: 'Encoding',
  inputs: [{ name: 'text', type: STRING }] as const,
  outputs: [{ name: 'text', type: STRING }] as const,
  run: (inputs) => ({ text: decodeURIComponent(inputs.text ?? '') }),
})
