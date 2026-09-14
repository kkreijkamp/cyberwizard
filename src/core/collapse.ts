/**
 * Collapse-to-subgraph: turn a selection of nodes into a reusable definition
 * plus an instance wired exactly where the selection was.
 *
 * (LiteGraph 0.17.2 ships its own convertToSubgraph, but it is broken
 * standalone: it instantiates via LiteGraph.createNode(uuid), which only the
 * ComfyUI app layer registers. Ours is built on the definition lifecycle in
 * core/subgraph.ts and runs headless.)
 *
 * Cut-edge analysis:
 *  - edges fully inside the selection are recreated in the interior as-is;
 *  - edges crossing the boundary are grouped per outside endpoint: one
 *    declared input per (origin node, origin slot) feeding in, one declared
 *    output per (origin node, origin slot) feeding out: with names/types
 *    taken from the original slots, so the instance's signature matches what
 *    was cut. Fan-out across the boundary is preserved (panel fan-out inside,
 *    instance fan-out outside).
 *
 * Links are scanned in _links insertion order, so IO ordering is
 * deterministic. Reroutes on cut edges are straightened (the link is
 * recreated without them); groups and reroute markers themselves stay behind.
 */

import type { LGraph, LGraphNode, NodeId, SubgraphNode } from '@comfyorg/litegraph'
import { Subgraph } from '@comfyorg/litegraph'
import type { DataType } from './types'
import { ANY, dataTypeFromKind } from './types'
import {
  SUBGRAPH_INPUT_NODE_ID,
  SUBGRAPH_OUTPUT_NODE_ID,
  addDefInput,
  addDefOutput,
  createSubgraphDef,
  rawSubgraph,
  spawnSubgraphNode,
} from './subgraph'

interface LinkSnap {
  from: { node: NodeId; slot: number }
  to: { node: NodeId; slot: number }
}

interface BoundaryGroup {
  origin: { id: NodeId; slot: number }
  targets: LinkSnap[]
}

export interface CollapseResult {
  defId: string
  instance: SubgraphNode
}

function dataTypeOfSlot(slot: { type: string | number } | undefined): DataType {
  if (!slot || typeof slot.type === 'number') return ANY
  return dataTypeFromKind(slot.type)
}

export function collapseToSubgraph(
  graph: LGraph,
  selected: readonly LGraphNode[],
  name = 'New Subgraph',
): CollapseResult {
  if (selected.length === 0) throw new Error('nothing selected to collapse')
  const rootGraph = graph.rootGraph
  const selectedIds = new Set(selected.map((n) => n.id))

  // Classify links (Map iteration order is insertion order → deterministic).
  const internal: LinkSnap[] = []
  const boundaryIn = new Map<string, BoundaryGroup>()
  const boundaryOut = new Map<string, BoundaryGroup>()
  for (const link of graph._links.values()) {
    const snap: LinkSnap = {
      from: { node: link.origin_id, slot: link.origin_slot },
      to: { node: link.target_id, slot: link.target_slot },
    }
    const fromIn = selectedIds.has(link.origin_id)
    const toIn = selectedIds.has(link.target_id)
    if (fromIn && toIn) {
      internal.push(snap)
    } else if (!fromIn && toIn) {
      const key = `${String(link.origin_id)}:${link.origin_slot}`
      let group = boundaryIn.get(key)
      if (!group) {
        group = { origin: { id: link.origin_id, slot: link.origin_slot }, targets: [] }
        boundaryIn.set(key, group)
      }
      group.targets.push(snap)
    } else if (fromIn && !toIn) {
      const key = `${String(link.origin_id)}:${link.origin_slot}`
      let group = boundaryOut.get(key)
      if (!group) {
        group = { origin: { id: link.origin_id, slot: link.origin_slot }, targets: [] }
        boundaryOut.set(key, group)
      }
      group.targets.push(snap)
    }
  }

  // Declared IO from the cut edges. A cut edge from the enclosing
  // definition's own input panel takes its type from the panel slot (the
  // panel is not a real node: getNodeById would miss it).
  const enclosing = graph instanceof Subgraph ? graph : null
  const inputDefs = [...boundaryIn.values()].map((group) => {
    const origin = graph.getNodeById(group.origin.id)
    const firstTarget = graph.getNodeById(group.targets[0]!.to.node)
    const type =
      enclosing && group.origin.id === SUBGRAPH_INPUT_NODE_ID
        ? dataTypeFromKind(enclosing.inputs[group.origin.slot]?.type ?? '')
        : dataTypeOfSlot(origin?.outputs[group.origin.slot])
    return {
      name: firstTarget?.inputs[group.targets[0]!.to.slot]?.name ?? 'in',
      type,
      group,
    }
  })
  const outputDefs = [...boundaryOut.values()].map((group) => {
    const origin = graph.getNodeById(group.origin.id)
    return {
      name: origin?.outputs[group.origin.slot]?.name ?? 'out',
      type: dataTypeOfSlot(origin?.outputs[group.origin.slot]),
      group,
    }
  })

  // Create the definition (at the document root: definitions are flat).
  const meta = createSubgraphDef(rootGraph, name, graph instanceof Subgraph ? graph.id : undefined)
  for (const d of inputDefs) addDefInput(rootGraph, meta.id, d.name, d.type)
  for (const d of outputDefs) addDefOutput(rootGraph, meta.id, d.name, d.type)
  const subgraph = rawSubgraph(rootGraph, meta.id)
  if (!subgraph) throw new Error('definition creation failed')

  // Selection centroid → instance position.
  let cx = 0
  let cy = 0
  for (const node of selected) {
    cx += node.pos[0] + node.size[0] / 2
    cy += node.pos[1] + node.size[1] / 2
  }
  cx /= selected.length
  cy /= selected.length

  // Move the nodes. add() preserves ids and advances the subgraph's own
  // counter past them, so future interior ids can't collide.
  for (const node of selected) {
    graph.remove(node)
    subgraph.add(node)
  }

  // Recreate internal links (types unchanged → valid by construction).
  for (const snap of internal) {
    const origin = subgraph.getNodeById(snap.from.node)
    const target = subgraph.getNodeById(snap.to.node)
    if (origin && target) origin.connect(snap.from.slot, target, snap.to.slot)
  }

  // Wire the boundary panels inside.
  inputDefs.forEach((d, i) => {
    for (const t of d.group.targets) {
      const target = subgraph.getNodeById(t.to.node)
      const slot = target?.inputs[t.to.slot]
      if (target && slot) subgraph.inputs[i]?.connect(slot, target)
    }
  })
  outputDefs.forEach((d, i) => {
    const origin = subgraph.getNodeById(d.group.origin.id)
    const slot = origin?.outputs[d.group.origin.slot]
    if (origin && slot) subgraph.outputs[i]?.connect(slot, origin)
  })

  // Spawn the instance where the selection was and rewire the parent.
  const instance = spawnSubgraphNode(meta.id)
  if (!instance) throw new Error('instance creation failed')
  instance.pos = [cx - instance.size[0] / 2, cy - 20]
  graph.add(instance)

  inputDefs.forEach((d, i) => {
    // Cut edge originated at the enclosing definition's input panel → the
    // replacement edge must come from that panel too.
    if (enclosing && d.group.origin.id === SUBGRAPH_INPUT_NODE_ID) {
      const panelSlot = enclosing.inputs[d.group.origin.slot]
      const instanceSlot = instance.inputs[i]
      if (panelSlot && instanceSlot) panelSlot.connect(instanceSlot, instance)
      return
    }
    const outsideOrigin = graph.getNodeById(d.group.origin.id)
    outsideOrigin?.connect(d.group.origin.slot, instance, i)
  })
  outputDefs.forEach((d, i) => {
    for (const t of d.group.targets) {
      if (enclosing && t.to.node === SUBGRAPH_OUTPUT_NODE_ID) {
        const panelSlot = enclosing.outputs[t.to.slot]
        const instanceSlot = instance.outputs[i]
        if (panelSlot && instanceSlot) panelSlot.connect(instanceSlot, instance)
        continue
      }
      const outsideTarget = graph.getNodeById(t.to.node)
      if (outsideTarget) instance.connect(i, outsideTarget, t.to.slot)
    }
  })

  return { defId: meta.id, instance }
}
