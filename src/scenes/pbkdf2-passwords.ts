/**
 * Scene: Encrypting with a Password, PBKDF2 stretches a human password into
 * a real key, with salt and iteration count doing the heavy lifting.
 */

import type { GraphDocument } from '../core/serialize'
import { SceneBuilder } from './kit'

export function pbkdf2Passwords(): GraphDocument {
  const b = new SceneBuilder()

  b.note(
    [50, 50],
    'Passwords are not keys',
    [
      'AES wants 32 bytes of uniform randomness. Humans pick `hunter2`.',
      '**PBKDF2** bridges the gap: it hashes the password against a **salt**',
      'thousands of times, stretching it into proper key material and making',
      'brute-force guesses cost real time (× iterations, per guess, per',
      'candidate password).',
      '',
      'Same password + same salt + same settings → same key, every time.',
      'That determinism is the point: the decrypting side re-derives it.',
    ].join('\n'),
    'Crypto',
    [380, 330],
  )

  const password = b.config('io/text-input', [50, 500], { text: 'correct horse battery staple' }, 'Password')
  const salt = b.config('crypto/random-bytes', [50, 800], { count: 16 }, 'Salt')

  const kdf = b.node('crypto/pbkdf2', [550, 600])
  const keyWatch = b.watch([1000, 600], 'Derived key (hex)')

  b.link(password, 'text', kdf, 'password')
  b.link(salt, 'bytes', kdf, 'salt')
  b.link(kdf, 'hex', keyWatch, 'value')

  const message = b.config('io/text-input', [50, 1100], { text: 'the eagle lands at dawn' }, 'Secret message')
  const enc = b.node('crypto/aes-gcm-encrypt', [550, 1000])
  const b64 = b.node('encoding/base64-encode', [1000, 1000])
  const cipherWatch = b.watch([1400, 1000], 'Ciphertext')
  const saltB64 = b.node('encoding/base64-encode', [550, 1300], 'Salt (store beside ciphertext)')
  const saltWatch = b.watch([1000, 1300], 'Salt (not secret)')

  b.link(message, 'text', enc, 'data')
  b.link(kdf, 'key', enc, 'key')
  b.link(enc, 'ciphertext', b64, 'data')
  b.link(b64, 'text', cipherWatch, 'value')
  b.link(salt, 'bytes', saltB64, 'data')
  b.link(saltB64, 'text', saltWatch, 'value')

  const dec = b.node('crypto/aes-gcm-decrypt', [1400, 1300])
  const backToText = b.node('data/from-bytes', [1700, 1400], 'As text')
  const plainWatch = b.watch([2050, 1300], 'Decrypted ✓')
  b.link(enc, 'ciphertext', dec, 'ciphertext')
  b.link(kdf, 'key', dec, 'key')
  b.link(enc, 'iv', dec, 'iv')
  b.link(dec, 'plaintext', backToText, 'data')
  b.link(backToText, 'text', plainWatch, 'value')

  b.note(
    [1000, 1600],
    'The salt is not a secret',
    [
      'Store it **next to the ciphertext**: its only job is to make every',
      'derivation unique, so two users with the same password get different',
      'keys and attackers can\'t precompute a dictionary once for everyone.',
      '',
      'The **iteration count** (100 000 here) is your brake pedal: raise it',
      'and every guess gets slower, including yours. Watch the graph',
      'recompute when you edit the password; that pause *is* the security.',
    ].join('\n'),
    'Notes',
    [330, 300],
  )

  b.group('Password in, key out', [40, 440, 390, 520], '#7d5119')
  b.group('Derive → encrypt → decrypt', [540, 540, 2100, 1400], '#a83a32')

  return b.build()
}
