import '@comfyorg/litegraph/style.css'
import './ui/app.css'
import { LGraphCanvas } from '@comfyorg/litegraph'
import { buildDemoGraph } from './demo/demo-graph'
import { applyTheme } from './ui/theme'

const canvasElement = document.querySelector<HTMLCanvasElement>('#graph')
if (!canvasElement) throw new Error('Missing #graph canvas element')

const graph = buildDemoGraph()

// LGraphCanvas starts its own render loop on construction (unless skip_render).
const canvas = new LGraphCanvas(canvasElement, graph, { autoresize: true })
applyTheme(canvas)

window.addEventListener('resize', () => canvas.resize())

graph.start()
