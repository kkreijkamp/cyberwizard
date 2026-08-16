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
| No conditionals or iteration | Switch/merge routing, list ops (map/filter/unique/sort) |

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
- **Reactive dataflow**: editing a param or input marks the node dirty; dirtiness
  propagates downstream; affected subgraph re-evaluates in topological order
- **Async-aware**: crypto/compression ops are async; engine awaits them and batches
  UI updates
- **Cancellation**: each run carries a generation token — a stale run (user edited
  mid-flight) discards its result instead of overwriting newer state
- **Output caching**: unchanged upstream branches are never re-executed
- **Later**: Web Worker execution for heavy ops; streaming for large files

### 4. Serialization (`core/serialize.ts`)
- Versioned JSON schema (`{ version, nodes, links, pan/zoom }`)
- Save/load to file, autosave to `localStorage`
- **Share via URL**: graph JSON → deflate → base64url → location hash (CyberChef
  does exactly this for recipes)

## UI

- LiteGraph canvas (pan/zoom/multi-select/box-select come free)
- **Node palette**: categorized, fuzzy-searchable, double-click or drag to spawn;
  dragging from a slot filters palette to type-compatible nodes
- **Live previews**: each node shows a truncated render of its current output
  (text snippet / hex dump / image / JSON summary); click to expand
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
- List ops: Map (apply subgraph per element), Filter, Unique, Sort, Zip, Flatten
- Control: Switch (route by condition), Merge, Gate
- **Subgraphs**: select nodes → collapse into a composite node with exposed slots
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
| M5 | Power features | Subgraphs, list ops, switch/merge |
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
