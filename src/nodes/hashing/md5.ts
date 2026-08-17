import { md5 } from 'hash-wasm'
import { hexToBytes } from '../../core/binary'
import { defineNode } from '../../core/registry'
import { BYTES, STRING } from '../../core/types'

/** MD5 via hash-wasm (WebCrypto doesn't offer it — legacy use only). */
defineNode({
  type: 'hashing/md5',
  title: 'MD5',
  category: 'Hashing',
  description: 'Legacy hash — cryptographically broken, use for checksums only.',
  inputs: [{ name: 'data', type: BYTES }] as const,
  outputs: [
    { name: 'digest', type: BYTES },
    { name: 'hex', type: STRING },
  ] as const,
  run: async (inputs) => {
    const hex = await md5(inputs.data ?? new Uint8Array())
    return { digest: hexToBytes(hex), hex }
  },
})
