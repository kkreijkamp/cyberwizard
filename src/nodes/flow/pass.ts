/**
 * Flow — Pass: the identity node. The output is the input, unchanged (same
 * reference for lists and bytes). Handy for tidying wire routing with a
 * live preview, or as the no-op branch inside an If's branch subgraph.
 */

import { defineNode } from '../../core/registry'
import { ANY } from '../../core/types'

defineNode({
  type: 'flow/pass',
  title: 'Pass',
  category: 'Flow',
  description: 'Identity: the output is the input, unchanged.',
  inputs: [{ name: 'value', type: ANY }] as const,
  outputs: [{ name: 'value', type: ANY }] as const,
  run: (inputs) => ({ value: inputs.value }),
})
