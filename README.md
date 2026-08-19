# CyberWizard 🧙

A node-based data manipulation workbench — like [CyberChef](https://gchq.github.io/CyberChef/),
but operations are wired into a **graph** (via LiteGraph.js) instead of a linear recipe.

Fan out one input into parallel transforms, wire keys into crypto nodes as connections,
preview every intermediate value live, and collapse subgraphs into reusable custom nodes.

Fully client-side: your data never leaves the browser.

## Subgraphs — build your own nodes

Any graph fragment can become a reusable node with its own typed inputs and
outputs — a function, basically:

- **Create**: `+ Subgraph` in the header opens an empty definition; add typed
  inputs/outputs in the sidebar panel and build the interior. The breadcrumb
  bar (or `Esc`) takes you back up.
- **Collapse**: select nodes on the canvas, then right-click → *Collapse to
  Subgraph* (or `Ctrl/Cmd+G`). The cut edges become the new node's slots.
- **Reuse**: definitions appear in the palette under *Subgraphs* and can nest
  inside other subgraphs — including themselves (recursion is depth-limited
  and budget-capped, so a runaway definition shows a node error instead of
  freezing the page).
- **Share**: definitions embed in save files and share URLs — documents stay
  fully self-contained.

## Lists — functional pipelines

Lists are first-class values. The **Flow** category has the usual building
blocks (Pack, Get, Take/Drop, Reverse, Unique, Sort, Flatten, Zip, Concat,
Range), and three higher-order ops that apply a **subgraph** per element:

- **Map** — transform each element with a 1-in-1-out subgraph
- **Filter** — keep elements where a 1-in-1-out subgraph returns truthy
- **Fold** — reduce with a 2-in-1-out subgraph (`[acc, element] → acc`)

Pick the subgraph in the node's `fn` dropdown (create it first with
`+ Subgraph`). Nested lists work throughout: coercion recurses, previews
render nested structure, and Flatten peels one level at a time.

## Math, logic & conditionals — functional graphs

**Math** covers arithmetic (Add … Power, Min/Max, Floor/Ceil/Round) and
structural comparisons; **Logic** has the boolean combinators (And/Or/Not)
for composing conditions. **Flow** has two conditionals:

- **Select** — the eager ternary `cond ? then : else` on plain wired
  values. Both sides always compute.
- **If** — the lazy conditional: its branches are subgraphs (pick them in
  the `then`/`else` dropdowns) and only the taken one runs. This is what
  recursion terminates through — e.g. factorial is a definition whose If
  returns constant 1 when `n ≤ 1` and otherwise applies a branch subgraph
  containing `n × Fact(n − 1)`. With an eager node both sides would
  evaluate on every level, so recursion could never bottom out.

Recursion stays guarded: depth-limited and budget-capped, so a runaway
definition shows a node error instead of freezing the page.

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
