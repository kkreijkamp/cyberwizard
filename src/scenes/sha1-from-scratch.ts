/**
 * Scene: SHA-1 From Scratch, a complete SHA-1 (FIPS 180-4) built only from
 * arithmetic, bit logic, list ops and subgraphs, checked live against the
 * built-in WebCrypto node.
 *
 * It exercises nearly everything the platform has: a tree of SCOPED helper
 * definitions (only the top-level "SHA-1 (by hand)" is visible at the root),
 * a recursive definition (Chunk), Fold inside Fold (over the blocks, then
 * the message schedule and the 80 rounds per block), Map, Zip, Range,
 * negative List Get indexes,
 * lazy Select choosing a round function, and bytes-as-bignum arithmetic.
 *
 * Words are 32-bit values held as BYTES: math and gate ops on bytes run as
 * exact big-endian bignums (numbers would hit the f64 / int32 paths, and
 * And/Or on plain numbers are logical, not bitwise). Bignum results are
 * minimal-length, so a word with a leading zero byte is 3 bytes long: every
 * helper below is written to be length-independent for that reason.
 */

import type { LGraphNode } from '@comfyorg/litegraph'
import type { GraphDocument } from '../core/serialize'
import { ANY, BYTES, NUMBER, STRING, listOf } from '../core/types'
import type { SubgraphBuilder } from './kit'
import { SceneBuilder } from './kit'

type Pos = [number, number]

const LIST = listOf(ANY)
const TWO_32 = 4294967296

/**
 * Note bodies are authored soft-wrapped, like markdown source, but the note
 * renderer makes every source line its own block (hard breaks that then
 * word-wrap again, leaving ragged lines). Reflow: a line continues the one
 * before it unless it starts a block (blank, bullet, numbered item, quote,
 * heading). Fenced code stays verbatim.
 */
function prose(lines: string[]): string {
  const out: string[] = []
  let fenced = false
  let joinable = false
  for (const line of lines) {
    if (line.trimStart().startsWith('```')) {
      fenced = !fenced
      out.push(line)
      joinable = false
    } else if (fenced) {
      out.push(line)
    } else {
      const startsBlock = line.trim() === '' || /^\s*([-*+] |\d+\. |>|#)/.test(line)
      if (joinable && !startsBlock) out[out.length - 1] += ` ${line.trim()}`
      else out.push(line)
      joinable = line.trim() !== ''
    }
  }
  return out.join('\n')
}

/** A numeric constant node (Number Input), titled with its value by default. */
function constant(def: SubgraphBuilder, pos: Pos, value: number, title = String(value)): LGraphNode {
  return def.config('io/number-input', pos, { value }, title)
}

export function sha1FromScratch(): GraphDocument {
  const b = new SceneBuilder()

  // ─── The definition tree (scopes) ─────────────────────────────────────────
  // IO first, interiors after: instances mirror their definition's slots, so
  // every definition must exist (with its slots) before anything instances it.

  const sha1 = b.subgraph('SHA-1 (by hand)', {
    inputs: [['data', BYTES]],
    outputs: [['digest', BYTES], ['hex', STRING]],
  })
  const pad = sha1.subgraph('Pad', {
    inputs: [['message', BYTES]],
    outputs: [['padded', BYTES], ['blocks', NUMBER]],
  })
  const chunk = sha1.subgraph('Chunk', {
    inputs: [['value', BYTES], ['count', NUMBER], ['bits', NUMBER]],
    outputs: [['chunks', LIST]],
  })
  const compress = sha1.subgraph('Compress', {
    inputs: [['H', LIST], ['block', BYTES]],
    outputs: [['H', LIST]],
  })
  const rotl = sha1.subgraph('RotL', {
    inputs: [['x', BYTES], ['n', NUMBER]],
    outputs: [['result', BYTES]],
  })
  const xor = sha1.subgraph('Xor', {
    inputs: [['a', BYTES], ['b', BYTES]],
    outputs: [['result', BYTES]],
  })
  const wordHex = sha1.subgraph('Word Hex', {
    inputs: [['word', BYTES]],
    outputs: [['hex', STRING]],
  })
  const extend = compress.subgraph('Extend', {
    inputs: [['W', LIST], ['t', NUMBER]],
    outputs: [['W', LIST]],
  })
  const round = compress.subgraph('Round', {
    inputs: [['state', LIST], ['step', LIST]],
    outputs: [['state', LIST]],
  })
  const add32 = compress.subgraph('Add32', {
    inputs: [['pair', LIST]],
    outputs: [['sum', BYTES]],
  })
  const ch = round.subgraph('Ch', {
    inputs: [['b', BYTES], ['c', BYTES], ['d', BYTES]],
    outputs: [['f', BYTES]],
  })
  const parity = round.subgraph('Parity', {
    inputs: [['b', BYTES], ['c', BYTES], ['d', BYTES]],
    outputs: [['f', BYTES]],
  })
  const maj = round.subgraph('Maj', {
    inputs: [['b', BYTES], ['c', BYTES], ['d', BYTES]],
    outputs: [['f', BYTES]],
  })

  // ─── Xor: a ⊕ b = (a ∨ b) − (a ∧ b) ──────────────────────────────────────
  {
    xor.panels([50, 200], [1000, 200])
    const or = xor.node('logic/or', [300, 100], 'a ∨ b')
    const and = xor.node('logic/and', [300, 350], 'a ∧ b')
    const sub = xor.node('math/subtract', [650, 200], '(a ∨ b) − (a ∧ b)')
    xor.panelIn('a', or, 'a')
    xor.panelIn('b', or, 'b')
    xor.panelIn('a', and, 'a')
    xor.panelIn('b', and, 'b')
    xor.link(or, 'result', sub, 'a')
    xor.link(and, 'result', sub, 'b')
    xor.panelOut(sub, 'result', 'result')
    xor.note(
      [300, 650],
      'XOR by arithmetic (not the XOR node)',
      prose([
        'The palette\'s **XOR** is a *repeating-key* byte op: it lines the key',
        'up from the left. Words here are minimal-length bignums (a word with',
        'a leading zero byte is only 3 bytes), so the bytes would misalign.',
        '',
        'Instead: a bit is in `a ⊕ b` when it is in exactly one of them, so',
        '`a ⊕ b = (a ∨ b) − (a ∧ b)`. And/Or on bytes are bitwise and',
        'right-aligned, Subtract is an exact bignum: length never matters.',
      ]),
      'Logic',
      [380, 280],
    )
  }

  // ─── RotL: ((x << n) mod 2³²) ∨ (x >> (32 − n)) ──────────────────────────
  {
    rotl.panels([50, 300], [1700, 250])
    const shl = rotl.node('math/shift-left', [300, 100], 'x << n')
    const two32 = constant(rotl, [300, 350], TWO_32, '2³²')
    const low = rotl.node('math/modulo', [650, 150], 'keep the low 32 bits')
    const thirtyTwo = constant(rotl, [300, 550], 32)
    const back = rotl.node('math/subtract', [650, 450], '32 − n')
    const shr = rotl.node('math/shift-right', [1000, 400], 'x >> (32 − n)')
    const or = rotl.node('logic/or', [1350, 250], 'rotated')
    rotl.panelIn('x', shl, 'value')
    rotl.panelIn('n', shl, 'bits')
    rotl.link(shl, 'result', low, 'a')
    rotl.link(two32, 'number', low, 'b')
    rotl.link(thirtyTwo, 'number', back, 'a')
    rotl.panelIn('n', back, 'b')
    rotl.panelIn('x', shr, 'value')
    rotl.link(back, 'result', shr, 'bits')
    rotl.link(low, 'result', or, 'a')
    rotl.link(shr, 'result', or, 'b')
    rotl.panelOut(or, 'result', 'result')
    rotl.note(
      [650, 750],
      'Rotate = two shifts',
      prose([
        'On bytes, Shift Left is a bignum shift: bits pushed past bit 31 are',
        'not lost, they just make the number bigger. `mod 2³²` cuts them off,',
        'and `x >> (32 − n)` brings exactly those bits back in at the bottom.',
        '',
        'The two halves never overlap, so Or glues them into the rotation.',
      ]),
      'Math',
      [380, 230],
    )
  }

  // ─── Chunk: recursive split of a bignum into `count` chunks of `bits` ────
  {
    chunk.panels([-250, 450], [2100, 350])
    const zero = constant(chunk, [50, 100], 0)
    const done = chunk.node('math/less-eq', [350, 100], 'count ≤ 0?')
    const empty = chunk.config('flow/list-range', [350, 300], { count: 0 }, 'empty list')
    const two = constant(chunk, [50, 650], 2)
    const pow = chunk.node('math/power', [350, 650], '2^bits')
    const low = chunk.node('math/modulo', [700, 650], 'last chunk: value mod 2^bits')
    const high = chunk.node('math/shift-right', [700, 900], 'the rest: value >> bits')
    const one = constant(chunk, [350, 1150], 1)
    const dec = chunk.node('math/subtract', [700, 1150], 'count − 1')
    const self = chunk.selfInstance([1050, 950], 'Chunk (the rest)')
    const append = chunk.node('flow/list-append', [1400, 700], 'rest ++ [last]')
    const select = chunk.node('flow/select', [1750, 350], 'done ? [] : …')

    chunk.panelIn('count', done, 'a')
    chunk.link(zero, 'number', done, 'b')
    chunk.link(two, 'number', pow, 'a')
    chunk.panelIn('bits', pow, 'b')
    chunk.panelIn('value', low, 'a')
    chunk.link(pow, 'result', low, 'b')
    chunk.panelIn('value', high, 'value')
    chunk.panelIn('bits', high, 'bits')
    chunk.panelIn('count', dec, 'a')
    chunk.link(one, 'number', dec, 'b')
    chunk.link(high, 'result', self, 'value')
    chunk.link(dec, 'result', self, 'count')
    chunk.panelIn('bits', self, 'bits')
    chunk.link(self, 'chunks', append, 'items')
    chunk.link(low, 'result', append, 'element')
    chunk.link(done, 'result', select, 'cond')
    chunk.link(empty, 'items', select, 'then')
    chunk.link(append, 'items', select, 'else')
    chunk.panelOut(select, 'result', 'chunks')

    chunk.note(
      [1400, 1050],
      'Recursion, bottoming out through Select',
      prose([
        '`Chunk(v, n) = Chunk(v >> bits, n − 1) ++ [v mod 2^bits]`, and',
        '`Chunk(v, 0) = []`.',
        '',
        'The lowest bits are the *last* chunk, so the recursive call (on',
        'everything above them) produces the earlier chunks in order.',
        '**Select** is lazy: at `count ≤ 0` the `else` branch, and with it',
        'the self-call, is never evaluated.',
        '',
        'Used three times: message → 512-bit blocks, block → sixteen',
        '32-bit words, and the IV → H0…H4.',
      ]),
      'Flow',
      [400, 330],
    )
  }

  // ─── Pad: message → padded bignum + block count ──────────────────────────
  {
    pad.panels([-250, 500], [2800, 650])
    const eight = constant(pad, [50, 100], 8)
    const sixtyFour = constant(pad, [50, 300], 64)
    const c119 = constant(pad, [50, 500], 119)
    const c128 = constant(pad, [50, 700], 128, '0x80')
    const nine = constant(pad, [50, 900], 9)

    const len = pad.node('text/length', [350, 100], 'length (bytes)')
    const bits = pad.node('math/multiply', [700, 100], 'bit length')
    const lenMod = pad.node('math/modulo', [700, 350], 'length mod 64')
    const kRaw = pad.node('math/subtract', [1050, 350], '119 − (length mod 64)')
    const k = pad.node('math/modulo', [1400, 350], 'k zero bytes')
    const kBits = pad.node('math/multiply', [1750, 350], '8k')
    const room = pad.node('math/add', [2100, 350], '8k + 64')

    const shl8 = pad.node('math/shift-left', [350, 650], 'message << 8')
    const marker = pad.node('math/add', [700, 650], '+ 0x80 (the 1 bit)')
    const shifted = pad.node('math/shift-left', [2100, 650], '<< (8k + 64)')
    const padded = pad.node('math/add', [2450, 650], '+ bit length')

    const total = pad.node('math/add', [1050, 950], 'length + 9')
    const totalK = pad.node('math/add', [1400, 950], 'length + 9 + k')
    const blocks = pad.node('math/divide', [1750, 950], '÷ 64 = blocks')

    pad.panelIn('message', len, 'value')
    pad.link(len, 'length', bits, 'a')
    pad.link(eight, 'number', bits, 'b')
    pad.link(len, 'length', lenMod, 'a')
    pad.link(sixtyFour, 'number', lenMod, 'b')
    pad.link(c119, 'number', kRaw, 'a')
    pad.link(lenMod, 'result', kRaw, 'b')
    pad.link(kRaw, 'result', k, 'a')
    pad.link(sixtyFour, 'number', k, 'b')
    pad.link(k, 'result', kBits, 'a')
    pad.link(eight, 'number', kBits, 'b')
    pad.link(kBits, 'result', room, 'a')
    pad.link(sixtyFour, 'number', room, 'b')

    pad.panelIn('message', shl8, 'value')
    pad.link(eight, 'number', shl8, 'bits')
    pad.link(shl8, 'result', marker, 'a')
    pad.link(c128, 'number', marker, 'b')
    pad.link(marker, 'result', shifted, 'value')
    pad.link(room, 'result', shifted, 'bits')
    pad.link(shifted, 'result', padded, 'a')
    pad.link(bits, 'result', padded, 'b')
    pad.panelOut(padded, 'result', 'padded')

    pad.link(len, 'length', total, 'a')
    pad.link(nine, 'number', total, 'b')
    pad.link(total, 'result', totalK, 'a')
    pad.link(k, 'result', totalK, 'b')
    pad.link(totalK, 'result', blocks, 'a')
    pad.link(sixtyFour, 'number', blocks, 'b')
    pad.panelOut(blocks, 'result', 'blocks')

    pad.note(
      [350, 1200],
      'Padding, done as plain arithmetic',
      prose([
        'SHA-1 hashes whole 64-byte blocks, so the message is extended to',
        '`message ‖ 0x80 ‖ k zero bytes ‖ 64-bit bit length`, with k the',
        'smallest count that makes the total a multiple of 64:',
        '`k = (119 − length mod 64) mod 64` (55 for an empty message).',
        '',
        'Treating the message as one big number, appending is shifting:',
        '`((m << 8) + 0x80) << (8k + 64)`, then add the bit length into',
        'the freed low 64 bits.',
      ]),
      'Math',
      [420, 300],
    )
  }

  // ─── Word Hex: one word → exactly 8 hex digits ───────────────────────────
  {
    wordHex.panels([-250, 100], [1400, 100])
    const two32 = constant(wordHex, [50, 100], TWO_32, '2³²')
    const plus = wordHex.node('math/add', [350, 100], 'word + 2³²')
    const hex = wordHex.node('encoding/hex-encode', [700, 100], '01xxxxxxxx')
    const strip = wordHex.config('text/find-replace', [1050, 100], { find: '^01', replace: '', regex: true, flags: '' }, 'drop the 01')
    wordHex.panelIn('word', plus, 'a')
    wordHex.link(two32, 'number', plus, 'b')
    wordHex.link(plus, 'result', hex, 'data')
    wordHex.link(hex, 'text', strip, 'text')
    wordHex.panelOut(strip, 'text', 'hex')
    wordHex.note(
      [350, 450],
      'Keeping the leading zeros',
      prose([
        'A bignum drops leading zero bytes, but a digest must not: word',
        '`0x00ab12cd` has to print as `00ab12cd`.',
        '',
        'Adding 2³² puts a `01` byte in front of all four word bytes,',
        'whatever their value; hex-encode, then cut that `01` off again.',
      ]),
      'Encoding',
      [380, 230],
    )
  }

  // ─── Ch, Parity, Maj: the three round functions (scoped to Round) ────────
  {
    ch.panels([-250, 250], [1350, 200])
    const bc = ch.node('logic/and', [300, 100], 'b ∧ c')
    const ones = constant(ch, [50, 350], 0xffffffff, '0xffffffff')
    const notB = ch.node('math/subtract', [300, 350], '¬b')
    const notBD = ch.node('logic/and', [650, 400], '¬b ∧ d')
    const f = ch.node('logic/or', [1000, 200], '(b ∧ c) ∨ (¬b ∧ d)')
    ch.panelIn('b', bc, 'a')
    ch.panelIn('c', bc, 'b')
    ch.link(ones, 'number', notB, 'a')
    ch.panelIn('b', notB, 'b')
    ch.link(notB, 'result', notBD, 'a')
    ch.panelIn('d', notBD, 'b')
    ch.link(bc, 'result', f, 'a')
    ch.link(notBD, 'result', f, 'b')
    ch.panelOut(f, 'result', 'f')
    ch.note(
      [300, 650],
      'Ch: "choose"',
      prose([
        'Each bit of **b** chooses: c where b is 1, d where b is 0.',
        '',
        '`¬b` is `0xffffffff − b` rather than the **Not** node: Not inverts',
        'only the bytes it is given, and a short (leading-zero) word would',
        'leave its missing top byte un-inverted.',
      ]),
      'Logic',
      [380, 230],
    )
  }
  {
    parity.panels([0, 150], [1000, 200])
    const x1 = parity.instance(xor, [300, 100], 'b ⊕ c')
    const x2 = parity.instance(xor, [650, 200], 'b ⊕ c ⊕ d')
    parity.panelIn('b', x1, 'a')
    parity.panelIn('c', x1, 'b')
    parity.link(x1, 'result', x2, 'a')
    parity.panelIn('d', x2, 'b')
    parity.panelOut(x2, 'result', 'f')
    parity.note(
      [300, 450],
      'Lexical scope at work',
      prose([
        '**Xor** is not defined here: it is scoped to *SHA-1 (by hand)*,',
        'three levels up (SHA-1 → Compress → Round → Parity). Inner scopes',
        'see outer definitions, so it resolves.',
        '',
        'From the root canvas, Xor is invisible: open the palette there and',
        'only *SHA-1 (by hand)* is listed under Subgraphs.',
      ]),
      'Subgraphs',
      [380, 250],
    )
  }
  {
    maj.panels([0, 300], [1350, 350])
    const bc = maj.node('logic/and', [300, 100], 'b ∧ c')
    const bd = maj.node('logic/and', [300, 350], 'b ∧ d')
    const cd = maj.node('logic/and', [300, 600], 'c ∧ d')
    const or1 = maj.node('logic/or', [650, 200], '(b ∧ c) ∨ (b ∧ d)')
    const or2 = maj.node('logic/or', [1000, 350], 'majority')
    maj.panelIn('b', bc, 'a')
    maj.panelIn('c', bc, 'b')
    maj.panelIn('b', bd, 'a')
    maj.panelIn('d', bd, 'b')
    maj.panelIn('c', cd, 'a')
    maj.panelIn('d', cd, 'b')
    maj.link(bc, 'result', or1, 'a')
    maj.link(bd, 'result', or1, 'b')
    maj.link(or1, 'result', or2, 'a')
    maj.link(cd, 'result', or2, 'b')
    maj.panelOut(or2, 'result', 'f')
    maj.note(
      [650, 600],
      'Maj: "majority"',
      prose(['Each output bit is whatever at least two of b, c, d agree on.']),
      'Logic',
      [330, 140],
    )
  }

  // ─── Round: one of the 80 rounds (a Fold step) ───────────────────────────
  {
    round.panels([-250, 650], [3150, 700])
    const idx = [0, 1, 2, 3, 4].map((i) => constant(round, [50, 100 + i * 200], i))
    const names = ['a', 'b', 'c', 'd', 'e'] as const
    const word = names.map((name, i) => {
      const get = round.node('flow/list-get', [350, 100 + i * 200], name)
      round.panelIn('state', get, 'items')
      round.link(idx[i]!, 'number', get, 'index')
      return get
    })
    const [a, bWord, c, d, e] = word as [LGraphNode, LGraphNode, LGraphNode, LGraphNode, LGraphNode]
    const t = round.node('flow/list-get', [350, 1150], 't')
    const w = round.node('flow/list-get', [350, 1350], 'W[t]')
    round.panelIn('step', t, 'items')
    round.link(idx[0]!, 'number', t, 'index')
    round.panelIn('step', w, 'items')
    round.link(idx[1]!, 'number', w, 'index')

    // Which quarter of the 80 rounds: stage = floor(t / 20).
    const twenty = constant(round, [50, 1150], 20)
    const two = constant(round, [50, 1550], 2)
    const isCh = round.node('math/less', [700, 1150], 't < 20?')
    const div = round.node('math/divide', [700, 1400], 't ÷ 20')
    const stage = round.node('math/floor', [1050, 1400], 'stage (0…3)')
    const isMaj = round.node('math/equals', [1400, 1350], 'stage = 2?')
    round.link(t, 'element', isCh, 'a')
    round.link(twenty, 'number', isCh, 'b')
    round.link(t, 'element', div, 'a')
    round.link(twenty, 'number', div, 'b')
    round.link(div, 'result', stage, 'n')
    round.link(stage, 'result', isMaj, 'a')
    round.link(two, 'number', isMaj, 'b')

    // f(b, c, d): three scoped helpers, only the selected one runs (lazy Select).
    const fCh = round.instance(ch, [1050, 300])
    const fMaj = round.instance(maj, [1050, 550])
    const fParity = round.instance(parity, [1050, 800])
    for (const fn of [fCh, fMaj, fParity]) {
      round.link(bWord, 'element', fn, 'b')
      round.link(c, 'element', fn, 'c')
      round.link(d, 'element', fn, 'd')
    }
    const pickMajOrParity = round.node('flow/select', [1400, 700], 'Maj or Parity')
    const f = round.node('flow/select', [1750, 450], 'f')
    round.link(isMaj, 'result', pickMajOrParity, 'cond')
    round.link(fMaj, 'f', pickMajOrParity, 'then')
    round.link(fParity, 'f', pickMajOrParity, 'else')
    round.link(isCh, 'result', f, 'cond')
    round.link(fCh, 'f', f, 'then')
    round.link(pickMajOrParity, 'result', f, 'else')

    // K for this stage.
    const kText = round.config('io/text-input', [700, 1650], { text: '5a827999,6ed9eba1,8f1bbcdc,ca62c1d6' }, 'K constants')
    const kList = round.config('text/split', [1050, 1650], { separator: ',' }, 'K list')
    const kGet = round.node('flow/list-get', [1400, 1600], 'K[stage]')
    const kHex = round.node('encoding/hex-decode', [1750, 1600], 'K')
    round.link(kText, 'text', kList, 'text')
    round.link(kList, 'items', kGet, 'items')
    round.link(stage, 'result', kGet, 'index')
    round.link(kGet, 'element', kHex, 'text')

    // temp = (ROTL5(a) + f + e + K + W[t]) mod 2³²
    const five = constant(round, [1050, 50], 5)
    const rotA = round.instance(rotl, [1400, 50], 'ROTL5(a)')
    round.link(a, 'element', rotA, 'x')
    round.link(five, 'number', rotA, 'n')
    const sum1 = round.node('math/add', [2100, 100], '+ f')
    const sum2 = round.node('math/add', [2100, 350], '+ e')
    const sum3 = round.node('math/add', [2100, 600], '+ K')
    const sum4 = round.node('math/add', [2100, 850], '+ W[t]')
    const two32 = constant(round, [2100, 1100], TWO_32, '2³²')
    const temp = round.node('math/modulo', [2450, 850], 'temp (mod 2³²)')
    round.link(rotA, 'result', sum1, 'a')
    round.link(f, 'result', sum1, 'b')
    round.link(sum1, 'result', sum2, 'a')
    round.link(e, 'element', sum2, 'b')
    round.link(sum2, 'result', sum3, 'a')
    round.link(kHex, 'data', sum3, 'b')
    round.link(sum3, 'result', sum4, 'a')
    round.link(w, 'element', sum4, 'b')
    round.link(sum4, 'result', temp, 'a')
    round.link(two32, 'number', temp, 'b')

    // The new state: [temp, a, ROTL30(b), c, d].
    const thirty = constant(round, [2100, 1350], 30)
    const rotB = round.instance(rotl, [2450, 1350], 'ROTL30(b)')
    round.link(bWord, 'element', rotB, 'x')
    round.link(thirty, 'number', rotB, 'n')
    const next = round.node('flow/list-pack', [2800, 700], 'new state')
    round.link(temp, 'result', next, 'a')
    round.link(a, 'element', next, 'b')
    round.link(rotB, 'result', next, 'c')
    round.link(c, 'element', next, 'd')
    round.link(d, 'element', next, 'e')
    round.panelOut(next, 'items', 'state')

    round.note(
      [2800, 1050],
      'One round (of 80): mix, then shift the state',
      prose([
        '```',
        'temp = ROTL5(a) + f(b, c, d)',
        '       + e + K + W[t]',
        'state = [temp, a, ROTL30(b), c, d]',
        '```',
        'f and K change every 20 rounds: **Ch** for 0 to 19, **Parity** for',
        '20 to 39 and 60 to 79, **Maj** for 40 to 59.',
        '',
        'All three f helpers are wired, but the two **Select** nodes are lazy:',
        'only the chosen helper is ever evaluated. Ch, Parity and Maj are',
        'scoped to Round: nothing outside this definition can see them.',
      ]),
      'Hashing',
      [460, 330],
    )
  }

  // ─── Extend: one message-schedule step (a Fold step) ─────────────────────
  {
    extend.panels([-250, 350], [2100, 250])
    const back = [3, 8, 14, 16].map((n, i) => {
      const k = constant(extend, [50, 100 + i * 200], -n)
      const get = extend.node('flow/list-get', [350, 100 + i * 200], `W[t−${n}]`)
      extend.panelIn('W', get, 'items')
      extend.link(k, 'number', get, 'index')
      return get
    })
    const [w3, w8, w14, w16] = back as [LGraphNode, LGraphNode, LGraphNode, LGraphNode]
    const x1 = extend.instance(xor, [700, 200], 'W[t−3] ⊕ W[t−8]')
    const x2 = extend.instance(xor, [700, 550], 'W[t−14] ⊕ W[t−16]')
    const x3 = extend.instance(xor, [1050, 350], 'all four')
    const one = constant(extend, [1050, 650], 1)
    const rot = extend.instance(rotl, [1400, 450], 'ROTL1')
    const append = extend.node('flow/list-append', [1750, 250], 'W ++ [W[t]]')
    extend.link(w3, 'element', x1, 'a')
    extend.link(w8, 'element', x1, 'b')
    extend.link(w14, 'element', x2, 'a')
    extend.link(w16, 'element', x2, 'b')
    extend.link(x1, 'result', x3, 'a')
    extend.link(x2, 'result', x3, 'b')
    extend.link(x3, 'result', rot, 'x')
    extend.link(one, 'number', rot, 'n')
    extend.panelIn('W', append, 'items')
    extend.link(rot, 'result', append, 'element')
    extend.panelOut(append, 'items', 'W')
    extend.note(
      [700, 900],
      'The message schedule: 16 words grow to 80',
      prose([
        '`W[t] = ROTL1(W[t−3] ⊕ W[t−8] ⊕ W[t−14] ⊕ W[t−16])` for t = 16…79.',
        '',
        'A Fold over t = 16…79 grows the 16 block words into 80. At step t the',
        'list holds exactly t words, so W[t−3] is simply **index −3**: List Get',
        'counts negative indexes from the end. (The t input is the Fold\'s',
        'step counter; the window does the indexing.)',
      ]),
      'Flow',
      [420, 250],
    )
  }

  // ─── Add32: (x + y) mod 2³² for a [x, y] pair (a Map step) ───────────────
  {
    add32.panels([-250, 200], [1400, 250])
    const zero = constant(add32, [50, 100], 0)
    const one = constant(add32, [50, 300], 1)
    const x = add32.node('flow/list-get', [350, 100], 'x')
    const y = add32.node('flow/list-get', [350, 350], 'y')
    const sum = add32.node('math/add', [700, 200], 'x + y')
    const two32 = constant(add32, [700, 450], TWO_32, '2³²')
    const mod = add32.node('math/modulo', [1050, 250], 'mod 2³²')
    add32.panelIn('pair', x, 'items')
    add32.link(zero, 'number', x, 'index')
    add32.panelIn('pair', y, 'items')
    add32.link(one, 'number', y, 'index')
    add32.link(x, 'element', sum, 'a')
    add32.link(y, 'element', sum, 'b')
    add32.link(sum, 'result', mod, 'a')
    add32.link(two32, 'number', mod, 'b')
    add32.panelOut(mod, 'result', 'sum')
    add32.note(
      [350, 650],
      'Addition mod 2³²',
      prose([
        'Bignum addition never overflows, so the wrap-around that 32-bit',
        'hardware does for free is an explicit `mod 2³²` here.',
      ]),
      'Math',
      [380, 160],
    )
  }

  // ─── Compress: one 512-bit block (a Fold step over the blocks) ───────────
  {
    compress.panels([-250, 250], [2550, 100])
    const sixteen = constant(compress, [50, 100], 16)
    const thirtyTwo = constant(compress, [50, 300], 32)
    const words = compress.instance(chunk, [350, 100], 'W[0…15]')
    compress.panelIn('block', words, 'value')
    compress.link(sixteen, 'number', words, 'count')
    compress.link(thirtyTwo, 'number', words, 'bits')

    const scheduleSteps = compress.config('flow/list-range', [350, 450], { start: 16, count: 64 }, 't = 16…79')
    const schedule = compress.config('flow/fold', [750, 200], { fn: 'Extend' }, 'W[0…79]')
    compress.link(scheduleSteps, 'items', schedule, 'items')
    compress.link(words, 'chunks', schedule, 'init')

    const roundSteps = compress.config('flow/list-range', [750, 550], { start: 0, count: 80 }, 't = 0…79')
    const steps = compress.node('flow/list-zip', [1150, 350], '[t, W[t]] × 80')
    compress.link(roundSteps, 'items', steps, 'a')
    compress.link(schedule, 'result', steps, 'b')

    const rounds = compress.config('flow/fold', [1500, 200], { fn: 'Round' }, '80 rounds')
    compress.link(steps, 'pairs', rounds, 'items')
    compress.panelIn('H', rounds, 'init')

    const pairs = compress.node('flow/list-zip', [1850, 100], '[H, after rounds]')
    const added = compress.config('flow/map', [2200, 100], { fn: 'Add32' }, 'H + a…e')
    compress.panelIn('H', pairs, 'a')
    compress.link(rounds, 'result', pairs, 'b')
    compress.link(pairs, 'pairs', added, 'items')
    compress.panelOut(added, 'items', 'H')

    compress.note(
      [1150, 700],
      'One block, three higher-order steps',
      prose([
        '1. **Chunk** (recursive) splits the block into 16 words, then a',
        '   **Fold** with *Extend* grows them into the 80-word schedule.',
        '2. **Zip** pairs each round number with its word, and a **Fold**',
        '   with *Round* runs all 80 rounds over the state [a, b, c, d, e].',
        '3. **Zip** + **Map** with *Add32* adds the result back into H.',
        '',
        'Extend, Round and Add32 are scoped to Compress. Round has helpers',
        'of its own (Ch, Parity, Maj): scopes nest as deep as you like.',
      ]),
      'Flow',
      [440, 300],
    )
  }

  // ─── SHA-1 (by hand): the whole algorithm ────────────────────────────────
  {
    sha1.panels([50, 100], [2850, 450])
    const padded = sha1.instance(pad, [350, 100])
    sha1.panelIn('data', padded, 'message')

    const blockBits = constant(sha1, [350, 400], 512)
    const blocks = sha1.instance(chunk, [750, 150], '512-bit blocks')
    sha1.link(padded, 'padded', blocks, 'value')
    sha1.link(padded, 'blocks', blocks, 'count')
    sha1.link(blockBits, 'number', blocks, 'bits')

    const ivText = sha1.config('io/text-input', [350, 650], { text: '67452301 efcdab89 98badcfe 10325476 c3d2e1f0' }, 'H0…H4 (FIPS 180-4)')
    const ivBytes = sha1.node('encoding/hex-decode', [750, 650], 'IV bytes')
    const five = constant(sha1, [750, 900], 5)
    const thirtyTwo = constant(sha1, [750, 1100], 32)
    const iv = sha1.instance(chunk, [1100, 700], 'IV words')
    sha1.link(ivText, 'text', ivBytes, 'text')
    sha1.link(ivBytes, 'data', iv, 'value')
    sha1.link(five, 'number', iv, 'count')
    sha1.link(thirtyTwo, 'number', iv, 'bits')

    const hashed = sha1.config('flow/fold', [1450, 300], { fn: 'Compress' }, 'compress every block')
    sha1.link(blocks, 'chunks', hashed, 'items')
    sha1.link(iv, 'chunks', hashed, 'init')

    const hexWords = sha1.config('flow/map', [1800, 300], { fn: 'Word Hex' }, '8 hex digits each')
    const joined = sha1.config('text/join', [2150, 300], { separator: '' }, 'hex digest')
    const digest = sha1.node('encoding/hex-decode', [2500, 450], 'digest')
    sha1.link(hashed, 'result', hexWords, 'items')
    sha1.link(hexWords, 'items', joined, 'items')
    sha1.link(joined, 'text', digest, 'text')
    sha1.panelOut(digest, 'data', 'digest')
    sha1.panelOut(joined, 'text', 'hex')

    sha1.note(
      [1450, 650],
      'The algorithm, top to bottom',
      prose([
        '1. **Pad** the message to a whole number of 64-byte blocks.',
        '2. **Chunk** it into 512-bit blocks (and the IV into H0…H4).',
        '3. **Fold** *Compress* over the blocks, starting from the IV.',
        '4. **Map** *Word Hex* over the final H0…H4, **Join**, decode.',
        '',
        'Double-click any helper to go inside. The wells in there show the',
        '**last** call\'s values: Fold and Map run their helper once per',
        'element and keep no per-call history.',
      ]),
      'Hashing',
      [420, 280],
    )
    sha1.note(
      [350, 1350],
      'This definition\'s private library',
      prose([
        '```',
        'SHA-1 (by hand)      global',
        '├─ Pad',
        '├─ Chunk             recursive',
        '├─ Compress',
        '│  ├─ Extend',
        '│  ├─ Round',
        '│  │  └─ Ch, Parity, Maj',
        '│  └─ Add32',
        '├─ RotL, Xor         shared bit helpers',
        '└─ Word Hex',
        '```',
        'Every helper is **scoped**: visible inside its parent\'s subtree and',
        'nowhere else. Inner scopes see outer ones, which is how Round and',
        'Extend (two levels down) both use RotL and Xor.',
      ]),
      'Subgraphs',
      [440, 420],
    )
  }

  // ─── Root: the two implementations, side by side ─────────────────────────
  b.note(
    [50, 50],
    'SHA-1, built from nothing but wires',
    prose([
      '**SHA-1 (by hand)** below is a subgraph that computes SHA-1 from',
      'scratch: no hashing node anywhere inside it, only arithmetic, bit',
      'logic, lists and a dozen helper subgraphs (recursion, Fold, Map,',
      'lazy Select, scoped definitions).',
      '',
      'It has the same input and outputs as the built-in **SHA-1** node, and',
      '**Identical?** compares the two digests byte for byte.',
      '',
      '**Double-click it** to go inside, and keep going: every helper is a',
      'graph you can open.',
    ]),
    'Hashing',
    [430, 330],
  )

  const message = b.config('io/text-input', [50, 550], { text: 'The quick brown fox jumps over the lazy dog' }, 'Message')
  const builtin = b.node('hashing/sha-1', [550, 450], 'SHA-1 (built-in)')
  const byHand = b.instance(sha1, [550, 800])
  const builtinHex = b.watch([950, 450], 'built-in')
  const byHandHex = b.watch([950, 800], 'by hand')
  const same = b.node('math/equals', [1350, 600], 'digests equal?')
  const verdict = b.watch([1700, 600], 'Identical?')

  b.link(message, 'text', builtin, 'data')
  b.link(message, 'text', byHand, 'data')
  b.link(builtin, 'hex', builtinHex, 'value')
  b.link(byHand, 'hex', byHandHex, 'value')
  b.link(builtin, 'digest', same, 'a')
  b.link(byHand, 'digest', same, 'b')
  b.link(same, 'result', verdict, 'value')

  b.note(
    [950, 1050],
    'Try it',
    prose([
      '- Edit the message: both digests change, and stay identical.',
      '- Paste in more than 55 bytes: the padding spills into a second',
      '  block, and *Compress* runs once per block.',
      '- Non-ASCII works too: the message is hashed as UTF-8 bytes.',
      '',
      'Every 64-byte block costs about 7 000 node runs (80 rounds plus 64',
      'schedule steps), all of them inspectable.',
    ]),
    'Notes',
    [420, 250],
  )

  b.group('Same input, two implementations', [40, 440, 1940, 520], '#7d5119')

  return b.build()
}
