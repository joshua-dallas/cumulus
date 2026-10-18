import { CumulusController } from "./cumulus-controller.js";

// Where a cloud runs. The element talks to a host, which is either a worker (the cloud
// is built, simulated and drawn off the main thread, onto a transferred OffscreenCanvas)
// or, where workers cannot draw to a canvas, the main thread. Both have the same methods:
//   build(config)                   replaces the cloud (config as for CumulusController)
//   setInView(), setPageVisible(), setSunset(on, duration), setShadowDiagonal(settings), setThemeValues(values)
//   seed                            the seed of the cloud on show
//   destroy()
// config.onSeedChange is called on the main thread either way.

export function workersCanDraw(canvas) {
  return (
    typeof Worker !== "undefined" &&
    typeof OffscreenCanvas !== "undefined" &&
    typeof canvas.transferControlToOffscreen === "function"
  );
}

export class MainThreadHost {
  constructor(canvas) {
    this.canvas = canvas;
    this.controller = null;
  }

  build(config) {
    this.controller?.destroy();
    this.controller = new CumulusController(this.canvas, config);
  }

  get seed() {
    return this.controller?.seed;
  }

  setInView(value) {
    this.controller?.setInView(value);
  }

  setPageVisible(value) {
    this.controller?.setPageVisible(value);
  }

  setSunset(on, duration) {
    this.controller?.setSunset(on, duration);
  }

  setShadowDiagonal(settings) {
    this.controller?.setShadowDiagonal(settings);
  }

  setThemeValues(values) {
    this.controller?.setThemeValues(values);
  }

  destroy() {
    this.controller?.destroy();
    this.controller = null;
  }
}

// The canvas can be handed to a worker only once, so a WorkerHost owns its canvas for good:
// it builds every cloud for it, and destroying the host ends the canvas.
export class WorkerHost {
  constructor(canvas) {
    this.canvas = canvas;
    this.worker = new Worker(new URL("./cumulus-worker.js", import.meta.url), {
      type: "module",
    });
    this.worker.onmessage = ({ data }) => this.onMessage(data);

    const offscreen = canvas.transferControlToOffscreen();
    this.worker.postMessage({ type: "init", canvas: offscreen }, [offscreen]);

    this.seed = undefined;
    this.onSeedChange = null;
    this.buildId = 0;
    this.pointerListeners = [];
  }

  build(config) {
    const { onSeedChange, ...plain } = config;
    this.onSeedChange = onSeedChange;
    this.seed = config.seed;
    this.removePointerListeners();

    // The worker has no window, so it is told the pixel ratio. The canvas is sized here
    // (the worker sets its pixel size, but an OffscreenCanvas has no style)
    this.canvas.style.width = `${config.width}px`;
    this.canvas.style.height = `${config.height}px`;
    this.worker.postMessage({
      type: "build",
      buildId: ++this.buildId,
      config: { ...plain, pixelRatio: window.devicePixelRatio || 1 },
    });
  }

  onMessage(data) {
    switch (data.type) {
      case "built":
        // Only follow the mouse if the cloud can use it, and ignore a cloud already replaced
        if (data.buildId === this.buildId && data.followsMouse) this.addPointerListeners();
        break;
      case "seedchange":
        this.seed = data.seed;
        this.onSeedChange?.(data.seed);
        break;
      case "cursor":
        this.canvas.style.cursor = data.cursor;
        break;
    }
  }

  // Mouse events happen on the real canvas. They are sent to the worker as positions in
  // canvas pixels
  addPointerListeners() {
    const position = (event) => {
      const rect = this.canvas.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };
    this.pointerListeners = [
      ["mousemove", (event) => this.worker.postMessage({ type: "pointermove", ...position(event) })],
      ["mouseleave", () => this.worker.postMessage({ type: "pointerleave" })],
      ["click", (event) => this.worker.postMessage({ type: "pointerclick", ...position(event) })],
    ];
    for (const [type, handler] of this.pointerListeners) {
      this.canvas.addEventListener(type, handler);
    }
  }

  removePointerListeners() {
    for (const [type, handler] of this.pointerListeners) {
      this.canvas.removeEventListener(type, handler);
    }
    this.pointerListeners = [];
    this.canvas.style.cursor = "";
  }

  setInView(value) {
    this.worker.postMessage({ type: "inview", value });
  }

  setPageVisible(value) {
    this.worker.postMessage({ type: "pagevisible", value });
  }

  setSunset(on, duration) {
    this.worker.postMessage({ type: "sunset", on, duration });
  }

  setShadowDiagonal(settings) {
    this.worker.postMessage({ type: "shadow", settings });
  }

  setThemeValues(values) {
    this.worker.postMessage({ type: "themevalues", values });
  }

  destroy() {
    this.removePointerListeners();
    this.worker.terminate();
  }
}
