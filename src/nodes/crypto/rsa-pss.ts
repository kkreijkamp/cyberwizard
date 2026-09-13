import { asBufferSource } from '../../core/binary'
import { defineNode } from '../../core/registry'
import { BOOLEAN, BYTES } from '../../core/types'

const HASHES = ['SHA-256', 'SHA-512', 'SHA-1'] as const

async function importPssKey(key: Uint8Array | undefined, format: 'spki' | 'pkcs8', hash: string, usages: KeyUsage[]): Promise<CryptoKey> {
  const raw = key ?? new Uint8Array()
  if (raw.length === 0) throw new Error(`${format === 'spki' ? 'public' : 'private'} key is required`)
  try {
    return await crypto.subtle.importKey(format, asBufferSource(raw), { name: 'RSA-PSS', hash: { name: hash } }, false, usages)
  } catch {
    throw new Error(`not a valid RSA ${format === 'spki' ? 'public (SPKI)' : 'private (PKCS#8)'} key for RSA-PSS/${hash} (${raw.length} bytes)`)
  }
}

/** RSA-PSS signature — probabilistic (salt), so signatures differ run to run. */
defineNode({
  type: 'crypto/rsa-sign',
  title: 'RSA Sign',
  category: 'Crypto',
  description:
    'RSA-PSS signature over the data. Key: a "sign"-usage RSA private key (PKCS#8); hash and salt length must match what the verifier uses.',
  inputs: [
    { name: 'data', type: BYTES },
    { name: 'privateKey', type: BYTES },
  ] as const,
  outputs: [{ name: 'signature', type: BYTES }] as const,
  params: [
    { kind: 'enum', name: 'hash', label: 'Hash', default: 'SHA-256', options: HASHES },
    { kind: 'number', name: 'saltLength', label: 'Salt length (bytes)', default: 32, min: 0, max: 222, step: 1, precision: 0 },
  ] as const,
  run: async (inputs, params) => {
    const key = await importPssKey(inputs.privateKey, 'pkcs8', params.hash, ['sign'])
    const signature = new Uint8Array(
      await crypto.subtle.sign({ name: 'RSA-PSS', saltLength: params.saltLength }, key, asBufferSource(inputs.data ?? new Uint8Array())),
    )
    return { signature }
  },
})

/** RSA-PSS verification — boolean output, wire it into Select/If. */
defineNode({
  type: 'crypto/rsa-verify',
  title: 'RSA Verify',
  category: 'Crypto',
  description: 'Verifies an RSA-PSS signature against a public key (SPKI). Outputs true/false rather than erroring.',
  inputs: [
    { name: 'data', type: BYTES },
    { name: 'signature', type: BYTES },
    { name: 'publicKey', type: BYTES },
  ] as const,
  outputs: [{ name: 'valid', type: BOOLEAN }] as const,
  params: [
    { kind: 'enum', name: 'hash', label: 'Hash', default: 'SHA-256', options: HASHES },
    { kind: 'number', name: 'saltLength', label: 'Salt length (bytes)', default: 32, min: 0, max: 222, step: 1, precision: 0 },
  ] as const,
  run: async (inputs, params) => {
    const key = await importPssKey(inputs.publicKey, 'spki', params.hash, ['verify'])
    const valid = await crypto.subtle.verify(
      { name: 'RSA-PSS', saltLength: params.saltLength },
      key,
      asBufferSource(inputs.signature ?? new Uint8Array()),
      asBufferSource(inputs.data ?? new Uint8Array()),
    )
    return { valid }
  },
})
