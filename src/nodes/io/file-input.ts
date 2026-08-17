import { defineNode, markNodeDirty } from '../../core/registry'
import { BYTES, STRING } from '../../core/types'

/**
 * Source node: reads a file from disk into bytes. The file lives in
 * node.properties — a graph serialisation story for M3.
 */
defineNode({
  type: 'io/file-input',
  title: 'File Input',
  category: 'IO',
  inputs: [] as const,
  outputs: [
    { name: 'data', type: BYTES },
    { name: 'name', type: STRING },
  ] as const,
  setup: (node) => {
    const label = node.addWidget('text', 'file', '(no file chosen)', null)
    node.addWidget('button', 'Choose file…', '', () => {
      const picker = document.createElement('input')
      picker.type = 'file'
      picker.onchange = async () => {
        const file = picker.files?.[0]
        if (!file) return
        node.properties.fileName = file.name
        node.properties.fileData = new Uint8Array(await file.arrayBuffer())
        ;(label as { value?: unknown }).value = `${file.name} (${file.size} B)`
        markNodeDirty(node)
      }
      picker.click()
    })
  },
  run: (_inputs, _params, ctx) => {
    const data = ctx.node?.properties.fileData
    const name = ctx.node?.properties.fileName
    return {
      data: data instanceof Uint8Array ? data : new Uint8Array(),
      name: typeof name === 'string' ? name : '',
    }
  },
})
