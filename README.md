# graphviz-renderer

Render [Graphviz](https://graphviz.org) (DOT) graphs to safe, inline-ready SVG in Node, at
build time. One of five renderer libraries that share the
[render contract](http://192.168.188.68:3001/projects/markdown-renderers/wiki/Render_contract).

```sh
npm install github:Reonarudo/graphviz-renderer#v0.1.0
```

On npm 12 or later, a project installing git dependencies also needs `allow-git=root` in its
`.npmrc`. Nothing runs on install: `dist/` and the engine are committed.

## Use

```js
import { createRuntime } from '@reonarudo/graphviz-renderer';

const runtime = await createRuntime();
const result = runtime.render({ source: 'digraph { rankdir=LR; source -> parse -> render }' });
await runtime.dispose();
```

`render({ source })` takes the fence body. It is synchronous and returns one of:

| `status` | Fields | When |
| --- | --- | --- |
| `success` | `output`, `notes` | `output` is one `<svg class="graphviz" viewBox="…">` with no size, ready to inline; `notes` holds Graphviz's warnings as plain text |
| `failure` | `message`, `line?` | a Graphviz error (plain text, 1-based fence-relative line), a fence with no graph, or an exceeded limit |
| `timeout` | `budget` | the layout ran past `timeout` milliseconds |
| `unavailable` | `reason` | the engine could not start |

`render` throws only for programmer errors: input that is not `{ source: string }`, or a call
after `dispose()`. `createRuntime` rejects only for invalid options.

The layout engine is chosen inside the source, as in Graphviz itself: `layout=neato`. Every
engine in the build is available: `dot` (default), `neato`, `fdp`, `sfdp`, `circo`, `twopi`,
`osage` and `patchwork`.

### Runtime options

| Option | Default | |
| --- | --- | --- |
| `timeout` | `3000` | milliseconds per render |
| `startupTimeout` | `10000` | milliseconds per engine start, never charged to a render |
| `limits.sourceChars` | `64000` | fence body, in string length |
| `limits.outputBytes` | `4194304` | Graphviz's SVG, in characters before sanitizing and in UTF-8 bytes after |

Each must be a finite positive number. Limits can be raised or lowered, never disabled.

### Errors and notes

A syntax error's line is lifted out of Graphviz's sentence: `syntax error in line 2 near ';'`
becomes `{ message: "syntax error near ';'", line: 2 }`. Graphviz reports no columns.

On a success, warnings become `notes`, one per message; a located one reads `line N: …`. A
malformed HTML-like label is still drawn, and its error is a note too. Graphviz counts that
error's line inside the label, so it keeps Graphviz's own words (`mismatched tag in line 1`,
`in label of node a`) rather than being reported as a fence line. The excerpt of the label
Graphviz adds is dropped.

### What the consumer does

The consumer does everything presentational:

- wraps the SVG: figure, caption, alt text, the author's class and alignment;
- escapes `message`, `notes` and `reason` when writing them into HTML;
- creates one runtime per build or preview, and disposes of it;
- caches, if it wants to.

Graphs are drawn as Graphviz draws them, usually on a white background with the author's
colours; any dark-mode treatment is the consumer's.

## How the safety guarantees are met

Fence source is treated as untrusted.

- **Bounded time.** Graphviz runs in a worker thread that `render` blocks on with
  `Atomics.wait`. Layout and sanitizing both count against the budget. A render past its
  budget terminates the worker. The next render starts a fresh one and waits for it under
  `startupTimeout` before its own budget begins.
- **Bounded memory.** The engine's wasm heap is capped at 2 GiB by the viz build, and the
  worker's JavaScript heap at 256 MB — twice the extension's, because parsing an output at the
  4 MiB limit takes about 200 MB. An engine abort, such as running out of memory, is a
  `failure` and the worker is discarded.
- **Bounded input and output.** `limits.sourceChars` is checked before the engine sees the
  source. `limits.outputBytes` is checked on Graphviz's raw SVG before it is parsed, so a huge
  layout fails on the limit instead of spending the budget in the parser, and again on the
  sanitized SVG, which namespacing can make slightly larger.
- **No reach outside.** The engine is Graphviz compiled to wasm with an in-memory filesystem
  that holds no files: `image=`, `shapefile=` and `<IMG SRC>` find nothing, and no `<image>` is
  ever emitted. A note about a missing file names only the path the author wrote.
- **Safe to inline.** Every SVG is parsed as XML and rebuilt from an allowlist. It keeps
  passive geometry, text, gradients and Graphviz's classes. `href` is kept only as `#id`, and
  `url()` only as `url(#id)`; `style` survives only as a gradient stop's colour. No value may
  carry `javascript:`, `data:` or a network URL, with one exception: a link (`URL`, `href`) to
  an `http:`, `https:` or `mailto:` address stays an `<a>` that a reader can follow, with its
  tooltip unless the tooltip itself names a URL. Any other link is removed and its content
  kept. Comments and anything that is not well-formed SVG are refused.
- **Isolated.** Every `id`, `#id` reference and `url(#id)` is namespaced with
  `graphviz-<8 hex>-`, taken from the sha256 of the source. Graphviz names nodes, edges and
  gradients the same way in every graph; with the prefix, two graphs on one page cannot address
  each other. Graphviz emits no `<style>`.
- **Plain text out.** `message` and `notes` are Graphviz's text with its source excerpts
  dropped.

Output is deterministic: the same source yields byte-identical SVG in any runtime. Graphviz
keeps state from one render to the next (gradient ids count up), so after every render the
worker restores the engine's memory to its state when it was ready.

## The engine

`vendor/viz/viz.cjs` is `dist/viz.cjs` from the npm package `@viz-js/viz` 3.30.0, which
embeds the unmodified Graphviz 16.0.0 release compiled to wasm; `provenance.json` is that
package's SLSA build provenance. To regenerate both:

```sh
scripts/vendor-viz.sh
```

The script downloads the package, refuses it unless its npm integrity matches the pin, copies
the two files and rewrites `SHA256SUMS`. To move to another release, change the version and
integrity at the top of the script and the expectations in `test/vendor.test.ts`. CI never
runs it; it only verifies the committed files against `SHA256SUMS`.

## Development

```sh
npm ci
npm run lint
npm run compile        # tsc → dist/, which is committed; CI fails if it is stale
npm test               # tests import dist/, so compile first
npm run test:packed    # npm pack, install into a temp project, render one graph
```

Requires Node 22 or later (`.nvmrc` pins the version used in development).
