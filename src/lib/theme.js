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
//   paddingScale (default 1) multiplies a layer's padding, including the
//   per-fractal padding of the light fractals (e.g. less padding on a small screen).
//
// Use createTheme() to get a copy that is safe to modify.

import { lerp, mixColours } from "./utils.js";

export const defaultTheme = {
  colours: {
    light: { hue: 0, sat: 0, light: 75 },
    mid: { hue: 0, sat: 0, light: 66 },
    dark: { hue: 0, sat: 0, light: 45 },
    dark2: { hue: 0, sat: 0, light: 10 },
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
    // Where the diagonal meets the base of the dome (the flat bottom of the cloud): how far
    // along the base from the dome's centre, in dome radii (negative is to the left)
    xOriginOffset: -0.2375,
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

  // How the mouse moves the cloud (see CloudSimulation)
  interaction: {
    // Cells near the cursor slide sideways, just far enough to be out of its way, and
    // return when it leaves (CloudSimulation.moveCellsWithMouse). Set by the mouseRepel
    // attribute
    repel: false,
  },

  layers: {
    cell: {
      fill: "mid",
      paddingScale: 1,
      rightEdgeNoise: 4,
      leftEdgeNoise: 7,
      rightPadding: 3,
      leftPadding: 0,
      lineWidth: 1.3,
      waveAmplitude: 0.6,
      wavePeriod: 30,
    },
    darkFractal: {
      fill: "dark2",
      paddingScale: 1,
      rightEdgeNoise: 2,
      leftEdgeNoise: 4,
      rightPadding: 0,
      leftPadding: 0,
      lineWidth: 1,
      waveAmplitude: 0.8,
      wavePeriod: 30,
    },
    // rightPadding is set per fractal by the cloud builder
    lightFractal: {
      fill: "light",
      paddingScale: 1,
      rightEdgeNoise: 4,
      leftEdgeNoise: 4,
      leftPadding: 0,
      waveAmplitude: 0.7,
      wavePeriod: 30,
    },
    // Used for both the centre line fill circles and the horizontal fill circles
    fillCircle: {
      fill: "dark",
      paddingScale: 1,
      lineWidth: 1.3,
      rightEdgeNoise: 6,
      leftEdgeNoise: 6,
      leftPadding: 0,
      rightPadding: 0,
    },
    innerRight: {
      fill: "dark",
      paddingScale: 1,
      lineWidth: 1.3,
      rightEdgeNoise: 5,
      leftEdgeNoise: 0,
      leftPadding: 0,
      rightPadding: 0,
    },
    innerLeft: {
      fill: "dark",
      paddingScale: 1,
      lineWidth: 1.3,
      rightEdgeNoise: 0,
      leftEdgeNoise: 5,
      leftPadding: 0,
      rightPadding: 0,
    },
  },
};

// Writes values into a theme (or a stage of a sunset), keeping everything else:
//   { colours: { dark: { light: 40 } }, layers: { cell: { lineWidth: 1.5 } } }
// Objects are merged level by level, anything else is replaced
export function mergeThemeValues(theme, values = {}) {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) continue;
    if (value && typeof value === "object" && theme[key] && typeof theme[key] === "object") {
      mergeThemeValues(theme[key], value);
    } else {
      theme[key] = value;
    }
  }
  return theme;
}

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
export const SUNSET_SHADOW_X_ORIGIN_OFFSET = 0.231;

// The sunset theme: a copy of the theme with only a few things changed
//   shadowAngle, shadowXOriginOffset: where the shadow edge is in the sunset
export function createSunsetTheme(
  base = createTheme(),
  { shadowAngle = SUNSET_SHADOW_ANGLE, shadowXOriginOffset = SUNSET_SHADOW_X_ORIGIN_OFFSET } = {},
) {
  const sunset = structuredClone(base);
  sunset.background.top = { ...SUNSET_SKY };
  sunset.background.bottom = undefined; // all orange
  sunset.shadowDiagonal.angle = shadowAngle;
  sunset.shadowDiagonal.xOriginOffset = shadowXOriginOffset;
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
  dusk.shadowDiagonal.xOriginOffset =
    (base.shadowDiagonal.xOriginOffset + sunset.shadowDiagonal.xOriginOffset) / 2;

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
