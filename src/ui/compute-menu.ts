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
 * Installed as a prototype hook: litegraph prepends each node's
 * getExtraMenuOptions entries to its context menu (SubgraphNode defines
 * none of its own, so instances are covered too).
 */

import { LGraphNode } from '@comfyorg/litegraph'
import type { IContextMenuValue, LGraphCanvas } from '@comfyorg/litegraph'
import type { Engine } from '../core/engine'

/** `getCanvas` because the menu is installed before the canvas exists (main.ts). */
export function installComputeMenu(engine: Engine, getCanvas: () => LGraphCanvas): void {
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
