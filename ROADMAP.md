# Roadmap

What is done and what is planned for Cumulus. The detailed design is in [CLAUDE.md](CLAUDE.md).

Changing how a cloud is generated (`CloudBuilder`) changes the cloud every existing seed makes. Items marked **(changes seeds)** do that, so do them deliberately and update the golden hash in `test/cloud-builder.test.js`.

## Features

- [ ] **Line breaks that eat into adjacent lines.** Horizontal line breaks (gaps in a line) should be able to spread into the lines above and below, mainly along the bottom of the cloud and the top and bottom border of the canvas.
- [ ] **Keep the cloud inside the canvas.** The dome radius fits the canvas across as well as up, which cut the clouds that overflow on 600x400 from about 6% to about 1% of seeds (worst 13px over). Portrait and square canvases still have about 1% overflow (worst 10px). To remove the rest: fit the cloud to the canvas after it is built (only changes the clouds that overflow).
- [ ] **Morph on click.** Morph the old cloud into the new one on click, without shrinking away first.
- [ ] **More vertical mouse movement.** Needs the fills to survive it, most likely by building the fill per scanline from the cells each frame (moving cells vertically tears the fills; see CLAUDE.md). Also: touch support through pointer events.
- [ ] **More realistic growth.** Growth is a uniform scale about the base; cells could grow at different times, rise and billow individually.
- [ ] **More realistic clouds.** Shade by light direction, and make growth, rising, drift and dissipation behave more like real cumulus.
- [ ] **Theming API.** `setThemeValues` changes colours and layer styles. Still to do: a `theme` property or CSS custom properties.
- [ ] **Randomise the seed when none is given** (the default seed is always 5; 323 is a good one) and use the element's seed for the renderer's noise (it is hardcoded to 10).
- [ ] **Smaller padding and noise for small screens** (phones), as a separate theme.
- [x] Rebuild on attribute change (`observedAttributes`, `ResizeObserver`, one `rebuild()`).
- [x] Grow-in animation (`growIn` attribute).
- [x] Click to regenerate (`regenerateOnClick` attribute).
- [x] Sunset mode: the sky fades from blue to orange, through a dusk, while the shadow rises (`sunset` attribute; shifting the cloud's own colours is supported by the theme transition).
- [x] A minimum base width for the cloud (`cloud.minBaseWidth`).
- [x] Sideways mouse push (`mouseRepel`).
- [x] Force-based mouse interaction was built and later removed (it is in the git history). Vertical movement tore the fills.
- [x] Longer and more frequent line breaks on the top and bottom lines.

## Performance

- [ ] **Batch strokes:** one `stroke()` per run of the same colour and width instead of one per 2px step, and cache the `hsl()` strings. (Batching by colour, lightness and width was about 3x faster to draw in headless Chrome but slower in a real browser, so it was reverted. Needs measuring in a real browser before retrying.)
- [ ] Redraw only the lines affected by moved cells instead of the whole canvas (the renderer would need to know which lines changed; the builder could flag them).
- [ ] Stop the `requestAnimationFrame` loop entirely while the cloud is at rest.
- [ ] Try rounding long decimal values to 3 significant figures and measure whether it helps.
- [x] Pause when off-screen or when the tab is hidden.
- [x] Honour `prefers-reduced-motion` (draw the final cloud once).
- [x] Only recompute fills and redraw when the simulation moved something.
- [x] Fractals grouped per cell once at build time.
- [x] `addSegment` no longer re-sorts on every insert.
- [x] Compute the default y offsets (`baseYOffset`) once instead of on every draw.
- [x] Offscreen canvas and worker, with a main-thread fallback.
- [x] The worker file is found relative to the built file, so `dist/` works wherever it is served.

## Package and project

- [ ] **Publish to npm.** The package is installed from GitHub for now. To move: `npm login`, then `npm publish --access public`, change the README Install section to `npm install @joshua-dallas/cumulus`. (`prepare` also runs before `npm publish`, so `dist/` is built then too.)
- [ ] Tests for the custom element (needs a DOM, e.g. jsdom or a browser).
- [ ] Types: JSDoc typedefs for the controller config, the theme and the renderer's layer, line and segment shapes; then turn on `checkJs`.
- [ ] A `HTMLElementTagNameMap` entry so TypeScript knows `cumulus-canvas`.
- [ ] Opt-in debugging: an `onDebug` callback (config option, and an event or property on the element) that receives diagnostic messages, so the library stays silent by default and has no `console.log` calls.
- [x] Lint, format, type declarations, CI and a GitHub Pages demo.
- [x] Unit tests for the builder, simulation, renderer and controller.
- [x] Licence: PolyForm Noncommercial 1.0.0.
- [x] Package metadata (description, author, licence, homepage, engines, files).
- [x] Cells addressed by id, theme object, separate simulation, element and controller modules, padding as part of a layer, edge noise cached per layer, Perlin noise for line width.

## Ideas from the source

These were `// TODO` comments in the code. They are grouped by where they were.

### Renderer (`hatched-renderer.js`)

- [ ] Use typed shapes for layer, line and segment.
- [ ] Setters for the style parameters (`defaultLineWidth`, `lineSpacing`, `backgroundBorderNoise`, ...), maybe with get/set that trigger a re-render.
- [ ] Continuous (Perlin) noise for the y offset, lightness and edge noise (line width noise already is), and an x wave per line.
- [ ] A separate setting for the background line width gradient so lines can be thicker at the top (today they only get thicker down the page, `backgroundLineWidthGradientDown`).
- [ ] Padding noise.
- [ ] Smooth the line width and y offset between segments, with a flag to turn it on.
- [ ] A flag set in `finaliseRenderer` that `draw` checks, so drawing before finalising fails clearly.
- [ ] Only create noise where it is enabled, or only apply it where it is enabled, and make clear that `initialiseNoise` runs after all parameters are set.
- [ ] More line breaks in the background.
- [ ] More lightness noise in the shadow region.
- [ ] When positions are not whole numbers, floor the y offset.
- [ ] Set each line's `startX` from the background padding and mask, and sort out `endX`.
- [ ] Check that `setBackgroundBorderNoise` is given a positive number.
- [ ] `addBackground` must be called first; consider keeping the background apart from the layers.
- [ ] Find a cleaner way to get the draw step index in `getStrokeColour`, and check that it behaves as intended.
- [ ] Top and bottom noise for the inner fills (theme).
- [ ] Try the cell layer without `rightPadding` (theme).
- [x] Higher chance of line breaks, and longer ones, on the first and last line.
- [x] Line width gradient down the background.
- [x] Compute the y offsets once before drawing.

### Builder (`cloud-builder.js`) (all of these change seeds unless they only rename or move code)

- [ ] Extra padding so cells can grow and rise.
- [ ] Flag which lines changed between animation frames.
- [ ] Random `upperExtension` and `lowerExtension` for a cell.
- [ ] Stepped child cells: move `probOfSteppedChild` to the top of the file and randomise `childRadiusRatio`.
- [ ] Fractals: better names, constants at the top of the file, a fractal count that depends on the cell radius, a minimum distance and a limit on the largest radius, a random shadow angle for the light fractals, better angle ranges, and a check that the direction of y is right for the lower-right `rightPadding`.
- [ ] Check whether the cloud looks better without sorting fractals largest to smallest.
- [ ] Fill circles on horizontal edges: constants and better names (`maxStraightFillLength` may be too large), and a number of circles that depends on the edge length.
- [ ] Better names in `fillCentreLineGaps`, and note where horizontal breaks could be removed if wanted.
- [x] Centre the cloud on the dome (`centreCells` centres the middle of the extents, not a weighted centre).

### Simulation, controller and utilities

- [ ] Easing for cell motion with force and velocity (a force model was built and removed; see the git history).
- [ ] Spread the fractals when a cell moves.
- [ ] Allow a slight crossing of the centre line that would not show in the fill.
- [ ] Move stepped child cells with their parent when it is pushed.
- [ ] Round simulated positions to a tenth of a pixel.
- [ ] Better name for `intersectionOfMany` in `utils.js`.
