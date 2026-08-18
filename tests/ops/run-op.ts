import { getDefByType } from '../../src/core/registry'
import type { RunContext } from '../../src/core/registry'

const ctx: RunContext = { signal: new AbortController().signal, node: undefined as never }

/**
 * Calls an operation's run() directly with engine-equivalent params
 * (defaults filled from the def, then overrides applied).
 */
export async function runOp(
  type: string,
  inputs: Record<string, unknown> = {},
  params: Record<string, unknown> = {},
  ctxPartial: Partial<RunContext> = {},
): Promise<Record<string, unknown>> {
  const def = getDefByType(type)
  if (!def) throw new Error(`unregistered op: ${type}`)
  const fullParams: Record<string, unknown> = {}
  for (const p of def.params ?? []) fullParams[p.name] = p.default
  Object.assign(fullParams, params)
  return def.run(inputs, fullParams, { ...ctx, ...ctxPartial })
}

export function bytesOf(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

export function textOf(bytes: unknown): string {
  return new TextDecoder().decode(bytes as Uint8Array)
}
