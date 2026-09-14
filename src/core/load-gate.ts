/**
 * Bulk-restore gate. deserializeGraph replaces the whole document in one
 * synchronous pass; per-node hooks that fire on every add (ui/layout's
 * position snap, size snap, and column reflow) must stay quiet through it,
 * or the restored graph drifts from the saved document: restored ≠ snapshot.
 * (That drift is what killed redo: the undo history's poll saw the reflow's
 * moves as a fresh edit and pushed, clobbering the redo stack.)
 *
 * Lives in core so both serialize (writer) and layout (reader) can see it
 * without a layering violation.
 */
let depth = 0

export function isLoading(): boolean {
  return depth > 0
}

/** Runs `fn` with the gate held, releasing even on throw. */
export function withLoadGate<T>(fn: () => T): T {
  depth++
  try {
    return fn()
  } finally {
    depth = Math.max(0, depth - 1)
  }
}
