import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { CloudBuilder } from "../src/lib/cloud-builder.js";

const build = (seed = 323, numCells = 15, width = 600, height = 400) =>
  new CloudBuilder(width, height, numCells, seed);

// Everything the builder generates, as plain data
const snapshot = (builder) => ({
  cells: builder.cells,
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
test("seed 323 still builds the same cloud (random call order is stable)", () => {
  const hash = createHash("sha1")
    .update(JSON.stringify(snapshot(build(323))))
    .digest("hex");
  assert.equal(hash, "7ca51f4df701c63507277a4dfbf7e01b7743212d");
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
  assert.deepEqual(radii, [...radii].sort((a, b) => b - a));
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
