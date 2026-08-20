/**
 * The node context-menu "Compute" action: evaluates the clicked node and
 * its dirty upstream on demand, exactly as if it were wired to a Preview
 * sink (Engine.compute). The badge repaints with the result.
 *
 * Installed as a prototype hook — litegraph prepends each node's
 * getExtraMenuOptions entries to its context menu (SubgraphNode defines
 * none of its own, so instances are covered too).
 */

import { LGraphNode } from '@comfyorg/litegraph'
import type { IContextMenuValue } from '@comfyorg/litegraph'
import type { Engine } from '../core/engine'

export function installComputeMenu(engine: Engine): void {
  LGraphNode.prototype.getExtraMenuOptions = function (this: LGraphNode): IContextMenuValue<string>[] {
    const node = this
    return [
      {
        content: 'Compute',
        title: 'Evaluate this node and its upstream on demand',
        callback: () => {
          void engine.compute(node)
        },
      },
    ]
  }
}
