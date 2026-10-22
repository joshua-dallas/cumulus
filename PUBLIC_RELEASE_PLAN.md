# Plan: making the repo public

A working plan for turning this into a public portfolio repo. It is a to-do list for the author, not project documentation, so delete it (or move it to an issue) once it is done.

Goal: someone lands on the repo (a recruiter, a hiring engineer), and within a minute sees what it is, sees it running, can run it, and finds code that looks cared for.

## TypeScript or not?

**Recommendation: do not convert to TypeScript before going public. Stay in JS, and add JSDoc types checked by `tsc` for the public surface and the core data shapes.**

Reasons:

- **A conversion is a large diff with little visible payoff.** About 4,000 lines of source plus 2,000 of tests. The interesting thing about this project is the generation and rendering, and none of that gets better to look at by being typed. A rewrite delays publishing and risks the thing the project depends on most: `this.random()` call order in `CloudBuilder` (the golden-hash test guards it, but a long mechanical diff is still where it would slip).
- **What consumers get from TS is `.d.ts` files, not TS source.** They can be had from JSDoc: `tsc --allowJs --checkJs --declaration --emitDeclarationOnly`. Consumers get autocomplete and type checking either way.
- **Plain JS needs no build step to test.** `node --test` runs the source directly today. That is a real strength; keep it.
- **It reads as a deliberate choice, not a gap**, if the README says so in one line ("plain ES modules, typed with JSDoc, no build step for tests").
- The cost of waiting is low. If you later want TS (it is a good thing to show you can do), a `checkJs` setup is the easiest on-ramp: turn it on, fix errors file by file, then rename files. Do it as a separate, clearly labelled piece of work after release, not as a gate.

Where types would help most, if you do some: the renderer's layer/line/segment shapes (the source TODOs already ask for this), the theme object, and the controller `config`. These are the shapes someone reading the code needs to hold in their head.

---

## Must do

These block going public, or make the repo look unfinished or unsafe.

### Legal and safety

- [ ] **Choose and add a licence.** `LICENCE` is an empty file. MIT is the usual choice for a portfolio library. Put the full text in, and rename the file to `LICENSE` (the spelling GitHub, npm and every tool look for first), add `"license": "MIT"` to `package.json`, and fill in the year and your name.
- [x] **Author email rewritten.** History was rewritten with `git filter-repo --mailmap` and force-pushed; every commit now uses the GitHub no-reply address.
- [ ] **Scan the history for secrets.** A quick scan of the working tree found none. Also scan the whole history (`gitleaks detect`, or `git log -p | grep -iE 'key|secret|token|password'`), since public means every commit is public.
- [x] **Fix the `npm audit` finding.** `npm audit` now reports 0 vulnerabilities.

### Package and install story

- [ ] **Decide where the package lives, and make the README match.** `package.json` is named `@joshua-dallas/cumulus` with `publishConfig` pointing at **GitHub Packages**, which needs an auth token even to install a public package. For a portfolio piece that is friction. Either publish to the public npm registry (remove `publishConfig.registry`) or do not publish and document installing from git (`npm i github:joshua-dallas/cumulus`). The README examples currently import from `"cumulus"`, which is neither name; change them to the real one.
- [ ] **Fill in `package.json`.** Add `description`, `keywords` (`web-component`, `canvas`, `generative-art`, `custom-element`, `cloud`), `author`, `license`, `homepage`, `bugs`, and an `engines` entry. Add a `types` field once declarations exist (see "Nice to have"), and a `"files"` check with `npm pack --dry-run` to see exactly what would ship (today it ships `src` as well as `dist`, which is fine, but make it on purpose).
- [ ] **Bump the version deliberately.** It is `1.0.1` with no changelog or tag. Either call it `0.x` until the API settles (the theme API, for example, is still an open roadmap item), or tag `v1.0.0` and write a short `CHANGELOG.md`.

### README

The README is currently a developer's working notes: long attribute prose, then a roadmap full of ticked-off items and fixed bugs. A visitor needs something else first.

- [ ] **Lead with a picture.** A screenshot or a short GIF/MP4 of the cloud (grow-in, a click making a new one, the sunset fade) above everything else. This is the single most valuable thing for a visual project.
- [ ] **Add a live demo link.** Deploy `demo/` to GitHub Pages (a small Vite config or build script for the demo, plus a GitHub Actions workflow). Link it at the top of the README and in the repo's "About" box. Note that the demo currently imports `../src/define.js` and only works through the dev server.
- [ ] **Restructure the README**: one-paragraph pitch, picture, demo link, install, quick start, attributes table, JS API (`currentSeed`, `seedchange`, `setShadowDiagonal`, `setThemeValues`, theming), "how it works" (short), browser support, development, licence. Keep the table of attributes (tidy its column alignment; Prettier will do it).
- [ ] **Move the roadmap and history out of the README.** Put open items in GitHub Issues (or a `ROADMAP.md` of open items only), and delete the ticked-off list of past fixes: it is useful to you and noise to a visitor. The ~67 `// TODO` comments in the source are a backlog too; turn the real ones into issues and delete the rest, because a public repo with dozens of TODOs reads as unfinished.
- [ ] **Fix the "Known bugs" visibility.** The roughly 1% of seeds that overflow the canvas is documented in the README roadmap; keep it, but under a short "Known limitations" heading, stated plainly.
- [ ] **State browser support and fallback**: the worker/OffscreenCanvas path, the main-thread fallback, and that the worker file loads relative to the built file (`base: "./"`). Mention the bundler caveat already in the README.

### Code hygiene

- [ ] **Run Prettier on everything.** `npm run format:check` currently fails on 21 files. Run `npm run format` once in a single commit titled "Format" so the diff noise is isolated, then keep `format:check` in CI. Reformat `eslint.config.js`, which is one long line.
- [x] **Delete commented-out code.** The commented-out `console.log` lines in the renderer and builder are removed. Still to check: a stale comment in `HatchedRenderer.draw()` ("For testing, we are only going to draw one line at y=200").
- [ ] **Resolve the TODOs** (see README section above): issue or delete each one.
- [ ] **Check the demo page** works from a clean clone (`npm install && npm run dev`), has a sensible `<title>`, description and favicon, and does not look like template leftovers. (`demo/demo.css` is a two-line Tailwind import; fine, but check the built result.)

### Repo basics

- [ ] **Continuous integration**: one GitHub Actions workflow running `npm ci`, `npm run lint`, `npm run format:check`, `npm test` and `npm run build` on push and pull request. Add the status badge to the README. This is the best "adheres to best practices" signal for the least work.
- [ ] **Set the GitHub repo up**: description, topics, website (the demo link), and a social preview image (the screenshot).
- [ ] **Decide what to do with `CLAUDE.md`.** It is a very good architecture document, and also an instruction file for a coding assistant. Either keep it as-is (some visitors find it interesting that you work with an AI assistant; say so plainly in the README if you keep it), or move the architecture content to `docs/ARCHITECTURE.md`, link it from the README, and leave a short `CLAUDE.md` pointing at it. Note that some of its lines are addressed to the assistant (for example "Do not make code changes beyond the task asked"), not to contributors, so reread it with a stranger in mind.
- [ ] **Make the first public commit state clean**: `git status` empty, the build output (`dist/`) not committed, `package-lock.json` committed.

---

## Nice to have

Worth doing, none of it blocks going public. Roughly in order of value.

### Types and API

- [x] (Done for the element; the controller config, theme and renderer shapes are still untyped, and `checkJs` is off: turning it on gives about 280 errors, most of them untyped parameters.) **JSDoc on the public API and emit `.d.ts`.** Add JSDoc to the `Cumulus` element, the controller `config`, `createTheme`/the theme shape and the renderer's layer shape. Add `jsconfig.json`/`tsconfig.json` with `checkJs`, a `npm run typecheck` script (`tsc --noEmit`), and a declaration build step so `package.json` can have `types` and `exports.*.types`. Add typecheck to CI.
- [ ] **Add the custom-element typings** (`HTMLElementTagNameMap` entry for `cumulus-canvas`) so TS users get the tag name and attributes.
- [ ] **A real theming API** (already on the roadmap): a documented `theme` property or CSS custom properties, rather than `setThemeValues` only. Document it with a small example in the README.
- [ ] **Randomise the seed when none is given** (roadmap item), so the default is not always the same cloud.

### Tests and quality

- [ ] **Test the custom element itself** (attributes, rebuild batching, observers, reduced motion), with jsdom/happy-dom or Playwright. The element is the public surface and is the one thing with no automated test. A single Playwright smoke test (load the demo, the canvas has non-blank pixels, click changes the seed) would also double as an end-to-end test in CI.
- [ ] **Coverage report** (`node --test --experimental-test-coverage`), shown in CI output. No need for a badge.
- [ ] **Visual regression for a few seeds** (render to PNG, compare with a stored image). It fits a generative project well and protects the "same seed, same cloud" promise from the renderer side as well as the builder side (the golden hash covers only the builder).
- [ ] **Dependabot or Renovate** for dependency updates, and `npm audit` in CI.

### Documentation

- [ ] **A short "how the cloud is made" write-up with diagrams** (cells, extension lines, fills, fractals, then the hatching), possibly as a blog-style `docs/how-it-works.md` with images from each build step. This is the part of the project that best shows off your thinking; it is worth more to a reader than any amount of reformatting.
- [ ] **A gallery**: a grid of a dozen seeds (with seed numbers) in the README or on the demo page.
- [ ] **`CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, issue and PR templates.** Small, quick to add, and part of what GitHub's "community standards" checklist looks for. Keep CONTRIBUTING to a few lines: how to run, test, format, and the rule about `random()` call order.
- [ ] **`.editorconfig`** and a `.vscode/extensions.json` recommending the Prettier and ESLint extensions (the `.gitignore` already allows that file).
- [ ] **Bundle size note**: report the gzip size of the built library and worker in the README (currently about 15 kB gzipped plus the worker).

### Code structure

- [ ] **Split the biggest files** if they can be split along real seams: `hatched-renderer.js` (826 lines), `cloud-builder.js` (770) and `cumulus-controller.js` (568). For example, the builder's eleven generation steps could each live in a small module under `src/lib/builder/`. Only do it if it makes the code easier to read; the golden-hash test makes this safe, but it is a lot of churn, so do it after release.
- [ ] **Move magic numbers to named constants / the theme** where the TODOs already ask for it.
- [ ] **Resolve known gotchas** listed in `CLAUDE.md`: the renderer's hardcoded seed (`10`), the one-past-the-end noise index, and the unused `fractalSim` code. Each is a small, well-understood fix (the noise one changes the PRNG stream, so it changes existing output; do that deliberately).
- [ ] **Performance work** from the roadmap (batched strokes, redraw only affected lines, stop the rAF loop at rest) with before/after numbers in the README. "Measured, then faster" is a good story to have.

### Release

- [ ] **Tag a release and publish** with a changelog (npm provenance if on npm: `npm publish --provenance` from CI).
- [ ] **Pin the portfolio presentation**: pin the repo on your GitHub profile and link the demo from your portfolio site.

---

## Suggested order

1. Licence, audit fix, history scan (small, and they stop being a risk).
2. Format commit, delete dead code, triage TODOs into issues.
3. `package.json` clean-up and the package-name decision.
4. CI workflow.
5. Demo on GitHub Pages, screenshot/GIF.
6. README rewrite, roadmap moved out, `CLAUDE.md` decision.
7. Make the repo public; set description, topics, social image.
8. Then the "nice to have" list, starting with JSDoc types and the element test.
