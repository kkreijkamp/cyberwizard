import { asBufferSource } from '../../core/binary'
import { defineNode } from '../../core/registry'
import { BOOLEAN, BYTES } from '../../core/types'

const CURVES = ['P-256', 'P-384', 'P-521'] as const
const HASHES = ['SHA-256', 'SHA-512', 'SHA-1'] as const
const USAGES = ['sign', 'derive'] as const

/**
 * EC key pair generation (NIST curves). Usage picks the algorithm: "sign" →
 * ECDSA sign/verify, "derive" → ECDH shared-secret derivation. Public key
 * exports as SPKI bytes, private as PKCS#8.
 */
defineNode({
  type: 'crypto/ec-generate',
  title: 'EC Generate Key Pair',
  category: 'Crypto',
  description:
    'Generates an elliptic-curve key pair (public: SPKI bytes, private, PKCS#8 bytes). Usage picks the algorithm: "sign" → ECDSA, "derive" → ECDH.',
  inputs: [] as const,
  outputs: [
    { name: 'publicKey', type: BYTES },
    { name: 'privateKey', type: BYTES },
  ] as const,
  params: [
    { kind: 'enum', name: 'curve', label: 'Curve', default: 'P-256', options: CURVES },
    { kind: 'enum', name: 'usage', label: 'Usage', default: 'sign', options: USAGES },
  ] as const,
  run: async (_inputs, params) => {
    const ecdh = params.usage === 'derive'
    const pair = await crypto.subtle.generateKey(
      { name: ecdh ? 'ECDH' : 'ECDSA', namedCurve: params.curve },
      true,
      ecdh ? ['deriveBits'] : ['sign', 'verify'],
    )
    const publicKey = new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey))
    const privateKey = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey))
    return { publicKey, privateKey }
  },
})

async function importEcKey(
  key: Uint8Array | undefined,
  format: 'spki' | 'pkcs8',
  algorithm: 'ECDSA' | 'ECDH',
  curve: string,
  usages: KeyUsage[],
): Promise<CryptoKey> {
  const raw = key ?? new Uint8Array()
  if (raw.length === 0) throw new Error(`${format === 'spki' ? 'public' : 'private'} key is required`)
  try {
    return await crypto.subtle.importKey(format, asBufferSource(raw), { name: algorithm, namedCurve: curve }, false, usages)
  } catch {
    throw new Error(
      `not a valid ${algorithm} ${format === 'spki' ? 'public (SPKI)' : 'private (PKCS#8)'} key on ${curve} (${raw.length} bytes)`,
    )
  }
}

/** ECDSA signature (IEEE-P1363 r‖s form: the same encoding JWS uses). */
defineNode({
  type: 'crypto/ecdsa-sign',
  title: 'ECDSA Sign',
  category: 'Crypto',
  description: 'Elliptic-curve signature in P1363 (r‖s) encoding: what JWS/JWT ES256 uses. Key: a "sign"-usage EC private key.',
  inputs: [
    { name: 'data', type: BYTES },
    { name: 'privateKey', type: BYTES },
  ] as const,
  outputs: [{ name: 'signature', type: BYTES }] as const,
  params: [
    { kind: 'enum', name: 'curve', label: 'Curve', default: 'P-256', options: CURVES },
    { kind: 'enum', name: 'hash', label: 'Hash', default: 'SHA-256', options: HASHES },
  ] as const,
  run: async (inputs, params) => {
    const key = await importEcKey(inputs.privateKey, 'pkcs8', 'ECDSA', params.curve, ['sign'])
    const signature = new Uint8Array(
      await crypto.subtle.sign({ name: 'ECDSA', hash: { name: params.hash } }, key, asBufferSource(inputs.data ?? new Uint8Array())),
    )
    return { signature }
  },
})

/** ECDSA verification: boolean output for Select/If wiring. */
defineNode({
  type: 'crypto/ecdsa-verify',
  title: 'ECDSA Verify',
  category: 'Crypto',
  description: 'Verifies a P1363-encoded ECDSA signature against an EC public key (SPKI). Outputs true/false rather than erroring.',
  inputs: [
    { name: 'data', type: BYTES },
    { name: 'signature', type: BYTES },
    { name: 'publicKey', type: BYTES },
  ] as const,
  outputs: [{ name: 'valid', type: BOOLEAN }] as const,
  params: [
    { kind: 'enum', name: 'curve', label: 'Curve', default: 'P-256', options: CURVES },
    { kind: 'enum', name: 'hash', label: 'Hash', default: 'SHA-256', options: HASHES },
  ] as const,
  run: async (inputs, params) => {
    const key = await importEcKey(inputs.publicKey, 'spki', 'ECDSA', params.curve, ['verify'])
    const valid = await crypto.subtle.verify(
      { name: 'ECDSA', hash: { name: params.hash } },
      key,
      asBufferSource(inputs.signature ?? new Uint8Array()),
      asBufferSource(inputs.data ?? new Uint8Array()),
    )
    return { valid }
  },
})

/** ECDH key agreement: my private key + their public key → the same shared secret both sides. */
defineNode({
  type: 'crypto/ecdh-derive',
  title: 'ECDH Derive Shared Secret',
  category: 'Crypto',
  description:
    'Elliptic-curve Diffie–Hellman: your private key (PKCS#8) + their public key (SPKI) → a shared secret both sides compute identically. Feed it into HKDF for a usable symmetric key.',
  inputs: [
    { name: 'privateKey', type: BYTES },
    { name: 'publicKey', type: BYTES },
  ] as const,
  outputs: [{ name: 'sharedSecret', type: BYTES }] as const,
  params: [
    { kind: 'enum', name: 'curve', label: 'Curve', default: 'P-256', options: CURVES },
    { kind: 'number', name: 'length', label: 'Secret length (bytes)', default: 32, min: 1, max: 66, step: 1, precision: 0 },
  ] as const,
  run: async (inputs, params) => {
    const privateKey = await importEcKey(inputs.privateKey, 'pkcs8', 'ECDH', params.curve, ['deriveBits'])
    const publicKey = await importEcKey(inputs.publicKey, 'spki', 'ECDH', params.curve, [])
    const bits = await crypto.subtle.deriveBits({ name: 'ECDH', public: publicKey }, privateKey, params.length * 8)
    return { sharedSecret: new Uint8Array(bits) }
  },
})
