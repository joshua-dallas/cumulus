// Everything that controls how a cloud looks, as opposed to its shape.
//
// - colours: named { hue, sat, light } colours. Layers refer to these by name
//   (see `fill` below), so changing a colour here, or at runtime for a sunset,
//   restyles every layer that uses it.
// - background / shadowDiagonal: applied to the renderer (HatchedRenderer.applyTheme).
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
