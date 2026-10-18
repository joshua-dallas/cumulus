import { test } from "node:test";
import assert from "node:assert/strict";
import { CloudBuilder } from "../src/lib/cloud-builder.js";
import { CloudSimulation } from "../src/lib/cloud-simulation.js";
import { createTheme } from "../src/lib/theme.js";
import { mulberry32 } from "../src/lib/utils.js";
import { exposedFillEdgePixels, pocketArea } from "./fill-pockets.js";

// Strokes the mouse across a cloud at random angles and speeds, as a person
// brushing it would, and measures the fills after the frames (see fill-pockets.js).
// Returns how bad the worst frame was, and the average over frames, compared with
// the cloud at rest
function brushCloud(seed, interaction = {}, { strokes = 4, settleFrames = 40, sampleEvery = 3 } = {}) {
  const builder = new CloudBuilder(600, 400, 15, seed);
  const settings = { ...createTheme().interaction, ...interaction };
  const simulation = new CloudSimulation(builder, seed, settings);
  const restPockets = pocketArea(builder);
  const restEdges = exposedFillEdgePixels(builder);

  const random = mulberry32(seed * 7 + 1);
  const centre = { x: builder.dome.x, y: builder.dome.y - builder.dome.radius / 2 };
  let frame = 0;
  let worstPocket = 0;
  let totalPocket = 0;
  let samples = 0;
  let worstEdges = 0;

  for (let s = 0; s < strokes; s++) {
    const angle = random() * Math.PI * 2;
    const speed = 600 + random() * 1800; // px/s
    const offset = (random() - 0.5) * builder.dome.radius; // how far from the middle the stroke passes
    const start = {
      x: centre.x - Math.cos(angle) * 200 - Math.sin(angle) * offset,
      y: centre.y - Math.sin(angle) * 200 + Math.cos(angle) * offset,
    };
    const stepLength = (speed * 16) / 1000; // one 16ms frame
    const strokeFrames = Math.ceil(400 / stepLength);

    // The stroke, then the cloud settling before the next one
    for (let i = 0; i <= strokeFrames + settleFrames; i++) {
      const cursor =
        i <= strokeFrames
          ? { x: start.x + Math.cos(angle) * i * stepLength, y: start.y + Math.sin(angle) * i * stepLength }
          : null;
      if (simulation.step(cursor, 16)) builder.updateFills();

      if (frame++ % sampleEvery === 0) {
        const pocket = Math.max(0, pocketArea(builder) - restPockets);
        worstPocket = Math.max(worstPocket, pocket);
        totalPocket += pocket;
        samples++;
        worstEdges = Math.max(worstEdges, exposedFillEdgePixels(builder) - restEdges);
      }
    }
  }
  return { worstPocket, meanPocket: totalPocket / samples, worstEdges };
}

test("brushing clouds does not tear the fills: no large pockets of sky open up inside the cloud", () => {
  for (const seed of [5, 7, 323, 42]) {
    const { worstPocket, meanPocket } = brushCloud(seed);
    assert.ok(worstPocket < 600, `seed ${seed}: a pocket of ${worstPocket}px opened up`);
    assert.ok(meanPocket < 25, `seed ${seed}: ${meanPocket}px of pockets on average`);
  }
});

test("brushing clouds does not show vertical fill lines: fill edges stay behind cells", () => {
  for (const seed of [5, 7, 323, 42]) {
    const { worstEdges } = brushCloud(seed);
    assert.ok(worstEdges <= 3, `seed ${seed}: ${worstEdges}px of fill edge were left showing`);
  }
});

test("cohesion keeps the cloud together: it tears less than cells that do not tug each other", () => {
  const meanPockets = (interaction) =>
    [7, 42].reduce((sum, seed) => sum + brushCloud(seed, interaction).meanPocket, 0);

  assert.ok(meanPockets({}) < meanPockets({ neighbourStiffness: 0 }));
});

// A small made-up cloud: just the cells, with no fills
function cloudOf(cells) {
  return {
    width: 200,
    height: 200,
    dome: { x: 100 },
    cells,
    fillCircles: [],
    horizontalFillCircles: [],
    cloudInnerLeft: [],
    cloudInnerRight: [],
  };
}

test("the tear measure finds a pocket of sky inside a ring of cells, and not a solid cloud or open sky", () => {
  const ring = Array.from({ length: 8 }, (_, i) => ({
    x: 100 + 40 * Math.cos((i * Math.PI) / 4),
    y: 100 + 40 * Math.sin((i * Math.PI) / 4),
    radius: 20,
  }));
  assert.ok(pocketArea(cloudOf(ring)) > 800); // the hole in the middle, about 1250px

  assert.equal(pocketArea(cloudOf([...ring, { x: 100, y: 100, radius: 25 }])), 0); // filled in
  assert.equal(pocketArea(cloudOf([{ x: 100, y: 100, radius: 30 }])), 0); // no hole at all
});

test("the edge measure finds a fill edge with no cell behind it", () => {
  const builder = cloudOf([{ x: 150, y: 100, radius: 20 }]);
  // A fill polygon on the right whose outer edge, at x = 150, runs from y = 60 to 140.
  // The cell only backs the part from 80 to 120
  builder.cloudInnerRight = [
    { x: 100, y: 60 },
    { x: 150, y: 60 },
    { x: 150, y: 140 },
    { x: 100, y: 140 },
  ];
  const exposed = exposedFillEdgePixels(builder);
  assert.ok(exposed > 35 && exposed < 50, `${exposed}px exposed`);
});
