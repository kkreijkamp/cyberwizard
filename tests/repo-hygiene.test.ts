import { describe, expect, it } from 'vitest'

/**
 * Repo hygiene: no em dashes in source or tests. The project style is plain
 * punctuation: colons, semicolons, commas, parentheses. (Requested by the
 * user; enforced here so it doesn't creep back.)
 *
 * Contents come from vite's raw glob (import.meta.glob) — no node builtins,
 * so the project's browser-only type environment stays untouched.
 */
const files = import.meta.glob(['../../src/**/*.ts', '../../src/**/*.css', './*.ts', './**/*.ts'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

describe('repo hygiene', () => {
  it('no em dashes anywhere in src/ or tests/', () => {
    const offenders: string[] = []
    for (const [file, text] of Object.entries(files)) {
      for (const [index, line] of text.split('\n').entries()) {
        if (line.includes('—')) offenders.push(`${file}:${index + 1}`)
      }
    }
    expect(offenders).toEqual([])
  })
})
