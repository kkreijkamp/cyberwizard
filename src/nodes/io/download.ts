import { asBufferSource } from '../../core/binary'
import { defineNode } from '../../core/registry'
import { BYTES } from '../../core/types'

/**
 * Sink node: saves its input as a file download. Caches the latest input on
 * each run; the actual save happens on button click (auto-downloading on
 * every upstream change would be hostile).
 */
defineNode({
  type: 'io/download',
  title: 'Download',
  category: 'IO',
  inputs: [{ name: 'data', type: BYTES }] as const,
  outputs: [] as const,
  params: [{ kind: 'string', name: 'filename', label: 'Filename', default: 'output.bin' }] as const,
  setup: (node) => {
    node.addWidget('button', 'Save file', '', () => {
      const data = node.properties.lastData
      if (!(data instanceof Uint8Array) || data.length === 0) return
      const blob = new Blob([asBufferSource(data)])
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = typeof node.properties.filename === 'string' ? node.properties.filename : 'output.bin'
      a.click()
      URL.revokeObjectURL(url)
    })
  },
  run: (inputs, _params, ctx) => {
    if (ctx.node) ctx.node.properties.lastData = inputs.data ?? new Uint8Array()
    return {}
  },
})
