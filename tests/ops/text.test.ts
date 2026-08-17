import { describe, expect, it } from 'vitest'
import { runOp } from './run-op'
import '../../src/nodes'

describe('case', () => {
  it('upper / lower / capitalize', async () => {
    expect((await runOp('text/to-upper-case', { text: 'abc Def' })).text).toBe('ABC DEF')
    expect((await runOp('text/to-lower-case', { text: 'ABC Def' })).text).toBe('abc def')
    expect((await runOp('text/capitalize', { text: 'hello wizard world' })).text).toBe('Hello Wizard World')
  })
})

describe('find & replace', () => {
  it('plain mode replaces all literal occurrences', async () => {
    expect((await runOp('text/find-replace', { text: 'a.b.c' }, { find: '.', replace: '-' })).text)
      .toBe('a-b-c')
  })

  it('regex mode supports capture refs and flags', async () => {
    expect(
      (await runOp('text/find-replace', { text: 'Hello WORLD' }, { find: '(world)', replace: '[$1]', regex: true, flags: 'gi' })).text,
    ).toBe('Hello [WORLD]')
  })

  it('empty find is a no-op', async () => {
    expect((await runOp('text/find-replace', { text: 'abc' }, { find: '', replace: 'x' })).text).toBe('abc')
  })
})

describe('regex', () => {
  it('extracts full matches and capture groups', async () => {
    expect((await runOp('text/regex-extract', { text: 'a1 b2 c3' }, { pattern: '\\w\\d' })).matches)
      .toEqual(['a1', 'b2', 'c3'])
    expect((await runOp('text/regex-extract', { text: 'a1 b2' }, { pattern: '(\\w)(\\d)', group: 2 })).matches)
      .toEqual(['1', '2'])
  })

  it('match returns a boolean', async () => {
    expect((await runOp('text/regex-match', { text: 'abc' }, { pattern: '^a' })).matches).toBe(true)
    expect((await runOp('text/regex-match', { text: 'abc' }, { pattern: '^b' })).matches).toBe(false)
  })

  it('counts matches and forces the g flag', async () => {
    expect((await runOp('text/regex-count', { text: 'a1 b2 c3' }, { pattern: '\\d', flags: '' })).count).toBe(3)
  })

  it('invalid pattern raises a node error', async () => {
    await expect(runOp('text/regex-match', { text: 'x' }, { pattern: '(' })).rejects.toThrow()
  })
})

describe('trim', () => {
  it('trims both, start, or end', async () => {
    expect((await runOp('text/trim', { text: '  x  ' })).text).toBe('x')
    expect((await runOp('text/trim', { text: '  x  ' }, { mode: 'start' })).text).toBe('x  ')
    expect((await runOp('text/trim', { text: '  x  ' }, { mode: 'end' })).text).toBe('  x')
  })
})

describe('split & join', () => {
  it('splits on a separator and into characters', async () => {
    expect((await runOp('text/split', { text: 'a,b,c' })).items).toEqual(['a', 'b', 'c'])
    expect((await runOp('text/split', { text: 'abc' }, { separator: '' })).items).toEqual(['a', 'b', 'c'])
  })

  it('joins with a separator', async () => {
    expect((await runOp('text/join', { items: ['a', 'b'] }, { separator: ' + ' })).text).toBe('a + b')
  })
})

describe('length', () => {
  it('measures strings, bytes, and lists', async () => {
    expect((await runOp('text/length', { value: 'hello' })).length).toBe(5)
    expect((await runOp('text/length', { value: new Uint8Array(3) })).length).toBe(3)
    expect((await runOp('text/length', { value: [1, 2] })).length).toBe(2)
  })

  it('rejects values without a length', async () => {
    await expect(runOp('text/length', { value: 42 })).rejects.toThrow(/no length/)
  })
})
