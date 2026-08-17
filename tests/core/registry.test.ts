import { LiteGraph } from '@comfyorg/litegraph'
import { describe, expect, it } from 'vitest'
import {
  PREVIEW_WIDGET_NAME,
  defineNode,
  getNodeDef,
  installConnectionRules,
  paramWidgets,
  setParam,
} from '../../src/core/registry'
import { NUMBER, STRING } from '../../src/core/types'

defineNode({
  type: 'test-reg/greet',
  title: 'Greet',
  category: 'Test',
  inputs: [{ name: 'name', type: STRING }] as const,
  outputs: [
    { name: 'greeting', type: STRING },
    { name: 'length', type: NUMBER },
  ] as const,
  params: [
    { kind: 'enum', name: 'lang', label: 'Language', default: 'en', options: ['en', 'nl'] },
    { kind: 'boolean', name: 'shout', default: false },
  ] as const,
  run: (inputs, params) => {
    const greeting = `${params.lang === 'nl' ? 'hoi' : 'hi'} ${inputs.name ?? ''}`
    return { greeting: params.shout ? greeting.toUpperCase() : greeting, length: greeting.length }
  },
})

describe('defineNode', () => {
  const node = (() => {
    const n = LiteGraph.createNode('test-reg/greet')
    if (!n) throw new Error('registration failed')
    return n
  })()

  it('generates a creatable LiteGraph node with typed slots', () => {
    expect(node.title).toBe('Greet')
    expect(node.inputs[0]?.name).toBe('name')
    expect(node.inputs[0]?.type).toBe('string')
    expect(node.outputs.map((o) => [o.name, o.type])).toEqual([
      ['greeting', 'string'],
      ['length', 'number'],
    ])
  })

  it('builds param widgets with defaults', () => {
    expect(node.properties.lang).toBe('en')
    expect(node.properties.shout).toBe(false)
    expect(paramWidgets(node).get('lang')?.type).toBe('combo')
    expect(paramWidgets(node).get('shout')?.type).toBe('toggle')
  })

  it('widget callback writes back to properties', () => {
    const widget = paramWidgets(node).get('shout')
    const callback = widget?.callback as unknown as ((v: boolean) => void) | undefined
    callback?.(true)
    expect(node.properties.shout).toBe(true)
  })

  it('setParam keeps properties and widget in sync', () => {
    setParam(node, 'lang', 'nl')
    expect(node.properties.lang).toBe('nl')
    expect((paramWidgets(node).get('lang') as { value?: unknown }).value).toBe('nl')
  })

  it('exposes the def from the instance', () => {
    expect(getNodeDef(node)?.type).toBe('test-reg/greet')
  })

  it('names the generated class for the add-node menu and DevTools', () => {
    // The search box reads the registered class's static .title.
    expect(LiteGraph.registered_node_types['test-reg/greet']?.title).toBe('Greet')
    expect(node.constructor.name).toBe('Greet')
  })

  it('adds a live preview widget only when the def has outputs', () => {
    expect(node.widgets?.some((w) => w.name === PREVIEW_WIDGET_NAME)).toBe(true)
    const sink = LiteGraph.createNode('test-reg/hello-world') // zero outputs
    expect(sink?.widgets?.some((w) => w.name === PREVIEW_WIDGET_NAME) ?? false).toBe(false)
  })

  it('rejects duplicate type registration', () => {
    expect(() =>
      defineNode({
        type: 'test-reg/greet',
        title: 'Dup',
        category: 'Test',
        inputs: [] as const,
        outputs: [],
        run: () => ({}),
      }),
    ).toThrow(/duplicate/)
  })
})

defineNode({
  type: 'test-reg/hello-world',
  title: 'Hello World',
  category: 'Test',
  inputs: [] as const,
  outputs: [] as const,
  run: () => ({}),
})

describe('installConnectionRules', () => {
  installConnectionRules()

  it('sanitises class names from spaced titles', () => {
    const node = LiteGraph.createNode('test-reg/hello-world')
    expect(node?.constructor.name).toBe('HelloWorld')
    expect(LiteGraph.registered_node_types['test-reg/hello-world']?.title).toBe('Hello World')
  })

  it('follows the coercion matrix (from, to)', () => {
    expect(LiteGraph.isValidConnection('string', 'bytes')).toBe(true)
    expect(LiteGraph.isValidConnection('string', 'number')).toBe(true)
    expect(LiteGraph.isValidConnection('json', 'bytes')).toBe(true)
  })

  it('rejects non-coercible pairs', () => {
    expect(LiteGraph.isValidConnection('bytes', 'number')).toBe(false)
    expect(LiteGraph.isValidConnection('number', 'json')).toBe(false)
  })

  it('honours the wildcard', () => {
    expect(LiteGraph.isValidConnection(0, 'bytes')).toBe(true)
    expect(LiteGraph.isValidConnection('bytes', 0)).toBe(true)
  })
})
