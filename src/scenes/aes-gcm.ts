/**
 * Scene: AES-GCM — authenticated encryption: confidentiality AND tamper
 * detection, the nonce rule, and the auth tag riding in the ciphertext.
 */

import type { GraphDocument } from '../core/serialize'
import { SceneBuilder } from './kit'

export function aesGcm(): GraphDocument {
  const b = new SceneBuilder()

  b.note(
    [50, 50],
    'AES-GCM: encryption that detects tampering',
    [
      '**AES-GCM is AEAD**: authenticated encryption with associated data.',
      'It hides the message *and* glues a 16-byte **authentication tag** to the',
      'ciphertext: change one bit of it, the key, the nonce, or the AAD, and',
      'decryption **fails loudly** instead of returning garbage.',
      '',
      'Here: a random 32-byte key (AES-256), and the nonce left empty so the',
      'node generates a fresh 12-byte one and reports it on its **iv output**.',
    ].join('\n'),
    'Crypto',
    [380, 330],
  )

  b.note(
    [50, 500],
    'The one rule: never reuse a nonce',
    [
      'Encrypting two messages with the **same key + same nonce** breaks GCM:',
      'attackers recover the XOR of the plaintexts and can forge tags.',
      '',
      'Random 12-byte nonces from a CSPRNG (what this node does) are safe:',
      'the birthday bound leaves you ~2³² messages of headroom per key.',
      '',
      'The nonce is **not secret**: it travels next to the ciphertext,',
      'exactly like the Base64 blob below.',
    ].join('\n'),
    'Notes',
    [330, 330],
  )

  const key = b.config('crypto/random-bytes', [50, 950], { count: 32 }, 'AES-256 key')
  const message = b.config('io/text-input', [50, 1250], { text: 'meet me at midnight, bring the kraken' }, 'Message')

  const enc = b.node('crypto/aes-gcm-encrypt', [550, 900])
  const b64 = b.node('encoding/base64-encode', [950, 900])
  const cipherWatch = b.watch([1350, 900], 'Ciphertext (transmittable)')
  const ivWatch = b.watch([950, 1150], 'Nonce used')

  b.link(key, 'bytes', enc, 'key')
  b.link(message, 'text', enc, 'data')
  b.link(enc, 'ciphertext', b64, 'data')
  b.link(b64, 'text', cipherWatch, 'value')
  b.link(enc, 'iv', ivWatch, 'value')

  const dec = b.node('crypto/aes-gcm-decrypt', [950, 1350])
  const backToText = b.node('data/from-bytes', [1300, 1450], 'As text')
  const plainWatch = b.watch([1650, 1350], 'Decrypted ✓')
  b.link(enc, 'ciphertext', dec, 'ciphertext')
  b.link(key, 'bytes', dec, 'key')
  b.link(enc, 'iv', dec, 'iv')
  b.link(dec, 'plaintext', backToText, 'data')
  b.link(backToText, 'text', plainWatch, 'value')

  b.note(
    [1350, 500],
    'Try to break it',
    [
      '**Experiment:** drag the key wire off the Decrypt node and wire a',
      '*different* Random Bytes node in. The node turns red:',
      '',
      '`AES-GCM decryption failed: wrong key, nonce, AAD, or tampered ciphertext`',
      '',
      'That red node is the authentication tag doing its job. Compare with',
      'AES-CBC (no tag), which would silently "decrypt" to nonsense.',
      '',
      'Click the red node\'s well for the full error, then wire the right key',
      'back and watch it heal itself.',
    ].join('\n'),
    'Notes',
    [330, 380],
  )

  b.group('Secrets & message', [40, 890, 390, 530], '#47603f')
  b.group('Encrypt → transmit → decrypt', [540, 840, 1230, 730], '#a83a32')

  return b.build()
}
