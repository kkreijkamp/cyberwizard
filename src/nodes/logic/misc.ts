import { defineNode } from '../../core/registry'
import { STRING } from '../../core/types'

const textInOut = {
  inputs: [{ name: 'text', type: STRING }] as const,
  outputs: [{ name: 'text', type: STRING }] as const,
}

defineNode({
  type: 'logic/rot13',
  title: 'ROT13',
  category: 'Logic',
  ...textInOut,
  run: (inputs) => ({
    text: (inputs.text ?? '').replace(/[a-zA-Z]/g, (ch) => {
      const base = ch <= 'Z' ? 65 : 97
      return String.fromCharCode(((ch.charCodeAt(0) - base + 13) % 26) + base)
    }),
  }),
})

/** Reverses by Unicode code point (surrogate pairs stay intact). */
defineNode({
  type: 'logic/reverse',
  title: 'Reverse',
  category: 'Logic',
  ...textInOut,
  run: (inputs) => ({ text: [...(inputs.text ?? '')].reverse().join('') }),
})
