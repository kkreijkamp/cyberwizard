import { describe, expect, it } from 'vitest'
import '../../src/nodes'
import { bytesOf, runOp } from './run-op'

describe('math/arithmetic', () => {
  it('adds, subtracts, multiplies, divides', async () => {
    expect((await runOp('math/add', { a: 2, b: 3 })).result).toBe(5)
    expect((await runOp('math/subtract', { a: 2, b: 3 })).result).toBe(-1)
    expect((await runOp('math/multiply', { a: 2, b: 3 })).result).toBe(6)
    expect((await runOp('math/divide', { a: 7, b: 2 })).result).toBe(3.5)
  })

  it('treats unwired inputs as the identity (0 additive, 1 multiplicative)', async () => {
    expect((await runOp('math/add', { a: 5 })).result).toBe(5)
    expect((await runOp('math/add', {})).result).toBe(0)
    expect((await runOp('math/subtract', { a: 5 })).result).toBe(5)
    expect((await runOp('math/multiply', { a: 5 })).result).toBe(5)
    expect((await runOp('math/multiply', {})).result).toBe(1)
    expect((await runOp('math/divide', { a: 5 })).result).toBe(5)
  })

  it('errors on division and modulo by zero', async () => {
    await expect(runOp('math/divide', { a: 1, b: 0 })).rejects.toThrow(/division by zero/)
    await expect(runOp('math/modulo', { a: 1, b: 0 })).rejects.toThrow(/modulo by zero/)
  })

  it('takes the dividend’s sign for modulo (JS semantics)', async () => {
    expect((await runOp('math/modulo', { a: 7, b: 3 })).result).toBe(1)
    expect((await runOp('math/modulo', { a: -7, b: 3 })).result).toBe(-1)
  })

  it('powers, mins, maxes', async () => {
    expect((await runOp('math/power', { a: 2, b: 10 })).result).toBe(1024)
    expect((await runOp('math/min', { a: 2, b: -3 })).result).toBe(-3)
    expect((await runOp('math/max', { a: 2, b: -3 })).result).toBe(2)
  })

  it('unary: abs, negate, floor, ceil, round', async () => {
    expect((await runOp('math/abs', { n: -3 })).result).toBe(3)
    expect((await runOp('math/negate', { n: 3 })).result).toBe(-3)
    expect((await runOp('math/floor', { n: 2.7 })).result).toBe(2)
    expect((await runOp('math/ceil', { n: 2.1 })).result).toBe(3)
    expect((await runOp('math/round', { n: 2.5 })).result).toBe(3)
  })
})

describe('math/comparisons', () => {
  it('equality is structural: types matter, bytes and lists by content', async () => {
    expect((await runOp('math/equals', { a: 1, b: 1 })).result).toBe(true)
    expect((await runOp('math/equals', { a: 1, b: '1' })).result).toBe(false)
    expect((await runOp('math/equals', { a: [1, [2]], b: [1, [2]] })).result).toBe(true)
    expect((await runOp('math/equals', { a: bytesOf('hi'), b: bytesOf('hi') })).result).toBe(true)
    expect((await runOp('math/equals', { a: bytesOf('hi'), b: bytesOf('ho') })).result).toBe(false)
    expect((await runOp('math/equals', { a: Number.NaN, b: Number.NaN })).result).toBe(true)
  })

  it('not-equals inverts equals', async () => {
    expect((await runOp('math/not-equals', { a: 1, b: 2 })).result).toBe(true)
    expect((await runOp('math/not-equals', { a: 1, b: 1 })).result).toBe(false)
  })

  it('orders numbers numerically and strings lexicographically', async () => {
    expect((await runOp('math/less', { a: 2, b: 10 })).result).toBe(true)
    expect((await runOp('math/less', { a: 'pear', b: 'apple' })).result).toBe(false)
    expect((await runOp('math/less-eq', { a: 10, b: 10 })).result).toBe(true)
    expect((await runOp('math/greater', { a: 2, b: 10 })).result).toBe(false)
    expect((await runOp('math/greater-eq', { a: 'apple', b: 'apple' })).result).toBe(true)
  })

  it('orders mixed types by repr', async () => {
    expect((await runOp('math/less', { a: 10, b: '2' })).result).toBe(true) // '10' < '2'
    expect((await runOp('math/greater', { a: 'b', b: 10 })).result).toBe(true) // 'b' > '10'
  })
})

describe('math/bitwise shifts', () => {
  it('shifts left and right', async () => {
    expect((await runOp('math/shift-left', { value: 1, bits: 4 })).result).toBe(16)
    expect((await runOp('math/shift-right', { value: 256, bits: 4 })).result).toBe(16)
  })

  it('keeps the sign on >> and zero-fills on >>>', async () => {
    expect((await runOp('math/shift-right', { value: -8, bits: 1 })).result).toBe(-4)
    expect((await runOp('math/shift-right-unsigned', { value: -8, bits: 1 })).result).toBe(2147483644)
  })

  it('masks the count to 5 bits and truncates operands to 32-bit', async () => {
    expect((await runOp('math/shift-left', { value: 1, bits: 32 })).result).toBe(1)
    expect((await runOp('math/shift-left', { value: 1.9, bits: 1.7 })).result).toBe(2)
  })

  it('unwired inputs act as 0 (a no-op shift)', async () => {
    expect((await runOp('math/shift-left', { value: 5 })).result).toBe(5)
    expect((await runOp('math/shift-right', {})).result).toBe(0)
  })
})

describe('math/shifts on bytes (big-endian bignum)', () => {
  it('appends a zero bit: << 1 doubles, growing as needed', async () => {
    expect((await runOp('math/shift-left', { value: new Uint8Array([1]), bits: 1 })).result)
      .toEqual(new Uint8Array([2]))
    expect((await runOp('math/shift-left', { value: new Uint8Array([0xff]), bits: 1 })).result)
      .toEqual(new Uint8Array([1, 0xfe]))
    expect((await runOp('math/shift-left', { value: new Uint8Array([0x48, 0x69]), bits: 1 })).result)
      .toEqual(new Uint8Array([0x90, 0xd2])) // "Hi" << 1
  })

  it('handles values far past 32 bits (the f64 truncation bug)', async () => {
    const text = new TextEncoder().encode('Hello! I love CyberSecurity and Leyla!')
    const expected = (() => {
      let n = 0n
      for (const b of text) n = (n << 8n) | BigInt(b)
      n <<= 1n
      const hex = n.toString(16)
      const padded = hex.length % 2 ? `0${hex}` : hex
      const out = new Uint8Array(padded.length / 2)
      for (let i = 0; i < out.length; i++) out[i] = parseInt(padded.slice(i * 2, i * 2 + 2), 16)
      return out
    })()
    expect((await runOp('math/shift-left', { value: text, bits: 1 })).result).toEqual(expected)
  })

  it('shifts right, dropping low bits', async () => {
    expect((await runOp('math/shift-right', { value: new Uint8Array([0x90, 0xd2]), bits: 1 })).result)
      .toEqual(new Uint8Array([0x48, 0x69]))
    expect((await runOp('math/shift-right', { value: new Uint8Array([1]), bits: 1 })).result)
      .toEqual(new Uint8Array([0])) // 0 stays a single zero byte
  })

  it('drops leading zero bytes (minimal length), delegates negative counts', async () => {
    expect((await runOp('math/shift-left', { value: new Uint8Array([0, 1]), bits: 0 })).result)
      .toEqual(new Uint8Array([1]))
    expect((await runOp('math/shift-left', { value: new Uint8Array([0x90, 0xd2]), bits: -1 })).result)
      .toEqual(new Uint8Array([0x48, 0x69]))
  })

  it('unsigned right shift matches on bytes', async () => {
    expect((await runOp('math/shift-right-unsigned', { value: new Uint8Array([0x90, 0xd2]), bits: 1 })).result)
      .toEqual(new Uint8Array([0x48, 0x69]))
  })

  it('hex strings still shift 32-bit', async () => {
    expect((await runOp('math/shift-left', { value: 'ff', bits: 1 })).result).toBe(510)
  })
})

describe('math/bignum arithmetic on bytes', () => {
  it('adds: bytes + bytes, bytes + number, bytes + hex string', async () => {
    expect((await runOp('math/add', { a: new Uint8Array([0xff]), b: new Uint8Array([1]) })).result)
      .toEqual(new Uint8Array([1, 0]))
    expect((await runOp('math/add', { a: new Uint8Array([0xff]), b: 1 })).result)
      .toEqual(new Uint8Array([1, 0]))
    expect((await runOp('math/add', { a: 1, b: new Uint8Array([0xff]) })).result)
      .toEqual(new Uint8Array([1, 0]))
    expect((await runOp('math/add', { a: new Uint8Array([1]), b: 'ff' })).result)
      .toEqual(new Uint8Array([1, 0])) // hex string stays exact
  })

  it('SHA-1 padding style: shift left 8 (append zero byte), then add 0x80', async () => {
    const text = new TextEncoder().encode('abc')
    const shifted = (await runOp('math/shift-left', { value: text, bits: 8 })).result
    expect(shifted).toEqual(new Uint8Array([0x61, 0x62, 0x63, 0x00]))
    const padded = (await runOp('math/add', { a: shifted, b: 0x80 })).result
    expect(padded).toEqual(new Uint8Array([0x61, 0x62, 0x63, 0x80]))
    // and appending the single 1 bit: << 1, then + 1
    const bit = (await runOp('math/shift-left', { value: text, bits: 1 })).result
    const setBit = (await runOp('math/add', { a: bit, b: 1 })).result
    expect(setBit).toEqual(new Uint8Array([0xc2, 0xc4, 0xc7]))
  })

  it('subtracts, erroring on a negative result', async () => {
    expect((await runOp('math/subtract', { a: new Uint8Array([1, 0]), b: new Uint8Array([0xff]) })).result)
      .toEqual(new Uint8Array([1]))
    await expect(runOp('math/subtract', { a: new Uint8Array([1]), b: new Uint8Array([2]) }))
      .rejects.toThrow(/negative/)
  })

  it('multiplies, divides (floor), modulo: all staying bytes', async () => {
    expect((await runOp('math/multiply', { a: new Uint8Array([0x10]), b: new Uint8Array([0x10]) })).result)
      .toEqual(new Uint8Array([1, 0]))
    expect((await runOp('math/divide', { a: new Uint8Array([1, 0]), b: 2 })).result)
      .toEqual(new Uint8Array([0x80]))
    expect((await runOp('math/modulo', { a: new Uint8Array([1, 0]), b: new Uint8Array([0xff]) })).result)
      .toEqual(new Uint8Array([1]))
    await expect(runOp('math/divide', { a: new Uint8Array([1]), b: 0 })).rejects.toThrow(/division by zero/)
    await expect(runOp('math/modulo', { a: new Uint8Array([1]), b: 0 })).rejects.toThrow(/modulo by zero/)
  })

  it('power, min, max as bignums', async () => {
    expect((await runOp('math/power', { a: new Uint8Array([2]), b: 8 })).result)
      .toEqual(new Uint8Array([1, 0]))
    expect((await runOp('math/min', { a: new Uint8Array([0xff]), b: new Uint8Array([1, 0]) })).result)
      .toEqual(new Uint8Array([0xff])) // 255 < 256 as bignum, not as repr
    expect((await runOp('math/max', { a: new Uint8Array([0xff]), b: new Uint8Array([1, 0]) })).result)
      .toEqual(new Uint8Array([1, 0]))
  })

  it('keeps number-path identities and unary behavior', async () => {
    expect((await runOp('math/multiply', {})).result).toBe(1) // identity preserved
    expect((await runOp('math/abs', { n: new Uint8Array([5]) })).result).toEqual(new Uint8Array([5]))
    await expect(runOp('math/negate', { n: new Uint8Array([5]) })).rejects.toThrow(/cannot negate/)
  })
})

describe('math/comparisons on bytes (bignum ordering)', () => {
  it('orders bytes and mixed operands as unsigned bignums', async () => {
    expect((await runOp('math/less', { a: new Uint8Array([0xff]), b: new Uint8Array([1, 0]) })).result).toBe(true)
    expect((await runOp('math/greater', { a: new Uint8Array([1, 0]), b: 255 })).result).toBe(true)
    expect((await runOp('math/less-eq', { a: 'ff', b: new Uint8Array([0xff]) })).result).toBe(true)
  })
})

describe('operand error messages', () => {
  it('render the full offending value: the inspect overlay shows it whole', async () => {
    const items = Array.from({ length: 8 }, (_, i) => new Uint8Array([i, i, i, i]))
    const err = await runOp('math/shift-left', { value: items }).then(
      () => {
        throw new Error('expected shift-left to reject a list')
      },
      (e: Error) => e,
    )
    expect(err.message).toContain('not a numeric operand')
    expect(err.message).toContain('[8 items]')
    // Every item renders: the compact repr would have stopped at five.
    for (let i = 0; i < 8; i++) {
      expect(err.message).toContain(`⟨4B⟩ 0${i} 0${i} 0${i} 0${i}`)
    }
    expect(err.message).not.toContain('…')
  })
})
