import { CloudBuilder } from "./cloud-builder.js";
import { CloudSimulation } from "./cloud-simulation.js";
import { HatchedRenderer } from "./hatched-renderer.js";
import { createTheme } from "./theme.js";

// Runs one cloud on one canvas: builds the cloud, turns it into renderer
// layers, and drives the animation loop. It knows nothing about custom
// elements or attributes (see cumulus.js); it is created with a finished
// config and thrown away with destroy() when that config changes.
//
// config: { width, height, numCells, seed, lineWidth, lineSpacing,
//           animate, theme }
//   animate: false draws the finished cloud once, with no animation loop
//            and no mouse interaction (used for prefers-reduced-motion)
//
// TODO: Grow-in animation, sunset mode and click to regenerate belong here

export class CumulusController {
  constructor(canvas, config) {
    this.canvas = canvas;
    this.animate = config.animate ?? true;
    this.theme = config.theme ?? createTheme();

    this.builder = new CloudBuilder(
      config.width,
      config.height,
      config.numCells,
      config.seed,
    );
    this.simulation = new CloudSimulation(this.builder, config.seed);

    this.renderer = new HatchedRenderer(
      canvas,
      config.width,
      config.height,
      config.lineWidth,
      config.lineSpacing,
    );
    this.renderer.applyTheme(this.theme);
    this.renderer.finaliseRenderer();

    // The loop only runs while the cloud is animating, on screen and the page is visible
    this.destroyed = false;
    this.inView = true;
    this.pageVisible = true;
    this.frameId = null;
    this.tick = this.tick.bind(this); // Bound once, rather than every frame

    // Cursor position relative to the canvas, or null when it is not over it
    this.cursor = null;
    this.onMouseMove = (event) => {
      const rect = this.canvas.getBoundingClientRect();
      this.cursor = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };
    this.onMouseLeave = () => (this.cursor = null);
    if (this.animate) {
      this.canvas.addEventListener("mousemove", this.onMouseMove);
      this.canvas.addEventListener("mouseleave", this.onMouseLeave);
    }

    this.drawFrame();
    this.updateLoop();
  }

  // Stops the loop and removes listeners. The controller cannot be reused.
  destroy() {
    this.destroyed = true;
    this.updateLoop();
    this.canvas.removeEventListener("mousemove", this.onMouseMove);
    this.canvas.removeEventListener("mouseleave", this.onMouseLeave);
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
    const shouldRun =
      this.animate && this.inView && this.pageVisible && !this.destroyed;

    if (shouldRun && this.frameId === null) {
      this.frameId = requestAnimationFrame(this.tick);
    } else if (!shouldRun && this.frameId !== null) {
      cancelAnimationFrame(this.frameId);
      this.frameId = null;
    }
  }

  tick() {
    this.frameId = requestAnimationFrame(this.tick);

    // Fills and the picture only need updating if the simulation moved something
    if (this.simulation.step(this.cursor)) {
      this.builder.updateFills();
      this.renderer.clearCanvas();
      this.renderer.clear();
      this.drawFrame();
    }
  }

  //----------------------------------------------------//
  // Converting the cloud into renderer layers
  //----------------------------------------------------//

  drawFrame() {
    const styles = this.resolveLayerStyles();

    // Layers are drawn in the order they are added: fills, then cells on top
    this.builder.fillCircles.forEach((circle, i) =>
      this.addFillCircleLayer(circle, `fill-${i}`, styles.fillCircle),
    );
    this.builder.horizontalFillCircles.forEach((circle, i) =>
      this.addFillCircleLayer(circle, `horizontal-fill-${i}`, styles.fillCircle),
    );
    this.renderer.addRightAnglePolygonLayer({
      ...styles.innerLeft,
      key: "inner-left",
      vertices: this.builder.cloudInnerLeft,
    });
    this.renderer.addRightAnglePolygonLayer({
      ...styles.innerRight,
      key: "inner-right",
      vertices: this.builder.cloudInnerRight,
    });
    for (const cell of this.builder.cells) {
      this.addCloudCellLayers(cell, styles);
    }

    this.renderer.draw();
  }

  // Layer styles in the theme refer to colours by name. Resolve them each frame
  // so that colours changed at runtime (e.g. a sunset) are picked up
  resolveLayerStyles() {
    const styles = {};
    for (const [name, style] of Object.entries(this.theme.layers)) {
      styles[name] = { ...style, fill: this.theme.colours[style.fill] };
    }
    return styles;
  }

  // Layer keys identify a shape between frames. The renderer uses them to
  // keep each shape's edge noise stable, so they must not depend on draw order
  addCloudCellLayers(cell, styles) {
    // Add the main cell first
    this.renderer.addCircleLayer({
      ...styles.cell,
      key: `cell-${cell.id}`,
      x: cell.x,
      y: cell.y,
      radius: cell.radius,
      specialType: "cloud-cell",
    });

    // Then all of its fractals, which were grouped by cell when the cloud was built
    cell.darkFractals.forEach((fractal, i) => {
      this.renderer.addCircleLayer({
        ...styles.darkFractal,
        key: `dark-fractal-${cell.id}-${i}`,
        x: cell.x + fractal.x,
        y: cell.y + fractal.y,
        radius: fractal.radius,
        specialType: "dark-fractal",
      });
    });

    cell.lightFractals.forEach((fractal, i) => {
      this.renderer.addCircleLayer({
        ...styles.lightFractal,
        key: `light-fractal-${cell.id}-${i}`,
        x: cell.x + fractal.x,
        y: cell.y + fractal.y,
        radius: fractal.radius,
        rightPadding: fractal.rightPadding,
        specialType: "light-fractal",
      });
    });
  }

  addFillCircleLayer(circle, key, style) {
    this.renderer.addCircleLayer({
      ...style,
      key,
      x: circle.x,
      y: circle.y,
      radius: circle.radius,
    });
  }
}
