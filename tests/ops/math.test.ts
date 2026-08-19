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
