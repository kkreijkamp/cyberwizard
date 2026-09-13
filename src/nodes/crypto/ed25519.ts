import { asBufferSource } from '../../core/binary'
import { defineNode } from '../../core/registry'
import { BOOLEAN, BYTES } from '../../core/types'

/**
 * Ed25519 key pair (Edwards-curve DSA — fast, modern, tiny 64-byte
 * signatures). Public exports as SPKI bytes, private as PKCS#8.
 */
defineNode({
  type: 'crypto/ed25519-generate',
  title: 'Ed25519 Generate Key Pair',
  category: 'Crypto',
  description: 'Generates an Ed25519 key pair (public: SPKI bytes, private: PKCS#8 bytes). Modern, fast, 64-byte signatures.',
  inputs: [] as const,
  outputs: [
    { name: 'publicKey', type: BYTES },
    { name: 'privateKey', type: BYTES },
  ] as const,
  run: async () => {
    const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
    const publicKey = new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey))
    const privateKey = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey))
    return { publicKey, privateKey }
  },
})

async function importEd25519Key(key: Uint8Array | undefined, format: 'spki' | 'pkcs8', usages: KeyUsage[]): Promise<CryptoKey> {
  const raw = key ?? new Uint8Array()
  if (raw.length === 0) throw new Error(`${format === 'spki' ? 'public' : 'private'} key is required`)
  try {
    return await crypto.subtle.importKey(format, asBufferSource(raw), { name: 'Ed25519' }, false, usages)
  } catch {
    throw new Error(`not a valid Ed25519 ${format === 'spki' ? 'public (SPKI)' : 'private (PKCS#8)'} key (${raw.length} bytes)`)
  }
}

/** Ed25519 signature — deterministic, always 64 bytes. */
defineNode({
  type: 'crypto/ed25519-sign',
  title: 'Ed25519 Sign',
  category: 'Crypto',
  description: 'Deterministic Ed25519 signature (64 bytes) over the data.',
  inputs: [
    { name: 'data', type: BYTES },
    { name: 'privateKey', type: BYTES },
  ] as const,
  outputs: [{ name: 'signature', type: BYTES }] as const,
  run: async (inputs) => {
    const key = await importEd25519Key(inputs.privateKey, 'pkcs8', ['sign'])
    const signature = new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, key, asBufferSource(inputs.data ?? new Uint8Array())))
    return { signature }
  },
})

/** Ed25519 verification — boolean output for Select/If wiring. */
defineNode({
  type: 'crypto/ed25519-verify',
  title: 'Ed25519 Verify',
  category: 'Crypto',
  description: 'Verifies an Ed25519 signature against a public key (SPKI). Outputs true/false rather than erroring.',
  inputs: [
    { name: 'data', type: BYTES },
    { name: 'signature', type: BYTES },
    { name: 'publicKey', type: BYTES },
  ] as const,
  outputs: [{ name: 'valid', type: BOOLEAN }] as const,
  run: async (inputs) => {
    const key = await importEd25519Key(inputs.publicKey, 'spki', ['verify'])
    const valid = await crypto.subtle.verify(
      { name: 'Ed25519' },
      key,
      asBufferSource(inputs.signature ?? new Uint8Array()),
      asBufferSource(inputs.data ?? new Uint8Array()),
    )
    return { valid }
  },
})
