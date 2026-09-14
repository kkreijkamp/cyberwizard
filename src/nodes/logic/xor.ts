import { xorBytes } from '../../core/binary'
import { defineNode } from '../../core/registry'
import { BYTES } from '../../core/types'

/** Repeating-key XOR: the key is a wire, not a retyped param. */
defineNode({
  type: 'logic/xor',
  title: 'XOR',
  category: 'Logic',
  description: 'XOR data with a repeating key. Empty key passes data through.',
  inputs: [
    { name: 'data', type: BYTES },
    { name: 'key', type: BYTES },
  ] as const,
  outputs: [{ name: 'result', type: BYTES }] as const,
  run: (inputs) => ({
    result: xorBytes(inputs.data ?? new Uint8Array(), inputs.key ?? new Uint8Array()),
  }),
})
