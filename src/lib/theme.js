// Everything that controls how a cloud looks, as opposed to its shape.
//
// - colours: named { hue, sat, light } colours. Layers refer to these by name
//   (see `fill` below), so changing a colour here, or at runtime for a sunset,
//   restyles every layer that uses it.
// - background: the sky, as a top colour and optionally a bottom colour to fade to.
//   shadowDiagonal: the edge of the shadow on the cloud. Both are applied to the
//   renderer (HatchedRenderer.applyTheme, updateTheme).
// - cloud: the shape of the cloud, passed to CloudBuilder.
// - animation: durations of the grow and shrink animations.
// - interaction: how the mouse moves the cloud.
// - layers: the style of each kind of shape. Noise values are "plus or minus
//   this many pixels"; padding shifts the edge of the neighbouring segment.
//
// Use createTheme() to get a copy that is safe to modify.

import { lerp, mixColours } from "./utils.js";

export const defaultTheme = {
  colours: {
    light: { hue: 0, sat: 0, light: 100 },
    mid: { hue: 0, sat: 0, light: 75 },
    dark: { hue: 0, sat: 0, light: 50 },
    dark2: { hue: 0, sat: 0, light: 15 },
  },

  background: {
    borderNoise: 3,
    top: { hue: 206, sat: 57, light: 60 },
    // The colour of the paper: what the gaps (padding) beside the layers in a line are
    // drawn in, so they are blank paper. The spaces between the lines are always
    // see-through, and show whatever is behind the canvas on the page. If paper is not
    // set, the gaps are see-through too
    paper: { hue: 0, sat: 0, light: 100 },
    // The colour at the bottom of the sky, fading from the top colour. If it is not
    // set, the whole sky is the top colour
    bottom: undefined,
  },

  // The shape of the cloud. These change which clouds the seeds make, so changing
  // them changes every existing seed
  cloud: {
    // The distance between the middle of the two cells at the base of the cloud is at
    // least this, as a multiple of the dome radius (the size of the cloud). 0 is no minimum
    minBaseWidth: 1,
  },

  shadowDiagonal: {
    enabled: true,
    direction: "left", // The shadow is on the left of the diagonal
    angle: (151 * Math.PI) / 180, // From the bottom x-axis
    xOriginRatio: 0.75, // Where the diagonal meets the bottom of the canvas, as a ratio of the width
    edgeNoise: 30,
  },

  // Timings and shape of the grow and shrink animations
  animation: {
    growDuration: 3200, // ms for a new cloud to grow from nothing
    shrinkDuration: 800, // ms for a cloud to shrink away when it is clicked
    // false: the fractals (the fluff) grow at the same time and rate as the cells.
    // true: they lag behind the cell bodies, starting to appear once the cloud has
    // grown to fractalStart (a fraction of its size) and finishing with it
    fractalLag: false,
    fractalStart: 0.35,
  },

  // How the mouse moves the cloud (see CloudSimulation). The mouse is a force, like a
  // hand moving through water or gas: cells are pushed along by the stroke, faster
  // strokes push harder, heavier cells move less, and a spring slowly returns every
  // cell to where it started. Sizes are in pixels, times in seconds
  interaction: {
    // Whether the mouse moves the cloud at all. Off for now: only clicking does anything
    enabled: false,

    // The hand
    handRadius: 30, // Added to a cell's radius: how close the stroke must pass to push it
    minSpeed: 60, // px/s. Slower strokes do nothing, so a resting or jittering mouse is ignored
    maxSpeed: 2500, // px/s. Faster strokes count as this fast
    speedSmoothing: 0.03, // s. The mouse speed is averaged over about this long
    strength: 3, // How hard a stroke pushes: force per px/s of mouse speed at the reference speed
    // A stroke pushes with a force of speed ^ speedExponent. At 1 a faster stroke pushes
    // harder, but for less time, so it moves a cell no further. At 2, like a hand in
    // water, faster strokes also move cells further
    speedExponent: 2,
    referenceSpeed: 1000, // px/s. strength is the force at this speed
    parting: 0.25, // 0 to 1: how much of the push is directly away from the stroke, not along it
    // 0 to 1: how much of the push acts up and down. 0 is sideways only. Moving cells up and
    // down tears the fills sooner than moving them sideways. Measured as the area of sky
    // showing through the middle of the cloud during random strokes, 0.2 is as good as
    // sideways only, and from 0.3 up some clouds develop large pockets
    verticalStrength: 0.2,

    // The cells
    massExponent: 2, // Mass is (radius / a typical radius) to this power: area for 2

    // Returning to the start
    returnTime: 3, // s for a cell of typical size to return about 90% of the way
    dampingRatio: 1.15, // 1 returns as fast as possible without overshooting; more is slower

    // Cohesion: cells that overlap tug each other along, so the cloud moves as one
    // body and the fills between cells keep their shape
    neighbourStiffness: 4, // As a multiple of the return spring. 0 turns cohesion off
    // The furthest two overlapping cells can be moved out of their resting positions
    // relative to each other, as a fraction of the smaller cell's radius. A hard limit,
    // for if the cohesion springs are not enough. Measured, it made no difference to
    // the tearing of the fills beyond the springs, so it is off (Infinity)
    maxRelativeOffset: Infinity,

    // Limits
    maxOffsetX: 60, // The furthest a cell can be pushed from its start, sideways
    maxOffsetY: 40, // and up or down
    borderPadding: 20, // The closest a cell can get to the edge of the canvas
  },

  layers: {
    cell: {
      fill: "dark2",
      rightEdgeNoise: 4,
      leftEdgeNoise: 7,
      rightPadding: 3, // TODO: Try without
      leftPadding: 0,
      lineWidth: 1.3,
      waveAmplitude: 0.6,
      wavePeriod: 30,
    },
    darkFractal: {
      fill: "dark",
      rightEdgeNoise: 2,
      leftEdgeNoise: 4,
      rightPadding: 0,
      leftPadding: 0,
      lineWidth: 1.4,
      waveAmplitude: 0.7,
      wavePeriod: 30,
    },
    // rightPadding is set per fractal by the cloud builder
    lightFractal: {
      fill: "mid",
      rightEdgeNoise: 4,
      leftEdgeNoise: 4,
      leftPadding: 0,
      waveAmplitude: 0.7,
      wavePeriod: 30,
    },
    // Used for both the centre line fill circles and the horizontal fill circles
    fillCircle: {
      fill: "dark",
      lineWidth: 1.3,
      rightEdgeNoise: 6,
      leftEdgeNoise: 6,
      leftPadding: 0,
      rightPadding: 0,
    },
    // TODO: Top and bottom noise for the inner fills
    innerRight: {
      fill: "dark",
      lineWidth: 1.3,
      rightEdgeNoise: 5,
      leftEdgeNoise: 0,
      leftPadding: 0,
      rightPadding: 0,
    },
    innerLeft: {
      fill: "dark",
      lineWidth: 1.3,
      rightEdgeNoise: 0,
      leftEdgeNoise: 5,
      leftPadding: 0,
      rightPadding: 0,
    },
  },
};

export function createTheme() {
  return structuredClone(defaultTheme);
}

//----------------------------------------------------//
// Sunset, and blending between themes
//----------------------------------------------------//

// The orange of the sunset sky. The hue is just past the red end of orange, so that
// from the blue of the day sky the shortest way round the colour wheel is through
// purple and pink, as in a real sunset, and not through green
const SUNSET_SKY = { hue: 20, sat: 90, light: 62 };
export const SUNSET_SHADOW_ANGLE = (111 * Math.PI) / 180; // From the bottom x-axis
export const SUNSET_SHADOW_X_ORIGIN_RATIO = 0.64;

// The sunset theme: a copy of the theme with only a few things changed
//   shadowAngle, shadowXOriginRatio: where the shadow edge is in the sunset
export function createSunsetTheme(
  base = createTheme(),
  { shadowAngle = SUNSET_SHADOW_ANGLE, shadowXOriginRatio = SUNSET_SHADOW_X_ORIGIN_RATIO } = {},
) {
  const sunset = structuredClone(base);
  sunset.background.top = { ...SUNSET_SKY };
  sunset.background.bottom = undefined; // all orange
  sunset.shadowDiagonal.angle = shadowAngle;
  sunset.shadowDiagonal.xOriginRatio = shadowXOriginRatio;
  return sunset;
}

// The stages of a sunset, from the day to the sunset, as themes to blend between:
//   day: the theme as it is
//   dusk: a blue sky that is orange at the bottom, and the shadow half way there
//   sunset: an all orange sky and the shadow at its end
// Fading back is the same stages in reverse. base is used as the first theme
// itself (not copied), so that it is the one that is kept up to date
export function createSunsetKeyframes(base = createTheme(), sunsetOptions = {}) {
  const sunset = createSunsetTheme(base, sunsetOptions);

  const dusk = structuredClone(base);
  dusk.background.bottom = { ...sunset.background.top };
  dusk.shadowDiagonal.angle = (base.shadowDiagonal.angle + sunset.shadowDiagonal.angle) / 2;
  dusk.shadowDiagonal.xOriginRatio =
    (base.shadowDiagonal.xOriginRatio + sunset.shadowDiagonal.xOriginRatio) / 2;

  return [base, dusk, sunset];
}

// The parts of a theme that blendThemes changes. The rest (animation, interaction,
// layers, cloud) are the same in every stage
export const BLENDED_SECTIONS = ["colours", "background", "shadowDiagonal"];

const isColour = (value) =>
  value && typeof value === "object" && "hue" in value && "sat" in value && "light" in value;

// Blends two values of the same shape. Numbers are mixed, colours are mixed
// along the shortest way round the colour wheel, objects are mixed part by part,
// and anything else (a name, a switch) is a's until the half way point and then b's
function blend(a, b, t) {
  if (typeof a === "number" && typeof b === "number") return lerp(a, b, t);
  if (isColour(a) && isColour(b)) return mixColours(a, b, t);
  if (a && b && typeof a === "object" && typeof b === "object") {
    const blended = {};
    for (const key of Object.keys(a)) blended[key] = blend(a[key], b[key], t);
    return blended;
  }
  return t < 0.5 ? a : b;
}

// A theme t of the way from theme a to theme b
export function blendThemes(a, b, t) {
  const blended = { ...a };
  for (const section of BLENDED_SECTIONS) {
    blended[section] = blend(withBottom(a[section]), withBottom(b[section]), t);
  }
  // Two skies with no bottom colour blend to a sky with no bottom colour
  if (a.background?.bottom === undefined && b.background?.bottom === undefined) {
    blended.background.bottom = undefined;
  }
  return blended;
}

// A background with no bottom colour is the same all the way down, so for blending
// it has a bottom that is the top
function withBottom(section) {
  if (!section || !("top" in section)) return section;
  return { ...section, bottom: section.bottom ?? section.top };
}

// The theme part of the way through a list of themes: 0 is the first, 1 is the last,
// and the others are evenly spaced between
export function themeAtProgress(keyframes, progress) {
  if (keyframes.length === 1) return keyframes[0];

  const position = Math.min(Math.max(progress, 0), 1) * (keyframes.length - 1);
  const index = Math.min(Math.floor(position), keyframes.length - 2);

  // Exactly on a theme, it is that theme as it is, with nothing blended in
  const t = position - index;
  if (t === 0) return keyframes[index];
  if (t === 1) return keyframes[index + 1];
  return blendThemes(keyframes[index], keyframes[index + 1], t);
}
