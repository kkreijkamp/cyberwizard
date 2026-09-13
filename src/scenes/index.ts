/**
 * Example scenes: guided, annotated graphs that teach the platform and
 * demonstrate cryptographic ideas. Each builds to a plain GraphDocument and
 * loads through the ordinary restore path (ui/scenes).
 */

import type { GraphDocument } from '../core/serialize'
import { aesGcm } from './aes-gcm'
import { hashesAvalanche } from './hashes-avalanche'
import { pbkdf2Passwords } from './pbkdf2-passwords'
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
    description: 'PBKDF2 stretches a human password into a real AES key — salt and iterations explained.',
    build: pbkdf2Passwords,
  },
]
