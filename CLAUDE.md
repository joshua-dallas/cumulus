# CLAUDE.md

Guidance for working in this repo. Keep it in sync when the architecture changes.

## What this is

`<cumulus-canvas>` is a custom HTML element that draws a generative cumulus cloud on a `<canvas>` in a hand-hatched style: the image is made of thousands of short, slightly wavy horizontal strokes whose colour encodes shade. A numeric `seed` fully determines the cloud's shape.

Vanilla JS (ES modules, no framework, no TypeScript). Vite builds the library (`vite.config.js`, ES format, two entries: `cumulus` and `define`). Tailwind is used only by the demo page. ESLint config exists but there is no lint script. There are no tests (`test/` is empty).

## Commands

- `npm run dev` – Vite dev server; open `/demo/` (demo imports `../src/define.js`).
- `npm run build` – library build to `dist/` (gitignored).
- `npx eslint src` – lint (no npm script yet).

## Layout

| File | Role |
| --- | --- |
| `src/index.js` | Exports the `Cumulus` class (no side effects). |
| `src/define.js` | Registers `cumulus-canvas` (side-effect entry, listed in `package.json` `sideEffects`). |
| `src/cumulus.js` | `Cumulus` custom element: DOM only. Shadow root + canvas, attribute parsing, `observedAttributes`, `ResizeObserver`, `IntersectionObserver`, `visibilitychange`, reduced-motion media query. Everything funnels into `rebuild()`. |
| `src/lib/cumulus-controller.js` | `CumulusController`: runs one cloud on one canvas. Builds builder + simulation + renderer, converts builder shapes into renderer layers (`drawFrame`), owns the rAF loop and mouse tracking. Created per rebuild, discarded with `destroy()`. |
| `src/lib/cloud-builder.js` | `CloudBuilder`: seeded, pure-geometry cloud model. No canvas access. |
| `src/lib/cloud-simulation.js` | `CloudSimulation`: moves cells/fractals over time (currently the mouse effect; `fractalSim` and `moveCloudCells` exist but are not called). Has its own PRNG. |
| `src/lib/hatched-renderer.js` | `HatchedRenderer`: turns layers into per-scanline segments and strokes them. |
| `src/lib/theme.js` | `defaultTheme` / `createTheme()`: colour palette, background/shadow settings and per-layer styles. |
| `src/lib/utils.js` | `mulberry32` PRNG, 1-D range maths, polygon edge extraction, `clamp`, `distanceBetweenPoints`. |
| `demo/` | Demo page + Tailwind stylesheet. |

## Data flow

```
attributes / resize / reduced-motion change
   └─► Cumulus.rebuild()  (batched via scheduleRebuild; destroys the old controller)
         └─► new CumulusController(canvas, config)
               ├─ CloudBuilder(width, height, numCells, seed)     geometry only, deterministic
               ├─ CloudSimulation(builder, seed)                  animation state, own PRNG
               ├─ HatchedRenderer(canvas, width, height, ...)     applyTheme(theme) → finaliseRenderer()
               ├─ drawFrame(): builder shapes ─► renderer.add*Layer() ─► renderer.draw()
               └─ rAF loop (only while animate && inView && pageVisible):
                    if simulation.step(cursor) moved something:
                       builder.updateFills(); clearCanvas(); renderer.clear(); drawFrame()
```

### CloudBuilder (generation, run once in the constructor, in this order)

1. `generateCells` – `numCells` circles at random polar positions inside a half-disc ("dome") whose radius derives from the canvas size. Radii are fractions (0.1–0.3) of the dome radius.
2. `matchBottomCell` – adds one cell on the opposite side of the centre line so the base is flat-ish.
3. `centreCells` – shifts all cells (and their `sim.baseLocation`) so the radius²-weighted centroid sits on the dome centre x.
4. `addSteppedChildCells` – each cell has 50% chance of getting 2 smaller children stepping outward, baselines aligned.
5. `addExtensionLines` – each cell gets `upperExtension`/`lowerExtension`: vertical lines through the cell centre used to build the interior fill.
6. `fillInnerGaps` – raises `upperExtension` where an outer/upper cell's lower extension would leave a vertical gap.
7. `createCloudInner` – traces the outline of the union of extension rectangles for each half (left/right of dome centre) into a right-angle polygon (`cloudInnerLeft/Right`; vertices carry `type: "upper"|"lower"` and `id`).
8. `fillCentreLineGaps` – finds spans on the centre line filled from only one side and adds half-dome `fillCircles`.
9. `addFractalsToCells` – per cell: 20 light fractals (mid-grey highlights, with `rightPadding` when lower-right) and, 60% of the time, 15 dark fractals (upper-left shading). Light fractals also get `sim` params for an elliptical grow/fall cycle (used only by the unused `fractalSim`).
10. `addFillCirclesToHorzontals` – random circles along long horizontal edges of the inner polygons → `horizontalFillCircles` (each stores `dx`, its offset from its `linkedCell`).
11. `sortBySize` – cells sorted largest-first so small cells draw on top; then `updateFills()` once more so the polygons match the sorted order.

**Cells are addressed by id, never by array index.** Ids are assigned in `addCell()` and stay valid after `sortBySize` re-orders `cells`. Use `builder.cellsById.get(id)` (a `Map`, O(1)). Fractals are grouped once at build time on the cell itself: `cell.lightFractals` / `cell.darkFractals` – do not `filter` a flat list per frame.

**Randomness:** one `mulberry32(seed)` stream (`this.random`) consumed in the order above. **Reordering steps or adding/removing `random()` calls changes every cloud for existing seeds.** Anything animated at runtime must use its own stream (`CloudSimulation.random`), never the builder's.

`updateFills()` recomputes everything derived from cell positions (`createCloudInner`, `fillCentreLineGaps`, horizontal fill circle x). It must be called after cells move, and only then. The controller does this only when `simulation.step()` reports a change.

### CloudSimulation

`step(cursor)` runs each stage and returns true if anything changed. Currently only `moveCellsWithMouse`: pushes cells horizontally out of `cursor` range (max shift 30px, eased back to `sim.baseLocation`). `cursor` is `{x, y}` or `null` (no cursor).

### HatchedRenderer (rendering)

Constructed as `(canvas, width, height, lineWidth, lineSpacing)`. Width/height are logical CSS pixels passed in; the renderer does not measure the DOM.

Core model: the canvas is divided into horizontal **lines** (`generateLines`, spacing = `lineWidth + lineSpacing`). Each line holds an ordered, non-overlapping list of **segments** `{startX, endX, layerId, isBackground, leftCoveredByLayer, rightCoveredByLayer}`.

- `addBackground` puts one full-width background segment on each line.
- `addCircleLayer` / `addRightAnglePolygonLayer` register a layer (config incl. `fill`, `key`, edge noise, padding, `lineWidth`, wave params) and add a segment to every line it crosses. `addSegment` paints over whatever is beneath: it binary-searches the sorted list and splices the new segment in (no re-sort), so **layer insertion order = z-order**. The `*CoveredByLayer` flags record which ends were trimmed by something on top.
- `draw` → `drawLine` → `drawSegment`: walks each segment in `DRAW_STEP` (2px) increments and issues one `stroke()` per step with its own colour, width and y-wiggle (line breaks skip the stroke). Left/right padding of neighbouring layers shrinks a segment's ends (suppressed in shadow).
- **Shadow diagonal**: a per-line x (`shadowDiagonalLocations`, from the theme's `shadowDiagonal`). Non-background strokes on the shadow side use `colours.dark2`. Computed once in `finaliseRenderer`.
- **Noise** is pre-generated per line (`initialiseNoise`) from a renderer-local PRNG (`seed = 10`, hardcoded). **Edge noise is cached by layer `key`** (`noise.layerEdge`: key → per-line left/right arrays), so a shape keeps its edge between frames even if layers are added/removed. Every layer should pass a stable `key` (`cell-4`, `light-fractal-4-7`, `fill-0`, ...); without one it falls back to the layer index.
- `baseYOffset` caches the default sine wave per line/step; layers with a custom `wavePeriod` compute `Math.sin` live.
- `applyTheme(theme)` must be called before `finaliseRenderer()` (noise depends on it). `colours` is the theme's object by reference, so mutating a colour in place restyles the next frame.
- `resize()` sets canvas pixel size from `width/height × devicePixelRatio` and scales the context. Setting `canvas.width` resets the context, so the renderer is created after sizing.

### Theme

`createTheme()` returns a deep copy of `defaultTheme`. Layer styles refer to colours by name (`fill: "dark2"`); `CumulusController.resolveLayerStyles()` resolves them every frame. Add new visual constants here rather than inline in the controller.

### Cumulus element

- Observed attributes (lower-case, as HTML lower-cases them): `width` (500), `height` (500), `numCells` (15), `seed` (5), `lineWidth` (1), `lineSpacing` (1.5). `seed="0"` is valid; non-numeric values fall back to the default; `numCells` is at least 1.
- Size: `width`/`height` attributes win; a missing dimension takes the element's CSS size (measured with the canvas collapsed so its old size isn't mistaken for the CSS size); otherwise the default. A `ResizeObserver` triggers a debounced rebuild when the measured size changes.
- Pause: `IntersectionObserver` (off-screen) and `visibilitychange` (hidden tab) call `controller.setInView / setPageVisible`; the loop is cancelled while either is false.
- `prefers-reduced-motion: reduce` → `animate: false`: the controller draws the finished cloud once, starts no loop and attaches no mouse listeners. A change of the preference rebuilds.
- `connectedCallback` sets up observers and builds; `disconnectedCallback` removes them and destroys the controller. The shadow root/canvas are created once and reused on reconnect.

## Known bugs / gotchas

- `cursor` is `null` when the mouse is off the canvas (fixed; it used to default to `{0,0}`).
- `generateFractalSimParams` compares relative `fractal.x` with absolute `cell.x` (`rightSide`); only matters for the unused fractal sim.
- Noise arrays have `ceil(width / DRAW_STEP)` entries but the last stroke at the right edge can index one past the end (`NaN` line width, ignored by canvas). Fixing it changes the PRNG stream for the renderer noise.
- Renderer seed is hardcoded (`10`) and independent of the element's `seed`.
- Horizontal fill circles move with their linked (outer) cell only; the neighbouring cell on the same edge can move independently.
- Stepped child cells do not follow their parent when it is pushed by the mouse.
- The `// TODO` comments in the source are the author's own backlog; grep for them.

## Conventions

- 2-space indent, double quotes, semicolons (Prettier-style). Match surrounding comment density.
- Builder = geometry only, simulation = motion only, renderer = drawing only, controller = glue, element = DOM/lifecycle.
- Deterministic output per seed is a feature: do not introduce `Math.random()` into generation, and keep `this.random()` call order in `CloudBuilder` stable.
- Do not make code changes beyond the task asked; the author works incrementally and reviews diffs.

## Testing

No test suite. Useful checks when changing the builder: dump `cells`, fractals, `fillCircles`, `horizontalFillCircles`, `cloudInnerLeft/Right` for a grid of seeds/sizes before and after, and diff them (the output must be identical unless a change is intended). Renderer `addSegment` was verified against the previous sort-based implementation with randomised inserts. For browser behaviour, headless Chrome driven over the DevTools protocol works (`--force-prefers-reduced-motion` for the reduced-motion path); `--virtual-time-budget` does not run animation frames reliably, so use real time.

## Planned work

See the Roadmap in `README.md`.
