import '@comfyorg/litegraph/style.css'
import './ui/app.css'
import { LGraph, LGraphCanvas } from '@comfyorg/litegraph'
import { Engine } from './core/engine'
import { installConnectionRules } from './core/registry'
import { deserializeGraph } from './core/serialize'
import { buildShowcaseGraph } from './showcase'
import { createPalette } from './ui/palette'
import { initialDocument, startAutosave, wirePersistence } from './ui/persistence'
import { applyTheme } from './ui/theme'
import './nodes'

installConnectionRules()

const canvasElement = document.querySelector<HTMLCanvasElement>('#graph')
if (!canvasElement) throw new Error('Missing #graph canvas element')

// Boot order: shared URL → autosave → showcase.
const doc = initialDocument()
const graph = new LGraph()
if (doc) deserializeGraph(doc, graph)
else buildShowcaseGraph(graph)

// The engine drives evaluation reactively — no graph.start() polling loop.
const engine = new Engine(graph)

// LGraphCanvas starts its own render loop on construction (unless skip_render).
const canvas = new LGraphCanvas(canvasElement, graph, { autoresize: true })
applyTheme(canvas)
if (doc?.view) {
  canvas.ds.offset = [...doc.view.offset]
  canvas.ds.scale = doc.view.scale
}

const paletteHost = document.querySelector<HTMLElement>('#palette')
if (paletteHost) createPalette(paletteHost, canvas, graph)

wirePersistence(graph, canvas)
startAutosave(graph, canvas)

window.addEventListener('resize', () => canvas.resize())

// Handy for poking at the engine from DevTools.
;(globalThis as Record<string, unknown>).cyberwizard = { graph, engine }
