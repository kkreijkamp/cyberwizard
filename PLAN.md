# CyberWizard — Plan

A node-based data manipulation workbench: CyberChef's operation library, but instead
of a linear recipe, data flows through a **directed graph** of operations built on
LiteGraph.js. Fully client-side — data never leaves the browser.

## Why node-based beats linear recipes

| CyberChef (linear) | CyberWizard (graph) |
|---|---|
| One input, one output | Multiple inputs/outputs, anywhere in the graph |
| Ops run in fixed sequence | Fan-out: feed one value into many parallel transforms |
| Key/params must be retyped per op | Multi-input ops: wire a key node into XOR / AES / HMAC |
| Intermediate values hidden | Live preview badge on every node |
| Recipe = flat op list | Subgraphs: collapse a graph into a reusable custom node |
| No conditionals or iteration | Lazy conditionals, recursion via self-instancing subgraphs, list ops (map/filter/fold…) |

## Tech stack

- **TypeScript + Vite** — fast dev loop, strict typing for the node system
- **LiteGraph** — `@comfyorg/litegraph@0.17.2`, **pinned exact**. Finding
  (2026-08-17): the package is deprecated on npm — ComfyOrg merged the fork into
  [ComfyUI_frontend](https://github.com/Comfy-Org/ComfyUI_frontend)
  (`src/lib/litegraph`) and stopped publishing. v0.17.2 is the final
  self-contained published build (zero-dep ESM + full types); the monorepo source
  is coupled to ComfyUI app code (i18n/stores/utils imports across 71 files), so
  vendoring was rejected for now. All litegraph access goes through our own core
  layer, keeping a future migration (vendored fork / community continuation)
  cheap. The original `jagenjo/litegraph.js` remains off-limits (unmaintained).
- **pako** — gzip/zlib/deflate
- **WebCrypto API** — AES, RSA, SHA family, HMAC (native, no dependency)
- **hash-wasm** — MD5 and other hashes WebCrypto doesn't cover
- **Vitest** — unit tests for ops, coercion, and the engine

No backend. Static hosting (GitHub Pages) like CyberChef.

## Core architecture

### 1. Type system (`core/types.ts`)
- Canonical currency type: **`bytes`** (`Uint8Array`) — every value can coerce to/from it
- Other types: `string`, `number`, `boolean`, `json`, `list<T>`
- **Coercion layer** (CyberChef's "Dish" idea): typed slots declare what they accept;
  incompatible connections auto-coerce where sensible (string ↔ bytes via UTF-8,
  json → string via stringify, anything → string via repr). Coercion is explicit in
  the edge so users can see when it happens.

### 2. Node definitions (`core/registry.ts`)
Declarative spec → auto-generated LiteGraph node class. Adding an operation is one
small file, no LiteGraph boilerplate:

```ts
defineNode({
  title: "Base64 Encode",
  category: "Encoding",
  inputs:  [{ name: "data", type: "bytes" }],
  outputs: [{ name: "text", type: "string" }],
  params:  [{ name: "alphabet", type: "enum", options: ["standard", "url-safe"] }],
  async run({ data }, { alphabet }) { /* ... */ },
})
```

The registry drives the node palette, search, and slot-type compatibility checks.

### 3. Execution engine (`core/engine.ts`)
- **Demand-driven (pull)**: sinks — nodes with no declared outputs (Preview,
  Download) — pull their inputs; evaluation recurses upstream and runs only
  what a sink actually demands. Undemanded nodes rest: disconnected branches
  never run, unwired cycles stay inert (a demanded cycle is diagnosed by
  re-entrant pull), dead interior branches can't fail an instance.
- **Incremental**: editing a param or connection marks the node dirty;
  dirtiness propagates downstream. Pulling re-runs only dirty nodes — clean
  cached outputs are memo hits.
- **Lazy slots**: a def may declare `lazyInputs` (Select's then/else); the op
  pulls them via `ctx.pull`, which is why recursion terminates through an
  ordinary value-level conditional.
- **Async-aware**: crypto/compression ops are async; the engine awaits them
  and batches UI updates
- **Cancellation**: each run carries a generation token — a stale run (user
  edited mid-flight) discards its result instead of overwriting newer state
- **Later**: Web Worker execution for heavy ops; streaming for large files

### 4. Serialization (`core/serialize.ts`)
- Versioned JSON schema (`{ version, nodes, links, subgraphs?, pan/zoom }`)
- Save/load to file, autosave to `localStorage`
- **Share via URL**: graph JSON → deflate → base64url → location hash (CyberChef
  does exactly this for recipes)
- **Subgraph definitions** (v2): stored once, flat, by UUID under `subgraphs`;
  instances reference the definition UUID as their node type, so recursive and
  mutually-recursive definitions never nest infinitely. v1 documents load
  unchanged (they predate subgraphs — accepting them is the whole migration).

### 5. Subgraphs (`core/subgraph.ts`, `core/collapse.ts`)
- Definitions are named graph fragments with declared, typed inputs/outputs —
  "custom nodes as functions". Instances are LiteGraph `SubgraphNode`s created
  through a per-definition factory shim (0.17.2 standalone can't instantiate
  them unaided — its `createNode(uuid)` and `convertToSubgraph` are broken
  without the ComfyUI app layer).
- **Call semantics, not flattening**: an instance is one node in its parent's
  topological order; running it evaluates the definition's interior in a
  per-instance state store with inputs bound at the boundary panels. Unchanged
  instances never re-run; interior edits re-run only the affected branch
  (seeded dirty propagation across the boundary).
- **Lexical scope**: definitions are stored flat on the root but may be scoped
  to a parent definition — visible (palette, pickers, name resolution) only
  inside the parent's subtree, like local functions. Scope is a visibility
  property, never containment, so recursion and serialization are unaffected;
  definitions move between scopes (`reScopeDef`), and deleting a definition
  cascades through its scope subtree.
- **Recursion-compatible**: a definition may contain an instance of itself.
  Evaluation is guarded by a depth limit (64) and a per-call-tree evaluation
  budget (1000), surfacing as ordinary node errors — never a stack overflow
  or page freeze.
- **Call trace + lens**: every instance call from a root-level run downward is
  recorded (transient recursive calls included, capped at the eval budget;
  apply() subtrees excluded) with its boundary inputs. While a definition is
  open, the *call lens* picks which recorded call drives badges/inspect:
  double-click an instance to descend into its call, Esc pops back out, and a
  dropdown next to the breadcrumb jumps to any recorded call directly.
- Authoring: create empty + edit inside (typed IO panel, breadcrumb
  navigation), or select nodes → collapse (cut edges become the new node's
  slots, grouped per outside endpoint with names/types preserved).

## UI

- LiteGraph canvas (pan/zoom/multi-select/box-select come free)
- **Node palette**: categorized, fuzzy-searchable, double-click or drag to spawn;
  dragging from a slot filters palette to type-compatible nodes
- **Live previews**: each node shows a truncated render of its current output
  (text snippet / hex dump / image / JSON summary); click to expand
- **State trace**: one-click JSON dump of the full live state — every node's
  values, errors, and the whole recorded call tree (the debugging counterpart
  to Save, which serializes structure only)
- Input nodes: text paste, file drop, hex editor
- Output nodes: text/hex/JSON/image preview, file download
- Dark theme, cyberpunk accent (it is called CyberWizard)

## Node library roadmap

**Phase 1 — MVP ops**
- IO: Text Input, File Input, Constant, Preview, Download
- Encoding: Base64 (std/url), Base32, Base58, Hex, URL-encode, HTML entities, Binary
- Hashing: MD5, SHA-1, SHA-256/512, HMAC (key as input slot)
- Text: Find/Replace, Regex Extract/Match, Case ops, Trim, Split, Join, Length
- Logic: XOR (key slot), ROT13, Reverse
- Data: JSON Parse/Stringify, JSONPath Pick, To/From Bytes

**Phase 2 — crypto & formats**
- AES-GCM/CBC, RSA (WebCrypto), key-generate nodes
- gzip/deflate (pako), CRC32, checksums
- Number base convert, timestamps (unix ↔ ISO), JWT decode, UUID gen
- CSV ↔ JSON, YAML, XML pretty/minify

**Phase 3 — flow & power features**
- ~~List ops: Map (apply subgraph per element), Filter, Unique, Sort, Zip, Flatten~~ **(done, M5** — plus Fold, Pack/Get/Take/Drop/Reverse/Concat/Range; nested lists recurse through coercion and repr)
- ~~Math & logic: arithmetic, structural comparisons, boolean combinators~~ **(done, M5)**
- ~~Control: Select + If (both lazy — the untaken branch never evaluates, so recursion terminates through either)~~ **(done, M5)** — Switch (route by condition), Merge, Gate still open
- ~~**Subgraphs**: select nodes → collapse into a composite node with exposed slots~~ **(done, M5)**
- Diff/Compare node, frequency analysis, entropy meter

**Phase 4 — extended**
- HTTP Request node (CORS-permitting), sandboxed JS Function node
- Worker-based execution, large-file streaming
- Graph templates gallery (e.g. "analyze a JWT", "peel a multi-layer obfuscated string")

## Repo layout

```
cyberwizard/
├── PLAN.md  README.md  package.json  tsconfig.json  vite.config.ts
├── index.html
├── src/
│   ├── main.ts
│   ├── core/        types.ts  registry.ts  engine.ts  serialize.ts  coerce.ts
│   ├── nodes/       io/  encoding/  hashing/  text/  logic/  data/  crypto/  flow/
│   ├── ui/          palette.ts  theme.ts  preview.ts  panels.ts
│   └── workers/     (phase 3+)
└── tests/           ops/  engine/  coerce/
```

## Milestones

| # | Goal | Done when |
|---|------|-----------|
| M0 | Scaffold | Vite+TS+LiteGraph boots, one hardcoded demo graph renders |
| M1 | Core | Registry + engine + coercion pass unit tests (incl. diamond graph, dirty propagation, async, stale-run cancellation) |
| M2 | MVP app | Phase-1 ops, palette w/ search, live previews — genuinely usable |
| M3 | Persistence | Save/load/autosave/URL-share work, schema versioned |
| M4 | Phase-2 ops | Crypto, compression, formats |
| M5 | Power features | ~~Subgraphs~~ (done), ~~list ops~~ (done), ~~math/logic/conditionals~~ (done), ~~demand-driven engine~~ (done), switch/merge |
| M6 | Ship | README+docs, graph templates, deployed to GitHub Pages |

## Testing strategy
- Every op gets unit tests with known vectors (RFC test vectors where they exist)
- Engine tests: topological order, diamond fan-in/fan-out, dirty-propagation
  minimality, async cancellation, coercion matrix
- Serialization round-trip tests across schema versions

## Explicit non-goals (v1)
- No backend / accounts / cloud sync
- No collaboration features
- No mobile-optimized UI (desktop-first, like CyberChef)
