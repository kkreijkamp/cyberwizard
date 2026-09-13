import { asBufferSource, bytesToHex } from '../../core/binary'
import { defineNode } from '../../core/registry'
import { BYTES, STRING } from '../../core/types'

const HASHES = ['SHA-256', 'SHA-512', 'SHA-1'] as const

/** PBKDF2: stretch a password into a key with salt + iterations. */
defineNode({
  type: 'crypto/pbkdf2',
  title: 'PBKDF2 Derive Key',
  category: 'Crypto',
  description:
    'Password-Based Key Derivation Function 2: stretches a password with salt and iterations into key material. The salt is not secret, but must be stored to re-derive.',
  inputs: [
    { name: 'password', type: BYTES },
    { name: 'salt', type: BYTES },
  ] as const,
  outputs: [
    { name: 'key', type: BYTES },
    { name: 'hex', type: STRING },
  ] as const,
  params: [
    { kind: 'number', name: 'iterations', label: 'Iterations', default: 100_000, min: 1, max: 10_000_000, step: 1000, precision: 0 },
    { kind: 'enum', name: 'hash', label: 'Hash', default: 'SHA-256', options: HASHES },
    { kind: 'number', name: 'length', label: 'Key length (bytes)', default: 32, min: 1, max: 512, step: 1, precision: 0 },
  ] as const,
  run: async (inputs, params) => {
    const baseKey = await crypto.subtle.importKey('raw', asBufferSource(inputs.password ?? new Uint8Array()), 'PBKDF2', false, ['deriveBits'])
    const bits = await crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        hash: { name: params.hash },
        salt: asBufferSource(inputs.salt ?? new Uint8Array()),
        iterations: Math.floor(params.iterations),
      },
      baseKey,
      params.length * 8,
    )
    const key = new Uint8Array(bits)
    return { key, hex: bytesToHex(key) }
  },
})

/** HKDF: expand already-strong key material into purpose-specific keys. */
defineNode({
  type: 'crypto/hkdf',
  title: 'HKDF Derive Key',
  category: 'Crypto',
  description:
    'HMAC-based Extract-and-Expand KDF: turns strong-but-uniform input key material (e.g. an ECDH shared secret) into purpose-specific keys, labelled by the info slot.',
  inputs: [
    { name: 'ikm', type: BYTES },
    { name: 'salt', type: BYTES },
    { name: 'info', type: BYTES },
  ] as const,
  outputs: [
    { name: 'key', type: BYTES },
    { name: 'hex', type: STRING },
  ] as const,
  params: [
    { kind: 'enum', name: 'hash', label: 'Hash', default: 'SHA-256', options: HASHES },
    { kind: 'number', name: 'length', label: 'Key length (bytes)', default: 32, min: 1, max: 512, step: 1, precision: 0 },
  ] as const,
  run: async (inputs, params) => {
    const baseKey = await crypto.subtle.importKey('raw', asBufferSource(inputs.ikm ?? new Uint8Array()), 'HKDF', false, ['deriveBits'])
    const bits = await crypto.subtle.deriveBits(
      {
        name: 'HKDF',
        hash: { name: params.hash },
        salt: asBufferSource(inputs.salt ?? new Uint8Array()),
        info: asBufferSource(inputs.info ?? new Uint8Array()),
      },
      baseKey,
      params.length * 8,
    )
    const key = new Uint8Array(bits)
    return { key, hex: bytesToHex(key) }
  },
})
