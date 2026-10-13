/**
 * Scene: SHA-1 From Scratch, a complete SHA-1 (FIPS 180-4) built only from
 * arithmetic, bit logic, list ops and subgraphs, checked live against the
 * built-in WebCrypto node. Twice:
 *
 * - "SHA-1 (by hand)" leans on the higher-order nodes: Fold over the blocks,
 *   Fold for the message schedule and the 80 rounds, Map for the final add.
 * - "SHA-1 (recursive)" uses no Fold and no Map at all. Every loop is a
 *   definition that instances itself and bottoms out through a lazy Select,
 *   and the state [a, b, c, d, e] travels as five separate wires, so every
 *   step of the algorithm is visible as plain wiring.
 *
 * Between them they exercise nearly everything the platform has: trees of
 * SCOPED helper definitions (only the two top-level ones are visible at the
 * root), recursion, Fold inside Fold, Map, Zip, Range, Take/Drop, negative
 * List Get indexes, lazy Select, and bytes-as-bignum arithmetic.
 *
 * Words are 32-bit values held as BYTES: math and gate ops on bytes run as
 * exact big-endian bignums (numbers would hit the f64 / int32 paths, and
 * And/Or on plain numbers are logical, not bitwise). Bignum results are
 * minimal-length, so a word with a leading zero byte is 3 bytes long: every
 * helper below is written to be length-independent for that reason.
 *
 * Layout: columns 300 apart (nodes are 230 to 280 wide), rows 150 apart for
 * two-slot nodes, 200 for three-slot ones, so neighbours keep the layout's
 * 20px margin and nothing more. Input panels sit at x = −200, notes go
 * below the wiring (bottom-left), where their font-dependent size cannot
 * collide with anything.
 */

import type { LGraphNode } from '@comfyorg/litegraph'
import type { GraphDocument } from '../core/serialize'
import { ANY, BYTES, NUMBER, STRING, listOf } from '../core/types'
import type { SubgraphBuilder } from './kit'
import { SceneBuilder } from './kit'

type Pos = [number, number]

const LIST = listOf(ANY)
const TWO_32 = 4294967296
const K_HEX = ['5a827999', '6ed9eba1', '8f1bbcdc', 'ca62c1d6'] as const
const IV_HEX = ['67452301', 'efcdab89', '98badcfe', '10325476', 'c3d2e1f0'] as const
const WORD = ['a', 'b', 'c', 'd', 'e'] as const
type Five<T> = [T, T, T, T, T]

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

/** A hex constant: Text Input → Hex Decode, titled with the hex. */
function hexConstant(def: SubgraphBuilder, textPos: Pos, decodePos: Pos, hex: string, title: string): LGraphNode {
  const text = def.config('io/text-input', textPos, { text: hex }, title)
  const bytes = def.node('encoding/hex-decode', decodePos, `${title} bytes`)
  def.link(text, 'text', bytes, 'text')
  return bytes
}

// ─── Shared interiors (identical in both implementations) ──────────────────

type DefIO = Parameters<SubgraphBuilder['subgraph']>[1]
type Slot = DefIO['inputs'][number]

const PAD_IO: DefIO = { inputs: [['message', BYTES]], outputs: [['padded', BYTES], ['blocks', NUMBER]] }
const CHUNK_IO: DefIO = { inputs: [['value', BYTES], ['count', NUMBER], ['bits', NUMBER]], outputs: [['chunks', LIST]] }
const WORD_HEX_IO: DefIO = { inputs: [['word', BYTES]], outputs: [['hex', STRING]] }

/** Pad: message → padded bignum + block count. */
function buildPad(pad: SubgraphBuilder): void {
  pad.panels([-200, 300], [2450, 500])
  const eight = constant(pad, [50, 100], 8)
  const sixtyFour = constant(pad, [50, 250], 64)
  const c119 = constant(pad, [50, 400], 119)
  const c128 = constant(pad, [50, 550], 128, '0x80')
  const nine = constant(pad, [50, 700], 9)

  const len = pad.node('text/length', [350, 100], 'length (bytes)')
  const bits = pad.node('math/multiply', [650, 100], 'bit length')
  const lenMod = pad.node('math/modulo', [650, 300], 'length mod 64')
  const kRaw = pad.node('math/subtract', [950, 300], '119 − (length mod 64)')
  const k = pad.node('math/modulo', [1250, 300], 'k zero bytes')
  const kBits = pad.node('math/multiply', [1550, 300], '8k')
  const room = pad.node('math/add', [1850, 300], '8k + 64')

  const shl8 = pad.node('math/shift-left', [350, 500], 'message << 8')
  const marker = pad.node('math/add', [650, 500], '+ 0x80 (the 1 bit)')
  const shifted = pad.node('math/shift-left', [1850, 500], '<< (8k + 64)')
  const padded = pad.node('math/add', [2150, 500], '+ bit length')

  const total = pad.node('math/add', [950, 700], 'length + 9')
  const totalK = pad.node('math/add', [1250, 700], 'length + 9 + k')
  const blocks = pad.node('math/divide', [1550, 700], '÷ 64 = blocks')

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
    [350, 900],
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
  )
}

/** Chunk: recursive split of a bignum into `count` chunks of `bits`. */
function buildChunk(chunk: SubgraphBuilder, usedFor: string): void {
  chunk.panels([-200, 450], [1850, 250])
  const zero = constant(chunk, [50, 100], 0)
  const done = chunk.node('math/less-eq', [350, 100], 'count ≤ 0?')
  const empty = chunk.config('flow/list-range', [350, 250], { count: 0 }, 'empty list')
  const two = constant(chunk, [50, 450], 2)
  const pow = chunk.node('math/power', [350, 450], '2^bits')
  const one = constant(chunk, [350, 600], 1)
  const low = chunk.node('math/modulo', [650, 450], 'last: value mod 2^bits')
  const high = chunk.node('math/shift-right', [650, 600], 'rest: value >> bits')
  const dec = chunk.node('math/subtract', [650, 750], 'count − 1')
  const self = chunk.selfInstance([950, 600], 'Chunk (the rest)')
  const append = chunk.node('flow/list-append', [1250, 450], 'rest ++ [last]')
  const select = chunk.node('flow/select', [1550, 250], 'done ? [] : …')

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
    [950, 850],
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
      usedFor,
    ]),
    'Flow',
  )
}

/** Word Hex: one word → exactly 8 hex digits. */
function buildWordHex(wordHex: SubgraphBuilder): void {
  wordHex.panels([-200, 100], [1250, 100])
  const two32 = constant(wordHex, [50, 100], TWO_32, '2³²')
  const plus = wordHex.node('math/add', [350, 100], 'word + 2³²')
  const hex = wordHex.node('encoding/hex-encode', [650, 100], '01xxxxxxxx')
  const strip = wordHex.config('text/find-replace', [950, 100], { find: '^01', replace: '', regex: true, flags: '' }, 'drop the 01')
  wordHex.panelIn('word', plus, 'a')
  wordHex.link(two32, 'number', plus, 'b')
  wordHex.link(plus, 'result', hex, 'data')
  wordHex.link(hex, 'text', strip, 'text')
  wordHex.panelOut(strip, 'text', 'hex')
  wordHex.note(
    [350, 350],
    'Keeping the leading zeros',
    prose([
      'A bignum drops leading zero bytes, but a digest must not: word',
      '`0x00ab12cd` has to print as `00ab12cd`.',
      '',
      'Adding 2³² puts a `01` byte in front of all four word bytes,',
      'whatever their value; hex-encode, then cut that `01` off again.',
    ]),
    'Encoding',
  )
}

// ─── Inline bit helpers (the recursive version cannot afford instances) ───

type Out = [LGraphNode, string]

/** a ⊕ b = (a ∨ b) − (a ∧ b), as three nodes: Or and And stacked at `pos`, Subtract one column right. */
function inlineXor(def: SubgraphBuilder, pos: Pos, a: Out, b: Out, label: string): Out {
  const [x, y] = pos
  const or = def.node('logic/or', [x, y], `${label}: ∨`)
  const and = def.node('logic/and', [x, y + 150], `${label}: ∧`)
  const sub = def.node('math/subtract', [x + 300, y + 50], label)
  def.link(a[0], a[1], or, 'a')
  def.link(b[0], b[1], or, 'b')
  def.link(a[0], a[1], and, 'a')
  def.link(b[0], b[1], and, 'b')
  def.link(or, 'result', sub, 'a')
  def.link(and, 'result', sub, 'b')
  return [sub, 'result']
}

/**
 * ROTL n of a 32-bit word, as ((x << n) mod 2³²) ∨ (x >> (32 − n)) with
 * both shift counts as constants. Constants in the column at `pos`, shifts
 * one column right, the Or two columns right (three rows tall).
 */
function inlineRotl(def: SubgraphBuilder, pos: Pos, x: Out, n: number, two32: LGraphNode, label: string): Out {
  const [cx, y] = pos
  const left = constant(def, [cx, y], n)
  const right = constant(def, [cx, y + 150], 32 - n)
  const shl = def.node('math/shift-left', [cx + 300, y], `x << ${n}`)
  const low = def.node('math/modulo', [cx + 600, y], 'mod 2³²')
  const shr = def.node('math/shift-right', [cx + 300, y + 150], `x >> ${32 - n}`)
  const or = def.node('logic/or', [cx + 900, y + 50], label)
  def.link(x[0], x[1], shl, 'value')
  def.link(left, 'number', shl, 'bits')
  def.link(shl, 'result', low, 'a')
  def.link(two32, 'number', low, 'b')
  def.link(x[0], x[1], shr, 'value')
  def.link(right, 'number', shr, 'bits')
  def.link(low, 'result', or, 'a')
  def.link(shr, 'result', or, 'b')
  return [or, 'result']
}

// ═══ Implementation 1: SHA-1 (by hand), Fold / Map / Zip ═══════════════════

function buildByHand(b: SceneBuilder): SubgraphBuilder {
  // IO first, interiors after: instances mirror their definition's slots, so
  // every definition must exist (with its slots) before anything instances it.
  const sha1 = b.subgraph('SHA-1 (by hand)', {
    inputs: [['data', BYTES]],
    outputs: [['digest', BYTES], ['hex', STRING]],
  })
  const pad = sha1.subgraph('Pad', PAD_IO)
  const chunk = sha1.subgraph('Chunk', CHUNK_IO)
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
  const wordHex = sha1.subgraph('Word Hex', WORD_HEX_IO)
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
  const fnIO: DefIO = { inputs: [['b', BYTES], ['c', BYTES], ['d', BYTES]], outputs: [['f', BYTES]] }
  const ch = round.subgraph('Ch', fnIO)
  const parity = round.subgraph('Parity', fnIO)
  const maj = round.subgraph('Maj', fnIO)

  buildPad(pad)
  buildChunk(chunk, 'Used three times: message → 512-bit blocks, block → sixteen 32-bit words, and the IV → H0…H4.')
  buildWordHex(wordHex)

  // ─── Xor: a ⊕ b = (a ∨ b) − (a ∧ b) ──────────────────────────────────────
  {
    xor.panels([-200, 150], [650, 150])
    const or = xor.node('logic/or', [50, 100], 'a ∨ b')
    const and = xor.node('logic/and', [50, 250], 'a ∧ b')
    const sub = xor.node('math/subtract', [350, 150], '(a ∨ b) − (a ∧ b)')
    xor.panelIn('a', or, 'a')
    xor.panelIn('b', or, 'b')
    xor.panelIn('a', and, 'a')
    xor.panelIn('b', and, 'b')
    xor.link(or, 'result', sub, 'a')
    xor.link(and, 'result', sub, 'b')
    xor.panelOut(sub, 'result', 'result')
    xor.note(
      [50, 450],
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
    )
  }

  // ─── RotL: ((x << n) mod 2³²) ∨ (x >> (32 − n)) ──────────────────────────
  {
    rotl.panels([-200, 250], [1250, 250])
    const shl = rotl.node('math/shift-left', [50, 100], 'x << n')
    const two32 = constant(rotl, [50, 250], TWO_32, '2³²')
    const thirtyTwo = constant(rotl, [50, 400], 32)
    const low = rotl.node('math/modulo', [350, 150], 'keep the low 32 bits')
    const back = rotl.node('math/subtract', [350, 350], '32 − n')
    const shr = rotl.node('math/shift-right', [650, 350], 'x >> (32 − n)')
    const or = rotl.node('logic/or', [950, 250], 'rotated')
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
      [350, 600],
      'Rotate = two shifts',
      prose([
        'On bytes, Shift Left is a bignum shift: bits pushed past bit 31 are',
        'not lost, they just make the number bigger. `mod 2³²` cuts them off,',
        'and `x >> (32 − n)` brings exactly those bits back in at the bottom.',
        '',
        'The two halves never overlap, so Or glues them into the rotation.',
      ]),
      'Math',
    )
  }

  // ─── Ch, Parity, Maj: the three round functions (scoped to Round) ────────
  {
    ch.panels([-200, 200], [1250, 150])
    const ones = constant(ch, [50, 250], 0xffffffff, '0xffffffff')
    const bc = ch.node('logic/and', [350, 100], 'b ∧ c')
    const notB = ch.node('math/subtract', [350, 250], '¬b')
    const notBD = ch.node('logic/and', [650, 300], '¬b ∧ d')
    const f = ch.node('logic/or', [950, 150], '(b ∧ c) ∨ (¬b ∧ d)')
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
      [350, 500],
      'Ch: "choose"',
      prose([
        'Each bit of **b** chooses: c where b is 1, d where b is 0.',
        '',
        '`¬b` is `0xffffffff − b` rather than the **Not** node: Not inverts',
        'only the bytes it is given, and a short (leading-zero) word would',
        'leave its missing top byte un-inverted.',
      ]),
      'Logic',
    )
  }
  {
    parity.panels([-200, 100], [650, 150])
    const x1 = parity.instance(xor, [50, 100], 'b ⊕ c')
    const x2 = parity.instance(xor, [350, 150], 'b ⊕ c ⊕ d')
    parity.panelIn('b', x1, 'a')
    parity.panelIn('c', x1, 'b')
    parity.link(x1, 'result', x2, 'a')
    parity.panelIn('d', x2, 'b')
    parity.panelOut(x2, 'result', 'f')
    parity.note(
      [50, 350],
      'Lexical scope at work',
      prose([
        '**Xor** is not defined here: it is scoped to *SHA-1 (by hand)*,',
        'three levels up (SHA-1 → Compress → Round → Parity). Inner scopes',
        'see outer definitions, so it resolves.',
        '',
        'From the root canvas, Xor is invisible: open the palette there and',
        'only the two top-level SHA-1 definitions are listed under Subgraphs.',
      ]),
      'Subgraphs',
    )
  }
  {
    maj.panels([-200, 250], [950, 250])
    const bc = maj.node('logic/and', [50, 100], 'b ∧ c')
    const bd = maj.node('logic/and', [50, 250], 'b ∧ d')
    const cd = maj.node('logic/and', [50, 400], 'c ∧ d')
    const or1 = maj.node('logic/or', [350, 150], '(b ∧ c) ∨ (b ∧ d)')
    const or2 = maj.node('logic/or', [650, 250], 'majority')
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
      [350, 450],
      'Maj: "majority"',
      prose(['Each output bit is whatever at least two of b, c, d agree on.']),
      'Logic',
    )
  }

  // ─── Round: one of the 80 rounds (a Fold step) ───────────────────────────
  {
    round.panels([-200, 500], [3050, 500])
    const idx = [0, 1, 2, 3, 4].map((i) => constant(round, [50, 100 + i * 150], i))
    const word = WORD.map((name, i) => {
      const get = round.node('flow/list-get', [350, 100 + i * 150], name)
      round.panelIn('state', get, 'items')
      round.link(idx[i]!, 'number', get, 'index')
      return get
    }) as Five<LGraphNode>
    const [a, bWord, c, d, e] = word
    const twenty = constant(round, [50, 900], 20)
    const t = round.node('flow/list-get', [350, 900], 't')
    const w = round.node('flow/list-get', [350, 1050], 'W[t]')
    round.panelIn('step', t, 'items')
    round.link(idx[0]!, 'number', t, 'index')
    round.panelIn('step', w, 'items')
    round.link(idx[1]!, 'number', w, 'index')

    // Which quarter of the 80 rounds: stage = floor(t / 20).
    const isCh = round.node('math/less', [650, 900], 't < 20?')
    const div = round.node('math/divide', [650, 1050], 't ÷ 20')
    const stage = round.node('math/floor', [950, 1050], 'stage (0…3)')
    const two = constant(round, [950, 1200], 2)
    const isMaj = round.node('math/equals', [1250, 1050], 'stage = 2?')
    round.link(t, 'element', isCh, 'a')
    round.link(twenty, 'number', isCh, 'b')
    round.link(t, 'element', div, 'a')
    round.link(twenty, 'number', div, 'b')
    round.link(div, 'result', stage, 'n')
    round.link(stage, 'result', isMaj, 'a')
    round.link(two, 'number', isMaj, 'b')

    // f(b, c, d): three scoped helpers, only the selected one runs (lazy Select).
    const fCh = round.instance(ch, [650, 300])
    const fMaj = round.instance(maj, [650, 500])
    const fParity = round.instance(parity, [650, 700])
    for (const fn of [fCh, fMaj, fParity]) {
      round.link(bWord, 'element', fn, 'b')
      round.link(c, 'element', fn, 'c')
      round.link(d, 'element', fn, 'd')
    }
    const pickMajOrParity = round.node('flow/select', [1550, 600], 'Maj or Parity')
    const f = round.node('flow/select', [1850, 350], 'f')
    round.link(isMaj, 'result', pickMajOrParity, 'cond')
    round.link(fMaj, 'f', pickMajOrParity, 'then')
    round.link(fParity, 'f', pickMajOrParity, 'else')
    round.link(isCh, 'result', f, 'cond')
    round.link(fCh, 'f', f, 'then')
    round.link(pickMajOrParity, 'result', f, 'else')

    // K for this stage.
    const kText = round.config('io/text-input', [650, 1250], { text: K_HEX.join(',') }, 'K constants')
    const kList = round.config('text/split', [950, 1350], { separator: ',' }, 'K list')
    const kGet = round.node('flow/list-get', [1250, 1250], 'K[stage]')
    const kHex = round.node('encoding/hex-decode', [1550, 1250], 'K')
    round.link(kText, 'text', kList, 'text')
    round.link(kList, 'items', kGet, 'items')
    round.link(stage, 'result', kGet, 'index')
    round.link(kGet, 'element', kHex, 'text')

    // temp = (ROTL5(a) + f + e + K + W[t]) mod 2³²
    const five = constant(round, [650, 100], 5)
    const rotA = round.instance(rotl, [950, 100], 'ROTL5(a)')
    round.link(a, 'element', rotA, 'x')
    round.link(five, 'number', rotA, 'n')
    const sum1 = round.node('math/add', [2150, 200], '+ f')
    const sum2 = round.node('math/add', [2150, 350], '+ e')
    const sum3 = round.node('math/add', [2150, 500], '+ K')
    const sum4 = round.node('math/add', [2150, 650], '+ W[t]')
    const two32 = constant(round, [2150, 800], TWO_32, '2³²')
    const temp = round.node('math/modulo', [2450, 650], 'temp (mod 2³²)')
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
    const thirty = constant(round, [2150, 950], 30)
    const rotB = round.instance(rotl, [2450, 950], 'ROTL30(b)')
    round.link(bWord, 'element', rotB, 'x')
    round.link(thirty, 'number', rotB, 'n')
    const next = round.node('flow/list-pack', [2750, 450], 'new state')
    round.link(temp, 'result', next, 'a')
    round.link(a, 'element', next, 'b')
    round.link(rotB, 'result', next, 'c')
    round.link(c, 'element', next, 'd')
    round.link(d, 'element', next, 'e')
    round.panelOut(next, 'items', 'state')

    round.note(
      [50, 1450],
      'One round of 80',
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
    )
  }

  // ─── Extend: one message-schedule step (a Fold step) ─────────────────────
  {
    extend.panels([-200, 300], [1850, 200])
    const back = [3, 8, 14, 16].map((n, i) => {
      const k = constant(extend, [50, 100 + i * 150], -n)
      const get = extend.node('flow/list-get', [350, 100 + i * 150], `W[t−${n}]`)
      extend.panelIn('W', get, 'items')
      extend.link(k, 'number', get, 'index')
      return get
    })
    const [w3, w8, w14, w16] = back as [LGraphNode, LGraphNode, LGraphNode, LGraphNode]
    const x1 = extend.instance(xor, [650, 150], 'W[t−3] ⊕ W[t−8]')
    const x2 = extend.instance(xor, [650, 450], 'W[t−14] ⊕ W[t−16]')
    const x3 = extend.instance(xor, [950, 300], 'all four')
    const one = constant(extend, [950, 450], 1)
    const rot = extend.instance(rotl, [1250, 350], 'ROTL1')
    const append = extend.node('flow/list-append', [1550, 200], 'W ++ [W[t]]')
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
      [650, 700],
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
    )
  }

  // ─── Add32: (x + y) mod 2³² for a [x, y] pair (a Map step) ───────────────
  {
    add32.panels([-200, 150], [1250, 200])
    const zero = constant(add32, [50, 100], 0)
    const one = constant(add32, [50, 250], 1)
    const x = add32.node('flow/list-get', [350, 100], 'x')
    const y = add32.node('flow/list-get', [350, 250], 'y')
    const sum = add32.node('math/add', [650, 150], 'x + y')
    const two32 = constant(add32, [650, 300], TWO_32, '2³²')
    const mod = add32.node('math/modulo', [950, 200], 'mod 2³²')
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
      [350, 450],
      'Addition mod 2³²',
      prose([
        'Bignum addition never overflows, so the wrap-around that 32-bit',
        'hardware does for free is an explicit `mod 2³²` here.',
      ]),
      'Math',
    )
  }

  // ─── Compress: one 512-bit block (a Fold step over the blocks) ───────────
  {
    compress.panels([-200, 150], [2150, 100])
    const sixteen = constant(compress, [50, 100], 16)
    const thirtyTwo = constant(compress, [50, 250], 32)
    const words = compress.instance(chunk, [350, 100], 'W[0…15]')
    compress.panelIn('block', words, 'value')
    compress.link(sixteen, 'number', words, 'count')
    compress.link(thirtyTwo, 'number', words, 'bits')

    const scheduleSteps = compress.config('flow/list-range', [350, 350], { start: 16, count: 64 }, 't = 16…79')
    const schedule = compress.config('flow/fold', [650, 150], { fn: 'Extend' }, 'W[0…79]')
    compress.link(scheduleSteps, 'items', schedule, 'items')
    compress.link(words, 'chunks', schedule, 'init')

    const roundSteps = compress.config('flow/list-range', [650, 400], { start: 0, count: 80 }, 't = 0…79')
    const steps = compress.node('flow/list-zip', [950, 300], '[t, W[t]] × 80')
    compress.link(roundSteps, 'items', steps, 'a')
    compress.link(schedule, 'result', steps, 'b')

    const rounds = compress.config('flow/fold', [1250, 150], { fn: 'Round' }, '80 rounds')
    compress.link(steps, 'pairs', rounds, 'items')
    compress.panelIn('H', rounds, 'init')

    const pairs = compress.node('flow/list-zip', [1550, 100], '[H, after rounds]')
    const added = compress.config('flow/map', [1850, 100], { fn: 'Add32' }, 'H + a…e')
    compress.panelIn('H', pairs, 'a')
    compress.link(rounds, 'result', pairs, 'b')
    compress.link(pairs, 'pairs', added, 'items')
    compress.panelOut(added, 'items', 'H')

    compress.note(
      [950, 600],
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
    )
  }

  // ─── SHA-1 (by hand): the whole algorithm ────────────────────────────────
  {
    sha1.panels([-200, 100], [2150, 350])
    const padded = sha1.instance(pad, [50, 100])
    sha1.panelIn('data', padded, 'message')

    const blockBits = constant(sha1, [50, 300], 512)
    const blocks = sha1.instance(chunk, [350, 150], '512-bit blocks')
    sha1.link(padded, 'padded', blocks, 'value')
    sha1.link(padded, 'blocks', blocks, 'count')
    sha1.link(blockBits, 'number', blocks, 'bits')

    const ivText = sha1.config('io/text-input', [50, 500], { text: IV_HEX.join(' ') }, 'H0…H4 (FIPS 180-4)')
    const ivBytes = sha1.node('encoding/hex-decode', [350, 500], 'IV bytes')
    const five = constant(sha1, [350, 650], 5)
    const thirtyTwo = constant(sha1, [350, 800], 32)
    const iv = sha1.instance(chunk, [650, 550], 'IV words')
    sha1.link(ivText, 'text', ivBytes, 'text')
    sha1.link(ivBytes, 'data', iv, 'value')
    sha1.link(five, 'number', iv, 'count')
    sha1.link(thirtyTwo, 'number', iv, 'bits')

    const hashed = sha1.config('flow/fold', [950, 250], { fn: 'Compress' }, 'compress every block')
    sha1.link(blocks, 'chunks', hashed, 'items')
    sha1.link(iv, 'chunks', hashed, 'init')

    const hexWords = sha1.config('flow/map', [1250, 250], { fn: 'Word Hex' }, '8 hex digits each')
    const joined = sha1.config('text/join', [1550, 250], { separator: '' }, 'hex digest')
    const digest = sha1.node('encoding/hex-decode', [1850, 350], 'digest')
    sha1.link(hashed, 'result', hexWords, 'items')
    sha1.link(hexWords, 'items', joined, 'items')
    sha1.link(joined, 'text', digest, 'text')
    sha1.panelOut(digest, 'data', 'digest')
    sha1.panelOut(joined, 'text', 'hex')

    sha1.note(
      [950, 550],
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
    )
    sha1.note(
      [50, 1050],
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
    )
  }

  return sha1
}

// ═══ Implementation 2: SHA-1 (recursive), no Fold, no Map ══════════════════

/** The five state words as definition slots. */
const STATE: Slot[] = WORD.map((name) => [name, BYTES])

/** Wires the five state words from `from`'s outputs (or the panel when `from` is null) into `to`. */
function wireState(def: SubgraphBuilder, from: LGraphNode | null, to: LGraphNode): void {
  for (const name of WORD) {
    if (from) def.link(from, name, to, name)
    else def.panelIn(name, to, name)
  }
}

/**
 * The recursive loop ending: five Selects, `done ? keep : next`, one per
 * state word, in a column at `pos`. `keep` is the panel's own word, `next`
 * the self-instance's. Each Select is wired to the definition output.
 */
function loopExit(def: SubgraphBuilder, pos: Pos, done: LGraphNode, next: LGraphNode): void {
  WORD.forEach((name, i) => {
    const select = def.node('flow/select', [pos[0], pos[1] + i * 200], `${name}: done ? keep : next`)
    def.link(done, 'result', select, 'cond')
    def.panelIn(name, select, 'then')
    def.link(next, name, select, 'else')
    def.panelOut(select, 'result', name)
  })
}

type RoundFn = 'Ch' | 'Parity' | 'Maj'

function buildRecursive(b: SceneBuilder): SubgraphBuilder {
  const sha1 = b.subgraph('SHA-1 (recursive)', {
    inputs: [['data', BYTES]],
    outputs: [['digest', BYTES], ['hex', STRING]],
  })
  const pad = sha1.subgraph('Pad', PAD_IO)
  const chunk = sha1.subgraph('Chunk', CHUNK_IO)
  const blocks = sha1.subgraph('Blocks', {
    inputs: [...STATE, ['blocks', LIST]],
    outputs: [...STATE],
  })
  const compress = sha1.subgraph('Compress', {
    inputs: [...STATE, ['block', BYTES]],
    outputs: [...STATE],
  })
  const wordHex = sha1.subgraph('Word Hex', WORD_HEX_IO)
  const schedule = compress.subgraph('Schedule', {
    inputs: [['W', LIST]],
    outputs: [['W', LIST]],
  })
  const roundsIO: DefIO = {
    inputs: [...STATE, ['W', LIST], ['t', NUMBER], ['K', BYTES], ['left', NUMBER]],
    outputs: [...STATE],
  }
  const stages: Record<RoundFn, SubgraphBuilder> = {
    Ch: compress.subgraph('Ch Rounds', roundsIO),
    Parity: compress.subgraph('Parity Rounds', roundsIO),
    Maj: compress.subgraph('Maj Rounds', roundsIO),
  }
  const add32 = compress.subgraph('Add32', {
    inputs: [['x', BYTES], ['y', BYTES]],
    outputs: [['sum', BYTES]],
  })

  buildPad(pad)
  buildChunk(chunk, 'Used twice here: message → 512-bit blocks, and block → sixteen 32-bit words.')
  buildWordHex(wordHex)

  // ─── Add32: (x + y) mod 2³² ──────────────────────────────────────────────
  {
    add32.panels([-200, 150], [650, 150])
    const sum = add32.node('math/add', [50, 100], 'x + y')
    const two32 = constant(add32, [50, 250], TWO_32, '2³²')
    const mod = add32.node('math/modulo', [350, 150], 'mod 2³²')
    add32.panelIn('x', sum, 'a')
    add32.panelIn('y', sum, 'b')
    add32.link(sum, 'result', mod, 'a')
    add32.link(two32, 'number', mod, 'b')
    add32.panelOut(mod, 'result', 'sum')
    add32.note(
      [50, 450],
      'Addition mod 2³²',
      prose([
        'Bignum addition never overflows, so the wrap-around that 32-bit',
        'hardware does for free is an explicit `mod 2³²` here.',
      ]),
      'Math',
    )
  }

  // ─── Schedule: W grows from 16 to 80 words, one per recursion level ──────
  {
    schedule.panels([-200, 500], [3650, 150])
    const len = schedule.node('text/length', [50, 100], 'words so far')
    const eighty = constant(schedule, [50, 250], 80)
    const done = schedule.node('math/greater-eq', [350, 150], 'all 80?')
    schedule.panelIn('W', len, 'value')
    schedule.link(len, 'length', done, 'a')
    schedule.link(eighty, 'number', done, 'b')

    const taps = [3, 8, 14, 16].map((n, i) => {
      const k = constant(schedule, [50, 450 + i * 150], -n)
      const get = schedule.node('flow/list-get', [350, 450 + i * 150], `W[t−${n}]`)
      schedule.panelIn('W', get, 'items')
      schedule.link(k, 'number', get, 'index')
      return [get, 'element'] as Out
    }) as [Out, Out, Out, Out]
    const x1 = inlineXor(schedule, [650, 450], taps[0], taps[1], 'W[t−3] ⊕ W[t−8]')
    const x2 = inlineXor(schedule, [650, 750], taps[2], taps[3], 'W[t−14] ⊕ W[t−16]')
    const x3 = inlineXor(schedule, [1250, 550], x1, x2, 'all four')
    const two32 = constant(schedule, [1550, 1100], TWO_32, '2³²')
    const rot = inlineRotl(schedule, [1550, 800], x3, 1, two32, 'ROTL1 = W[t]')

    const append = schedule.node('flow/list-append', [2750, 350], 'W ++ [W[t]]')
    const self = schedule.selfInstance([3050, 350], 'Schedule (the rest)')
    const select = schedule.node('flow/select', [3350, 150], 'done ? W : …')
    schedule.panelIn('W', append, 'items')
    schedule.link(rot[0], rot[1], append, 'element')
    schedule.link(append, 'items', self, 'W')
    schedule.link(done, 'result', select, 'cond')
    schedule.panelIn('W', select, 'then')
    schedule.link(self, 'W', select, 'else')
    schedule.panelOut(select, 'result', 'W')

    schedule.note(
      [650, 1300],
      'The message schedule, by recursion',
      prose([
        '`W[t] = ROTL1(W[t−3] ⊕ W[t−8] ⊕ W[t−14] ⊕ W[t−16])` for t = 16…79.',
        '',
        'No Fold: `Schedule(W) = Schedule(W ++ [W[t]])` until W holds 80',
        'words, then it hands W back. At each level the list holds exactly t',
        'words, so W[t−3] is **index −3** (List Get counts negative indexes',
        'from the end).',
        '',
        'Xor and the rotate are spelled out inline, `(x ∨ y) − (x ∧ y)` and',
        '`((x << 1) mod 2³²) ∨ (x >> 31)`: every recursion level shares one',
        'evaluation budget, and 64 levels of helper calls would exhaust it.',
      ]),
      'Flow',
    )
  }

  // ─── Ch / Parity / Maj Rounds: 20 rounds each, one per recursion level ──
  for (const [fn, rounds] of Object.entries(stages) as Array<[RoundFn, SubgraphBuilder]>) {
    rounds.panels([-200, 600], [3350, 500])
    // Loop control.
    const zero = constant(rounds, [50, 100], 0)
    const one = constant(rounds, [50, 250], 1)
    const done = rounds.node('math/less-eq', [350, 100], 'left ≤ 0?')
    const tNext = rounds.node('math/add', [350, 250], 't + 1')
    const leftNext = rounds.node('math/subtract', [350, 400], 'left − 1')
    const w = rounds.node('flow/list-get', [350, 550], 'W[t]')
    rounds.panelIn('left', done, 'a')
    rounds.link(zero, 'number', done, 'b')
    rounds.panelIn('t', tNext, 'a')
    rounds.link(one, 'number', tNext, 'b')
    rounds.panelIn('left', leftNext, 'a')
    rounds.link(one, 'number', leftNext, 'b')
    rounds.panelIn('W', w, 'items')
    rounds.panelIn('t', w, 'index')

    // ROTL5(a).
    const two32 = constant(rounds, [650, 400], TWO_32, '2³²')
    const five = constant(rounds, [650, 100], 5)
    const twentySeven = constant(rounds, [650, 250], 27)
    const shlA = rounds.node('math/shift-left', [950, 100], 'a << 5')
    const lowA = rounds.node('math/modulo', [1250, 100], 'mod 2³²')
    const shrA = rounds.node('math/shift-right', [950, 250], 'a >> 27')
    const rotA = rounds.node('logic/or', [1550, 150], 'ROTL5(a)')
    rounds.panelIn('a', shlA, 'value')
    rounds.link(five, 'number', shlA, 'bits')
    rounds.link(shlA, 'result', lowA, 'a')
    rounds.link(two32, 'number', lowA, 'b')
    rounds.panelIn('a', shrA, 'value')
    rounds.link(twentySeven, 'number', shrA, 'bits')
    rounds.link(lowA, 'result', rotA, 'a')
    rounds.link(shrA, 'result', rotA, 'b')

    // f(b, c, d), inline.
    let f: Out
    if (fn === 'Ch') {
      const ones = constant(rounds, [650, 550], 0xffffffff, '0xffffffff')
      const bc = rounds.node('logic/and', [950, 550], 'b ∧ c')
      const notB = rounds.node('math/subtract', [950, 700], '¬b')
      const notBD = rounds.node('logic/and', [1250, 700], '¬b ∧ d')
      const or = rounds.node('logic/or', [1550, 600], 'Ch = (b ∧ c) ∨ (¬b ∧ d)')
      rounds.panelIn('b', bc, 'a')
      rounds.panelIn('c', bc, 'b')
      rounds.link(ones, 'number', notB, 'a')
      rounds.panelIn('b', notB, 'b')
      rounds.link(notB, 'result', notBD, 'a')
      rounds.panelIn('d', notBD, 'b')
      rounds.link(bc, 'result', or, 'a')
      rounds.link(notBD, 'result', or, 'b')
      f = [or, 'result']
    } else if (fn === 'Parity') {
      const or1 = rounds.node('logic/or', [950, 550], 'b ∨ c')
      const and1 = rounds.node('logic/and', [950, 700], 'b ∧ c')
      const x1 = rounds.node('math/subtract', [1250, 600], 'b ⊕ c')
      const or2 = rounds.node('logic/or', [1550, 550], '(b ⊕ c) ∨ d')
      const and2 = rounds.node('logic/and', [1550, 700], '(b ⊕ c) ∧ d')
      const x2 = rounds.node('math/subtract', [1850, 600], 'Parity = b ⊕ c ⊕ d')
      rounds.panelIn('b', or1, 'a')
      rounds.panelIn('c', or1, 'b')
      rounds.panelIn('b', and1, 'a')
      rounds.panelIn('c', and1, 'b')
      rounds.link(or1, 'result', x1, 'a')
      rounds.link(and1, 'result', x1, 'b')
      rounds.link(x1, 'result', or2, 'a')
      rounds.panelIn('d', or2, 'b')
      rounds.link(x1, 'result', and2, 'a')
      rounds.panelIn('d', and2, 'b')
      rounds.link(or2, 'result', x2, 'a')
      rounds.link(and2, 'result', x2, 'b')
      f = [x2, 'result']
    } else {
      const bc = rounds.node('logic/and', [950, 550], 'b ∧ c')
      const bd = rounds.node('logic/and', [950, 700], 'b ∧ d')
      const cd = rounds.node('logic/and', [950, 850], 'c ∧ d')
      const or1 = rounds.node('logic/or', [1250, 600], '(b ∧ c) ∨ (b ∧ d)')
      const or2 = rounds.node('logic/or', [1550, 700], 'Maj = majority')
      rounds.panelIn('b', bc, 'a')
      rounds.panelIn('c', bc, 'b')
      rounds.panelIn('b', bd, 'a')
      rounds.panelIn('d', bd, 'b')
      rounds.panelIn('c', cd, 'a')
      rounds.panelIn('d', cd, 'b')
      rounds.link(bc, 'result', or1, 'a')
      rounds.link(bd, 'result', or1, 'b')
      rounds.link(or1, 'result', or2, 'a')
      rounds.link(cd, 'result', or2, 'b')
      f = [or2, 'result']
    }

    // ROTL30(b).
    const thirty = constant(rounds, [650, 1050], 30)
    const twoC = constant(rounds, [650, 1200], 2)
    const shlB = rounds.node('math/shift-left', [950, 1050], 'b << 30')
    const lowB = rounds.node('math/modulo', [1250, 1050], 'mod 2³²')
    const shrB = rounds.node('math/shift-right', [950, 1200], 'b >> 2')
    const rotB = rounds.node('logic/or', [1550, 1100], 'ROTL30(b)')
    rounds.panelIn('b', shlB, 'value')
    rounds.link(thirty, 'number', shlB, 'bits')
    rounds.link(shlB, 'result', lowB, 'a')
    rounds.link(two32, 'number', lowB, 'b')
    rounds.panelIn('b', shrB, 'value')
    rounds.link(twoC, 'number', shrB, 'bits')
    rounds.link(lowB, 'result', rotB, 'a')
    rounds.link(shrB, 'result', rotB, 'b')

    // temp = (ROTL5(a) + f + e + K + W[t]) mod 2³²
    const sum1 = rounds.node('math/add', [2150, 150], '+ f')
    const sum2 = rounds.node('math/add', [2150, 300], '+ e')
    const sum3 = rounds.node('math/add', [2150, 450], '+ K')
    const sum4 = rounds.node('math/add', [2150, 600], '+ W[t]')
    const temp = rounds.node('math/modulo', [2450, 600], 'temp (mod 2³²)')
    rounds.link(rotA, 'result', sum1, 'a')
    rounds.link(f[0], f[1], sum1, 'b')
    rounds.link(sum1, 'result', sum2, 'a')
    rounds.panelIn('e', sum2, 'b')
    rounds.link(sum2, 'result', sum3, 'a')
    rounds.panelIn('K', sum3, 'b')
    rounds.link(sum3, 'result', sum4, 'a')
    rounds.link(w, 'element', sum4, 'b')
    rounds.link(sum4, 'result', temp, 'a')
    rounds.link(two32, 'number', temp, 'b')

    // The next round, on the shifted state [temp, a, ROTL30(b), c, d].
    const self = rounds.selfInstance([2750, 400], `${fn} Rounds (the rest)`)
    rounds.link(temp, 'result', self, 'a')
    rounds.panelIn('a', self, 'b')
    rounds.link(rotB, 'result', self, 'c')
    rounds.panelIn('c', self, 'd')
    rounds.panelIn('d', self, 'e')
    rounds.panelIn('W', self, 'W')
    rounds.link(tNext, 'result', self, 't')
    rounds.panelIn('K', self, 'K')
    rounds.link(leftNext, 'result', self, 'left')
    loopExit(rounds, [3050, 100], done, self)

    rounds.note(
      [650, 1400],
      `${fn} Rounds: 20 of the 80, one per level`,
      prose([
        '```',
        'temp = ROTL5(a) + f(b, c, d)',
        '       + e + K + W[t]',
        'next  = [temp, a, ROTL30(b), c, d]',
        '```',
        'One round is wired out in full above, then the self-instance runs',
        'the remaining `left − 1` rounds on the shifted state. At `left ≤ 0`',
        'the five **Select** nodes keep the incoming words instead, and the',
        'self-call (their lazy `else`) never runs.',
        '',
        fn === 'Ch'
          ? '**Ch** (rounds 0…19): each bit of b chooses c (b = 1) or d (b = 0). `¬b` is `0xffffffff − b` so a short, leading-zero word still inverts its missing top byte.'
          : fn === 'Parity'
            ? '**Parity** (rounds 20…39 and 60…79): b ⊕ c ⊕ d, with each ⊕ spelled as `(x ∨ y) − (x ∧ y)` so word lengths never matter.'
            : '**Maj** (rounds 40…59): each output bit is whatever at least two of b, c, d agree on.',
      ]),
      'Hashing',
    )
  }

  // ─── Compress: one 512-bit block, four stages in a row ───────────────────
  {
    compress.panels([-200, 250], [2450, 350])
    const sixteen = constant(compress, [50, 100], 16)
    const thirtyTwo = constant(compress, [50, 250], 32)
    const words = compress.instance(chunk, [350, 100], 'W[0…15]')
    compress.panelIn('block', words, 'value')
    compress.link(sixteen, 'number', words, 'count')
    compress.link(thirtyTwo, 'number', words, 'bits')
    const W = compress.instance(schedule, [650, 100], 'W[0…79]')
    compress.link(words, 'chunks', W, 'W')

    const twenty = constant(compress, [650, 300], 20, '20 rounds each')
    const plan: Array<[RoundFn, number]> = [['Ch', 0], ['Parity', 20], ['Maj', 40], ['Parity', 60]]
    let previous: LGraphNode | null = null
    plan.forEach(([fn, start], i) => {
      const x = 950 + i * 300
      const stage = compress.instance(stages[fn], [x, 100], `rounds ${start}…${start + 19}: ${fn}`)
      const t = constant(compress, [x, 450], start, `t = ${start}`)
      const K = hexConstant(compress, [x, 600], [x, 750], K_HEX[i]!, `K = ${K_HEX[i]}`)
      wireState(compress, previous, stage)
      compress.link(W, 'W', stage, 'W')
      compress.link(t, 'number', stage, 't')
      compress.link(K, 'data', stage, 'K')
      compress.link(twenty, 'number', stage, 'left')
      previous = stage
    })

    WORD.forEach((name, i) => {
      const add = compress.instance(add32, [2150, 100 + i * 150], `H${i} + ${name}`)
      compress.panelIn(name, add, 'x')
      compress.link(previous!, name, add, 'y')
      compress.panelOut(add, 'sum', name)
    })

    compress.note(
      [950, 950],
      'One block: four stages, five wires',
      prose([
        'The state [a, b, c, d, e] is five separate wires here, so the four',
        'stages of SHA-1 are four nodes in a row, each with its own K and',
        'its own f: **Ch**, **Parity**, **Maj**, **Parity** again.',
        '',
        'Each stage is a recursive definition that runs 20 rounds, starting',
        'at its `t`. Then every word is added back into the incoming H.',
        '',
        'Chunk and Schedule build W: 16 words from the block, grown to 80.',
      ]),
      'Hashing',
    )
  }

  // ─── Blocks: hash the first block, recurse on the rest ───────────────────
  {
    blocks.panels([-200, 300], [1550, 500])
    const zero = constant(blocks, [50, 100], 0)
    const len = blocks.node('text/length', [350, 100], 'blocks left')
    const done = blocks.node('math/equals', [650, 100], 'none left?')
    const first = blocks.node('flow/list-get', [350, 300], 'first block')
    const rest = blocks.config('flow/list-drop', [350, 450], { n: 1 }, 'the rest')
    const one = blocks.instance(compress, [650, 300], 'Compress (first)')
    const self = blocks.selfInstance([950, 450], 'Blocks (the rest)')
    blocks.panelIn('blocks', len, 'value')
    blocks.link(len, 'length', done, 'a')
    blocks.link(zero, 'number', done, 'b')
    blocks.panelIn('blocks', first, 'items')
    blocks.link(zero, 'number', first, 'index')
    blocks.panelIn('blocks', rest, 'items')
    wireState(blocks, null, one)
    blocks.link(first, 'element', one, 'block')
    wireState(blocks, one, self)
    blocks.link(rest, 'items', self, 'blocks')
    loopExit(blocks, [1250, 100], done, self)

    blocks.note(
      [50, 700],
      'Fold, spelled out',
      prose([
        '`Blocks(H, [b, …rest]) = Blocks(Compress(H, b), rest)` and',
        '`Blocks(H, []) = H`: exactly what Fold does, as a graph.',
        '',
        '**List Get 0** and **Drop 1** split the list; **Length = 0** is the',
        'base case, taken by five lazy Selects (one per state word).',
      ]),
      'Flow',
    )
  }

  // ─── SHA-1 (recursive): the whole algorithm ──────────────────────────────
  {
    sha1.panels([-200, 100], [2150, 550])
    const padded = sha1.instance(pad, [50, 100])
    sha1.panelIn('data', padded, 'message')
    const blockBits = constant(sha1, [50, 300], 512)
    const blockList = sha1.instance(chunk, [350, 150], '512-bit blocks')
    sha1.link(padded, 'padded', blockList, 'value')
    sha1.link(padded, 'blocks', blockList, 'count')
    sha1.link(blockBits, 'number', blockList, 'bits')

    const hashed = sha1.instance(blocks, [650, 350], 'hash every block')
    IV_HEX.forEach((hex, i) => {
      const h = hexConstant(sha1, [50, 500 + i * 150], [350, 500 + i * 150], hex, `H${i} = ${hex}`)
      sha1.link(h, 'data', hashed, WORD[i]!)
    })
    sha1.link(blockList, 'chunks', hashed, 'blocks')

    const pack = sha1.node('flow/list-pack', [1250, 500], 'five hex words')
    WORD.forEach((name, i) => {
      const hex = sha1.instance(wordHex, [950, 300 + i * 150], `${name} → 8 hex digits`)
      sha1.link(hashed, name, hex, 'word')
      sha1.link(hex, 'hex', pack, name)
    })
    const joined = sha1.config('text/join', [1550, 500], { separator: '' }, 'hex digest')
    const digest = sha1.node('encoding/hex-decode', [1850, 650], 'digest')
    sha1.link(pack, 'items', joined, 'items')
    sha1.link(joined, 'text', digest, 'text')
    sha1.panelOut(digest, 'data', 'digest')
    sha1.panelOut(joined, 'text', 'hex')

    sha1.note(
      [1250, 800],
      'The algorithm, with no higher-order nodes',
      prose([
        '1. **Pad** the message, **Chunk** it into 512-bit blocks.',
        '2. **Blocks** hashes them one by one, starting from H0…H4, which',
        '   arrive as five separate wires.',
        '3. **Word Hex** prints each word, **List Pack** + **Join** glue them.',
        '',
        'Double-click any helper to go inside. Recursive calls are',
        '**inspectable**: the breadcrumb dropdown steps through every',
        'level, so you can watch round 37 of block 2.',
        '',
        'The price: every level shares one evaluation budget (1 000 helper',
        'calls per top-level instance), which is enough for five blocks,',
        'about 300 bytes of message. Fold and Map reset the budget per',
        'element, so the by-hand version has no such limit.',
      ]),
      'Hashing',
    )
    sha1.note(
      [50, 1300],
      'This definition\'s private library',
      prose([
        '```',
        'SHA-1 (recursive)    global',
        '├─ Pad',
        '├─ Chunk             recursive',
        '├─ Blocks            recursive',
        '├─ Compress',
        '│  ├─ Schedule       recursive',
        '│  ├─ Ch Rounds      recursive',
        '│  ├─ Parity Rounds  recursive',
        '│  ├─ Maj Rounds     recursive',
        '│  └─ Add32',
        '└─ Word Hex',
        '```',
        'Same names as the by-hand twin (Pad, Chunk, Compress, Word Hex), no',
        'clash: each is **scoped** to its own SHA-1 and invisible elsewhere.',
      ]),
      'Subgraphs',
    )
  }

  return sha1
}

// ═══ The scene ═════════════════════════════════════════════════════════════

export function sha1FromScratch(): GraphDocument {
  const b = new SceneBuilder()
  const byHandDef = buildByHand(b)
  const recursiveDef = buildRecursive(b)

  b.note(
    [50, 50],
    'SHA-1, built from nothing but wires',
    prose([
      'Two subgraphs below compute SHA-1 from scratch: no hashing node',
      'anywhere inside them, only arithmetic, bit logic, lists and scoped',
      'helper subgraphs.',
      '',
      '- **SHA-1 (by hand)** loops with **Fold** and **Map**.',
      '- **SHA-1 (recursive)** uses neither: every loop is a definition',
      '  that calls itself and stops through a lazy **Select**, with the',
      '  state as five visible wires.',
      '',
      'Both have the same input and outputs as the built-in **SHA-1** node,',
      'and the two **Identical?** wells compare digests byte for byte.',
      '**Double-click** either one to go inside, and keep going: every',
      'helper is a graph you can open.',
    ]),
    'Hashing',
  )

  const message = b.config('io/text-input', [50, 600], { text: 'The quick brown fox jumps over the lazy dog' }, 'Message')
  const builtin = b.node('hashing/sha-1', [350, 450], 'SHA-1 (built-in)')
  const byHand = b.instance(byHandDef, [350, 650])
  const recursive = b.instance(recursiveDef, [350, 850])
  const builtinHex = b.watch([650, 450], 'built-in')
  const byHandHex = b.watch([650, 650], 'by hand')
  const recursiveHex = b.watch([650, 850], 'recursive')
  const sameByHand = b.node('math/equals', [950, 500], 'by hand = built-in?')
  const sameRecursive = b.node('math/equals', [950, 800], 'recursive = built-in?')
  const verdictByHand = b.watch([1250, 500], 'Identical? (by hand)')
  const verdictRecursive = b.watch([1250, 800], 'Identical? (recursive)')

  b.link(message, 'text', builtin, 'data')
  b.link(message, 'text', byHand, 'data')
  b.link(message, 'text', recursive, 'data')
  b.link(builtin, 'hex', builtinHex, 'value')
  b.link(byHand, 'hex', byHandHex, 'value')
  b.link(recursive, 'hex', recursiveHex, 'value')
  b.link(builtin, 'digest', sameByHand, 'a')
  b.link(byHand, 'digest', sameByHand, 'b')
  b.link(builtin, 'digest', sameRecursive, 'a')
  b.link(recursive, 'digest', sameRecursive, 'b')
  b.link(sameByHand, 'result', verdictByHand, 'value')
  b.link(sameRecursive, 'result', verdictRecursive, 'value')

  b.note(
    [1550, 450],
    'Try it',
    prose([
      '- Edit the message: all three digests change, and stay identical.',
      '- Paste in more than 55 bytes: the padding spills into a second',
      '  block, and *Compress* runs once per block.',
      '- Non-ASCII works too: the message is hashed as UTF-8 bytes.',
      '- Past about 300 bytes the recursive version runs out of evaluation',
      '  budget (the note inside it says why); the by-hand one carries on.',
      '',
      'Every 64-byte block costs about 7 000 node runs (80 rounds plus 64',
      'schedule steps), all of them inspectable.',
    ]),
    'Notes',
  )

  b.group('Same input, three implementations', [40, 380, 1450, 650], '#7d5119')

  return b.build()
}
