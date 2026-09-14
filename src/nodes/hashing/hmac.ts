import { asBufferSource, bytesToHex } from '../../core/binary'
import { defineNode } from '../../core/registry'
import { BYTES, STRING } from '../../core/types'

const HASHES = ['SHA-256', 'SHA-512', 'SHA-1'] as const

/** HMAC via WebCrypto: the key is a wire, not a retyped param. */
defineNode({
  type: 'hashing/hmac',
  title: 'HMAC',
  category: 'Hashing',
  inputs: [
    { name: 'data', type: BYTES },
    { name: 'key', type: BYTES },
  ] as const,
  outputs: [
    { name: 'digest', type: BYTES },
    { name: 'hex', type: STRING },
  ] as const,
  params: [
    { kind: 'enum', name: 'hash', label: 'Hash', default: 'SHA-256', options: HASHES },
  ] as const,
  run: async (inputs, params) => {
    const key = await crypto.subtle.importKey(
      'raw',
      asBufferSource(inputs.key ?? new Uint8Array()),
      { name: 'HMAC', hash: { name: params.hash } },
      false,
      ['sign'],
    )
    const digest = new Uint8Array(
      await crypto.subtle.sign('HMAC', key, asBufferSource(inputs.data ?? new Uint8Array())),
    )
    return { digest, hex: bytesToHex(digest) }
  },
})
