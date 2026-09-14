import { describe, expect, it } from 'vitest'
import { History } from '../../src/core/history'

describe('history store', () => {
  it('starts empty', () => {
    const h = new History<number>()
    expect(h.canUndo).toBe(false)
    expect(h.canRedo).toBe(false)
    expect(h.undo(9)).toBeUndefined()
    expect(h.redo(9)).toBeUndefined()
  })

  it('walks back and forth through pushes', () => {
    const h = new History<number>()
    h.push(1)
    h.push(2)
    // current is 3; undo → 2, redo offers 3
    expect(h.undo(3)).toBe(2)
    expect(h.canUndo).toBe(true)
    expect(h.canRedo).toBe(true)
    expect(h.undo(2)).toBe(1)
    expect(h.canUndo).toBe(false)
    expect(h.redo(1)).toBe(2)
    expect(h.redo(2)).toBe(3)
    expect(h.canRedo).toBe(false)
  })

  it('a new push kills the redo future', () => {
    const h = new History<number>()
    h.push(1)
    expect(h.undo(2)).toBe(1)
    expect(h.canRedo).toBe(true)
    h.push(1) // a fresh edit from the undone state
    expect(h.canRedo).toBe(false)
  })

  it('caps the undo stack, dropping the oldest', () => {
    const h = new History<number>(3)
    h.push(1)
    h.push(2)
    h.push(3)
    h.push(4) // 1 falls off
    expect(h.undo(5)).toBe(4)
    expect(h.undo(4)).toBe(3)
    expect(h.undo(3)).toBe(2)
    expect(h.canUndo).toBe(false)
  })

  it('redo pushes back onto the undo stack (no loss on a round trip)', () => {
    const h = new History<number>()
    h.push(1)
    const back = h.undo(2)
    expect(back).toBe(1)
    const forward = h.redo(1)
    expect(forward).toBe(2)
    expect(h.undo(2)).toBe(1) // still undoable after the round trip
  })
})
