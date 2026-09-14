/**
 * Undo history: the generic two-stack model. Snapshots are full documents
 * (the app serializes the whole graph per entry — see ui/history), so undo
 * and redo are just stack moves. `push` clears the redo stack (new edits
 * always invalidate the redone future) and enforces the cap.
 */
export class History<T> {
  private readonly undoStack: T[] = []
  private readonly redoStack: T[] = []

  constructor(readonly limit = 50) {}

  get canUndo(): boolean {
    return this.undoStack.length > 0
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0
  }

  /** Records a new present: the previous one becomes undoable, redo dies. */
  push(previous: T): void {
    this.undoStack.push(previous)
    if (this.undoStack.length > this.limit) this.undoStack.shift()
    this.redoStack.length = 0
  }

  /** Steps back: `current` becomes redoable, the returned snapshot becomes present. Undefined when empty. */
  undo(current: T): T | undefined {
    const target = this.undoStack.pop()
    if (target === undefined) return undefined
    this.redoStack.push(current)
    return target
  }

  /** Steps forward: `current` becomes undoable, the returned snapshot becomes present. Undefined when empty. */
  redo(current: T): T | undefined {
    const target = this.redoStack.pop()
    if (target === undefined) return undefined
    this.undoStack.push(current)
    return target
  }
}
