import { defineNode } from '../../core/registry'
import { NUMBER } from '../../core/types'

defineNode({
  type: 'io/number-input',
  title: 'Number Input',
  category: 'IO',
  inputs: [] as const,
  outputs: [{ name: 'number', type: NUMBER }] as const,
  params: [{ kind: 'number', name: 'value', label: 'Value', default: 0, step: 1 }] as const,
  run: (_inputs, params) => ({ number: params.value }),
})
