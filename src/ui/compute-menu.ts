/**
 * Node context-menu actions:
 *
 *  - "Compute": evaluates the clicked node and its dirty upstream on demand,
 *    exactly as if it were wired to a Preview sink (Engine.compute). The
 *    badge repaints with the result.
 *  - "Go to failure source": shown only while the node is failing and the
 *    cause lies elsewhere: jumps the canvas to the node actually at fault
 *    (Engine.failureSource), entering a subgraph instance when the cause is
 *    in its interior.
 *
 * Also prunes LiteGraph's legacy "Properties" and "Properties Panel" entries.
 * The first edits raw node.properties - a debug view, since every param here
 * already has an on-node widget - and in this fork its click just closes the
 * menu. The second opens a panel positioned below the viewport with no
 * styling. Both are dead clicks wearing palette colours.
 *
 * Installed as prototype hooks: litegraph prepends each node's
 * getExtraMenuOptions entries to its context menu (SubgraphNode defines
 * none of its own, so instances are covered too), and getNodeMenuOptions
 * is the single choke point the whole option list flows through.
 */

import { LGraphCanvas, LGraphNode } from '@comfyorg/litegraph'
import type { IContextMenuValue } from '@comfyorg/litegraph'
import type { Engine } from '../core/engine'

const PRUNED_ENTRIES = new Set(['Properties', 'Properties Panel'])

/** `getCanvas` because the menu is installed before the canvas exists (main.ts). */
export function installComputeMenu(engine: Engine, getCanvas: () => LGraphCanvas): void {
  const baseMenuOptions = LGraphCanvas.prototype.getNodeMenuOptions
  LGraphCanvas.prototype.getNodeMenuOptions = function (this: LGraphCanvas, node: LGraphNode) {
    const options = baseMenuOptions
      .call(this, node)
      .filter((option) => option === null || !PRUNED_ENTRIES.has(option.content ?? ''))
    // Pruning can leave two null separators back to back; collapse those.
    return options.filter((option, i) => option !== null || options[i - 1] !== null)
  }

  LGraphNode.prototype.getExtraMenuOptions = function (this: LGraphNode): IContextMenuValue<string>[] {
    const node = this
    const options: IContextMenuValue<string>[] = []

    const source = engine.failureSource(node)
    if (source) {
      options.push({
        content: 'Go to failure source',
        title: `Jump to “${source.node.title}”: ${source.message}`,
        callback: () => {
          const canvas = getCanvas()
          const targetGraph = source.node.graph
          if (targetGraph && targetGraph !== canvas.graph) canvas.setGraph(targetGraph)
          canvas.centerOnNode(source.node)
          canvas.selectNode(source.node)
        },
      })
    }

    options.push({
      content: 'Compute',
      title: 'Evaluate this node and its upstream on demand',
      callback: () => {
        void engine.compute(node)
      },
    })
    return options
  }
}
