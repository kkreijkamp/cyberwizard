/**
 * Scene: ECDH Key Agreement, two parties derive the same secret without ever
 * transmitting it, then HKDF turns it into an AES key.
 */

import type { GraphDocument } from '../core/serialize'
import { SceneBuilder } from './kit'

export function ecdhAgreement(): GraphDocument {
  const b = new SceneBuilder()

  b.note(
    [50, 50],
    'The magic of Diffie–Hellman',
    [
      'Alice and Bob each make a keypair and swap **public keys only**, in',
      'the open, with Mallory watching.',
      '',
      'Each then combines *their own private key* with *the other\'s public',
      'key*… and both arrive at **the same shared secret**. Mallory, holding',
      'only the two public keys, cannot compute it.',
      '',
      'Below: both Derive nodes output identical values. Check the wells:',
      'the secret *never* crosses a wire between the two sides.',
    ].join('\n'),
    'Crypto',
    [380, 330],
  )

  const alice = b.config('crypto/ec-generate', [50, 500], { usage: 'derive' }, 'Alice keypair')
  const bob = b.config('crypto/ec-generate', [50, 800], { usage: 'derive' }, 'Bob keypair')
  const alicePub = b.watch([550, 500], "Alice's public key (transmitted)")
  const bobPub = b.watch([550, 800], "Bob's public key (transmitted)")

  const deriveAlice = b.node('crypto/ecdh-derive', [1000, 500], 'Derive (Alice side)')
  const deriveBob = b.node('crypto/ecdh-derive', [1000, 800], 'Derive (Bob side)')
  const secretA = b.watch([1450, 500], 'Shared secret (Alice)')
  const secretB = b.watch([1450, 800], 'Shared secret (Bob, identical!)')

  b.link(alice, 'publicKey', alicePub, 'value')
  b.link(bob, 'publicKey', bobPub, 'value')
  b.link(alice, 'privateKey', deriveAlice, 'privateKey')
  b.link(bob, 'publicKey', deriveAlice, 'publicKey')
  b.link(bob, 'privateKey', deriveBob, 'privateKey')
  b.link(alice, 'publicKey', deriveBob, 'publicKey')
  b.link(deriveAlice, 'sharedSecret', secretA, 'value')
  b.link(deriveBob, 'sharedSecret', secretB, 'value')

  b.note(
    [1450, 1050],
    'DH output is key *material*, not a key',
    [
      'The shared secret is mathematically strong but not uniformly random:',
      'using it directly as an AES key is sloppy. **HKDF** fixes that: it',
      'extracts and expands proper key material, labelled by **info** so one',
      'secret can yield independent keys for different purposes.',
      '',
      'Same inputs → same outputs, so Alice\'s and Bob\'s HKDF runs produce',
      'identical AES keys without ever sending the key itself.',
    ].join('\n'),
    'Notes',
    [330, 300],
  )

  const info = b.config('io/text-input', [1000, 1350], { text: 'alice-bob chat v1' }, 'HKDF info label')
  const kdf = b.node('crypto/hkdf', [1450, 1350])
  const keyWatch = b.watch([1900, 1350], 'AES key (hex)')
  b.link(deriveAlice, 'sharedSecret', kdf, 'ikm')
  b.link(info, 'text', kdf, 'info')
  b.link(kdf, 'hex', keyWatch, 'value')

  const message = b.config('io/text-input', [1000, 1650], { text: 'meet at the lighthouse, tell no one' }, "Alice's message")
  const enc = b.node('crypto/aes-gcm-encrypt', [1450, 1650])
  const cipherWatch = b.watch([1900, 1650], 'Ciphertext for Bob')
  b.link(message, 'text', enc, 'data')
  b.link(kdf, 'key', enc, 'key')
  b.link(enc, 'ciphertext', cipherWatch, 'value')

  b.group('Two keypairs, born apart', [40, 440, 390, 520], '#47603f')
  b.group('Same secret, twice, never transmitted', [990, 440, 870, 520], '#3a5580')
  b.group('KDF → encrypt', [990, 1290, 1300, 560], '#a83a32')

  return b.build()
}
