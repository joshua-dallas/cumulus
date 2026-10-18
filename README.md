# Cumulus

A custom HTML element that draws a generative cumulus cloud on a canvas in a hatched style. Each cloud is built from a seed number, so the same seed always gives the same cloud.

```html
<cumulus-canvas width="600" height="400" seed="323" numCells="15"></cumulus-canvas>
<script type="module">
  import "cumulus/define"; // registers <cumulus-canvas>
</script>
```

To register the element under your own name, import the class instead:

```js
import { Cumulus } from "cumulus";
customElements.define("my-cloud", Cumulus);
```

## Attributes

Changing an attribute rebuilds the cloud. Attribute names are case-insensitive in HTML, so `numCells` and `numcells` are the same.

| Attribute     | Default | Description                                      |
| ------------- | ------- | ------------------------------------------------ |
| `width`       | 500     | Canvas width in CSS pixels. If omitted, the element's CSS width is used |
| `height`      | 500     | Canvas height in CSS pixels. If omitted, the element's CSS height is used |
| `numCells`    | 15      | Number of main circles forming the cloud (max 100) |
| `seed`        | 5       | Seed for the generator                           |
| `lineWidth`   | 1       | Hatch line thickness                             |
| `lineSpacing` | 1.5     | Gap between hatch lines                          |
| `growIn`      | off     | The cloud grows from nothing when the element is first created |
| `regenerateOnClick` | off | Clicking the cloud shrinks it away and grows a new one (new random seed) |

`growIn` and `regenerateOnClick` are on when the attribute is present and off when it is missing or set to `false`. A resize rebuild does not replay the grow-in, and a cloud made by clicking keeps its seed through a rebuild until the `seed` attribute is changed. With `prefers-reduced-motion`, `growIn` does nothing and a click replaces the cloud instantly.

```html
<cumulus-canvas width="600" height="400" growIn regenerateOnClick></cumulus-canvas>
```

**Mouse:** the mouse acts like a hand moving through water or gas. Moving it across the cloud pushes cells along the stroke: faster strokes push harder, bigger cells are heavier and move less, overlapping cells drag each other along, and a spring slowly returns every cell to where it started. A resting mouse does nothing, and there is no mouse effect with `prefers-reduced-motion`. Tune it in `interaction` in `src/lib/theme.js`. (The old sideways push, `moveCellsWithMouse`, is kept in `src/lib/cloud-simulation.js` but not used.)

**Resizing:** leave `width`/`height` off and size the element with CSS (e.g. `cumulus-canvas { width: 100%; height: 400px }`) to make the cloud fill its container. It is rebuilt when the element's size changes, drawn at the device pixel ratio current at that time (a zoom or monitor change on its own does not trigger a rebuild yet).

**Performance and accessibility:** the animation pauses while the element is scrolled out of view or the tab is hidden. With `prefers-reduced-motion: reduce` the finished cloud is drawn once, with no animation and no mouse effect.

## How it works

A cloud is modelled as three kinds of shape, built by `CloudBuilder` (`src/lib/cloud-builder.js`):

- **Cells** – circles that make up the body of the cloud.
- **Fills** – regions between cells (polygons and half-circles along the centre line) that are shaded differently.
- **Fractals** – small light and dark circles inside each cell that give the fluffy look.

`Cumulus` (`src/cumulus.js`) is the custom element and handles attributes, resizing and lifecycle. It creates a `CumulusController` (`src/lib/cumulus-controller.js`), which turns the cloud into styled layers (styles live in `src/lib/theme.js`), moves the cells with `CloudSimulation` and hands the layers to the renderer (`src/lib/hatched-renderer.js`). The renderer splits the canvas into horizontal lines, works out which layer is visible along each stretch of each line, and strokes each stretch as a wavy, noisy line, with a diagonal shadow edge across the cloud. See [CLAUDE.md](CLAUDE.md) for a detailed walkthrough.

## Development

```sh
npm install
npm run dev     # then open /demo/
npm run build   # library output in dist/
npm run lint    # ESLint
npm test        # unit tests (no browser needed)
```

Tests use Node's built-in runner and run without a browser. The custom element itself (attributes, observers) is not covered yet, as it needs a DOM.

## Roadmap

### Next up (noted, not started)

- [ ] **Line break sections that eat into adjacent lines.** Horizontal line breaks (gaps in a line) should be able to spread into the lines above and below, mainly along the bottom of the cloud and the top and bottom border of the canvas. (Related source TODO: higher probability and longer line breaks on the first and last line.)
- [ ] **Sunset timelapse.** See "Sunset mode" below; the theme object and `applyTheme` are ready for it.
- [ ] **Enforce a minimum base width for the cloud.** (Related source TODO: minimum base width for the matched bottom cell.)

### Requested features

- [x] **Rebuild on attribute change** – `observedAttributes` / `attributeChangedCallback`, `ResizeObserver`, `disconnectedCallback` cleanup, all through one `rebuild()`.
- [x] **Grow-in animation** – `growIn` attribute. The cloud is scaled up from the middle of its base with an ease-out curve. The fractals (fluff) grow with the cells by default; set `animation.fractalLag` in the theme to make them appear later.
- [ ] **Sunset mode** – slowly shift the palette (sky, cloud lit/shadow colours) and rotate the shadow diagonal angle/origin to mimic a sunset timelapse. (The theme object and `applyTheme` are in place for this.)
- [x] **Click to regenerate** – `regenerateOnClick` attribute. The cloud shrinks away, then a new one (new random seed) grows.
- [ ] **Morph on click** – try morphing the old cloud into the new one on click, without shrinking away first.
- [x] **Force-based mouse interaction** – see above. Vertical movement is limited (`verticalStrength` 0.2) because the fills tear sooner with it.
- [ ] **More vertical mouse movement** – needs the fills to survive it, most likely by building the fill per scanline from the cells each frame (see CLAUDE.md for the measurements). Also: touch support through pointer events.
- [ ] **More realistic growth** – growth is currently a uniform scale about the base; cells could grow at different times, rise and billow individually.
- [ ] **More realistic clouds** – shade by light direction, and make growth, rising, drift and dissipation behave more like real cumulus. (Fills are rendered again.)
- [ ] **Lighter on the CPU** – see below.

### Performance

- [x] Pause when off-screen (`IntersectionObserver`) or the tab is hidden.
- [x] Honour `prefers-reduced-motion` (draw the final cloud once).
- [x] Only recompute fills and redraw when the simulation moved something.
- [x] Fractals grouped per cell once at build time instead of filtered every frame.
- [x] `addSegment` no longer re-sorts on every insert.
- [ ] Batch strokes: one `stroke()` per run of the same colour/width instead of one per 2px step, and cache the `hsl()` strings. (Tried batching by colour, lightness and width: about 3x faster to draw in headless Chrome but slower in a real browser, so it was reverted. Needs measuring in a real browser before retrying.)
- [ ] Redraw only the lines affected by moved cells instead of the whole canvas.
- [ ] Stop the `requestAnimationFrame` loop entirely while the cloud is at rest.
- [ ] Offscreen canvas / worker.

### Housekeeping

- [x] Rename `EtchRenderer` / `etch-render.js` to `HatchedRenderer` / `hatched-renderer.js`.
- [x] Theme object for the colour palette and layer styles.
- [x] Separate simulation module; separate element and controller.
- [x] Layer left/right padding is applied when segments are added rather than when drawing. It is treated as an extension of the layer (gap segments), so it stays visible even if the layer is covered.
- [x] Fixed: padding was not honoured next to segments narrower than the padding (e.g. near the edge of fill circles); padding is now a fixed-width gap regardless of the segments beneath.
- [x] Fixed: the inner fill polygon could add a segment with an undefined end when a line only touched one of its vertical edges.
- [x] Cells addressed by id (`cellsById` map) rather than array index.
- [x] Fixed: `line.segments` typo, and falsy `0` in the edge-noise cache (this affected both left and right edges; edge noise is now cached per layer key).
- [x] `seed="0"` is allowed; mouse-leave clears the cursor (`null`); removed debug `console.log`s and the debug draw helpers.
- [ ] Randomise the seed when none is provided; use the element seed for the renderer's noise.
- [ ] Public API for changing the theme/colours (e.g. a `theme` property or CSS custom properties).
- [x] Lint script (`npm run lint`).
- [x] Line width noise is 1-D Perlin noise (`perlinNoise1D` in `src/lib/utils.js`) so lines swell and thin smoothly, like a pen.
- [ ] Use Perlin noise for the other per-step noise too (y offset, lightness) and for the edge noise.
- [x] Unit tests for the builder, simulation, renderer and controller (`npm test`).
- [ ] Tests for the custom element (needs a DOM, e.g. jsdom or a browser), and a README demo image.
- [ ] **Add a licence before making the repo public.** `LICENCE` is currently an empty file; choose a licence, put its text in `LICENCE`, and add a matching `license` field to `package.json`. The repo is private until then.
- [ ] Package metadata: `package.json` is still version `1.0.0` with no description.

### Open TODOs from the source

The author's own `// TODO:` comments are the detailed backlog; `grep -rn TODO src` lists them. Themes:

- **Builder** – cell/extension randomisation, extra padding so cells can grow and rise, weighted centring, flagging changed lines between frames, moving the remaining constants to the top.
- **Renderer** – typed layer/line/segment shapes, continuous (Perlin-style) noise, smooth width/offset transitions between segments, persisted noise across layer re-adds, more line breaks on first/last lines, padding noise, setters for style parameters, only redrawing affected lines.
- **Controller/simulation** – force/velocity easing for cell motion, spreading fractals when a cell moves, stepped children following their parent.

## Licence

See [LICENCE](LICENCE).
