# CLAUDE.md

Guidance for working in this repo. How the code is put together is in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): read it before changing the builder, renderer, controller or element, and keep it in sync when the architecture changes. What is planned is in [ROADMAP.md](ROADMAP.md).

## Commands

- `npm run dev` – Vite dev server; open `/demo/` (demo imports `../src/define.js`).
- `npm run build` – library build to `dist/` (gitignored), then the type declarations.
- `npm run types` – `tsc` writes `.d.ts` files to `dist/types/` from the JSDoc in `src` (`tsconfig.json`: `allowJs`, `checkJs` off). The public types (`ShadowDiagonalSettings`, `ThemeValues`, ...) are `@typedef`s in `src/cumulus.js`, re-exported by `src/index.js`. Members of `Cumulus` that are not public API are marked `@internal` and given a `@type` (`stripInternal` does not remove JS fields in this TypeScript version, and an untyped field breaks strict consumers).
- `npm run build:demo` – demo page to `dist-demo/` (gitignored).
- `npm run check` – lint, format check, `npm audit` (high and critical only), tests and build: what CI (`.github/workflows/ci.yml`) runs.
- `npm run lint` – ESLint over `src`, `test` and `e2e` (`no-console` is an error).
- `npm run format` / `npm run format:check` – Prettier (`.prettierrc.json`: print width 100, otherwise defaults).
- `npm test` – unit tests (Node's built-in runner, no DOM needed).
- `npm run test:e2e` – Playwright tests of the element in Chromium (`npx playwright install chromium` once). CI runs them in a separate job.

## Conventions

- 2-space indent, double quotes, semicolons (Prettier-style, `.editorconfig`). Match surrounding comment density.
- Builder = geometry only, simulation = motion only, renderer = drawing only, controller = glue, element = DOM/lifecycle.
- Do not make code changes beyond the task asked; the author works incrementally and reviews diffs.
- No `console.*` in `src` (ESLint fails on it). No `// TODO` comments: add the item to `ROADMAP.md` instead. No commented-out code.
- Put tuning numbers in named constants (statics at the top of a class, or the theme), not inline.
- Public types are JSDoc in `src/cumulus.js` (see `npm run types` above); members of the element that are not public API are marked `@internal` with a `@type`.

## Rules that keep the code working

- **Deterministic output per seed is a feature.** Do not use `Math.random()` in generation, and keep the `this.random()` call order in `CloudBuilder` stable (steps, and the number of calls). Anything animated at runtime must use its own random stream, never the builder's. The renderer's noise is decided by the seed the controller starts with, and is not changed by a click; edge noise is a hash (`hashToUnit`), so it never depends on drawing order. Changing the renderer's noise changes how every seed looks. If the golden hash test fails after a deliberate change to generation, every existing seed now makes a different cloud: update the hash on purpose. Otherwise a `this.random()` call was added, removed or reordered.
- Address cells by id (`builder.cellsById`), never by array index. Do not `filter` a flat fractal list per frame: use `cell.lightFractals` / `cell.darkFractals`.
- `builder.updateFills()` must be called after cells move, and only then.
- `HatchedRenderer.applyTheme(theme)` must be called before `finaliseRenderer()`. Every layer needs a stable `key`. Anything that creates segments must keep `under` correct for gap segments. Noise arrays are read through `drawStepIndex(x)`.
- Add new visual constants to the theme, not inline in the controller.
- Click and hover hit-tests use the scaled cloud: keep drawing and hit-testing in step.
- When measuring fill tearing, count only enclosed pockets of at least 30px: metrics that compare slits, or compare pixel by pixel with the rest cloud, measure 1px rasterisation noise.

## Testing

- `test/helpers.js` provides a mock canvas (a no-op 2D context that records event listeners) and a fake, manually stepped `requestAnimationFrame`; import it first in tests that touch the renderer or controller.
- Add a test with a change. A change to the element goes in `e2e/cumulus-canvas.spec.js`.
- Useful extra check when changing the renderer's segment logic: log every `addSegment` call, repaint them in order at sample x positions (a painter's-algorithm oracle), and compare with the segment list and with what `drawLine` draws.
- Before finishing, run `npm run check` (lint, format check, tests, build).
