/**
 * The scene kit: ergonomics for authoring example graphs in code.
 *
 * Scenes are built in a detached LGraph and serialized — they load through
 * the ordinary document restore path, so a scene that builds cleanly is a
 * document that loads cleanly. Every helper fails LOUDLY at author time:
 * connect() silently returning null is how subtly unwired scenes happen.
 *
 * Positions are canvas coordinates on the 50px grid (keep them multiples of
 * 50; ui/layout snaps sizes on load, positions stay where authored).
 */

import { LGraph, LGraphGroup, LiteGraph } from '@comfyorg/litegraph'
import type { LGraphNode, Subgraph } from '@comfyorg/litegraph'
import { NOTE_TEXT_PARAM, NOTE_TINT_PARAM } from '../core/note-widget'
import { setParam } from '../core/registry'
import type { GraphDocument } from '../core/serialize'
import { serializeGraph } from '../core/serialize'
import { addDefInput, addDefOutput, createSubgraphDef, rawSubgraph, spawnSubgraphNode } from '../core/subgraph'
import type { DataType } from '../core/types'

type Pos = [number, number]

/** Slot index by name on the live slot arrays (works for registry nodes and subgraph instances alike). */
function slotIndex(node: LGraphNode, name: string, side: 'inputs' | 'outputs'): number {
  const slots = node[side] ?? []
  const index = slots.findIndex((slot) => slot.name === name)
  if (index === -1) {
    throw new Error(`scene: ${node.title} has no ${side === 'inputs' ? 'input' : 'output'} slot "${name}"`)
  }
  return index
}

function connectOrThrow(from: LGraphNode, fromSlot: string, to: LGraphNode, toSlot: string): void {
  const link = from.connect(slotIndex(from, fromSlot, 'outputs'), to, slotIndex(to, toSlot, 'inputs'))
  if (!link) throw new Error(`scene: cannot wire ${from.title}.${fromSlot} → ${to.title}.${toSlot}`)
}

export class SceneBuilder {
  readonly graph = new LGraph()

  node(type: string, pos: Pos, title?: string): LGraphNode {
    // Note: LiteGraph.createNode(type, title) does NOT apply the title for
    // registry-generated classes (their constructor passes def.title to
    // super, so node.title is already truthy) — set it explicitly.
    const node = LiteGraph.createNode(type)
    if (!node) throw new Error(`scene: unregistered node type "${type}"`)
    if (title !== undefined) node.title = title
    node.pos = pos
    this.graph.add(node)
    return node
  }

  /** Spawn with params set (the common case). */
  config(type: string, pos: Pos, params: Record<string, string | number | boolean>, title?: string): LGraphNode {
    const node = this.node(type, pos, title)
    for (const [name, value] of Object.entries(params)) setParam(node, name, value)
    return node
  }

  set(node: LGraphNode, name: string, value: string | number | boolean): LGraphNode {
    setParam(node, name, value)
    return node
  }

  /** Wire output→input by slot NAME. */
  link(from: LGraphNode, fromSlot: string, to: LGraphNode, toSlot: string): void {
    connectOrThrow(from, fromSlot, to, toSlot)
  }

  /** A Preview sink (demands everything upstream of it — that's what makes a scene compute). */
  watch(pos: Pos, title: string): LGraphNode {
    return this.node('io/preview', pos, title)
  }

  /** A sticky note (markdown body). Size is a hint — layout snaps it up to fit. */
  note(pos: Pos, title: string, markdown: string, tint = 'Notes', size?: [number, number]): LGraphNode {
    const node = this.config('notes/note', pos, { [NOTE_TEXT_PARAM]: markdown, [NOTE_TINT_PARAM]: tint }, title)
    if (size) node.size = size
    return node
  }

  group(title: string, bounding: [number, number, number, number], color?: string): LGraphGroup {
    const group = new LGraphGroup(title)
    group.pos = [bounding[0], bounding[1]]
    group.size = [bounding[2], bounding[3]]
    if (color !== undefined) group.color = color
    this.graph.add(group)
    return group
  }

  /** Starts a subgraph definition; the returned builder authors its interior. */
  subgraph(name: string, io: { inputs: Array<[string, DataType]>; outputs: Array<[string, DataType]> }): SubgraphBuilder {
    const meta = createSubgraphDef(this.graph, name)
    for (const [slotName, type] of io.inputs) addDefInput(this.graph, meta.id, slotName, type)
    for (const [slotName, type] of io.outputs) addDefOutput(this.graph, meta.id, slotName, type)
    return new SubgraphBuilder(this, meta.id)
  }

  /** An instance of a definition built with subgraph(). */
  instance(def: SubgraphBuilder, pos: Pos, title?: string): LGraphNode {
    const node = spawnSubgraphNode(def.id)
    if (!node) throw new Error(`scene: no factory for definition "${def.id}"`)
    node.pos = pos
    if (title !== undefined) node.title = title
    this.graph.add(node)
    return node
  }

  build(): GraphDocument {
    return serializeGraph(this.graph)
  }
}

export class SubgraphBuilder {
  constructor(
    private readonly scene: SceneBuilder,
    readonly id: string,
  ) {}

  get graph(): Subgraph {
    const sub = rawSubgraph(this.scene.graph, this.id)
    if (!sub) throw new Error(`scene: missing subgraph ${this.id}`)
    return sub
  }

  node(type: string, pos: Pos, title?: string): LGraphNode {
    // Note: LiteGraph.createNode(type, title) does NOT apply the title for
    // registry-generated classes (their constructor passes def.title to
    // super, so node.title is already truthy) — set it explicitly.
    const node = LiteGraph.createNode(type)
    if (!node) throw new Error(`scene: unregistered node type "${type}"`)
    if (title !== undefined) node.title = title
    node.pos = pos
    this.graph.add(node)
    return node
  }

  config(type: string, pos: Pos, params: Record<string, string | number | boolean>, title?: string): LGraphNode {
    const node = this.node(type, pos, title)
    for (const [name, value] of Object.entries(params)) setParam(node, name, value)
    return node
  }

  note(pos: Pos, title: string, markdown: string, tint = 'Notes', size?: [number, number]): LGraphNode {
    const node = this.config('notes/note', pos, { [NOTE_TEXT_PARAM]: markdown, [NOTE_TINT_PARAM]: tint }, title)
    if (size) node.size = size
    return node
  }

  watch(pos: Pos, title: string): LGraphNode {
    return this.node('io/preview', pos, title)
  }

  link(from: LGraphNode, fromSlot: string, to: LGraphNode, toSlot: string): void {
    connectOrThrow(from, fromSlot, to, toSlot)
  }

  /** Wire a definition input slot to an interior node's input. */
  panelIn(inputName: string, to: LGraphNode, toSlot: string): void {
    const sub = this.graph
    const index = sub.inputs.findIndex((slot) => slot.displayName === inputName)
    if (index === -1) throw new Error(`scene: definition has no input "${inputName}"`)
    const link = sub.inputs[index]?.connect(to.inputs[slotIndex(to, toSlot, 'inputs')]!, to)
    if (!link) throw new Error(`scene: panel-in wiring failed (${inputName} → ${to.title}.${toSlot})`)
  }

  /** Wire an interior node's output to a definition output slot. */
  panelOut(from: LGraphNode, fromSlot: string, outputName: string): void {
    const sub = this.graph
    const index = sub.outputs.findIndex((slot) => slot.displayName === outputName)
    if (index === -1) throw new Error(`scene: definition has no output "${outputName}"`)
    const link = sub.outputs[index]?.connect(from.outputs[slotIndex(from, fromSlot, 'outputs')]!, from)
    if (!link) throw new Error(`scene: panel-out wiring failed (${from.title}.${fromSlot} → ${outputName})`)
  }

  /** An instance of THIS definition inside its own interior — recursion. */
  selfInstance(pos: Pos, title?: string): LGraphNode {
    const node = spawnSubgraphNode(this.id)
    if (!node) throw new Error(`scene: no factory for definition "${this.id}"`)
    node.pos = pos
    if (title !== undefined) node.title = title
    this.graph.add(node)
    return node
  }
}
