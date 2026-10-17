import { CumulusController } from "./lib/cumulus-controller.js";

const DEFAULTS = {
  width: 500,
  height: 500,
  numCells: 15,
  seed: 5, // TODO: randomize seed if not provided. 323 is good
  lineWidth: 1,
  lineSpacing: 1.5,
};

const RESIZE_DEBOUNCE_MS = 150;

// The <cumulus-canvas> element: owns the DOM (shadow root and canvas), reads
// attributes, and decides when the cloud must be rebuilt. Everything to do with
// the cloud itself lives in CumulusController.
//
// Sizing: width/height attributes set a fixed size. A dimension without an
// attribute takes the element's own CSS size (so the cloud can fill its
// container), falling back to the default if the element has none.
//
// Anything that changes the cloud (attribute, resize, reduced-motion
// preference) ends in rebuild(), which replaces the controller.
export class Cumulus extends HTMLElement {
  // Attribute names are lower case because HTML lower-cases attribute names
  static observedAttributes = [
    "width",
    "height",
    "numcells",
    "seed",
    "linewidth",
    "linespacing",
  ];

  constructor() {
    super();
    this.controller = null;
    this.size = null; // The size the current controller was built with
    this.rebuildTimer = null;
    this.inView = true;
    this.reducedMotionQuery = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    );

    this.onReducedMotionChange = () => this.scheduleRebuild();
    this.onVisibilityChange = () => this.controller?.setPageVisible(!document.hidden);
  }

  connectedCallback() {
    // The shadow root and canvas survive disconnection, so create them only once
    if (!this.shadowRoot) {
      const shadow = this.attachShadow({ mode: "open" });
      const style = document.createElement("style");
      style.textContent = `
        :host { display: inline-block; line-height: 0; }
        canvas { display: block; }
      `;
      this.canvas = document.createElement("canvas");
      shadow.append(style, this.canvas);
    }

    // Pause the animation when scrolled out of view
    this.intersectionObserver = new IntersectionObserver((entries) => {
      this.inView = entries[entries.length - 1].isIntersecting;
      this.controller?.setInView(this.inView);
    });
    this.intersectionObserver.observe(this);

    // Rebuild when the element is resized
    this.resizeObserver = new ResizeObserver(() => {
      if (this.sizeHasChanged()) this.scheduleRebuild(RESIZE_DEBOUNCE_MS);
    });
    this.resizeObserver.observe(this);

    document.addEventListener("visibilitychange", this.onVisibilityChange);
    this.reducedMotionQuery.addEventListener(
      "change",
      this.onReducedMotionChange,
    );

    this.rebuild();
  }

  disconnectedCallback() {
    clearTimeout(this.rebuildTimer);
    this.rebuildTimer = null;
    this.intersectionObserver?.disconnect();
    this.resizeObserver?.disconnect();
    document.removeEventListener("visibilitychange", this.onVisibilityChange);
    this.reducedMotionQuery.removeEventListener(
      "change",
      this.onReducedMotionChange,
    );
    this.controller?.destroy();
    this.controller = null;
    this.size = null;
  }

  attributeChangedCallback(name, oldValue, newValue) {
    // Attributes present in the markup are reported before the element is
    // connected. connectedCallback builds from them, so there is nothing to do
    if (oldValue === newValue || !this.controller) return;
    this.scheduleRebuild();
  }

  // Several attributes are often changed together, so changes are batched
  // into a single rebuild
  scheduleRebuild(delay = 0) {
    clearTimeout(this.rebuildTimer);
    this.rebuildTimer = setTimeout(() => {
      this.rebuildTimer = null;
      if (this.isConnected) this.rebuild();
    }, delay);
  }

  rebuild() {
    this.controller?.destroy();

    const config = this.readConfig();
    this.size = { width: config.width, height: config.height };
    this.controller = new CumulusController(this.canvas, config);
    this.controller.setInView(this.inView);
    this.controller.setPageVisible(!document.hidden);
  }

  readConfig() {
    const { width, height } = this.measure({ ignoreCanvas: true });
    return {
      width,
      height,
      numCells: Math.max(
        1,
        Math.floor(this.numberAttribute("numcells", DEFAULTS.numCells)),
      ),
      seed: this.numberAttribute("seed", DEFAULTS.seed),
      lineWidth: this.positiveAttribute("linewidth", DEFAULTS.lineWidth),
      lineSpacing: Math.max(
        0,
        this.numberAttribute("linespacing", DEFAULTS.lineSpacing),
      ),
      animate: !this.reducedMotionQuery.matches,
    };
  }

  // The size the cloud should have: attributes first, then the element's CSS size
  measure({ ignoreCanvas = false } = {}) {
    if (ignoreCanvas) {
      // The element is sized to fit its canvas unless CSS says otherwise.
      // Collapse the canvas so that its old size is not mistaken for the CSS size
      this.canvas.style.width = "0px";
      this.canvas.style.height = "0px";
    }
    const rect = this.getBoundingClientRect();
    return {
      width:
        this.positiveAttribute("width", 0) ||
        Math.round(rect.width) ||
        DEFAULTS.width,
      height:
        this.positiveAttribute("height", 0) ||
        Math.round(rect.height) ||
        DEFAULTS.height,
    };
  }

  sizeHasChanged() {
    if (!this.size) return false;
    const { width, height } = this.measure();
    return width !== this.size.width || height !== this.size.height;
  }

  numberAttribute(name, fallback) {
    const raw = this.getAttribute(name);
    if (raw === null || raw.trim() === "") return fallback;
    const value = Number(raw);
    return Number.isFinite(value) ? value : fallback;
  }

  positiveAttribute(name, fallback) {
    const value = this.numberAttribute(name, fallback);
    return value > 0 ? value : fallback;
  }
}
