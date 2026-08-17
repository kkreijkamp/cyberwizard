import { defineNode } from '../../core/registry'
import { STRING } from '../../core/types'

const textInOut = {
  inputs: [{ name: 'text', type: STRING }] as const,
  outputs: [{ name: 'text', type: STRING }] as const,
}

defineNode({
  type: 'text/to-upper-case',
  title: 'To Upper Case',
  category: 'Text',
  ...textInOut,
  run: (inputs) => ({ text: (inputs.text ?? '').toUpperCase() }),
})

defineNode({
  type: 'text/to-lower-case',
  title: 'To Lower Case',
  category: 'Text',
  ...textInOut,
  run: (inputs) => ({ text: (inputs.text ?? '').toLowerCase() }),
})

defineNode({
  type: 'text/capitalize',
  title: 'Capitalize Words',
  category: 'Text',
  ...textInOut,
  run: (inputs) => ({
    text: (inputs.text ?? '').replace(/(^|\s)(\p{L})/gu, (_m, sep: string, ch: string) => sep + ch.toUpperCase()),
  }),
})
