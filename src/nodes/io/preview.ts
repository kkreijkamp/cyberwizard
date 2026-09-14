import type { LGraphNode } from '@comfyorg/litegraph'
import { SINK_WIDGET_NAME, makePreviewWidget } from '../../core/preview-widget'
import { defineNode } from '../../core/registry'
import { ANY, repr } from '../../core/types'

const WIDGET_NAME = SINK_WIDGET_NAME

/** Raw input from the last run, stashed for the inspect overlay (never serialized). */
export const LAST_INPUT_PROPERTY = '__lastInput'

/** Sink node: renders whatever arrives at its input, via the repr() of the value. */
defineNode({
  type: 'io/preview',
  title: 'Preview',
  category: 'IO',
  description: 'Sink node: displays the value arriving at its input.',
  inputs: [{ name: 'value', type: ANY }] as const,
  outputs: [] as const,
  run: (inputs, _params, ctx) => {
    previewWidget(ctx.node).value = repr(inputs.value)
    ctx.node.properties[LAST_INPUT_PROPERTY] = inputs.value as never
    return {}
  },
})

interface ValueWidget {
  value: unknown
}

function previewWidget(node: LGraphNode): ValueWidget {
  const widgets = (node.widgets ?? []) as unknown as Array<{ name?: unknown; value: unknown }>
  const existing = widgets.find((w) => w.name === WIDGET_NAME)
  if (existing) return existing
  // Created lazily on first run: the registry only builds param widgets.
  return node.addCustomWidget(makePreviewWidget(WIDGET_NAME)) as unknown as ValueWidget
}
