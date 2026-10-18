// Everything that controls how a cloud looks, as opposed to its shape.
//
// - colours: named { hue, sat, light } colours. Layers refer to these by name
//   (see `fill` below), so changing a colour here, or at runtime for a sunset,
//   restyles every layer that uses it.
// - background / shadowDiagonal: applied to the renderer (HatchedRenderer.applyTheme).
// - animation: durations of the grow and shrink animations.
// - interaction: how the mouse moves the cloud.
// - layers: the style of each kind of shape. Noise values are "plus or minus
//   this many pixels"; padding shifts the edge of the neighbouring segment.
//
// Use createTheme() to get a copy that is safe to modify.

export const defaultTheme = {
  colours: {
    background: { hue: 206, sat: 57, light: 60 },
    light: { hue: 0, sat: 0, light: 100 },
    mid: { hue: 0, sat: 0, light: 75 },
    dark: { hue: 0, sat: 0, light: 50 },
    dark2: { hue: 0, sat: 0, light: 15 },
  },

  background: {
    borderNoise: 3,
  },

  shadowDiagonal: {
    enabled: true,
    direction: "left", // The shadow is on the left of the diagonal
    angle: (5 * Math.PI) / 6, // From the bottom x-axis
    xOriginRatio: 0.7, // Where the diagonal meets the bottom of the canvas, as a ratio of the width
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
