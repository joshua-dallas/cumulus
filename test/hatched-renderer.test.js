import "./helpers.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { HatchedRenderer } from "../src/lib/hatched-renderer.js";
import { mockCanvas } from "./helpers.js";

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
  assert.deepEqual(summary, [[0, 40], [40, 60], [60, 100]]);
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

test("padding is not drawn, except in shadow where what it cleared is drawn instead", () => {
  const { renderer, line } = setup();
  addLayer(renderer, line, 40, 60, { rightPadding: 10 });

  const drawn = [];
  renderer.drawSegment = (x1, x2, ln, segment) =>
    drawn.push([x1, x2, segment.isBackground ? "background" : segment.layerId]);

  renderer.hasShadowDiagonal = false;
  renderer.drawLine(line);
  assert.deepEqual(drawn, [[0, 40, "background"], [40, 60, 0], [70, 100, "background"]]);

  // Everything left of x = 65 is in shadow, so the padding there (60 to 65) shows what it cleared
  drawn.length = 0;
  renderer.hasShadowDiagonal = true;
  renderer.shadowDiagonalDirection = "left";
  renderer.shadowDiagonalLocations = [65];
  renderer.drawLine(line);
  assert.deepEqual(drawn, [
    [0, 40, "background"],
    [40, 60, 0],
    [60, 65, "background"],
    [70, 100, "background"],
  ]);
});

test("edge noise is remembered per layer key, including an offset of 0", () => {
  const { renderer } = setup();
  let draws = 0;
  renderer.random = () => (draws++, 0.5); // 0.5 gives a noise offset of exactly 0
  const layer = { id: 0, key: "cell-1", leftEdgeNoise: 6, rightEdgeNoise: 6 };

  assert.deepEqual(renderer.addEdgeNoise(10, 20, layer, 0), [10, 20]);
  const drawsAfterFirst = draws;
  assert.deepEqual(renderer.addEdgeNoise(10, 20, layer, 0), [10, 20]);
  assert.equal(draws, drawsAfterFirst); // reused, not rolled again

  // The same key gives the same noise even if the layer has a different index next frame
  renderer.addEdgeNoise(10, 20, { ...layer, id: 7 }, 0);
  assert.equal(draws, drawsAfterFirst);
});

test("clear() empties every line and puts the background back", () => {
  const { renderer, line } = setup();
  addLayer(renderer, line, 40, 60, {});
  renderer.clear();

  assert.equal(renderer.layers.length, 0);
  assert.equal(line.segments.length, 1);
  assert.equal(line.segments[0].isBackground, true);
});
