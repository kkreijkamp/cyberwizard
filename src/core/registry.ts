/**
 * The node registry — the DX core of CyberWizard.
 *
 * An operation is declared once via defineNode() and the registry generates a
 * fully wired LiteGraph node class: typed slots, param widgets bound to
 * node.properties, category colours, and dirty-marking hooks. The engine
 * (core/engine.ts) drives execution; node code never touches LiteGraph.
 *
 * Everything is statically typed: with `as const` slot/param arrays, the
 * run() function gets exact input/param/output types.
 */

import { LiteGraph, LGraphNode } from '@comfyorg/litegraph'
import type { ISlotType, IWidget, LGraph, LLink } from '@comfyorg/litegraph'
import type { DataType, SlotTypeTag, ValueOf } from './types'
import { ANY, BOOLEAN, BYTES, JSON as JSON_TYPE, NUMBER, STRING, fromSlotType, listOf, toSlotType } from './types'
import { canCoerce } from './coerce'

// ─── Definition types ────────────────────────────────────────────────────────

export interface SlotDef<N extends string = string, T extends DataType = DataType> {
  readonly name: N
  readonly type: T
}

export type ParamDef =
  | {
      readonly kind: 'string'
      readonly name: string
      readonly label?: string
      readonly default: string
      readonly multiline?: boolean
      /** Param holds a subgraph definition's name (map/filter/fold's fn, If's then/else) — edits to that definition must dirty this node. */
      readonly subgraphRef?: boolean
    }
  | {
      readonly kind: 'number'
      readonly name: string
      readonly label?: string
      readonly default: number
      readonly min?: number
      readonly max?: number
      /** Literal step for the stepper arrows/drag (translated to litegraph's step2 — its `step` option is in tenths). */
      readonly step?: number
      /** Decimal places shown in the widget (litegraph default: 3). */
      readonly precision?: number
    }
  | { readonly kind: 'boolean'; readonly name: string; readonly label?: string; readonly default: boolean }
  | { readonly kind: 'enum'; readonly name: string; readonly label?: string; readonly default: string; readonly options: readonly string[] }

type ValueOfParam<P extends ParamDef> = P extends { kind: 'number' } ? number : P extends { kind: 'boolean' } ? boolean : string

export type InputValues<I extends readonly SlotDef[]> = {
  [K in I[number]['name']]: ValueOf<Extract<I[number], { name: K }>['type']> | undefined
}

export type OutputValues<O extends readonly SlotDef[]> = {
  [K in O[number]['name']]: ValueOf<Extract<O[number], { name: K }>['type']>
}

export type ParamValues<P extends readonly ParamDef[]> = {
  [K in P[number]['name']]: ValueOfParam<Extract<P[number], { name: K }>>
}

export interface RunContext {
  /** AbortSignalled when a newer evaluation supersedes this run. Best-effort: ops that can honour it should. */
  readonly signal: AbortSignal
  /** Escape hatch for sink/source nodes that render their own state (e.g. Preview). */
  readonly node: LGraphNode
  /**
   * Higher-order hook: evaluate a subgraph definition once with positional
   * inputs, using the same call semantics and recursion guards as instance
   * evaluation (flow/map & friends). Present when the engine drives the run.
   */
  readonly apply?: (defId: string, inputs: readonly unknown[]) => Promise<readonly unknown[]>
  /**
   * Pulls one input slot's value on demand: the upstream is evaluated and
   * the value coerced to the slot type. Throws when the upstream is blocked
   * or stale. Only slots declared in the def's `lazyInputs` need this —
   * eager inputs arrive in the `inputs` argument. The untaken side of a
   * conditional is never pulled, hence never evaluated.
   */
  readonly pull: (slotName: string) => Promise<unknown>
}

export interface NodeDef<
  I extends readonly SlotDef[] = readonly SlotDef[],
  O extends readonly SlotDef[] = readonly SlotDef[],
  P extends readonly ParamDef[] = readonly ParamDef[],
> {
  /** Unique type id, e.g. 'encoding/base64-encode'. */
  readonly type: string
  readonly title: string
  readonly category: string
  readonly description?: string
  readonly inputs: I
  readonly outputs: O
  readonly params?: P
  /**
   * Names of input slots the engine must NOT pre-evaluate: they are absent
   * from `inputs`, and the op demands them via ctx.pull (flow/select's
   * then/else — the untaken branch never runs). Coercion applies as usual.
   */
  readonly lazyInputs?: readonly string[]
  /**
   * Variadic inputs (Concat, List Pack): when every input is wired, one
   * more empty slot is appended automatically; trailing empty slots beyond
   * the first are pruned. The engine evaluates dynamically added slots like
   * declared ones; they serialize as a count (see core/serialize).
   */
  readonly variadicInputs?: boolean
  /**
   * Browser-side hook for nodes needing custom widgets (file picker, action
   * buttons). Runs once at construction, after slots and param widgets.
   */
  setup?(node: LGraphNode): void
  run(
    inputs: InputValues<I>,
    params: ParamValues<P>,
    ctx: RunContext,
  ): OutputValues<O> | Promise<OutputValues<O>>
}

/** Runtime-erased def for storage and lookup (typing lives at defineNode call sites). */
export type UntypedNodeDef = Omit<NodeDef, 'run'> & {
  run(inputs: Record<string, unknown>, params: Record<string, unknown>, ctx: RunContext): Record<string, unknown> | Promise<Record<string, unknown>>
}

// ─── Registry storage ────────────────────────────────────────────────────────

const defsByType = new Map<string, UntypedNodeDef>()

export function allNodeDefs(): readonly UntypedNodeDef[] {
  return [...defsByType.values()]
}

export function getDefByType(type: string): UntypedNodeDef | undefined {
  return defsByType.get(type)
}

export function getNodeDef(node: LGraphNode): UntypedNodeDef | undefined {
  return (node.constructor as unknown as { nodeDef?: UntypedNodeDef }).nodeDef
}

// ─── Dirty-marking bridge (breaks the registry↔engine import cycle) ─────────

type DirtyHandler = (node: LGraphNode) => void
const dirtyHandlers = new WeakMap<LGraph, DirtyHandler>()

/** Called by the Engine when it attaches to a graph. */
export function setDirtyHandler(graph: LGraph, handler: DirtyHandler | undefined): void {
  if (handler) dirtyHandlers.set(graph, handler)
  else dirtyHandlers.delete(graph)
}

/** Marks a node (and, via the engine, everything downstream of it) for re-evaluation. */
export function markNodeDirty(node: LGraphNode): void {
  const graph = node.graph
  if (!graph) return
  dirtyHandlers.get(graph)?.(node)
}

/** Programmatic param change: keeps properties, widget, and engine in sync. */
export function setParam(node: LGraphNode, name: string, value: string | number | boolean): void {
  node.properties[name] = value
  const widget = paramWidgets(node).get(name)
  if (widget) (widget as { value?: unknown }).value = value
  markNodeDirty(node)
}

// ─── Widget params ↔ connection points ───────────────────────────────────────

/**
 * Params that may be promoted from widget to wired input slot. Subgraph
 * pickers are excluded — they resolve definition names, not values.
 */
export function isConvertibleParam(param: ParamDef): boolean {
  return !(param.kind === 'string' && param.subgraphRef === true)
}

/** The DataType a converted param's slot accepts and its value coerces to. */
export function paramDataType(param: ParamDef): DataType {
  switch (param.kind) {
    case 'number': return NUMBER
    case 'boolean': return BOOLEAN
    default: return STRING // string + enum
  }
}

/**
 * Promotes a param to a connection point: an input slot bound to its widget
 * (litegraph's widget-input slot — the dot renders inline at the widget, and
 * the widget hides while wired). The engine feeds wired values through as
 * the param value (see doEnsure); unwired, the widget value stands.
 */
export function convertParamToInput(node: LGraphNode, param: ParamDef): void {
  const slot = node.addInput(param.name, toSlotType(paramDataType(param)) as string)
  ;(slot as unknown as { widget: { name: string } }).widget = { name: param.name }
  markNodeDirty(node)
}

/** Reverts a converted param back to widget-only, provided its slot is unwired. */
export function revertParamToWidget(node: LGraphNode, paramName: string, declaredInputs: number): void {
  const index = node.inputs.findIndex(
    (s, i) => i >= declaredInputs && (s as { widget?: { name?: unknown } }).widget?.name === paramName,
  )
  if (index === -1) return
  if ((node.inputs[index] as { link?: unknown }).link != null) return // wired — disconnect first
  node.removeInput(index)
  markNodeDirty(node)
}

/** Param names currently promoted to connection points, in slot order (for serialization). */
export function widgetInputParams(node: LGraphNode, declaredInputs: number): string[] {
  const names: string[] = []
  for (let i = declaredInputs; i < node.inputs.length; i++) {
    const name = (node.inputs[i] as { widget?: { name?: unknown } }).widget?.name
    if (typeof name === 'string') names.push(name)
  }
  return names
}

// ─── Variadic inputs ─────────────────────────────────────────────────────────

/** Slot names for variadic growth: a…z, aa, ab, … (spreadsheet letters). */
export function variadicSlotName(index: number): string {
  let n = index
  let name = ''
  do {
    name = String.fromCharCode(97 + (n % 26)) + name
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return name
}

/**
 * Keeps exactly one empty trailing slot on a variadic node: appends when
 * every input is wired, prunes surplus unwired trailing slots. Widget-input
 * slots (converted params) are ignored — they are not variadic slots.
 */
export function maintainVariadicSlots(node: LGraphNode, def: UntypedNodeDef): void {
  const declaredInputs = def.inputs.length
  const growthType = toSlotType(def.inputs[0]?.type ?? ANY) as string
  const linkOf = (i: number): unknown => (node.inputs[i] as { link?: unknown }).link
  const isVariadicSlot = (i: number): boolean =>
    i >= declaredInputs && (node.inputs[i] as { widget?: unknown }).widget === undefined

  if (node.inputs.every((_slot, i) => linkOf(i) != null)) {
    // Every input wired — grow one more (letters continue from the count).
    node.addInput(variadicSlotName(node.inputs.length), growthType)
    markNodeDirty(node)
    return
  }

  // Prune trailing unwired variadic slots beyond the single empty one.
  let pruned = false
  while (node.inputs.length > declaredInputs) {
    const last = node.inputs.length - 1
    if (!isVariadicSlot(last) || linkOf(last) != null) break
    if (linkOf(last - 1) != null) break // keep exactly one empty trailing slot
    node.removeInput(last)
    pruned = true
  }
  if (pruned) markNodeDirty(node)
}

const PARAM_WIDGETS = Symbol('cyberwizard.paramWidgets')

/** Name of the auto-added live-preview widget (glyph doubles as its label). */
export const PREVIEW_WIDGET_NAME = '⇒'

interface ParamWidgetCarrier {
  [PARAM_WIDGETS]?: Map<string, IWidget>
}

export function paramWidgets(node: LGraphNode): Map<string, IWidget> {
  const carrier = node as unknown as ParamWidgetCarrier
  let map = carrier[PARAM_WIDGETS]
  if (!map) {
    map = new Map()
    carrier[PARAM_WIDGETS] = map
  }
  return map
}

// ─── defineNode ──────────────────────────────────────────────────────────────

export function defineNode<
  I extends readonly SlotDef[],
  O extends readonly SlotDef[],
  P extends readonly ParamDef[],
>(def: NodeDef<I, O, P>): void {
  if (defsByType.has(def.type)) throw new Error(`duplicate node type: ${def.type}`)
  const untyped = def as unknown as UntypedNodeDef
  defsByType.set(def.type, untyped)

  const palette = categoryColors(def.category)

  class GeneratedNode extends LGraphNode {
    static readonly nodeDef = untyped
    /** Read by LiteGraph's add-node menu (registered class .title). */
    static override readonly title: string = def.title

    constructor() {
      super(def.title)
      for (const input of def.inputs) this.addInput(input.name, toSlotType(input.type))
      for (const output of def.outputs) this.addOutput(output.name, toSlotType(output.type))
      for (const param of def.params ?? []) this.addParamWidget(param)
      // Every node with outputs carries a live preview of its current value;
      // the engine rewrites it after each run (see Engine.paint).
      if (def.outputs.length > 0) {
        this.addWidget('text', PREVIEW_WIDGET_NAME, '∅', null, { multiline: true })
      }
      this.color = palette.color
      this.bgcolor = palette.bgcolor
      applyNodeFrame(this)
      def.setup?.(this)
    }

    private addParamWidget(param: ParamDef): void {
      this.properties[param.name] = param.default
      const onChange = (value: string | number | boolean): void => {
        this.properties[param.name] = value
        markNodeDirty(this)
      }
      const label = param.label ?? param.name
      let widget: IWidget
      switch (param.kind) {
        case 'string':
          widget = this.addWidget('text', label, param.default, onChange, { multiline: param.multiline ?? false }) as unknown as IWidget
          break
        case 'number':
          widget = this.addWidget('number', label, param.default, onChange, { min: param.min, max: param.max, step2: param.step, precision: param.precision }) as unknown as IWidget
          break
        case 'boolean':
          widget = this.addWidget('toggle', label, param.default, onChange) as unknown as IWidget
          break
        case 'enum':
          widget = this.addWidget('combo', label, param.default, onChange, { values: [...param.options] }) as unknown as IWidget
          break
      }
      paramWidgets(this).set(param.name, widget)
    }

    override onConnectionsChange(
      type: ISlotType,
      index: number,
      isConnected: boolean,
      linkInfo: LLink | null | undefined,
      inputOrOutput: Parameters<NonNullable<LGraphNode['onConnectionsChange']>>[4],
    ): void {
      super.onConnectionsChange?.(type, index, isConnected, linkInfo, inputOrOutput)
      if (def.variadicInputs) maintainVariadicSlots(this, def)
      markNodeDirty(this)
    }
  }

  // registerNodeType falls back to the class *name* for the menu label and
  // indexes LiteGraph.Nodes by it — without a real name every generated node
  // shows up as "GeneratedNode" and overwrites the previous one in Nodes.
  Object.defineProperty(GeneratedNode, 'name', { value: classNameFor(def) })

  LiteGraph.registerNodeType(def.type, GeneratedNode)
}

function classNameFor(def: UntypedNodeDef): string {
  const cleaned = def.title.replace(/[^a-zA-Z0-9_$]/g, '')
  return cleaned === '' || /^\d/.test(cleaned) ? `Node${cleaned}` : cleaned
}

// ─── Connection validity: driven by the coercion matrix ─────────────────────

let connectionRulesInstalled = false

/**
 * Makes LiteGraph's drag-and-drop connection checks follow the coercion
 * matrix. Verified against 0.17.2's connectSlots: the call order is
 * isValidConnection(outputType, inputType) — i.e. (from, to).
 */
export function installConnectionRules(): void {
  if (connectionRulesInstalled) return
  connectionRulesInstalled = true
  LiteGraph.isValidConnection = (from: ISlotType, to: ISlotType): boolean =>
    canCoerce(tagToDataType(fromSlotType(from)), tagToDataType(fromSlotType(to)))
}

function tagToDataType(tag: SlotTypeTag): DataType {
  switch (tag) {
    case 'bytes': return BYTES
    case 'string': return STRING
    case 'number': return NUMBER
    case 'boolean': return BOOLEAN
    case 'json': return JSON_TYPE
    // List element types are erased at the slot level; validated at run time.
    case 'list': return listOf(ANY)
    case 'any': return ANY
  }
}

// ─── Category colours ────────────────────────────────────────────────────────

/** Muted mid-tone title bars + cream-tinted bodies, for the paper theme. */
const CATEGORY_COLORS: Record<string, { color: string; bgcolor: string }> = {
  IO: { color: '#5f7f5a', bgcolor: '#eef2e6' },
  Encoding: { color: '#3f7f8c', bgcolor: '#e8f0f1' },
  Hashing: { color: '#b07830', bgcolor: '#f7efdd' },
  Text: { color: '#7a5f9e', bgcolor: '#f0eaf6' },
  Logic: { color: '#4a6fa5', bgcolor: '#e9eef7' },
  Data: { color: '#a04a68', bgcolor: '#f6e9ee' },
  Crypto: { color: '#a83a32', bgcolor: '#f7e8e6' },
  Flow: { color: '#6b7280', bgcolor: '#eff0f2' },
  Math: { color: '#4f8577', bgcolor: '#e8f2ef' },
  Subgraphs: { color: '#8a6d3b', bgcolor: '#f5efe0' },
}

export function categoryColors(category: string): { color: string; bgcolor: string } {
  const known = CATEGORY_COLORS[category]
  if (known) return known
  // Deterministic fallback hue for unlisted categories.
  let hash = 0
  for (const ch of category) hash = (hash * 31 + ch.charCodeAt(0)) | 0
  const hue = ((hash % 360) + 360) % 360
  return { color: `hsl(${hue} 30% 45%)`, bgcolor: `hsl(${hue} 35% 93%)` }
}

// ─── Node frame ──────────────────────────────────────────────────────────────

const NODE_FRAME_COLOR = 'rgba(80, 66, 53, 0.4)'

/**
 * The subtle permanent frame every node gets, hugging its edge (the library's
 * own strokeStyles channel — alongside its error/selection entries, not in
 * place of them). Called by the node factories (here and core/subgraph)
 * because strokeStyles is assigned per instance in the library constructor.
 */
export function applyNodeFrame(node: LGraphNode): void {
  node.strokeStyles.frame = () => ({ color: NODE_FRAME_COLOR, padding: 0.5, lineWidth: 1 })
}
