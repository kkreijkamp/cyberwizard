import '@comfyorg/litegraph/style.css'
import './ui/app.css'
import { LGraph, LGraphCanvas, LiteGraph } from '@comfyorg/litegraph'
import { Engine } from './core/engine'
import { installConnectionRules } from './core/registry'
import { deserializeGraph } from './core/serialize'
import { attachSubgraphSupport } from './core/subgraph'
import { buildShowcaseGraph } from './showcase'
import { installComputeMenu } from './ui/compute-menu'
import { installNodeLayout } from './ui/layout'
import { createPalette } from './ui/palette'
import { initialDocument, startAutosave, wirePersistence } from './ui/persistence'
import {
  installBreadcrumb,
  installCollapse,
  installIOPanel,
  wireNewSubgraphButton,
} from './ui/subgraphs'
import { applyTheme } from './ui/theme'
import './nodes'

installConnectionRules()

// The grid is one cell = 50px (library default: 10px); dragged nodes and
// reroutes snap to it unconditionally (library default: Shift-to-snap only).
// Node sizes snap to cells with column reflow (ui/layout).
LiteGraph.CANVAS_GRID_SIZE = 50
LiteGraph.alwaysSnapToGrid = true

const canvasElement = document.querySelector<HTMLCanvasElement>('#graph')
if (!canvasElement) throw new Error('Missing #graph canvas element')

const graph = new LGraph()

installNodeLayout(graph)

// Boot order: engine + subgraph coordinator first, so nodes and definitions
// restored below flow through their normal hooks. Then: URL → autosave → showcase.
const engine = new Engine(graph)
attachSubgraphSupport(graph, engine)
installComputeMenu(engine)

const doc = initialDocument()
if (doc) deserializeGraph(doc, graph)
else buildShowcaseGraph(graph)

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

const newSubgraphButton = document.querySelector<HTMLButtonElement>('#btn-new-subgraph')
if (newSubgraphButton) wireNewSubgraphButton(newSubgraphButton, canvas, graph)
const breadcrumbBar = document.querySelector<HTMLElement>('#breadcrumb')
if (breadcrumbBar) installBreadcrumb(breadcrumbBar, canvas, graph)
const ioPanel = document.querySelector<HTMLElement>('#io-panel')
if (ioPanel) installIOPanel(ioPanel, canvas, graph)
installCollapse(canvas, graph)

window.addEventListener('resize', () => canvas.resize())

// Handy for poking at the engine from DevTools.
;(globalThis as Record<string, unknown>).cyberwizard = { graph, engine }
