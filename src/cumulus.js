import { mergeThemeValues } from "./lib/theme.js";
import { MainThreadHost, WorkerHost, workersCanDraw } from "./lib/cumulus-host.js";

const DEFAULTS = {
  width: 500,
  height: 500,
  numCells: 15,
  lineWidth: 1,
  lineSpacing: 1.5,
  sunsetDuration: 6000, // ms
};

const RESIZE_DEBOUNCE_MS = 150;
const RANDOM_SEED_RANGE = 1e6; // A cloud with no seed attribute gets a seed below this

/**
 * The edge of the shadow on the cloud. Angles are in radians.
 * @typedef {object} ShadowEdge
 * @property {number} [angle] The angle of the edge from the horizontal.
 * @property {number} [xOriginOffset] Where the edge meets the base of the dome, measured
 *   from the dome centre in dome radii. Negative is left.
 */

/**
 * @typedef {object} ShadowDiagonalSettings
 * @property {ShadowEdge} [day] The shadow edge in daylight.
 * @property {ShadowEdge} [sunset] The shadow edge in the sunset.
 */

/**
 * A colour in HSL: hue in degrees, saturation and lightness in percent.
 * @typedef {{ hue?: number, sat?: number, light?: number }} Colour
 */

/**
 * Theme values to change. Only the values given are changed.
 * @typedef {object} ThemeValues
 * @property {Record<string, Colour>} [colours] Colours of the palette, by name
 *   (for example `dark`, `mid`).
 * @property {Record<string, Record<string, number | string>>} [layers] Style values of
 *   each kind of shape (for example `cell`, `lightFractal`), by layer name.
 */

/**
 * The `detail` of the `seedchange` event.
 * @typedef {{ seed: number }} SeedChangeDetail
 */

// The <cumulus-canvas> element: owns the DOM (shadow root and canvas), reads
// attributes, and decides when the cloud must be rebuilt. Everything to do with
// the cloud itself lives in CumulusController, which runs in a worker (so it never blocks
// the page) where the browser lets a worker draw to a canvas, and on the main thread
// where it does not. See cumulus-host.js.
//
// Optional behaviours, off unless the attribute is present (`growIn`,
// `regenerateOnClick`, `mouseRepel`; write ="false" to turn one off explicitly):
//   growIn             the cloud grows from nothing when the element is first
//                      created (not when it is rebuilt for a resize)
//   regenerateOnClick  clicking the cloud shrinks it away and grows a new one
//   mouseRepel         cells slide out of the way of the mouse
//   sunset             the sky is a sunset. Adding or removing the attribute fades
//                      to or from one, over sunsetDuration ms (default 6000)
//
// setShadowDiagonal({ day: { angle, xOriginOffset }, sunset: { ... } }) moves the edge
// of the shadow, in radians, for the day and for the sunset.
//
// setThemeValues({ colours: { dark: { light } }, layers: { cell: { lineWidth } } }) changes
// the shades and the line widths, wave periods and wave amplitudes of the layers.
// Only the values passed are changed. A layer's paddingScale multiplies its padding:
//   setThemeValues({ layers: { cell: { paddingScale: 0.5 }, lightFractal: { paddingScale: 0.5 } } })
//
// The seed of the cloud on show is the property `currentSeed`. When a click gives
// the cloud a new seed, the element fires a `seedchange` event with { seed } in
// its detail.
//
// Sizing: width/height attributes set a fixed size. A dimension without an
// attribute takes the element's own CSS size (so the cloud can fill its
// container), falling back to the default if the element has none.
//
// Anything that changes the cloud (attribute, resize, reduced-motion
// preference) ends in rebuild(), which replaces the cloud.
export class Cumulus extends HTMLElement {
  /** The attributes that rebuild or restyle the cloud. Lower case, as HTML lower-cases them. */
  static observedAttributes = [
    "width",
    "height",
    "numcells",
    "seed",
    "linewidth",
    "linespacing",
    "growin",
    "regenerateonclick",
    "mouserepel",
    "sunset",
    "sunsetduration",
  ];

  constructor() {
    super();
    /** @internal @type {unknown} */
    this.host = null; // Where the cloud runs: in a worker, or on the main thread
    /** @internal @type {{ width: number, height: number } | null} */
    this.size = null; // The size the current cloud was built with
    /** @internal @type {boolean} */
    this.hasBuilt = false; // Grow-in only plays the first time
    // Used while there is no seed attribute. Chosen once, so a rebuild keeps the cloud
    /** @internal @type {number} */
    this.randomSeed = Math.floor(Math.random() * RANDOM_SEED_RANGE);
    /** @internal @type {number | null} */
    this.seedOverride = null; // The seed of a cloud made by clicking, kept across rebuilds
    /** @internal @type {ShadowDiagonalSettings} */
    this.shadowSettings = { day: {}, sunset: {} }; // Set with setShadowDiagonal, kept across rebuilds
    /** @internal @type {ThemeValues} */
    this.themeValues = {}; // Set with setThemeValues, kept across rebuilds
    /** @internal @type {number | null} */
    this.rebuildTimer = null;
    /** @internal @type {boolean} */
    this.inView = true;
    /** @internal @type {MediaQueryList} */
    this.reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

    /** @internal @type {() => void} */
    this.onReducedMotionChange = () => this.scheduleRebuild();
    /** @internal @type {() => void} */
    this.onVisibilityChange = () => this.host?.setPageVisible(!document.hidden);
  }

  /** @internal */
  connectedCallback() {
    // The shadow root survives disconnection, so create it only once
    if (!this.shadowRoot) {
      const shadow = this.attachShadow({ mode: "open" });
      const style = document.createElement("style");
      style.textContent = `
        :host { display: inline-block; line-height: 0; }
        canvas { display: block; }
      `;
      shadow.append(style);
    }
    // A canvas given to a worker cannot be used again, so it is replaced on reconnect
    if (!this.canvas) {
      /** @internal @type {HTMLCanvasElement | null} */
      this.canvas = document.createElement("canvas");
      this.shadowRoot.append(this.canvas);
    }

    // Pause the animation when scrolled out of view
    /** @internal @type {IntersectionObserver} */
    this.intersectionObserver = new IntersectionObserver((entries) => {
      this.inView = entries[entries.length - 1].isIntersecting;
      this.host?.setInView(this.inView);
    });
    this.intersectionObserver.observe(this);

    // Rebuild when the element is resized
    /** @internal @type {ResizeObserver} */
    this.resizeObserver = new ResizeObserver(() => {
      if (this.sizeHasChanged()) this.scheduleRebuild(RESIZE_DEBOUNCE_MS);
    });
    this.resizeObserver.observe(this);

    document.addEventListener("visibilitychange", this.onVisibilityChange);
    this.reducedMotionQuery.addEventListener("change", this.onReducedMotionChange);

    this.rebuild();
  }

  /** @internal */
  disconnectedCallback() {
    clearTimeout(this.rebuildTimer);
    this.rebuildTimer = null;
    this.intersectionObserver?.disconnect();
    this.resizeObserver?.disconnect();
    document.removeEventListener("visibilitychange", this.onVisibilityChange);
    this.reducedMotionQuery.removeEventListener("change", this.onReducedMotionChange);
    this.host?.destroy();
    if (this.host instanceof WorkerHost) {
      this.canvas.remove();
      this.canvas = null;
    }
    this.host = null;
    this.size = null;
  }

  /**
   * @internal
   * @param {string} name
   * @param {string | null} oldValue
   * @param {string | null} newValue
   */
  attributeChangedCallback(name, oldValue, newValue) {
    // Attributes present in the markup are reported before the element is
    // connected. connectedCallback builds from them, so there is nothing to do
    if (oldValue === newValue || !this.host) return;

    // The sunset fades in or out, with no need to rebuild the cloud
    if (name === "sunset") {
      this.host.setSunset(this.booleanAttribute("sunset"), this.sunsetDuration());
      return;
    }
    if (name === "sunsetduration") return; // used the next time the sunset changes

    if (name === "seed") this.seedOverride = null; // the new attribute wins
    this.scheduleRebuild();
  }

  /** @internal */
  // Several attributes are often changed together, so changes are batched
  // into a single rebuild
  scheduleRebuild(delay = 0) {
    clearTimeout(this.rebuildTimer);
    this.rebuildTimer = setTimeout(() => {
      this.rebuildTimer = null;
      if (this.isConnected) this.rebuild();
    }, delay);
  }

  /** @internal */
  rebuild() {
    this.host ??= workersCanDraw(this.canvas)
      ? new WorkerHost(this.canvas)
      : new MainThreadHost(this.canvas);

    const config = this.readConfig();
    this.size = { width: config.width, height: config.height };
    this.host.build(config);
    this.hasBuilt = true;
    this.host.setInView(this.inView);
    this.host.setPageVisible(!document.hidden);
  }

  /** @internal */
  readConfig() {
    const { width, height } = this.measure({ ignoreCanvas: true });
    return {
      width,
      height,
      numCells: Math.max(1, Math.floor(this.numberAttribute("numcells", DEFAULTS.numCells))),
      // A cloud made by clicking keeps its seed if the element is rebuilt (resized)
      seed: this.seedOverride ?? this.numberAttribute("seed", this.randomSeed),
      lineWidth: this.positiveAttribute("linewidth", DEFAULTS.lineWidth),
      lineSpacing: Math.max(0, this.numberAttribute("linespacing", DEFAULTS.lineSpacing)),
      animate: !this.reducedMotionQuery.matches,
      growIn: !this.hasBuilt && this.booleanAttribute("growin"),
      regenerateOnClick: this.booleanAttribute("regenerateonclick"),
      mouseRepel: this.booleanAttribute("mouserepel"),
      sunset: this.booleanAttribute("sunset"),
      sunsetDuration: this.sunsetDuration(),
      shadowDiagonal: structuredClone(this.shadowSettings),
      themeValues: structuredClone(this.themeValues),
      onSeedChange: (seed) => {
        this.seedOverride = seed;
        this.dispatchEvent(
          new CustomEvent("seedchange", { detail: { seed }, bubbles: true, composed: true }),
        );
      },
    };
  }

  /**
   * Moves the edge of the shadow, for the day and for the sunset. Anything left out is
   * unchanged.
   * @param {ShadowDiagonalSettings} settings
   */
  setShadowDiagonal({ day = {}, sunset = {} }) {
    Object.assign(this.shadowSettings.day, day);
    Object.assign(this.shadowSettings.sunset, sunset);
    this.host?.setShadowDiagonal({ day, sunset });
  }

  /**
   * Changes colours and layer styles of the theme, for example
   * `{ colours: { dark: { light: 40 } }, layers: { cell: { lineWidth: 1.5 } } }`.
   * @param {ThemeValues} values
   */
  setThemeValues(values) {
    mergeThemeValues(this.themeValues, structuredClone(values));
    this.host?.setThemeValues(values);
  }

  /**
   * The seed of the cloud on show.
   * @type {number | undefined}
   */
  get currentSeed() {
    return this.host?.seed;
  }

  /** @internal */
  sunsetDuration() {
    return this.positiveAttribute("sunsetduration", DEFAULTS.sunsetDuration);
  }

  /** @internal */
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
      width: this.positiveAttribute("width", 0) || Math.round(rect.width) || DEFAULTS.width,
      height: this.positiveAttribute("height", 0) || Math.round(rect.height) || DEFAULTS.height,
    };
  }

  /** @internal */
  sizeHasChanged() {
    if (!this.size) return false;
    const { width, height } = this.measure();
    return width !== this.size.width || height !== this.size.height;
  }

  /** @internal */
  numberAttribute(name, fallback) {
    const raw = this.getAttribute(name);
    if (raw === null || raw.trim() === "") return fallback;
    const value = Number(raw);
    return Number.isFinite(value) ? value : fallback;
  }

  /** @internal */
  // A boolean attribute is on if it is present, unless it says it is not
  booleanAttribute(name) {
    const raw = this.getAttribute(name);
    if (raw === null) return false;
    return !["false", "0", "off", "no"].includes(raw.trim().toLowerCase());
  }

  /** @internal */
  positiveAttribute(name, fallback) {
    const value = this.numberAttribute(name, fallback);
    return value > 0 ? value : fallback;
  }
}
