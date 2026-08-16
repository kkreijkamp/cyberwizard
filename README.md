# CyberWizard 🧙

A node-based data manipulation workbench — like [CyberChef](https://gchq.github.io/CyberChef/),
but operations are wired into a **graph** (via LiteGraph.js) instead of a linear recipe.

Fan out one input into parallel transforms, wire keys into crypto nodes as connections,
preview every intermediate value live, and collapse subgraphs into reusable custom nodes.

Fully client-side: your data never leaves the browser.

## Status

Early development — see [PLAN.md](PLAN.md) for architecture and roadmap.

## Dev

```sh
npm install
npm run dev
```

## Test

```sh
npm test
```
