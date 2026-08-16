import { LiteGraph, LGraphNode } from '@comfyorg/litegraph'

/**
 * M0 smoke-demo nodes — hand-written against the raw LiteGraph API to prove
 * the stack end to end. In M1 these are deleted and replaced by nodes
 * auto-generated from declarative definitions (core/registry).
 */

/** Slot type used by the demo. M1 introduces the real type system (core/types). */
const TEXT = 'string'

export const DEMO_TYPES = {
  textInput: 'demo/text-input',
  toUpperCase: 'demo/to-upper-case',
  reverse: 'demo/reverse',
  preview: 'demo/preview',
} as const

/** Category accent colors (title bar / body). */
const COLORS = {
  source: { color: '#1f6f4a', bgcolor: '#12291d' },
  transform: { color: '#5b3a8c', bgcolor: '#1f1530' },
  preview: { color: '#155e75', bgcolor: '#0c2530' },
} as const

function asText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** Source: emits the text from its widget on every execution. */
export class TextInputNode extends LGraphNode {
  constructor() {
    super('Text Input')
    const initial = 'Hello, Wizard'
    this.properties.text = initial
    this.addOutput('text', TEXT)
    this.addWidget('text', 'Text', initial, (value) => {
      this.properties.text = value
    })
    this.size = [240, 80]
    Object.assign(this, COLORS.source)
  }

  override onExecute(): void {
    this.setOutputData(0, asText(this.properties.text))
  }
}

/** Transform: uppercase. */
export class ToUpperCaseNode extends LGraphNode {
  constructor() {
    super('To Upper Case')
    this.addInput('text', TEXT)
    this.addOutput('text', TEXT)
    Object.assign(this, COLORS.transform)
  }

  override onExecute(): void {
    this.setOutputData(0, asText(this.getInputData(0)).toUpperCase())
  }
}

/** Transform: reverse characters. */
export class ReverseNode extends LGraphNode {
  constructor() {
    super('Reverse')
    this.addInput('text', TEXT)
    this.addOutput('text', TEXT)
    Object.assign(this, COLORS.transform)
  }

  override onExecute(): void {
    this.setOutputData(0, [...asText(this.getInputData(0))].reverse().join(''))
  }
}

/** Sink: displays whatever arrives at its input. */
export class PreviewNode extends LGraphNode {
  constructor() {
    super('Preview')
    this.addInput('text', TEXT)
    this.addWidget('text', 'Value', '', null, { multiline: true })
    this.size = [300, 150]
    Object.assign(this, COLORS.preview)
  }

  override onExecute(): void {
    const widget = this.widgets?.[0]
    if (widget && widget.type === 'text') {
      widget.value = asText(this.getInputData(0))
    }
  }
}

let registered = false

/** Idempotent — safe to call from both app bootstrap and tests. */
export function registerDemoNodes(): void {
  if (registered) return
  LiteGraph.registerNodeType(DEMO_TYPES.textInput, TextInputNode)
  LiteGraph.registerNodeType(DEMO_TYPES.toUpperCase, ToUpperCaseNode)
  LiteGraph.registerNodeType(DEMO_TYPES.reverse, ReverseNode)
  LiteGraph.registerNodeType(DEMO_TYPES.preview, PreviewNode)
  registered = true
}
