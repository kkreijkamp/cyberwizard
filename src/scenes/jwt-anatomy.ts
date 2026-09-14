/**
 * Scene: Anatomy of a JWT, decode the parts, pick claims, and verify the
 * HS256 signature by composition (JWT Decode → HMAC → Equals).
 */

import type { GraphDocument } from '../core/serialize'
import { SceneBuilder } from './kit'

const JWT_IO_TOKEN =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
  'eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.' +
  'SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'

export function jwtAnatomy(): GraphDocument {
  const b = new SceneBuilder()

  b.note(
    [50, 50],
    'A JWT is three base64url parts',
    [
      '`header.payload.signature`: each part base64url-encoded.',
      '',
      '**A JWT is not encrypted.** Anyone can read the payload (try it below).',
      'The signature only proves *integrity*: the issuer\'s key signed these',
      'exact bytes. JWT Decode emits those bytes as **signedData**, so',
      'verification is just… the nodes you already know.',
      '',
      'This token is the classic jwt.io demo, signed with the public test',
      'secret `your-256-bit-secret` (never hardcode real secrets like this).',
    ].join('\n'),
    'Crypto',
    [380, 330],
  )

  const token = b.config('io/text-input', [50, 500], { text: JWT_IO_TOKEN }, 'JWT')
  const decode = b.node('crypto/jwt-decode', [550, 600])

  const alg = b.config('data/json-pick', [950, 450], { path: 'alg' }, 'header.alg')
  const name = b.config('data/json-pick', [950, 700], { path: 'name' }, 'payload.name')
  const iat = b.config('data/json-pick', [950, 900], { path: 'iat' }, 'payload.iat')
  const algWatch = b.watch([1350, 450], 'Algorithm')
  const nameWatch = b.watch([1350, 700], 'Name claim')
  const iatWatch = b.watch([1350, 900], 'Issued-at (unix)')

  b.link(token, 'text', decode, 'token')
  b.link(decode, 'header', alg, 'value')
  b.link(decode, 'payload', name, 'value')
  b.link(decode, 'payload', iat, 'value')
  b.link(alg, 'picked', algWatch, 'value')
  b.link(name, 'picked', nameWatch, 'value')
  b.link(iat, 'picked', iatWatch, 'value')

  const secret = b.config('io/text-input', [550, 1150], { text: 'your-256-bit-secret' }, 'HMAC secret')
  const hmac = b.node('hashing/hmac', [1000, 1200])
  const equals = b.node('math/equals', [1450, 1200], 'Signature matches?')
  const matchWatch = b.watch([1850, 1200], 'Signature valid?')

  b.link(secret, 'text', hmac, 'key')
  b.link(decode, 'signedData', hmac, 'data')
  b.link(hmac, 'digest', equals, 'a')
  b.link(decode, 'signature', equals, 'b')
  b.link(equals, 'result', matchWatch, 'value')

  b.note(
    [1450, 1450],
    'Verification by composition',
    [
      'No “verify JWT” node needed: **signedData → HMAC-SHA-256 → compare**',
      'to the attached signature. The bytes equal ⇒ true.',
      '',
      'Try it: change one character of the token\'s payload (the middle',
      'segment) and verification flips to **false** instantly.',
      '',
      'Real-world trap: some libraries once accepted `alg: none`. Always pin',
      'the algorithm you expect; the header is attacker-controlled too.',
    ].join('\n'),
    'Notes',
    [330, 300],
  )

  b.group('Read the claims', [540, 390, 1230, 660], '#2f5f68')
  b.group('Verify the signature', [540, 1090, 1700, 640], '#7d5119')

  return b.build()
}
