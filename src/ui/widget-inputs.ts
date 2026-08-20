/**
 * Widget params ↔ connection points. Nodes with convertible params (any
 * string/number/boolean/enum param, e.g. Take's n) get context-menu entries
 * to promote a param to a wired input slot, and to revert it while unwired.
 *
 * Chains onto LGraphNode.prototype.getExtraMenuOptions — the same hook
 * ui/compute-menu.ts uses; they compose (both prepended before litegraph's
 * standard entries).
 */

import { LGraphNode } from '@comfyorg/litegraph'
import type { IContextMenuValue } from '@comfyorg/litegraph'
import { convertParamToInput, getNodeDef, isConvertibleParam, revertParamToWidget } from '../core/registry'

export function installWidgetInputMenu(): void {
  const previous = LGraphNode.prototype.getExtraMenuOptions
  LGraphNode.prototype.getExtraMenuOptions = function (this: LGraphNode, canvas, options) {
    const inherited = previous?.call(this, canvas, options) ?? []
    const def = getNodeDef(this)
    if (!def) return inherited
    const params = (def.params ?? []).filter(isConvertibleParam)
    if (params.length === 0) return inherited

    const declared = def.inputs.length
    const entries: IContextMenuValue<string>[] = []
    for (const param of params) {
      const label = param.label ?? param.name
      const slot = this.inputs.find(
        (s, i) => i >= declared && (s as { widget?: { name?: unknown } }).widget?.name === param.name,
      )
      if (slot === undefined) {
        entries.push({
          content: `Convert “${label}” to connection point`,
          callback: () => convertParamToInput(this, param),
        })
      } else if ((slot as { link?: unknown }).link == null) {
        entries.push({
          content: `Convert “${label}” back to widget`,
          callback: () => revertParamToWidget(this, param.name, declared),
        })
      }
    }
    return [...inherited, ...entries]
  }
}
