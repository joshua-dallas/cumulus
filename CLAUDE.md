# CLAUDE.md

Guidance for working in this repo. Keep it in sync when the architecture changes.

## What this is

`<cumulus-canvas>` is a custom HTML element that draws a generative cumulus cloud on a `<canvas>` in a hand-hatched style: the image is made of thousands of short, slightly wavy horizontal strokes whose colour encodes shade. A numeric `seed` fully determines the cloud's shape.

Vanilla JS (ES modules, no framework, no TypeScript). Vite builds the library (`vite.config.js`, ES format, two entries: `cumulus` and `define`). Tailwind is used only by the demo page. ESLint is configured (`npm run lint`). Tests are in `test/` (see Testing).

## Commands

- `npm run dev` – Vite dev server; open `/demo/` (demo imports `../src/define.js`).
- `npm run build` – library build to `dist/` (gitignored).
- `npm run lint` – ESLint over `src` and `test`.
- `npm test` – unit tests (Node's built-in runner, no DOM needed).

## Layout

| File | Role |
| --- | --- |
| `src/index.js` | Exports the `Cumulus` class (no side effects). |
| `src/define.js` | Registers `cumulus-canvas` (side-effect entry, listed in `package.json` `sideEffects`). |
| `src/cumulus.js` | `Cumulus` custom element: DOM only. Shadow root + canvas, attribute parsing, `observedAttributes`, `ResizeObserver`, `IntersectionObserver`, `visibilitychange`, reduced-motion media query. Everything funnels into `rebuild()`, which tells its host to build. |
| `src/lib/cumulus-host.js` | `WorkerHost` (transfers the canvas to a worker as an `OffscreenCanvas`, forwards mouse positions, sets cursor and fires seed changes from the worker's replies) and `MainThreadHost` (fallback, runs a `CumulusController` directly). Same methods: `build(config)`, `setInView`, `setPageVisible`, `setSunset`, `setShadowDiagonal`, `seed`, `destroy`. |
| `src/lib/cumulus-worker.js` | Worker entry: owns the `OffscreenCanvas` and one `CumulusController`; receives messages from `WorkerHost`. |
| `src/lib/cumulus-controller.js` | `CumulusController`: runs one cloud on one canvas. Builds builder + simulation + renderer, converts builder shapes into renderer layers (`drawFrame`), owns the rAF loop, mouse tracking, and the grow/shrink/click-to-regenerate animation. Created per rebuild, discarded with `destroy()`. |
| `src/lib/easing.js` | `easeOutCubic`, `easeInOutCubic`, `clamp01`. |
| `src/lib/cloud-builder.js` | `CloudBuilder`: seeded, pure-geometry cloud model. No canvas access. |
| `src/lib/cloud-simulation.js` | `CloudSimulation`: moves cells/fractals over time (currently the mouse effect; `fractalSim` and `moveCloudCells` exist but are not called). Has its own PRNG. |
| `src/lib/hatched-renderer.js` | `HatchedRenderer`: turns layers into per-scanline segments and strokes them. |
| `src/lib/theme.js` | `defaultTheme` / `createTheme()`: colour palette, sky (top/bottom colour), shadow, cloud shape settings, animation, mouse interaction and per-layer styles. Also the sunset themes and `blendThemes` / `themeAtProgress`. |
| `src/lib/utils.js` | `mulberry32` PRNG, `perlinNoise1D`, 1-D range maths, polygon edge extraction, `clamp`, `distanceBetweenPoints`. |
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

### Worker

The element creates a `WorkerHost` when `Worker`, `OffscreenCanvas` and `transferControlToOffscreen` exist, else a `MainThreadHost`. A canvas can be transferred only once, so the worker host owns its canvas for good: a rebuild sends `build` (the worker destroys the old controller and makes a new one on the same `OffscreenCanvas`), and `disconnectedCallback` terminates the worker and discards the canvas (a new one is made on reconnect). Config must be structured-cloneable, so `onSeedChange` stays on the main thread (the worker sends `seedchange`). In a worker the controller runs with `listenToCanvas: false` and `onCursorChange`, and the host calls `pointerMove/pointerLeave/pointerClick` from forwarded events (positions in canvas px); the renderer takes `pixelRatio` from config and skips `canvas.style` (the host sets the style size). Vite bundles the worker through the `new Worker(new URL(...))` in `cumulus-host.js`. Not covered by tests (needs a browser); checked by hand in headless Chrome over the DevTools protocol.

### CloudBuilder (generation, run once in the constructor, in this order)

1. `generateCells` – `numCells` circles at random polar positions inside a half-disc ("dome") whose radius derives from the canvas size. Radii are fractions (0.1–0.3) of the dome radius.
2. `matchBottomCell` – adds one cell on the opposite side of the centre line so the base is flat-ish.
3. `centreCells` – shifts all cells (and their `sim.baseLocation`) so the middle between the leftmost and rightmost cell edges sits on the dome centre x (regardless of cell size). It runs a second time after `addSteppedChildCells`, so the children count too (the first run decides which side each cell is on).
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

### Grow, shrink and regenerate (CumulusController)

- The controller has a `scale` (0 to 1) and a `phase` (`idle`, `growing`, `shrinking`). Growing and shrinking scale the *drawn* cloud about the middle of its base (`anchor`, via `scaleX`/`scaleY`); the builder's cloud is never changed, so a seed gives the same cloud at every size. Cells, fills (circles and polygon vertices) scale together. Pixel sizes (edge noise, padding) are scaled by the same factor in `scaleStyles`, or they would swallow a small cloud.
- By default fractals grow with the cells: `fractalScale()` equals `scale`. With `theme.animation.fractalLag = true` they lag the bodies: 0 until `scale` reaches `theme.animation.fractalStart`, then easing in. Their offsets from the cell and their radii use it. At `scale >= 1` it is exactly 1, so a finished cloud is identical to a cloud drawn without animation (there is a test for that).
- Timing comes from `config.now()` (default `performance.now`) in `tick`, with each frame capped at 100ms so a paused tab does not jump to the end. Durations are in `theme.animation`. Grow uses `easeOutCubic`; shrink uses `easeInOutCubic`.
- `growIn` plays once, from the constructor. `regenerate(seed)` starts a shrink (from the current scale, so clicking mid-grow works); when it reaches 0 the controller calls `replaceCloud` (`buildCloud` with the new seed, then `config.onSeedChange(seed)`) and grows. Clicks during a shrink are ignored. The renderer is reused, so edge-noise values are kept per layer key.
- Click and hover (pointer cursor) hit-test the cells and the fill (fill circles and the inner polygons) at their current scale. Without `animate` a click replaces the cloud immediately.
- The edge-noise cache stores the unit random value and multiplies by the (scaled) range each use, so noise generated while the cloud is small is right at full size.
- TODO in the source and README: morph from the old cloud to the new one without shrinking first.

### CloudSimulation (the mouse as a force)

`step(cursor, dt)` (dt in ms) returns true if the cloud moved enough to redraw. Settings are `theme.interaction` (all constants live there, with comments). The controller only passes a cursor once the cloud has finished growing, and calls `resetCursor()` when the loop restarts.

- **Bodies.** Each cell has a mass (`(radius / (0.2 × dome radius)) ^ massExponent`), a velocity and an offset from `sim.baseLocation`. Cell positions (`cell.x`, `cell.y`) are the truth; physics runs in sub-steps of at most 8ms.
- **Mouse.** The cursor's velocity is measured from its movement since the last frame (so a fast stroke is a swept segment: the closest point of the segment to each cell is used and a stroke cannot skip a cell), limited by `maxSpeed` and smoothed by `speedSmoothing`. Strokes slower than `minSpeed` do nothing, so a resting mouse pushes nothing. A cell within `radius + handRadius` of the stroke is pushed along it, plus `parting` of the push directly away from the stroke. Force = `strength * speed * (speed / referenceSpeed)^(speedExponent - 1)` times a smooth falloff with distance. **`speedExponent` must be 2 (quadratic, like drag in water):** at 1 a faster stroke pushes harder for proportionally less time, so the cell moves the same distance whatever the speed. The vertical share of the force is scaled by `verticalStrength`.
- **Return.** A critically damped spring (`returnTime`, `dampingRatio`) with the same stiffness for every cell, so heavy cells accelerate less and return more slowly. It stiffens near `maxOffsetX/Y`.
- **Cohesion.** Cells that overlap at rest are neighbours (`neighbours`, weighted by overlap depth) and are tied by springs on their offsets (`neighbourStiffness`), so a pushed cell tugs its neighbours. `maxRelativeOffset` is an optional hard limit on neighbours' relative offsets; it is **off (Infinity)** because it made no measurable difference to tearing beyond the springs.
- **Walls.** Each cell stays on its side of the dome centre line (fills are built per side), inside the canvas border, and within the maximum offset. A cell that meets a wall stops moving into it.
- **Rest.** When every cell is slow and within 0.15px of its start the whole cloud snaps exactly back (`settleAndReport`), and `isSettled()` lets `step` skip the physics. Moves under 0.1px since the last report are not reported, so the slow tail does not redraw every frame.
- The old sideways push (`moveCellsWithMouse`, `MAX_SHIFT` etc.) is kept, unchanged and tested, but not called by `step()`.

**Fills and vertical movement.** Moving cells tears the fills (a pocket of sky opens inside the cloud) because the fill polygons are built from the cells' relative positions once at rest (`fillInnerGaps` runs only at build). Findings from measuring this (see `test/fill-tears.test.js`): fill edges stay hidden behind their cell because the fill rectangles move rigidly with their cells; spring cohesion cuts tearing a lot; offset limits, stiffer springs and the hard relative limit made no difference; vertical force is the main cause, and `verticalStrength` 0.2 tears no more than sideways-only while 0.3 and up gives large pockets on some seeds. If more vertical movement is wanted, the principled fix is a per-scanline fill derived from the cells each frame (not done: it changes how fills are generated, and the builder's `random()` order must stay stable). When measuring tearing, count only **enclosed pockets** of at least 30px: metrics that compare slits or compare pixel by pixel with the rest cloud measure 1px rasterisation noise and rate a uniform shift of the whole cloud as tearing.

### HatchedRenderer (rendering)

Constructed as `(canvas, width, height, lineWidth, lineSpacing)`. Width/height are logical CSS pixels passed in; the renderer does not measure the DOM.

Core model: the canvas is divided into horizontal **lines** (`generateLines`, spacing = `lineWidth + lineSpacing`). Each line holds an ordered, non-overlapping list of **segments** `{startX, endX, layerId, isBackground, isGap, under?}`.

- `addBackground` puts one full-width background segment on each line.
- `addCircleLayer` / `addRightAnglePolygonLayer` register a layer (config incl. `fill`, `key`, edge noise, padding, `lineWidth`, wave params) and add a segment to every line it crosses. `addSegment` paints over whatever is beneath: it binary-searches the sorted list and splices the new segment in (no re-sort), so **layer insertion order = z-order**.
- `draw` → `drawLine` → `drawSegment`: walks each segment in `DRAW_STEP` (2px) increments and issues one `stroke()` per step with its own colour, width and y-wiggle (line breaks skip the stroke). Gap segments (padding, see below) are not drawn; `drawSegmentRange` handles the shadow case.
- **Padding is part of the layer.** `addLayerSegment` (used by both `add*Layer` methods) adds the layer's segment *and* its padding to each line: `leftPadding` / `rightPadding` become **gap segments** (`isGap: true`, same `layerId`) next to the layer's edges, clipped to the line. A gap is inserted at the layer's place in the order, clearing whatever is underneath, and later layers paint over it like anything else. So padding stays visible even when the layer it belongs to is covered, and a gap is as wide as the padding however narrow the segments it clears. Gaps are never stroked.
- **Gaps and shadow:** there is no padding in shadow. A gap records what it cleared in `under` (clipped copies, taken in `addSegment` when the gap is inserted; the remainders of a split gap share it), and `drawSegmentRange` draws `under` instead of the gap for the part of the gap in shadow (`getShadowRange`, evaluated at draw time because the shadow can move). Anything that creates segments must keep `under` correct for gaps.
- **Shadow diagonal**: a per-line x (`shadowDiagonalLocations`, from the theme's `shadowDiagonal`). Non-background strokes on the shadow side use `colours.dark2`. Computed once in `finaliseRenderer`.
- **Noise** is pre-generated per line (`initialiseNoise`) from a renderer-local PRNG (`seed = 10`, hardcoded). **Line width noise is 1-D Perlin noise** (`perlinNoise1D`: `LINE_WIDTH_NOISE_NODES` nodes along each line, scaled by `LINE_WIDTH_NOISE_RANGE`), so the width drifts like a pen; it uses its own PRNG stream (`seed + 1`) so changing the node count does not change the other noise. The top and bottom lines also get a random number of longer line breaks (`addEdgeLineBreaks`, `EDGE_LINE_BREAK*` constants), from a third stream (`seed + 2`). Perlin rarely reaches its maximum, so at the same range it is about half as strong as the old uniform noise (std dev 0.04 vs 0.09); raise the range to compensate. The other noise (y offset, lightness, line breaks, edge) is still uniform random. **Edge noise is cached by layer `key`** (`noise.layerEdge`: key → per-line left/right arrays), so a shape keeps its edge between frames even if layers are added/removed. Every layer should pass a stable `key` (`cell-4`, `light-fractal-4-7`, `fill-0`, ...); without one it falls back to the layer index.
- `baseYOffset` caches the default sine wave per line/step; layers with a custom `wavePeriod` compute `Math.sin` live.
- `applyTheme(theme)` must be called before `finaliseRenderer()` (noise depends on it). `colours` is the theme's object by reference, so mutating a colour in place restyles the next frame.
- `resize()` sets canvas pixel size from `width/height × devicePixelRatio` and scales the context. Setting `canvas.width` resets the context, so the renderer is created after sizing.

### Theme

`createTheme()` returns a deep copy of `defaultTheme`. Layer styles refer to colours by name (`fill: "dark2"`); `CumulusController.resolveLayerStyles()` resolves them every frame. Add new visual constants here rather than inline in the controller.

- **Paper.** The canvas is always cleared to see-through (`clearCanvas` is a `clearRect`), so the **spaces between lines** and the **line breaks** show whatever is behind the canvas on the page. `theme.background.paper` (white by default; unset means none) is the colour of the **padding gaps** inside a line: `drawSegmentRange` draws a gap segment as an ordinary stroked segment in the paper colour (no lightness noise, `getStrokeColour`), except the part in shadow, which draws what the gap cleared instead. It follows the owning layer's line width and wave.
- **Sky.** `theme.background = { borderNoise, top, bottom, paper }`. `top` is `{hue, sat, light}`; `bottom` is optional and, if unset, the whole sky is `top`. The renderer gives each line its own colour (`backgroundColours`, mixed from top to bottom with `mixColours`, hue the short way round the wheel). `colours.background` no longer exists.
- **Cloud.** `theme.cloud` is passed to `CloudBuilder` as its options (`this.options`). `minBaseWidth` (default 1) is the least distance between the middles of the two cells at the base, in dome radii; `matchBottomCell` moves the new cell further out if needed and never changes the `random()` calls (with `minBaseWidth: 0` the cloud is exactly the one built before it existed: there is a test). `builder.bottomCellIds` holds the two cells. Changing it changes existing seeds.
- **Mouse.** `theme.interaction.enabled` switches the mouse force on; it is off. The controller only listens to the mouse if `regenerateOnClick` or the force is on.

### Sunset and theme transitions

- **Themes.** `createSunsetTheme(base)` is a copy of the theme with only the sky top colour (orange, hue 20 so the blue-to-orange fade goes through purple, not green) and the shadow angle (90°) changed. `createSunsetKeyframes(base)` returns `[day, dusk, sunset]`: dusk is a blue top with an orange bottom and the shadow half way.
- **Blending.** `blendThemes(a, b, t)` mixes only `BLENDED_SECTIONS` (`colours`, `background`, `shadowDiagonal`): numbers are interpolated, `{hue,sat,light}` colours go through `mixColours`, a sky with no bottom blends as if its bottom were its top, anything else switches at the half way point. `themeAtProgress(keyframes, progress)` places the keyframes evenly along 0 to 1.
- **Transition function.** `controller.transitionTheme(keyframes, from, to, duration)` animates `themeProgress` from `from` to `to` over `duration` ms with `easeInOutCubic`, on the frame clock (so it pauses with the loop and does not jump after a pause). Each frame `applyThemeProgress` writes the blended sections into **the same `controller.theme` object** (so references to `theme.interaction`, `animation` and `layers` stay valid), calls `renderer.updateTheme(theme)` and the frame redraws. Without animation (reduced motion) or with no time it applies at once.
- **Sunset toggle.** `controller.setSunset(on, duration)` calls `transitionTheme` with the sunset keyframes from the current progress to 1 or 0, taking `duration` times the distance left (so reversing part way goes straight back without passing through dusk). Config `sunset: true` starts at 1 instantly. Keyframe 0 is a clone of the day theme, not the live theme.
- **Shadow origin.** The edge is measured from the dome (`builder.dome`, given to the renderer with `setDome` before `applyTheme`), not the canvas: it passes through `(dome.x + xOriginOffset * dome.radius, dome.y)` at `angle` from the horizontal, so the shadow is the same on the cloud for any canvas shape. The theme's -0.2375 (day) and 0.231 (sunset) reproduce the old 0.75 and 0.64 of the width on the demo's 600 x 400 canvas.
- **Renderer.** `applyTheme` (once, before `finaliseRenderer`: it sets the border and shadow-edge noise) calls `updateTheme`, which can be called any time after: it sets colours, sky and shadow angle/origin and recalculates the sky colours and `shadowDiagonalLocations` (cheap) without remaking noise.
- **Shadow edge.** `controller.setShadowDiagonal({ day: { angle, xOriginOffset }, sunset: { ... } })` (radians; `xOriginOffset` is where the edge meets the base of the dome, from the dome centre in dome radii, negative is left; anything left out is unchanged) edits the day stage and the sunset options, rebuilds the keyframes (dusk is half way between, for both) and redraws; a transition in progress carries on to the new keyframes. `config.shadowDiagonal` sets them at creation, and the element keeps what was set through rebuilds. `createSunsetTheme/Keyframes` take `{ shadowAngle, shadowXOriginOffset }`. `themeAtProgress` returns a keyframe itself when exactly on it (so the day has no bottom colour), and the controller copies the blended sections into the live theme.
- **Theme values.** `controller.setThemeValues({ colours, layers })` (and `element.setThemeValues`, which keeps them through rebuilds and sends them to the worker as `themevalues`) merges values into the theme with `mergeThemeValues` and redraws. Colours go into the day keyframe so they last through a sunset; layer styles are not blended. `config.themeValues` applies them at creation. The demo's "Shades and lines" sliders use it and show the changed values as JSON to copy into `defaultTheme`.
- **Element.** `sunset` and `sunsetDuration` attributes (changing them does not rebuild the cloud); `currentSeed` property and a `seedchange` event (`detail.seed`, bubbles, composed) when a click gives a new seed.

### Cumulus element

- Observed attributes (lower-case, as HTML lower-cases them): `width` (500), `height` (500), `numCells` (15), `seed` (5), `lineWidth` (1), `lineSpacing` (1.5), and the booleans `growIn` and `regenerateOnClick` (off by default; present = on unless `false`/`0`/`off`/`no`). `seed="0"` is valid; non-numeric values fall back to the default; `numCells` is at least 1.
- Size: `width`/`height` attributes win; a missing dimension takes the element's CSS size (measured with the canvas collapsed so its old size isn't mistaken for the CSS size); otherwise the default. A `ResizeObserver` triggers a debounced rebuild when the measured size changes.
- Pause: `IntersectionObserver` (off-screen) and `visibilitychange` (hidden tab) call `controller.setInView / setPageVisible`; the loop is cancelled while either is false.
- `prefers-reduced-motion: reduce` → `animate: false`: the controller draws the finished cloud once, starts no loop and attaches no mouse listeners. A change of the preference rebuilds.
- `growIn` only applies to the first build (`hasBuilt`), so resize rebuilds do not replay it. A cloud made by clicking reports its seed through `onSeedChange`; the element keeps it in `seedOverride` so a rebuild keeps the same cloud, until the `seed` attribute changes.
- `connectedCallback` sets up observers and builds; `disconnectedCallback` removes them and destroys the controller. The shadow root/canvas are created once and reused on reconnect.

## Known bugs / gotchas

- A small number of seeds (about 1%) still build a cloud slightly past the canvas edge (up to about 13px), left or right, because stepped children and the base cell can extend past the dome. The dome radius is the smaller of the height-based and width-based radius. See the README.

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

`npm test` runs `node --test test/*.test.js`: plain Node, no DOM, no dependencies. `test/helpers.js` provides a mock canvas (a no-op 2D context that records event listeners) and a fake, manually stepped `requestAnimationFrame`; import it first in tests that touch the renderer or controller.

| File | Covers |
| --- | --- |
| `utils.test.js` | PRNG determinism, range maths, `clamp`, `perlinNoise1D` (bounds, zero at nodes, scale, smoothness, node count) |
| `cloud-builder.test.js` | determinism per seed, **golden hash for seed 323** (fails if `random()` call order changes), id lookup, fractal grouping, base locations, fill updates |
| `cloud-simulation.test.js` | the force model on a small made-up cloud (no push when still or slow, push along the stroke, faster pushes further, heavier moves less and returns slower, falloff, no skipping, return without overshoot, walls, vertical strength, cohesion, relative limit, cursor reset, long frames, determinism), plus the old push called directly |
| `theme.test.js` | the sunset theme (only a few things changed), the stages, blending (hue the short way, no-bottom sky, other sections untouched), progress through the stages |
| `fill-tears.test.js`, `fill-pockets.js` | tear guard: random strokes over real clouds must not open pockets of sky or expose fill edges, and cohesion must tear less than none; the helper measures pockets and exposed edges on a simple raster, with its own tests |
| `hatched-renderer.test.js` | `addSegment` overwrite/split, padding as gap segments (full width, persists when covered, shadow), edge-noise cache (including scaling with range), Perlin line width noise, `clear()` |
| `easing.test.js` | endpoints and monotonic progress of the easing functions |
| `cumulus-controller.test.js` | pointer methods without canvas listeners, layer building and keys, animate on/off, pause/resume/destroy, only redraw when something moved, theme, sunset (stages half way, reverse, reversing part way, redrawn each frame, instant without animation, same theme object), grow-in (scale, eased progress, fractals growing with the cells (and `fractalLag`), no jump after pause, finished cloud identical to a static one), click to regenerate (shrink, new seed, ignored clicks, instant without animation, pointer cursor) |

The `Cumulus` element (`src/cumulus.js`) needs a DOM and is not covered: attribute rebuilds, the `growIn`/`regenerateOnClick` attributes, `ResizeObserver`, `IntersectionObserver` and reduced motion were checked by hand in headless Chrome over the DevTools protocol (`--force-prefers-reduced-motion` for the reduced-motion path; `--virtual-time-budget` does not run animation frames reliably, so use real time).

If the golden hash test fails after a deliberate change to generation, every existing seed now makes a different cloud: update the hash on purpose. Otherwise a `this.random()` call was added, removed or reordered.

Useful extra check when changing the renderer's segment logic: log every `addSegment` call, repaint them in order at sample x positions (a painter's-algorithm oracle), and compare with the segment list and with what `drawLine` draws.

## Planned work

See the Roadmap in `README.md`.
