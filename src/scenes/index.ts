/**
 * Example scenes: guided, annotated graphs that teach the platform and
 * demonstrate cryptographic ideas. Each builds to a plain GraphDocument and
 * loads through the ordinary restore path (ui/scenes).
 */

import type { GraphDocument } from '../core/serialize'
import { aesGcm } from './aes-gcm'
import { ecdhAgreement } from './ecdh-agreement'
import { hashesAvalanche } from './hashes-avalanche'
import { jwtAnatomy } from './jwt-anatomy'
import { listPipelines } from './list-pipelines'
import { pbkdf2Passwords } from './pbkdf2-passwords'
import { peelingLayers } from './peeling-layers'
import { recursionLens } from './recursion-lens'
import { rsaHybrid } from './rsa-hybrid'
import { signatures } from './signatures'
import { welcomeTour } from './welcome-tour'

export interface Scene {
  id: string
  title: string
  /** One line shown in the picker. */
  description: string
  build: () => GraphDocument
}

export const SCENES: readonly Scene[] = [
  {
    id: 'welcome-tour',
    title: 'Welcome Tour',
    description: 'The platform in five minutes: wires, previews, coercion, demand-driven evaluation.',
    build: welcomeTour,
  },
  {
    id: 'hashes-avalanche',
    title: 'Hash Functions & Avalanche',
    description: 'One-way fingerprints, the avalanche effect, and why MD5/SHA-1 are legacy.',
    build: hashesAvalanche,
  },
  {
    id: 'aes-gcm',
    title: 'AES-GCM: Tamper-Evident Encryption',
    description: 'AEAD in practice: keys, nonces, the auth tag, and what breaks when you reuse them.',
    build: aesGcm,
  },
  {
    id: 'pbkdf2-passwords',
    title: 'Encrypting with a Password',
    description: 'PBKDF2 stretches a human password into a real AES key, with salt and iterations explained.',
    build: pbkdf2Passwords,
  },
  {
    id: 'rsa-hybrid',
    title: 'Hybrid Encryption (RSA + AES)',
    description: 'RSA wraps a one-time AES key, AES-GCM carries the message (the TLS/PGP pattern).',
    build: rsaHybrid,
  },
  {
    id: 'signatures',
    title: 'Digital Signatures (Ed25519)',
    description: 'Prove authorship without secrecy; a lazy Select renders the verdict.',
    build: signatures,
  },
  {
    id: 'ecdh-agreement',
    title: 'ECDH: Secrets From Thin Air',
    description: 'Two parties derive the same secret without sending it, then HKDF makes it an AES key.',
    build: ecdhAgreement,
  },
  {
    id: 'jwt-anatomy',
    title: 'Anatomy of a JWT',
    description: 'Decode the parts, pick the claims, and verify HS256 by composition (HMAC → Equals).',
    build: jwtAnatomy,
  },
  {
    id: 'recursion-lens',
    title: 'Recursion & the Call Lens',
    description: 'A subgraph that calls itself: double-click into it and step through every recursion layer.',
    build: recursionLens,
  },
  {
    id: 'list-pipelines',
    title: 'List Pipelines (Map/Filter)',
    description: 'Split → Map → Filter → Join, with subgraphs picked by name as the per-element functions.',
    build: listPipelines,
  },
  {
    id: 'peeling-layers',
    title: 'Peeling Layers of Encoding',
    description: 'Read an obfuscation by its shape and unwind Base64 → hex → XOR, watching every stage.',
    build: peelingLayers,
  },
]
