/**
 * Scene: Peeling Layers — CyberChef-style deobfuscation: recognize an encoding
 * by its shape, then unwind Base64 → hex → XOR one layer at a time.
 */

import type { GraphDocument } from '../core/serialize'
import { SceneBuilder } from './kit'

// Base64(hex(XOR('meet me at midnight', 'k3y'))) — precomputed.
const OBFUSCATED = 'MDY1NjFjMWYxMzE0MGUxMzE4MWYxMzE0MDI1NzE3MDI1NDExMWY='

export function peelingLayers(): GraphDocument {
  const b = new SceneBuilder()

  b.note(
    [50, 50],
    'Recognize the shape of an encoding',
    [
      'Obfuscated data is usually **layered**. Read the clues:',
      '',
      '- Ends in `=` and uses A–Za–z0–9+/ → smells like **Base64**.',
      '- Decodes to pairs of `0–9a–f` → that\'s **hex**.',
      '- Hex pairs that aren\'t ASCII → something binary happened — here,',
      '  a repeating-key **XOR**.',
      '',
      'Peel each layer and watch every stage in its well — that\'s the whole',
      'point of a node graph over a one-shot decoder.',
    ].join('\n'),
    'Encoding',
    [380, 330],
  )

  const input = b.config('io/text-input', [50, 500], { text: OBFUSCATED }, 'Obfuscated blob')
  const b64 = b.node('encoding/base64-decode', [500, 500], 'Layer 1: Base64')
  const hex = b.node('encoding/hex-decode', [900, 500], 'Layer 2: hex')
  const b64Watch = b.watch([900, 300], 'After Base64: hex text')
  const hexWatch = b.watch([1300, 300], 'After hex: raw bytes')

  const key = b.config('io/text-input', [900, 750], { text: 'k3y' }, 'XOR key')
  const xor = b.node('logic/xor', [1300, 600], 'Layer 3: XOR')
  const text = b.node('data/from-bytes', [1650, 600], 'As text')
  const plainWatch = b.watch([2000, 600], 'Plaintext ✓')

  b.link(input, 'text', b64, 'text')
  b.link(b64, 'data', b64Watch, 'value')
  b.link(b64, 'data', hex, 'text')
  b.link(hex, 'data', hexWatch, 'value')
  b.link(hex, 'data', xor, 'data')
  b.link(key, 'text', xor, 'key')
  b.link(xor, 'result', text, 'data')
  b.link(text, 'text', plainWatch, 'value')

  b.note(
    [1300, 850],
    'XOR is not encryption',
    [
      'A repeating-key XOR with a 3-byte key is a **puzzle, not a cipher** —',
      'frequency analysis on every third byte solves it in seconds.',
      '',
      'For real confidentiality you need real key management: compare the',
      'AES-GCM example. XOR earns its place as a building block (and in CTFs),',
      'not as protection.',
    ].join('\n'),
    'Notes',
    [330, 280],
  )

  b.group('Peel, layer by layer', [40, 440, 2300, 480], '#2f5f68')

  return b.build()
}
