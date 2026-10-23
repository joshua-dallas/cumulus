import "./helpers.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { HatchedRenderer } from "../src/lib/hatched-renderer.js";
import { mockCanvas } from "./helpers.js";
import { createTheme } from "../src/lib/theme.js";

// A renderer with 100px wide lines and a full-width background on line 0
function setup() {
  const renderer = new HatchedRenderer(mockCanvas(), 100, 50, 1, 1.5);
  renderer.generateLines();
  const line = renderer.lines[0];
  renderer.addSegment(line.id, 0, 100, undefined, true);
  return { renderer, line };
}

// Adds a layer (and its padding) to a line, the way addCircleLayer does
function addLayer(renderer, line, startX, endX, config = {}) {
  const layer = { id: renderer.layers.length, ...config };
  renderer.layers.push(layer);
  renderer.addLayerSegment(line, startX, endX, layer);
  return layer;
}

// What is visible at x: a layer id, "background", "gap" (padding) or "none".
// In shadow there is no padding, so what the gap cleared is visible instead.
function visibleAt(segments, x, inShadow = false) {
  const segment = segments.find((s) => s.startX <= x && x < s.endX);
  if (!segment) return "none";
  if (segment.isGap) return inShadow ? visibleAt(segment.under, x, true) : "gap";
  return segment.isBackground ? "background" : segment.layerId;
}

test("a new segment is written over the ones beneath it, keeping the list sorted", () => {
  const { renderer, line } = setup();
  renderer.addSegment(line.id, 40, 60, 1, false);
  renderer.addSegment(line.id, 10, 20, 2, false);
  renderer.addSegment(line.id, 50, 80, 3, false); // overlaps the end of segment 1

  const summary = line.segments.map((s) => [s.startX, s.endX, s.layerId]);
  assert.deepEqual(summary, [
    [0, 10, undefined],
    [10, 20, 2],
    [20, 40, undefined],
    [40, 50, 1],
    [50, 80, 3],
    [80, 100, undefined],
  ]);
});

test("a segment placed inside another splits it in two", () => {
  const { renderer, line } = setup();
  renderer.addSegment(line.id, 40, 60, 1, false);
  const summary = line.segments.map((s) => [s.startX, s.endX]);
  assert.deepEqual(summary, [
    [0, 40],
    [40, 60],
    [60, 100],
  ]);
});

test("padding is a gap beside the layer, on both sides", () => {
  const { renderer, line } = setup();
  addLayer(renderer, line, 40, 60, { leftPadding: 3, rightPadding: 5 });

  assert.equal(visibleAt(line.segments, 38), "gap");
  assert.equal(visibleAt(line.segments, 41), 0);
  assert.equal(visibleAt(line.segments, 62), "gap");
  assert.equal(visibleAt(line.segments, 66), "background");
});

test("padding is the full width even when the segment next to it is narrower", () => {
  const { renderer, line } = setup();
  addLayer(renderer, line, 63, 66, {}); // a thin segment just right of the layer
  addLayer(renderer, line, 40, 60, { rightPadding: 6 });

  // The gap spans the thin segment and on into the background: 60 to 66
  for (const x of [61, 64, 65.5]) assert.equal(visibleAt(line.segments, x), "gap");
  assert.equal(visibleAt(line.segments, 67), "background");
});

test("padding stays visible when the layer it belongs to is covered", () => {
  const { renderer, line } = setup();
  addLayer(renderer, line, 30, 40, { rightPadding: 5 }); // padding covers 40 to 45
  addLayer(renderer, line, 25, 42, {}); // covers the layer and the start of its padding

  assert.equal(visibleAt(line.segments, 35), 1); // the layer is hidden
  assert.equal(visibleAt(line.segments, 41), 1); // the covering layer wins over the padding
  assert.equal(visibleAt(line.segments, 43), "gap"); // the rest of the padding remains
  assert.equal(visibleAt(line.segments, 46), "background");
});

test("a later layer is drawn over earlier padding", () => {
  const { renderer, line } = setup();
  addLayer(renderer, line, 10, 20, { rightPadding: 6 });
  addLayer(renderer, line, 22, 30, {});

  assert.equal(visibleAt(line.segments, 21), "gap");
  assert.equal(visibleAt(line.segments, 25), 1);
});

test("padding is drawn as paper; in shadow there is no padding, and what it cleared is drawn instead", () => {
  const { renderer, line } = setup();
  addLayer(renderer, line, 40, 60, { rightPadding: 10 });

  const drawn = [];
  renderer.drawSegment = (x1, x2, ln, segment) => {
    const what = segment.isGap ? "paper" : segment.isBackground ? "background" : segment.layerId;
    drawn.push([x1, x2, what]);
  };
  const drawnInOrder = () => drawn.sort((a, b) => a[0] - b[0]);

  renderer.hasShadowDiagonal = false;
  renderer.drawLine(line);
  assert.deepEqual(drawnInOrder(), [
    [0, 40, "background"],
    [40, 60, 0],
    [60, 70, "paper"],
    [70, 100, "background"],
  ]);

  // Everything left of x = 65 is in shadow, so the padding there (60 to 65) shows what it cleared
  drawn.length = 0;
  renderer.hasShadowDiagonal = true;
  renderer.shadowDiagonalDirection = "left";
  renderer.shadowDiagonalLocations = [65];
  renderer.drawLine(line);
  assert.deepEqual(drawnInOrder(), [
    [0, 40, "background"],
    [40, 60, 0],
    [60, 65, "background"],
    [65, 70, "paper"],
    [70, 100, "background"],
  ]);

  // With no paper, the gap is left see-through
  drawn.length = 0;
  renderer.hasShadowDiagonal = false;
  renderer.paper = undefined;
  renderer.drawLine(line);
  assert.deepEqual(drawnInOrder(), [
    [0, 40, "background"],
    [40, 60, 0],
    [70, 100, "background"],
  ]);
});

test("edge noise is remembered per layer key, even if the layer has a different index", () => {
  const { renderer } = setup();
  const layer = { id: 0, key: "cell-1", leftEdgeNoise: 6, rightEdgeNoise: 6 };

  const first = renderer.addEdgeNoise(10, 20, layer, 0);
  assert.deepEqual(renderer.addEdgeNoise(10, 20, layer, 0), first);
  assert.deepEqual(renderer.addEdgeNoise(10, 20, { ...layer, id: 7 }, 0), first);
  assert.equal(renderer.noise.layerEdge.size, 1);
});

test("edge noise scales with its range without being rolled again", () => {
  const { renderer } = setup();
  const layer = { id: 0, key: "cell-1", leftEdgeNoise: 100, rightEdgeNoise: 100 };
  const big = renderer.addEdgeNoise(0, 0, layer, 0);
  const small = renderer.addEdgeNoise(0, 0, { ...layer, leftEdgeNoise: 50, rightEdgeNoise: 50 }, 0);
  small.forEach((offset, i) => assert.ok(Math.abs(offset - big[i] / 2) <= 0.5)); // same noise, half the range
  assert.ok(big.some((offset) => offset !== 0));
});

test("edge noise depends on the seed, the edge and the line, not on what was drawn before", () => {
  const edges = (seed, order) => {
    const renderer = new HatchedRenderer(mockCanvas(), 100, 50, 1, 1.5, undefined, seed);
    const layer = { id: 0, key: "cell-1", leftEdgeNoise: 1000, rightEdgeNoise: 1000 };
    const result = {};
    for (const lineId of order) result[lineId] = renderer.addEdgeNoise(0, 0, layer, lineId);
    return result;
  };
  assert.deepEqual(edges(7, [0, 1, 2, 3]), edges(7, [3, 1, 0, 2]));
  assert.notDeepEqual(edges(7, [0, 1, 2, 3]), edges(8, [0, 1, 2, 3]));
  const { 0: line0, 1: line1 } = edges(7, [0, 1]);
  assert.notDeepEqual(line0, line1);
  assert.notEqual(line0[0], line0[1]); // left and right edges differ
});

test("setEdgeSeed gives the edges new noise and leaves the rest of the noise alone", () => {
  const make = (seed) => {
    const renderer = new HatchedRenderer(mockCanvas(), 120, 60, 1, 1.5, undefined, seed);
    renderer.generateLines();
    renderer.applyTheme(createTheme());
    renderer.finaliseRenderer();
    return renderer;
  };
  const layer = { id: 0, key: "cell-1", leftEdgeNoise: 1000, rightEdgeNoise: 1000 };
  const edges = (renderer) =>
    [0, 1, 2, 3].map((lineId) => renderer.addEdgeNoise(0, 0, layer, lineId));

  const renderer = make(5);
  const before = edges(renderer);
  const otherNoise = structuredClone({ ...renderer.noise, layerEdge: undefined });
  assert.equal(renderer.noise.layerEdge.size, 1);

  renderer.setEdgeSeed(9);
  assert.equal(renderer.noise.layerEdge.size, 0);
  const after = edges(renderer);
  assert.notDeepEqual(after, before);
  assert.deepEqual(after, edges(make(9))); // the edges a renderer with that seed has
  assert.deepEqual({ ...renderer.noise, layerEdge: undefined }, otherNoise);
  assert.equal(renderer.seed, 5);
});

test("line width noise is smooth Perlin noise within the noise range", () => {
  // A realistic width, so there are many steps between nodes whatever the node count
  const renderer = new HatchedRenderer(mockCanvas(), 600, 50, 1, 1.5);
  renderer.generateLines();
  renderer.initialiseNoise();

  const limit = HatchedRenderer.LINE_WIDTH_NOISE_RANGE / 2;
  const widths = renderer.noise.lineWidth;
  assert.equal(widths.length, renderer.lines.length);
  for (const line of widths) {
    assert.equal(line.length, renderer.numXSteps);
    assert.ok(line.every((value) => Math.abs(value) <= limit + 1e-12));
  }
  // Neighbouring steps differ by far less than the range, so the width drifts like a pen
  const steps = widths[0].slice(1).map((v, i) => Math.abs(v - widths[0][i]));
  assert.ok(Math.max(...steps) < limit / 2);
});

test("changing the number of Perlin nodes does not change the other noise", () => {
  const noiseWith = (nodes) => {
    const { LINE_WIDTH_NOISE_NODES_MIN: min, LINE_WIDTH_NOISE_NODES_MAX: max } = HatchedRenderer;
    HatchedRenderer.LINE_WIDTH_NOISE_NODES_MIN = nodes;
    HatchedRenderer.LINE_WIDTH_NOISE_NODES_MAX = nodes;
    try {
      const { renderer } = setup();
      renderer.initialiseNoise();
      return renderer.noise;
    } finally {
      HatchedRenderer.LINE_WIDTH_NOISE_NODES_MIN = min;
      HatchedRenderer.LINE_WIDTH_NOISE_NODES_MAX = max;
    }
  };

  const few = noiseWith(4);
  const many = noiseWith(40);
  assert.notDeepEqual(few.lineWidth, many.lineWidth);
  assert.deepEqual(few.lightness, many.lightness);
  assert.deepEqual(few.lineBreaks, many.lineBreaks);
  assert.deepEqual(few.yOffset, many.yOffset);
});

// A renderer set up the way the controller does it, with a theme
function themedRenderer(theme = createTheme(), width = 200, height = 100) {
  const renderer = new HatchedRenderer(mockCanvas(), width, height, 1, 1.5);
  renderer.applyTheme(theme);
  renderer.finaliseRenderer();
  return renderer;
}

test("the sky is one colour from top to bottom when there is only a top colour", () => {
  const theme = createTheme();
  const renderer = themedRenderer(theme);

  assert.ok(renderer.lines.length > 10);
  assert.ok(renderer.backgroundColours.every((colour) => colour === theme.background.top));
});

test("the sky fades from the top colour to the bottom colour", () => {
  const theme = createTheme();
  theme.background.top = { hue: 200, sat: 60, light: 40 };
  theme.background.bottom = { hue: 220, sat: 80, light: 80 };
  const renderer = themedRenderer(theme);
  const colours = renderer.backgroundColours;

  assert.deepEqual(colours[0], theme.background.top);
  assert.deepEqual(colours.at(-1), theme.background.bottom);
  const middle = colours[Math.floor(colours.length / 2)];
  assert.ok(middle.light > 55 && middle.light < 65);
  for (let i = 1; i < colours.length; i++) assert.ok(colours[i].light >= colours[i - 1].light);
});

test("each line of the sky is drawn in its own colour", () => {
  const theme = createTheme();
  theme.background.bottom = { hue: 20, sat: 90, light: 62 };
  const renderer = themedRenderer(theme);
  const background = { isBackground: true };
  const lightnessNoise = (line) => renderer.noise.lightness[line.id][0];

  const [first, last] = [renderer.lines[0], renderer.lines.at(-1)];
  assert.equal(
    renderer.getStrokeColour(0, background, first),
    `hsl(${theme.background.top.hue}, ${theme.background.top.sat}%, ${theme.background.top.light + lightnessNoise(first)}%)`,
  );
  assert.ok(renderer.getStrokeColour(0, background, last).startsWith("hsl(20, 90%"));
});

test("updateTheme restyles the sky and moves the shadow on lines that already exist", () => {
  const renderer = themedRenderer();
  const spread = () => {
    const x = renderer.shadowDiagonalLocations;
    return Math.max(...x) - Math.min(...x);
  };

  const slanted = spread(); // a diagonal edge: far apart at the top and bottom
  assert.ok(slanted > 50);
  const vertical = createTheme();
  vertical.shadowDiagonal.angle = Math.PI / 2;
  vertical.background.top = { hue: 20, sat: 90, light: 62 };
  renderer.updateTheme(vertical);

  assert.ok(spread() <= vertical.shadowDiagonal.edgeNoise); // a vertical edge: only the noise
  assert.equal(renderer.backgroundColours[0], vertical.background.top);
  assert.equal(renderer.colours, vertical.colours);
});

// A drawing context that records what is done to the canvas
function recordingContext() {
  const calls = [];
  return {
    calls,
    set fillStyle(value) {
      calls.push(["fillStyle", value]);
    },
    fillRect: (...args) => calls.push(["fillRect", ...args]),
    clearRect: (...args) => calls.push(["clearRect", ...args]),
  };
}

test("the canvas is cleared to see-through, so the page behind shows between the lines, even with paper", () => {
  const theme = createTheme();
  theme.background.paper = { hue: 40, sat: 30, light: 95 };
  const renderer = themedRenderer(theme);
  renderer.context = recordingContext();

  renderer.clearCanvas();
  assert.deepEqual(renderer.context.calls, [["clearRect", 0, 0, 200, 100]]);
});

test("a gap is plain paper colour, with no lightness noise", () => {
  const theme = createTheme();
  theme.background.paper = { hue: 40, sat: 30, light: 95 };
  const renderer = themedRenderer(theme);
  const gap = { isGap: true, layerId: 0 };
  for (const x of [0, 10, 50, 120]) {
    assert.equal(renderer.getStrokeColour(x, gap, renderer.lines[3]), "hsl(40, 30%, 95%)");
  }
});

test("clear() empties every line and puts the background back", () => {
  const { renderer, line } = setup();
  addLayer(renderer, line, 40, 60, {});
  renderer.clear();

  assert.equal(renderer.layers.length, 0);
  assert.equal(line.segments.length, 1);
  assert.equal(line.segments[0].isBackground, true);
});

test("the top and bottom lines get line breaks in a random number of places", () => {
  const renderer = new HatchedRenderer(mockCanvas(), 600, 400, 1, 1.5);
  renderer.generateLines();
  renderer.applyTheme(createTheme());
  renderer.finaliseRenderer();

  const runs = (breaks) =>
    breaks
      .join("")
      .split("false")
      .join(" ")
      .trim()
      .split(/ +/)
      .filter((r) => r.includes("true")).length;
  const top = renderer.noise.lineBreaks[0];
  const bottom = renderer.noise.lineBreaks[renderer.lines.length - 1];
  for (const breaks of [top, bottom]) {
    assert.ok(breaks.filter(Boolean).length >= HatchedRenderer.EDGE_LINE_BREAK_MIN_WIDTH / 2 - 1);
    assert.ok(runs(breaks) >= 1);
  }
});

// A context that records everything the renderer sets on it and every point it draws to
function recordingCanvas() {
  const canvas = mockCanvas();
  const record = { lineWidths: [], strokeStyles: [], points: [] };
  const context = {
    set lineWidth(value) {
      record.lineWidths.push(value);
    },
    set strokeStyle(value) {
      record.strokeStyles.push(value);
    },
    moveTo: (x, y) => record.points.push([x, y]),
    lineTo: (x, y) => record.points.push([x, y]),
  };
  canvas.getContext = () =>
    new Proxy(context, { get: (target, name) => (name in target ? target[name] : () => {}) });
  return { canvas, record };
}

// Every stroke, including the last one that reaches the right edge, needs a real width,
// colour and position. A noise value looked up past the end of its array is undefined,
// which turns all three into NaN (the canvas then ignores them).
for (const width of [100, 101, 600]) {
  test(`drawing a ${width}px wide cloud never uses a noise value that does not exist`, () => {
    const { canvas, record } = recordingCanvas();
    const renderer = new HatchedRenderer(canvas, width, 40, 1, 1.5);
    renderer.generateLines();
    renderer.applyTheme(createTheme());
    renderer.finaliseRenderer();
    renderer.draw();

    assert.ok(record.lineWidths.length > 0);
    assert.ok(record.lineWidths.every(Number.isFinite), "a line width is not a number");
    assert.ok(record.points.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y)));
    assert.ok(record.strokeStyles.every((style) => !String(style).includes("NaN")));
  });
}

test("the noise for the right edge of the canvas is the last value, not one past it", () => {
  const renderer = new HatchedRenderer(mockCanvas(), 100, 40, 1, 1.5);
  assert.equal(renderer.drawStepIndex(0), 0);
  assert.equal(renderer.drawStepIndex(99), 49);
  assert.equal(renderer.drawStepIndex(100), renderer.numXSteps - 1);
  assert.equal(renderer.drawStepIndex(250), renderer.numXSteps - 1);
});
