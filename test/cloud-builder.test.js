import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { CloudBuilder } from "../src/lib/cloud-builder.js";

const build = (seed = 323, numCells = 15, width = 600, height = 400, options) =>
  new CloudBuilder(width, height, numCells, seed, options);

// Everything the builder generates, as plain data. The settings stored on each cell for the
// simulation (return speed, cursor radius) are tuning, not generation, so they are left out
// and a change to them does not change the hash
const snapshot = (builder) => ({
  cells: builder.cells.map(({ sim, ...cell }) => ({ ...cell, baseLocation: sim.baseLocation })),
  fillCircles: builder.fillCircles,
  horizontalFillCircles: builder.horizontalFillCircles,
  cloudInnerLeft: builder.cloudInnerLeft,
  cloudInnerRight: builder.cloudInnerRight,
});

test("the same seed always builds the same cloud", () => {
  assert.deepEqual(snapshot(build(7)), snapshot(build(7)));
});

test("different seeds build different clouds", () => {
  assert.notDeepEqual(snapshot(build(1)).cells, snapshot(build(2)).cells);
});

// This is the contract of a seed. If this fails after an intentional change to
// how clouds are generated, every existing seed now gives a different cloud:
// update the hash on purpose. If you did not mean to change clouds, you have
// added, removed or reordered a this.random() call in CloudBuilder.
// (The hashes changed on purpose when the unused random draws for the fractal animation were
// removed: every seed then made a different cloud. They were re-recorded once more when the
// simulation settings were left out of the snapshot: the clouds did not change.)
const hashOf = (builder) =>
  createHash("sha1")
    .update(JSON.stringify(snapshot(builder)))
    .digest("hex");

test("seed 323 still builds the same cloud (random call order is stable)", () => {
  assert.equal(hashOf(build(323)), "d2af6035d258fa3a334d93533f2e4483081a671f");
});

test("simulation settings stored on the cells are not part of the seed's hash", () => {
  const speed = CloudBuilder.CELL_RETURN_SPEED;
  const radius = CloudBuilder.CELL_CURSOR_RADIUS_RATIO;
  try {
    CloudBuilder.CELL_RETURN_SPEED = speed * 2;
    CloudBuilder.CELL_CURSOR_RADIUS_RATIO = radius + 1;
    assert.equal(hashOf(build(323)), "d2af6035d258fa3a334d93533f2e4483081a671f");
  } finally {
    CloudBuilder.CELL_RETURN_SPEED = speed;
    CloudBuilder.CELL_CURSOR_RADIUS_RATIO = radius;
  }
});

// The minimum base width moves a cell but does not use or skip any random numbers.
// (Checked once against the builder before the minimum existed: with no minimum,
// every portrait and square cloud tried was identical. Landscape clouds then changed
// size, as the dome radius was made to fit the width as well as the height.)
test("with no minimum base width, seed 323 builds the cloud it should", () => {
  const noMinimum = build(323, 15, 600, 400, { minBaseWidth: 0 });
  assert.equal(hashOf(noMinimum), "c59c4b45068a0fc7dee24cb971e1dd705f626736");
});

test("the dome is small enough for the cloud to fit the canvas across as well as up", () => {
  for (const [width, height] of [
    [600, 400],
    [500, 500],
    [300, 700],
    [800, 300],
    [900, 400],
  ]) {
    const { radius } = build(1, 15, width, height).dome;
    const { MIN_PADDING_RATIO, MAX_CELL_RADIUS } = CloudBuilder;
    assert.ok(
      radius * (2 + 2 * MAX_CELL_RADIUS) <= width * (1 - MIN_PADDING_RATIO) + 1,
      `${width}x${height} too wide`,
    );
    assert.ok(
      radius * (1 + 2 * MAX_CELL_RADIUS) <= height * (1 - MIN_PADDING_RATIO) + 1,
      `${width}x${height} too tall`,
    );
  }
  assert.equal(build(1, 15, 600, 400).dome.radius, 185); // was 200, from the height alone
});

// ---- the base of the cloud ----

// The distance between the middles of the two cells at the base
const baseWidth = (builder) => {
  const [a, b] = builder.bottomCellIds.map((id) => builder.cellsById.get(id));
  return Math.abs(a.x - b.x);
};

test("the two cells at the base of the cloud are at least the minimum base width apart", () => {
  for (let seed = 0; seed < 60; seed++) {
    for (const minBaseWidth of [0.5, 0.8, 1]) {
      // up to the dome radius always fits in the canvas
      const builder = build(seed, 15, 600, 400, { minBaseWidth });
      assert.ok(
        baseWidth(builder) >= minBaseWidth * builder.dome.radius,
        `seed ${seed}: ${baseWidth(builder)}px is less than ${minBaseWidth} x ${builder.dome.radius}`,
      );
    }
  }
});

test("the base cells are the lowest cell and one on the other side of the centre, with matching bottoms", () => {
  const builder = build(7);
  const [lowest, matched] = builder.bottomCellIds.map((id) => builder.cellsById.get(id));
  assert.equal(lowest.y + lowest.radius, matched.y + matched.radius);
  assert.ok(
    (lowest.sim.baseLocation.x - builder.dome.x) * (matched.sim.baseLocation.x - builder.dome.x) <=
      0,
  );
});

test("the minimum base width only moves the cell it has to, and the default is the dome radius", () => {
  const wide = build(5, 15, 600, 400, { minBaseWidth: 1 });
  const none = build(5, 15, 600, 400, { minBaseWidth: 0 });
  assert.ok(baseWidth(wide) >= wide.dome.radius);
  assert.ok(baseWidth(wide) >= baseWidth(none));
  assert.equal(build(5).options.minBaseWidth, 1);

  // A cloud whose base is already wide enough is not changed
  const wideEnough = [...Array(60).keys()].find((seed) => {
    const a = build(seed, 15, 600, 400, { minBaseWidth: 0 });
    return baseWidth(a) >= a.dome.radius;
  });
  assert.equal(
    hashOf(build(wideEnough, 15, 600, 400, { minBaseWidth: 0 })),
    hashOf(build(wideEnough)),
  );
});

test("cells can be looked up by id, even after sorting by size", () => {
  const builder = build();
  const ids = builder.cells.map((cell) => cell.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const cell of builder.cells) {
    assert.equal(builder.cellsById.get(cell.id), cell);
  }
  // sorted largest first, so the array order is not the id order
  const radii = builder.cells.map((cell) => cell.radius);
  assert.deepEqual(
    radii,
    [...radii].sort((a, b) => b - a),
  );
});

test("fractals are grouped on the cell they belong to", () => {
  const builder = build();
  for (const cell of builder.cells) {
    assert.equal(cell.lightFractals.length, 20);
    for (const fractal of [...cell.lightFractals, ...cell.darkFractals]) {
      assert.equal(fractal.linkedCell, cell.id);
    }
  }
});

test("cells start at rest: their base location is where they are", () => {
  for (const cell of build().cells) {
    assert.deepEqual(cell.sim.baseLocation, { x: cell.x, y: cell.y });
  }
});

test("horizontal fill circles follow the cell they are linked to", () => {
  const builder = build(5, 30, 300, 700); // a cloud that has some
  assert.ok(builder.horizontalFillCircles.length > 0);

  const circle = builder.horizontalFillCircles[0];
  const cell = builder.cellsById.get(circle.linkedCell);
  assert.equal(circle.x, cell.x + circle.dx);

  cell.x += 10;
  builder.updateFills();
  assert.equal(circle.x, cell.x + circle.dx);
});

test("updateFills changes nothing if no cell has moved", () => {
  const builder = build();
  const before = structuredClone(snapshot(builder));
  builder.updateFills();
  assert.deepEqual(snapshot(builder), before);
});

test("numCells is respected, plus the matched bottom cell and stepped children", () => {
  const builder = build(323, 8);
  assert.ok(builder.cells.length >= 9);
});
