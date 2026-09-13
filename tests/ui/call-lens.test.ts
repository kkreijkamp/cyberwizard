import { describe, expect, it } from 'vitest'
import type { CallInfo } from '../../src/core/engine'
import { callLabel, childCallPath, escPopTarget } from '../../src/ui/call-lens'

function info(defId: string, inputs: readonly unknown[], depth: number): CallInfo {
  return { defId, inputs, depth }
}

describe('call lens UI helpers', () => {
  it('labels calls by depth with their boundary inputs', () => {
    expect(callLabel({ path: '12', ...info('d', [5], 1) })).toBe('top · 5')
    expect(callLabel({ path: '12/7/7', ...info('d', [3], 3) })).toBe('depth 3 · 3')
    expect(callLabel({ path: '4', ...info('d', ['a', true], 1) })).toBe('top · a, true')
  })

  it('truncates long input values in labels', () => {
    const long = 'x'.repeat(60)
    const label = callLabel({ path: '12', ...info('d', [long], 1) })
    expect(label.length).toBeLessThan(40)
    expect(label).toContain('…')
  })

  it('builds child call paths from the lens base', () => {
    expect(childCallPath(null, 12)).toBe('12')
    expect(childCallPath('12', 7)).toBe('12/7')
    expect(childCallPath('12/7', 7)).toBe('12/7/7')
  })

  it('Esc pops one call while the parent call is the same definition', () => {
    const lookup = (path: string): CallInfo | undefined => {
      if (path === '12') return info('fact', [5], 1)
      if (path === '12/7') return info('fact', [4], 2)
      if (path === '12/3') return info('other', [9], 2)
      return undefined
    }
    // Recursion: 12/7's parent 12 is the same def — pop.
    expect(escPopTarget('12/7', 'fact', lookup)).toBe('12')
    // Top call: nothing to pop — ordinary navigation takes over.
    expect(escPopTarget('12', 'fact', lookup)).toBeNull()
    // Crossed into another definition: parent call belongs to the enclosing
    // def — ordinary navigation (which switches graphs) takes over.
    expect(escPopTarget('12/3', 'other', lookup)).toBeNull()
  })
})
