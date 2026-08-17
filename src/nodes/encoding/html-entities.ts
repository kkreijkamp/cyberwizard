import { defineNode } from '../../core/registry'
import { STRING } from '../../core/types'

const NAMED: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
  '&nbsp;': ' ',
}

const ENTITY_RE = /&(amp|lt|gt|quot|apos|nbsp|#x[0-9a-fA-F]+|#\d+);/g

function encodeBasic(text: string, includeApos: boolean): string {
  let out = text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
  if (includeApos) out = out.replaceAll("'", '&apos;')
  return out
}

defineNode({
  type: 'encoding/html-entities-encode',
  title: 'HTML Entities Encode',
  category: 'Encoding',
  inputs: [{ name: 'text', type: STRING }] as const,
  outputs: [{ name: 'text', type: STRING }] as const,
  params: [
    { kind: 'boolean', name: 'nonAscii', label: 'Encode non-ASCII', default: false },
  ] as const,
  run: (inputs, params) => {
    let text = encodeBasic(inputs.text ?? '', true)
    if (params.nonAscii) {
      text = text.replace(/[^\x00-\x7F]/g, (ch) => `&#x${(ch.codePointAt(0) ?? 0).toString(16)};`)
    }
    return { text }
  },
})

defineNode({
  type: 'encoding/html-entities-decode',
  title: 'HTML Entities Decode',
  category: 'Encoding',
  inputs: [{ name: 'text', type: STRING }] as const,
  outputs: [{ name: 'text', type: STRING }] as const,
  run: (inputs) => ({
    text: (inputs.text ?? '').replace(ENTITY_RE, (entity, body: string) => {
      if (body.startsWith('#x')) return String.fromCodePoint(Number.parseInt(body.slice(2), 16))
      if (body.startsWith('#')) return String.fromCodePoint(Number.parseInt(body.slice(1), 10))
      return NAMED[`&${body};`] ?? entity
    }),
  }),
})
