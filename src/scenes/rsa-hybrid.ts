/**
 * Scene: Hybrid Encryption — RSA wraps a symmetric key, AES-GCM carries the
 * actual message. The pattern behind TLS, PGP, and every real RSA deployment.
 */

import type { GraphDocument } from '../core/serialize'
import { SceneBuilder } from './kit'

export function rsaHybrid(): GraphDocument {
  const b = new SceneBuilder()

  b.note(
    [50, 50],
    'Public keys vs private keys',
    [
      'RSA is **asymmetric**: one keypair, two roles.',
      '',
      '- The **public key encrypts** — post it on a billboard, anyone can use it.',
      '- The **private key decrypts** — guard it; it\'s the only one that can read.',
      '',
      'Watch the keys below: the encryptor only ever touches the *public* key.',
      'The private key appears exactly once, at the decrypt end.',
    ].join('\n'),
    'Crypto',
    [380, 300],
  )

  b.note(
    [50, 450],
    'Why hybrid? RSA can\'t carry data',
    [
      'RSA-OAEP with a 2048-bit key encrypts at most **190 bytes** — not a',
      'message, barely a sentence. And it\'s slow.',
      '',
      'So real systems (TLS, PGP, Signal\'s ancestors) do **hybrid encryption**:',
      '',
      '1. Generate a random one-time AES key.',
      '2. **Wrap** it with RSA (32 bytes — fits easily).',
      '3. Encrypt the actual message with fast AES-GCM.',
      '',
      'The recipient unwraps the key with their private key, then decrypts.',
    ].join('\n'),
    'Notes',
    [330, 380],
  )

  const pair = b.config('crypto/rsa-generate', [50, 950], { usage: 'encrypt' }, 'Recipient keypair')
  const pubWatch = b.watch([550, 950], 'Public key (shareable)')

  const aesKey = b.config('crypto/random-bytes', [50, 1250], { count: 32 }, 'One-time AES key')
  const wrap = b.node('crypto/rsa-encrypt', [550, 1200], 'RSA wrap')
  const wrapWatch = b.watch([1000, 1200], 'Wrapped key')

  b.link(pair, 'publicKey', pubWatch, 'value')
  b.link(aesKey, 'bytes', wrap, 'data')
  b.link(pair, 'publicKey', wrap, 'publicKey')
  b.link(wrap, 'ciphertext', wrapWatch, 'value')

  const message = b.config('io/text-input', [50, 1550], { text: 'a whole message, far longer than 190 bytes could ever be' }, 'Message')
  const enc = b.node('crypto/aes-gcm-encrypt', [550, 1500])
  const cipherWatch = b.watch([1000, 1500], 'Ciphertext')
  b.link(message, 'text', enc, 'data')
  b.link(aesKey, 'bytes', enc, 'key')
  b.link(enc, 'ciphertext', cipherWatch, 'value')

  const unwrap = b.node('crypto/rsa-decrypt', [1000, 1750], 'RSA unwrap')
  const dec = b.node('crypto/aes-gcm-decrypt', [1450, 1750])
  const plainWatch = b.watch([1850, 1750], 'Decrypted ✓')
  b.link(wrap, 'ciphertext', unwrap, 'ciphertext')
  b.link(pair, 'privateKey', unwrap, 'privateKey')
  b.link(enc, 'ciphertext', dec, 'ciphertext')
  b.link(unwrap, 'plaintext', dec, 'key')
  b.link(enc, 'iv', dec, 'iv')
  b.link(dec, 'plaintext', plainWatch, 'value')

  b.note(
    [1450, 1300],
    'The private key appears once',
    [
      'Everything on the wire — public key, wrapped key, ciphertext, nonce —',
      'is safe to transmit in the open. Only the unwrap step needs the',
      '**private key**.',
      '',
      'Notice the unwrap output feeds the AES key slot directly: the wrapped',
      'key *is* the AES key, round-tripped through RSA.',
    ].join('\n'),
    'Notes',
    [330, 280],
  )

  b.group('Keys', [40, 890, 390, 580], '#47603f')
  b.group('Wrap → encrypt → unwrap → decrypt', [540, 890, 2300, 1080], '#a83a32')

  return b.build()
}
