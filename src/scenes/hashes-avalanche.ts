/**
 * Scene: Hash Functions & the Avalanche Effect, one-way digests, tiny input
 * changes flipping half the bits, and why MD5/SHA-1 are legacy.
 */

import type { GraphDocument } from '../core/serialize'
import { SceneBuilder } from './kit'

export function hashesAvalanche(): GraphDocument {
  const b = new SceneBuilder()

  b.note(
    [50, 50],
    'Hash functions: one-way fingerprints',
    [
      'A hash maps **any input to a fixed-size digest**, and is designed to be',
      'irreversible: the digest tells you nothing about the input.',
      '',
      'Below, two messages that differ in **one letter** produce completely',
      'different SHA-256 digests: the **avalanche effect**. Flip one input bit',
      'and about half the digest bits change.',
      '',
      'Try it: edit a message by a single character and compare the wells.',
    ].join('\n'),
    'Hashing',
    [380, 330],
  )

  const fox = b.config('io/text-input', [50, 500], { text: 'The quick brown fox jumps over the lazy dog' }, 'Message A')
  const fog = b.config('io/text-input', [50, 800], { text: 'The quick brown fog jumps over the lazy dog' }, 'Message B (one letter different)')

  const shaA = b.node('hashing/sha-256', [550, 450], 'SHA-256 of A')
  const shaB = b.node('hashing/sha-256', [550, 750], 'SHA-256 of B')
  const watchA = b.watch([950, 450], 'digest A')
  const watchB = b.watch([950, 750], 'digest B (no resemblance)')

  b.link(fox, 'text', shaA, 'data')
  b.link(shaA, 'hex', watchA, 'value')
  b.link(fog, 'text', shaB, 'data')
  b.link(shaB, 'hex', watchB, 'value')

  b.note(
    [550, 1050],
    'MD5 and SHA-1 are broken (kept for forensics)',
    [
      '**MD5** and **SHA-1** collide on demand: two different files can be made',
      'to share a digest. Never use them for integrity or signatures, but you',
      'will meet them constantly in old systems, logs, and malware reports,',
      'which is why they live in the palette.',
      '',
      'For new designs: **SHA-256** (or SHA-512). For passwords: not hashes at',
      'all; see the *Encrypting with a Password* example (PBKDF2).',
    ].join('\n'),
    'Notes',
    [330, 300],
  )

  const md5 = b.node('hashing/md5', [1000, 1100])
  const md5Watch = b.watch([1400, 1100], 'MD5 (legacy)')
  b.link(fox, 'text', md5, 'data')
  b.link(md5, 'hex', md5Watch, 'value')

  b.group('Near-identical inputs', [40, 440, 390, 500], '#47603f')
  b.group('Unrelated digests', [540, 390, 820, 500], '#7d5119')

  return b.build()
}
