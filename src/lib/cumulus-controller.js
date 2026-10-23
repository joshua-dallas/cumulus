import { CloudBuilder } from "./cloud-builder.js";
import { CloudSimulation } from "./cloud-simulation.js";
import { HatchedRenderer } from "./hatched-renderer.js";
import {
  BLENDED_SECTIONS,
  createSunsetKeyframes,
  createTheme,
  mergeThemeValues,
  themeAtProgress,
} from "./theme.js";
import { clamp01, easeInOutCubic, easeOutCubic } from "./easing.js";

// The longest time one frame can advance the animations by. A paused or
// background tab would otherwise jump straight to the end when it resumes
const MAX_FRAME_MS = 100;

// The renderer's noise (line widths, lightness, y offsets) comes from the seed the
// controller starts with, and stays the same when a click replaces the cloud. The wobble
// of the shapes' edges follows the current cloud's seed. Both are offset, because the same seed would give the renderer the same random numbers as the
// builder, and the builder's cell positions would line up with the noise
const RENDERER_SEED_OFFSET = 0x9e3779b9;
const rendererSeed = (seed) => seed + RENDERER_SEED_OFFSET;

// Runs one cloud on one canvas: builds the cloud, turns it into renderer
// layers, and drives the animation loop. It knows nothing about custom
// elements or attributes (see cumulus.js); it is created with a finished
// config and thrown away with destroy() when that config changes.
//
// config: { width, height, numCells, seed, lineWidth, lineSpacing,
//           animate, growIn, regenerateOnClick, sunset, sunsetDuration, shadowDiagonal,
//           themeValues, mouseRepel,
//           theme, onSeedChange, randomSeed, now, pixelRatio, listenToCanvas, onCursorChange }
//   animate: false draws the finished cloud once, with no animation loop,
//            no mouse push and no grow or shrink animation (used for
//            prefers-reduced-motion)
//   growIn: the cloud grows from nothing when it is created
//   regenerateOnClick: clicking the cloud shrinks it away and grows a new
//            one, with a new random seed. Without animation the new cloud
//            replaces it immediately
//   sunset: the sky starts as a sunset. setSunset(on) changes to or from one,
//            fading over sunsetDuration ms (see transitionTheme)
//   shadowDiagonal: { day: { angle, xOriginOffset }, sunset: { angle, xOriginOffset } }
//            changes where the edge of the shadow is, in the day and in the sunset
//            (see setShadowDiagonal). Angles are in radians
//   mouseRepel: cells slide out of the way of the mouse (theme.interaction.repel)
//   themeValues: colours and layer styles to change from the theme's (see setThemeValues)
//   onSeedChange(seed): called when a click gives the cloud a new seed
//   randomSeed(): picks the seed for a new cloud. now(): the clock, in ms
//   pixelRatio: device pixels per CSS pixel (read from the window if not given)
//   listenToCanvas: false when the controller runs in a worker, where the canvas gets no
//            mouse events. Whoever owns the real canvas calls pointerMove, pointerLeave
//            and pointerClick (positions in canvas pixels) instead
//   onCursorChange(cursor): called with "pointer" or "" when the mouse enters or leaves
//            the cloud. By default it sets canvas.style.cursor (a worker has no style)
//
// The cloud is grown and shrunk by scaling it about the middle of its base
// (see scaleX/scaleY), not by changing the cloud itself, so the cloud built
// from a seed is the same at every size.

export class CumulusController {
  constructor(canvas, config) {
    this.canvas = canvas;
    this.config = config;
    this.animate = config.animate ?? true;
    this.growIn = this.animate && (config.growIn ?? false);
    this.regenerateOnClick = config.regenerateOnClick ?? false;
    this.theme = mergeThemeValues(config.theme ?? createTheme(), config.themeValues);
    if (config.mouseRepel !== undefined) this.theme.interaction.repel = config.mouseRepel;

    // The sunset is a path through themes: the day, a dusk with a blue sky orange at
    // the bottom, and the sunset. The first is a copy of the day theme, as this.theme
    // is changed to match the point along the path (see applyThemeProgress)
    this.sunsetOptions = {}; // Where the shadow is in the sunset, if not the default
    this.sunsetKeyframes = createSunsetKeyframes(structuredClone(this.theme), this.sunsetOptions);
    this.setShadowSettings(config.shadowDiagonal);
    this.sunsetDuration = config.sunsetDuration ?? 6000;
    this.themeProgress = config.sunset ? 1 : 0; // 0 is the day, 1 is the sunset
    this.themeAnimation = null;
    this.applyThemeProgress(this.sunsetKeyframes, this.themeProgress);

    this.now = config.now ?? (() => performance.now());
    this.randomSeed = config.randomSeed ?? (() => Math.floor(Math.random() * 1e6));

    this.buildCloud(config.seed);

    this.renderer = new HatchedRenderer(
      canvas,
      config.width,
      config.height,
      config.lineWidth,
      config.lineSpacing,
      config.pixelRatio,
      rendererSeed(config.seed),
    );
    this.renderer.setDome(this.builder.dome); // the shadow is measured from it
    this.renderer.applyTheme(this.theme);
    this.renderer.finaliseRenderer();

    // The loop only runs while the cloud is animating, on screen and the page is visible
    this.destroyed = false;
    this.inView = true;
    this.pageVisible = true;
    this.frameId = null;
    this.tick = this.tick.bind(this); // Bound once, rather than every frame

    // How big the cloud is, from 0 (nothing) to 1 (full size), and what it is
    // doing. A cloud that is not growing, shrinking or about to be replaced is "idle"
    this.scale = 1;
    this.phase = "idle"; // "idle", "growing" or "shrinking"
    this.phaseTime = 0; // ms spent in the current phase
    this.shrinkFrom = 1; // the scale the shrink started from
    this.nextSeed = null; // the seed of the cloud that will replace this one
    this.lastTime = this.now();
    if (this.growIn) this.startGrowing();

    // Cursor position relative to the canvas, or null when it is not over it
    this.cursor = null;
    this.setCursorStyle =
      config.onCursorChange ?? ((cursor) => (this.canvas.style.cursor = cursor));
    this.onMouseMove = (event) => {
      const point = this.canvasPoint(event);
      this.pointerMove(point.x, point.y);
    };
    this.onMouseLeave = () => this.pointerLeave();
    this.onClick = (event) => {
      const point = this.canvasPoint(event);
      this.pointerClick(point.x, point.y);
    };
    // The mouse is only followed if it can do something: push the cloud, or click it
    this.followsMouse = this.regenerateOnClick || (this.animate && this.theme.interaction.repel);
    if (this.followsMouse && (config.listenToCanvas ?? true)) {
      this.canvas.addEventListener("mousemove", this.onMouseMove);
      this.canvas.addEventListener("mouseleave", this.onMouseLeave);
    }
    if (this.regenerateOnClick && (config.listenToCanvas ?? true)) {
      this.canvas.addEventListener("click", this.onClick);
    }

    this.renderer.clearCanvas(); // to the paper colour, before the first drawing
    this.drawFrame();
    this.updateLoop();
  }

  // Creates the cloud for a seed, and the simulation that moves it
  buildCloud(seed) {
    const { width, height, numCells } = this.config;
    this.seed = seed;
    this.builder = new CloudBuilder(width, height, numCells, seed, this.theme.cloud);
    this.simulation = new CloudSimulation(this.builder, this.theme.interaction);

    // The cloud grows and shrinks about the middle of its base
    this.anchor = {
      x: this.builder.dome.x,
      y: Math.max(...this.builder.cells.map((cell) => cell.y + cell.radius)),
    };
  }

  // The mouse moved to a point (in canvas pixels), left the canvas, or clicked
  pointerMove(x, y) {
    this.cursor = { x, y };
    if (this.regenerateOnClick) {
      this.setCursorStyle(this.isOverCloud(x, y) ? "pointer" : "");
    }
  }

  pointerLeave() {
    this.cursor = null;
    this.setCursorStyle("");
  }

  pointerClick(x, y) {
    if (this.isOverCloud(x, y)) this.regenerate();
  }

  canvasPoint(event) {
    const rect = this.canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  // Whether a point (in canvas pixels) is over the cloud: one of the cells, or the fill
  isOverCloud(x, y) {
    const inCircle = (circle) => {
      const dx = x - this.scaleX(circle.x);
      const dy = y - this.scaleY(circle.y);
      return dx * dx + dy * dy <= (circle.radius * this.scale) ** 2;
    };
    return (
      this.builder.cells.some(inCircle) ||
      this.builder.fillCircles.some(inCircle) ||
      this.builder.horizontalFillCircles.some(inCircle) ||
      this.isInPolygon(x, y, this.builder.cloudInnerLeft) ||
      this.isInPolygon(x, y, this.builder.cloudInnerRight)
    );
  }

  // Whether a point is inside a polygon of vertices (at the current scale), by counting
  // how many edges a ray going right from the point crosses
  isInPolygon(x, y, vertices) {
    let inside = false;
    for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
      const ax = this.scaleX(vertices[i].x);
      const ay = this.scaleY(vertices[i].y);
      const bx = this.scaleX(vertices[j].x);
      const by = this.scaleY(vertices[j].y);
      if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) inside = !inside;
    }
    return inside;
  }

  // Stops the loop and removes listeners. The controller cannot be reused.
  destroy() {
    this.destroyed = true;
    this.updateLoop();
    this.canvas.removeEventListener("mousemove", this.onMouseMove);
    this.canvas.removeEventListener("mouseleave", this.onMouseLeave);
    this.canvas.removeEventListener("click", this.onClick);
    this.setCursorStyle("");
  }

  //----------------------------------------------------//
  // Growing, shrinking and replacing the cloud
  //----------------------------------------------------//

  // Replaces the cloud with a new one. By default the old cloud shrinks away
  // first, and then the new one grows. Without animation, it is instant.
  regenerate(seed = this.randomSeed()) {
    if (this.phase === "shrinking" || this.destroyed) return;

    if (!this.animate) {
      this.replaceCloud(seed);
      this.redraw();
      return;
    }

    this.phase = "shrinking";
    this.phaseTime = 0;
    this.shrinkFrom = this.scale; // clicked while growing: shrink from where it is
    this.nextSeed = seed;
  }

  startGrowing() {
    this.phase = "growing";
    this.phaseTime = 0;
    this.scale = 0;
  }

  replaceCloud(seed) {
    this.buildCloud(seed);
    this.renderer.setEdgeSeed(rendererSeed(seed)); // the edges follow the new cloud's seed
    this.config.onSeedChange?.(seed);
  }

  //----------------------------------------------------//
  // Changing the theme: the sunset
  //----------------------------------------------------//

  // Fades to a sunset, or back to the day. The sky slowly changes from blue to orange
  // and the shadow on the cloud rises, over duration ms for the whole change (less if
  // it is already part of the way there)
  setSunset(on, duration = this.sunsetDuration) {
    if (this.destroyed) return;

    const target = on ? 1 : 0;
    const distance = Math.abs(target - this.themeProgress);
    this.transitionTheme(this.sunsetKeyframes, this.themeProgress, target, duration * distance);
  }

  // Animates the theme through a list of themes, in either direction. Progress is
  // how far along the list: 0 is the first theme and 1 is the last, with the others
  // evenly between. The theme changes from progress `from` to `to` over `duration` ms.
  // Without animation (reduced motion), or with no time, the change is immediate
  transitionTheme(keyframes, from, to, duration) {
    if (!this.animate || duration <= 0) {
      this.themeAnimation = null;
      this.themeProgress = to;
      this.applyThemeProgress(keyframes, to);
      this.redraw();
      return;
    }

    this.themeProgress = from;
    this.themeAnimation = { keyframes, from, to, duration, elapsed: 0 };
    this.updateLoop();
  }

  // Moves the theme animation on by dt ms. Returns true if the theme changed
  advanceThemeAnimation(dt) {
    const animation = this.themeAnimation;
    if (!animation) return false;

    animation.elapsed += dt;
    const progress = clamp01(animation.elapsed / animation.duration);
    const eased = easeInOutCubic(progress);
    this.themeProgress = animation.from + (animation.to - animation.from) * eased;
    if (progress >= 1) {
      this.themeProgress = animation.to;
      this.themeAnimation = null;
    }

    this.applyThemeProgress(animation.keyframes, this.themeProgress);
    return true;
  }

  // Changes where the edge of the shadow is, for the day and for the sunset:
  //   { day: { angle, xOriginOffset }, sunset: { angle, xOriginOffset } }
  // Anything left out is not changed. The angle is in radians, from the bottom
  // of the canvas; the ratio is how far across the canvas (0 to 1) the edge meets it
  setShadowDiagonal(settings) {
    this.setShadowSettings(settings);
    this.applyThemeProgress(this.sunsetKeyframes, this.themeProgress);
    this.redraw();
  }

  // Changes colours and layer styles of the theme, as in mergeThemeValues:
  //   { colours: { dark: { light: 40 } }, layers: { cell: { lineWidth: 1.5 } } }
  // Colours are part of the day (the first stage), so that they last through a sunset
  setThemeValues(values) {
    mergeThemeValues(this.sunsetKeyframes[0], values);
    mergeThemeValues(this.theme, { layers: values.layers });
    this.setShadowSettings();
    this.applyThemeProgress(this.sunsetKeyframes, this.themeProgress);
    this.redraw();
  }

  setShadowSettings({ day = {}, sunset = {} } = {}) {
    const oldKeyframes = this.sunsetKeyframes;

    // The day is the first of the stages, a copy of the theme. The sunset is made from it
    for (const key of ["angle", "xOriginOffset"]) {
      if (day[key] !== undefined) oldKeyframes[0].shadowDiagonal[key] = day[key];
    }
    if (sunset.angle !== undefined) this.sunsetOptions.shadowAngle = sunset.angle;
    if (sunset.xOriginOffset !== undefined)
      this.sunsetOptions.shadowXOriginOffset = sunset.xOriginOffset;

    this.sunsetKeyframes = createSunsetKeyframes(oldKeyframes[0], this.sunsetOptions);
    if (this.themeAnimation?.keyframes === oldKeyframes) {
      this.themeAnimation.keyframes = this.sunsetKeyframes; // carry on with the new ones
    }
  }

  // Makes the theme the one that is a given way along a list of themes. Only the
  // parts that the themes blend change; this.theme itself stays the same object
  applyThemeProgress(keyframes, progress) {
    const blended = themeAtProgress(keyframes, progress);
    // Copies, so that the theme never shares parts with one of the themes it blends
    for (const section of BLENDED_SECTIONS) this.theme[section] = structuredClone(blended[section]);
    this.renderer?.updateTheme(this.theme);
  }

  // Moves the grow or shrink animation on by dt ms. Returns true if the size changed
  advanceAnimation(dt) {
    if (this.phase === "idle") return false;

    const { growDuration, shrinkDuration } = this.theme.animation;
    this.phaseTime += dt;

    if (this.phase === "growing") {
      const progress = clamp01(this.phaseTime / growDuration);
      this.scale = easeOutCubic(progress);
      if (progress >= 1) this.phase = "idle";
    } else {
      const progress = clamp01(this.phaseTime / shrinkDuration);
      this.scale = this.shrinkFrom * (1 - easeInOutCubic(progress));
      if (progress >= 1) {
        // Nothing is left to see: swap in the new cloud and grow it
        this.replaceCloud(this.nextSeed);
        this.startGrowing();
      }
    }
    return true;
  }

  // How much of the fractals (the fluff) have appeared. By default they grow with
  // the cells. With theme.animation.fractalLag they lag behind the bodies of the
  // cells, appearing once the cloud has mostly grown
  fractalScale() {
    if (this.scale >= 1) return 1; // exactly, so a finished cloud is never rounded
    if (!this.theme.animation.fractalLag) return this.scale;

    const { fractalStart } = this.theme.animation;
    const progress = clamp01((this.scale - fractalStart) / (1 - fractalStart));
    return this.scale * easeInOutCubic(progress);
  }

  // Maps a point of the full size cloud to its place at the current size
  scaleX(x) {
    return this.scale === 1 ? x : this.anchor.x + (x - this.anchor.x) * this.scale;
  }

  scaleY(y) {
    return this.scale === 1 ? y : this.anchor.y + (y - this.anchor.y) * this.scale;
  }

  setInView(inView) {
    this.inView = inView;
    this.updateLoop();
  }

  setPageVisible(pageVisible) {
    this.pageVisible = pageVisible;
    this.updateLoop();
  }

  updateLoop() {
    const shouldRun = this.animate && this.inView && this.pageVisible && !this.destroyed;

    if (shouldRun && this.frameId === null) {
      this.lastTime = this.now(); // time spent paused does not count
      this.frameId = requestAnimationFrame(this.tick);
    } else if (!shouldRun && this.frameId !== null) {
      cancelAnimationFrame(this.frameId);
      this.frameId = null;
    }
  }

  tick() {
    this.frameId = requestAnimationFrame(this.tick);

    const time = this.now();
    const dt = Math.min(time - this.lastTime, MAX_FRAME_MS);
    this.lastTime = time;

    // Fills and the picture only need updating if something moved or changed size
    const resized = this.advanceAnimation(dt);
    const restyled = this.advanceThemeAnimation(dt);
    // The mouse only acts on a cloud that has finished growing, as until then what is
    // drawn is not where the cells are
    const cursor = this.scale === 1 ? this.cursor : null;
    const moved = this.simulation.step(cursor);
    if (moved) this.builder.updateFills();
    if (moved || resized || restyled) this.redraw();
  }

  redraw() {
    this.renderer.clearCanvas();
    this.renderer.clear();
    this.drawFrame();
  }

  //----------------------------------------------------//
  // Converting the cloud into renderer layers
  //----------------------------------------------------//

  drawFrame() {
    // Layers are drawn in the order they are added: fills, then cells on top.
    // There is nothing to add for a cloud that has not started to grow
    if (this.scale > 0) this.addCloudLayers();
    this.renderer.draw();
  }

  addCloudLayers() {
    const styles = this.resolveLayerStyles();
    const fractalScale = this.fractalScale();

    // Noise and padding are sizes in pixels. They shrink with the cloud, or
    // they would swallow a small one
    const bodyStyles = this.scaleStyles(styles, this.scale);
    const fractalStyles = this.scaleStyles(styles, fractalScale);

    this.builder.fillCircles.forEach((circle, i) =>
      this.addFillCircleLayer(circle, `fill-${i}`, bodyStyles.fillCircle),
    );
    this.builder.horizontalFillCircles.forEach((circle, i) =>
      this.addFillCircleLayer(circle, `horizontal-fill-${i}`, bodyStyles.fillCircle),
    );
    this.addInnerLayer("inner-left", this.builder.cloudInnerLeft, bodyStyles.innerLeft);
    this.addInnerLayer("inner-right", this.builder.cloudInnerRight, bodyStyles.innerRight);

    for (const cell of this.builder.cells) {
      this.addCloudCellLayers(cell, bodyStyles, fractalStyles, fractalScale);
    }
  }

  // Layer styles in the theme refer to colours by name. Resolve them each frame
  // so that colours changed at runtime (e.g. a sunset) are picked up.
  // Padding is multiplied by the layer's paddingScale here
  resolveLayerStyles() {
    const styles = {};
    for (const [name, style] of Object.entries(this.theme.layers)) {
      const paddingScale = style.paddingScale ?? 1;
      styles[name] = {
        ...style,
        fill: this.theme.colours[style.fill],
        paddingScale,
        leftPadding: (style.leftPadding ?? 0) * paddingScale,
        rightPadding: (style.rightPadding ?? 0) * paddingScale,
      };
    }
    return styles;
  }

  // The styles with their pixel sizes (noise and padding) multiplied by scale
  scaleStyles(styles, scale) {
    if (scale === 1) return styles;

    const scaled = {};
    for (const [name, style] of Object.entries(styles)) {
      scaled[name] = { ...style };
      for (const size of ["leftEdgeNoise", "rightEdgeNoise", "leftPadding", "rightPadding"]) {
        if (style[size]) scaled[name][size] = style[size] * scale;
      }
    }
    return scaled;
  }

  addInnerLayer(key, vertices, style) {
    this.renderer.addRightAnglePolygonLayer({
      ...style,
      key,
      vertices: vertices.map((vertex) => ({
        ...vertex,
        x: this.scaleX(vertex.x),
        y: this.scaleY(vertex.y),
      })),
    });
  }

  // Layer keys identify a shape between frames. The renderer uses them to
  // keep each shape's edge noise stable, so they must not depend on draw order
  addCloudCellLayers(cell, styles, fractalStyles, fractalScale) {
    const x = this.scaleX(cell.x);
    const y = this.scaleY(cell.y);

    // Add the main cell first
    this.renderer.addCircleLayer({
      ...styles.cell,
      key: `cell-${cell.id}`,
      x,
      y,
      radius: cell.radius * this.scale,
      specialType: "cloud-cell",
    });

    // Then all of its fractals, which were grouped by cell when the cloud was built.
    // They are placed relative to their cell, and scaled about its centre
    if (fractalScale <= 0) return;

    cell.darkFractals.forEach((fractal, i) => {
      this.renderer.addCircleLayer({
        ...fractalStyles.darkFractal,
        key: `dark-fractal-${cell.id}-${i}`,
        x: x + fractal.x * fractalScale,
        y: y + fractal.y * fractalScale,
        radius: fractal.radius * fractalScale,
        specialType: "dark-fractal",
      });
    });

    cell.lightFractals.forEach((fractal, i) => {
      this.renderer.addCircleLayer({
        ...fractalStyles.lightFractal,
        key: `light-fractal-${cell.id}-${i}`,
        x: x + fractal.x * fractalScale,
        y: y + fractal.y * fractalScale,
        radius: fractal.radius * fractalScale,
        rightPadding: fractal.rightPadding * fractalStyles.lightFractal.paddingScale * fractalScale,
        specialType: "light-fractal",
      });
    });
  }

  addFillCircleLayer(circle, key, style) {
    this.renderer.addCircleLayer({
      ...style,
      key,
      x: this.scaleX(circle.x),
      y: this.scaleY(circle.y),
      radius: circle.radius * this.scale,
    });
  }
}
