import '@comfyorg/litegraph/style.css'
import './ui/app.css'
import { LGraph, LGraphCanvas, LiteGraph } from '@comfyorg/litegraph'
import { Engine } from './core/engine'
import { installConnectionRules } from './core/registry'
import { deserializeGraph } from './core/serialize'
import { attachSubgraphSupport } from './core/subgraph'
import { welcomeTour } from './scenes/welcome-tour'
import { installCallLens } from './ui/call-lens'
import { installComputeMenu } from './ui/compute-menu'
import { installHiDPICanvas } from './ui/hidpi'
import { installInspect } from './ui/inspect'
import { installNodeLayout } from './ui/layout'
import { installLinkStyles } from './ui/links'
import { installNotes } from './ui/notes'
import { installWidgetInputMenu } from './ui/widget-inputs'
import { createPalette } from './ui/palette'
import { initialDocument, startAutosave, wirePersistence } from './ui/persistence'
import { installExamplesPicker } from './ui/scenes'
import { installHistory, wireHistoryButtons } from './ui/history'
import { wireStateTraceButton } from './ui/state-trace'
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
installComputeMenu(engine, () => canvas)
installWidgetInputMenu()

const doc = initialDocument()
if (doc) deserializeGraph(doc, graph)
else deserializeGraph(welcomeTour(), graph) // first boot: the annotated tour, not a bare demo

// LGraphCanvas starts its own render loop on construction (unless skip_render).
const canvas = new LGraphCanvas(canvasElement, graph, { autoresize: true })
// The library binds its keydown handler (Delete/Backspace, copy/paste,
// space-pan) to the CANVAS element — without a tabindex it can never hold
// keyboard focus, so none of those keys ever reached it.
canvasElement.tabIndex = 0
installHiDPICanvas(canvas)
applyTheme(canvas)
installLinkStyles(canvas, engine)
installNotes(canvas)
installInspect(engine)
if (doc?.view) {
  canvas.ds.offset = [...doc.view.offset]
  canvas.ds.scale = doc.view.scale
}

const paletteHost = document.querySelector<HTMLElement>('#palette')
if (paletteHost) createPalette(paletteHost, canvas, graph)

const history = installHistory(graph, canvas)
wirePersistence(graph, canvas, history)
startAutosave(graph, canvas)

const traceButton = document.querySelector<HTMLButtonElement>('#btn-trace')
if (traceButton) wireStateTraceButton(traceButton, engine)

const headerActions = document.querySelector<HTMLElement>('.header-actions')
if (headerActions) {
  installExamplesPicker(headerActions, graph, canvas, history)
  wireHistoryButtons(headerActions, history)
}

const newSubgraphButton = document.querySelector<HTMLButtonElement>('#btn-new-subgraph')
if (newSubgraphButton) wireNewSubgraphButton(newSubgraphButton, canvas, graph)
const breadcrumbBar = document.querySelector<HTMLElement>('#breadcrumb')
const breadcrumb = breadcrumbBar ? installBreadcrumb(breadcrumbBar, canvas, graph) : undefined
if (breadcrumb) installCallLens(engine, canvas, graph, breadcrumb)
const ioPanel = document.querySelector<HTMLElement>('#io-panel')
if (ioPanel) installIOPanel(ioPanel, canvas, graph)
installCollapse(canvas, graph)

window.addEventListener('resize', () => canvas.resize())

// Handy for poking at the engine from DevTools.
;(globalThis as Record<string, unknown>).cyberwizard = { graph, engine }
