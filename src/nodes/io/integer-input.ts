import { defineNode } from '../../core/registry'
import { NUMBER } from '../../core/types'

defineNode({
  type: 'io/integer-input',
  title: 'Integer Input',
  category: 'IO',
  description: 'Whole numbers only — a typed decimal is rounded to the nearest integer.',
  inputs: [] as const,
  outputs: [{ name: 'number', type: NUMBER }] as const,
  params: [{ kind: 'number', name: 'value', label: 'Value', default: 0, step: 1, precision: 0 }] as const,
  run: (_inputs, params) => ({ number: Math.round(params.value) }),
})
