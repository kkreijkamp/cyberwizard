import '@comfyorg/litegraph/style.css'
import './ui/app.css'
import { LGraphCanvas } from '@comfyorg/litegraph'
import { Engine } from './core/engine'
import { installConnectionRules } from './core/registry'
import { buildShowcaseGraph } from './showcase'
import { createPalette } from './ui/palette'
import { applyTheme } from './ui/theme'
import './nodes'

installConnectionRules()

const canvasElement = document.querySelector<HTMLCanvasElement>('#graph')
if (!canvasElement) throw new Error('Missing #graph canvas element')

const { graph } = buildShowcaseGraph()

// The engine drives evaluation reactively — no graph.start() polling loop.
const engine = new Engine(graph)

// LGraphCanvas starts its own render loop on construction (unless skip_render).
const canvas = new LGraphCanvas(canvasElement, graph, { autoresize: true })
applyTheme(canvas)

const paletteHost = document.querySelector<HTMLElement>('#palette')
if (paletteHost) createPalette(paletteHost, canvas, graph)

window.addEventListener('resize', () => canvas.resize())

// Handy for poking at the engine from DevTools.
;(globalThis as Record<string, unknown>).cyberwizard = { graph, engine }
