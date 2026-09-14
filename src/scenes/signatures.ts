/**
 * Scene: Digital Signatures (Ed25519), authenticity without secrecy, and a
 * lazy Select rendering the verdict.
 */

import type { GraphDocument } from '../core/serialize'
import { SceneBuilder } from './kit'

export function signatures(): GraphDocument {
  const b = new SceneBuilder()

  b.note(
    [50, 50],
    'Signatures: proof of authorship, not secrecy',
    [
      'A signature answers one question: **did THIS keyholder sign THIS',
      'message?** The message itself is public; signing hides nothing.',
      '',
      '- The **private key signs** (only the author can).',
      '- The **public key verifies** (anyone can check).',
      '',
      'Ed25519 is the modern default: fast, deterministic, tiny 64-byte',
      'signatures. Change one letter of the signed message below and watch',
      'the verdict flip to **✗ forged**, instantly, because the whole graph',
      'recomputes on edit.',
    ].join('\n'),
    'Crypto',
    [380, 330],
  )

  const pair = b.config('crypto/ed25519-generate', [50, 500], {}, 'Signer keypair')
  const message = b.config('io/text-input', [50, 800], { text: 'I owe you nothing, signed M.' }, 'Signed document')
  const pubWatch = b.watch([550, 500], 'Public key (post it anywhere)')

  const sign = b.node('crypto/ed25519-sign', [550, 800])
  const sigWatch = b.watch([1000, 800], 'Signature (64 bytes, hex)')
  const sigHex = b.node('encoding/hex-encode', [700, 1050], 'Hex')

  b.link(pair, 'publicKey', pubWatch, 'value')
  b.link(message, 'text', sign, 'data')
  b.link(pair, 'privateKey', sign, 'privateKey')
  b.link(sign, 'signature', sigHex, 'data')
  b.link(sigHex, 'text', sigWatch, 'value')

  const verify = b.node('crypto/ed25519-verify', [1000, 1150])
  b.link(message, 'text', verify, 'data')
  b.link(sign, 'signature', verify, 'signature')
  b.link(pair, 'publicKey', verify, 'publicKey')

  const yes = b.config('io/text-input', [1350, 1000], { text: '✓ authentic: the signature matches' }, 'then')
  const no = b.config('io/text-input', [1350, 1300], { text: '✗ forged or tampered' }, 'else')
  const verdict = b.node('flow/select', [1650, 1150], 'Verdict')
  const verdictWatch = b.watch([2050, 1150], 'Verdict')

  b.link(verify, 'valid', verdict, 'cond')
  b.link(yes, 'text', verdict, 'then')
  b.link(no, 'text', verdict, 'else')
  b.link(verdict, 'result', verdictWatch, 'value')

  b.note(
    [1650, 1450],
    'Lazy conditionals pick a branch',
    [
      'The **Select** node is a value-level if: it only evaluates the branch',
      'it takes. The `then` and `else` wells stay `∅` until their side is',
      'chosen: unwired-cycle-free control flow.',
      '',
      'Verify outputs a **boolean**: perfect Select condition. Booleans drive',
      'branching everywhere in CyberWizard, including stopping recursion',
      '(see the Recursion example).',
    ].join('\n'),
    'Notes',
    [330, 300],
  )

  b.group('Sign', [40, 440, 1290, 800], '#47603f')
  b.group('Verify → verdict', [990, 1090, 1470, 640], '#3a5580')

  return b.build()
}
