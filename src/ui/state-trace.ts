/**
 * State-trace download: snapshots the full engine state (every node's values,
 * the whole recorded call tree) to a JSON file — the debugging counterpart of
 * Save (which serializes structure, this serializes live state).
 */

import type { Engine } from '../core/engine'
import { buildStateDump } from '../core/state-dump'

export function wireStateTraceButton(button: HTMLButtonElement, engine: Engine): void {
  button.addEventListener('click', () => {
    const json = JSON.stringify(buildStateDump(engine), null, 2)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `cyberwizard-state-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
    a.click()
    URL.revokeObjectURL(url)
  })
}
