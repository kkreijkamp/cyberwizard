/** Case-insensitive subsequence match: empty query matches everything. */
export function fuzzyMatch(query: string, text: string): boolean {
  if (query === '') return true
  const q = query.toLowerCase()
  const t = text.toLowerCase()
  let i = 0
  for (const ch of t) {
    if (ch === q[i]) i++
    if (i === q.length) return true
  }
  return i === q.length
}
