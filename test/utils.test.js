import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mulberry32,
  intersection,
  subtractRange,
  subtractRanges,
  intersectionOfMany,
  clamp,
  perlinNoise1D,
  lerp,
  mixColours,
} from "../src/lib/utils.js";

test("mulberry32 gives the same sequence for the same seed", () => {
  const a = mulberry32(42);
  const b = mulberry32(42);
  for (let i = 0; i < 5; i++) assert.equal(a(), b());
});

test("mulberry32 differs between seeds and stays in [0, 1)", () => {
  const a = mulberry32(1);
  const b = mulberry32(2);
  assert.notEqual(a(), b());
  const random = mulberry32(0); // seed 0 is allowed
  for (let i = 0; i < 1000; i++) {
    const value = random();
    assert.ok(value >= 0 && value < 1);
  }
});

test("intersection of ranges", () => {
  assert.deepEqual(intersection([0, 10], [5, 15]), [5, 10]);
  assert.equal(intersection([0, 5], [5, 10]), undefined); // touching is not overlapping
  assert.equal(intersection([0, 5], [6, 10]), undefined);
});

test("subtractRange removes the overlap, possibly splitting the range", () => {
  assert.deepEqual(subtractRange([0, 10], [20, 30]), [0, 10]);
  assert.deepEqual(subtractRange([0, 10], [0, 10]), []);
  assert.deepEqual(subtractRange([0, 10], [0, 4]), [[4, 10]]);
  assert.deepEqual(subtractRange([0, 10], [6, 10]), [[0, 6]]);
  assert.deepEqual(subtractRange([0, 10], [4, 6]), [[0, 4], [6, 10]]);
});

test("subtractRanges removes several sorted ranges", () => {
  assert.deepEqual(subtractRanges([0, 10], [[2, 3], [6, 8]]), [[0, 2], [3, 6], [8, 10]]);
});

test("intersectionOfMany intersects every pair of ranges", () => {
  assert.deepEqual(intersectionOfMany([[0, 5], [10, 15]], [[3, 12]]), [[3, 5], [10, 12]]);
});

test("clamp", () => {
  assert.equal(clamp(5, 0, 10), 5);
  assert.equal(clamp(-5, 0, 10), 0);
  assert.equal(clamp(15, 0, 10), 10);
});

// ---- perlinNoise1D -------------------------------------------------------------------------

test("perlinNoise1D returns the requested number of values, the same ones for the same seed", () => {
  const a = perlinNoise1D(mulberry32(1), 100, 8);
  const b = perlinNoise1D(mulberry32(1), 100, 8);
  assert.equal(a.length, 100);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, perlinNoise1D(mulberry32(2), 100, 8));
});

test("perlinNoise1D values stay within +-0.5 times the scale", () => {
  for (const scale of [1, 0.3, 4]) {
    for (let seed = 0; seed < 50; seed++) {
      for (const value of perlinNoise1D(mulberry32(seed), 200, 10, scale)) {
        assert.ok(Math.abs(value) <= 0.5 * scale + 1e-12);
      }
    }
  }
});

test("perlinNoise1D is 0 at each node and the scale multiplies every value", () => {
  // 5 nodes over 9 values: a node falls on every second value
  const values = perlinNoise1D(mulberry32(3), 9, 5);
  for (let i = 0; i < 9; i += 2) assert.equal(Math.abs(values[i]), 0); // (-0 counts)
  assert.ok(values.some((value) => value !== 0));

  const scaled = perlinNoise1D(mulberry32(3), 9, 5, 0.3);
  scaled.forEach((value, i) => assert.ok(Math.abs(value - values[i] * 0.3) < 1e-12));
});

test("perlinNoise1D wanders smoothly: neighbouring values are close, unlike uniform noise", () => {
  const meanStep = (values) =>
    values.slice(1).reduce((sum, v, i) => sum + Math.abs(v - values[i]), 0) / (values.length - 1);

  const random = mulberry32(5);
  const uniform = Array.from({ length: 300 }, () => random() - 0.5);
  const perlin = perlinNoise1D(mulberry32(5), 300, 15);
  assert.ok(meanStep(perlin) < meanStep(uniform) / 5);
});

test("perlinNoise1D has slower drifts with fewer nodes", () => {
  const crossings = (values) => values.slice(1).filter((v, i) => v * values[i] < 0).length;
  const few = perlinNoise1D(mulberry32(9), 600, 4);
  const many = perlinNoise1D(mulberry32(9), 600, 60);
  assert.ok(crossings(few) < crossings(many));
});

test("perlinNoise1D uses one random number per node, and copes with small inputs", () => {
  let draws = 0;
  const counting = () => (draws++, 0.5);
  perlinNoise1D(counting, 50, 7);
  assert.equal(draws, 7);

  assert.equal(perlinNoise1D(mulberry32(1), 20, 0).length, 20); // fewer than 2 nodes is treated as 2
  assert.deepEqual(perlinNoise1D(mulberry32(1), 1, 5), [0]);
  assert.deepEqual(perlinNoise1D(mulberry32(1), 0, 5), []);
});

// ---- colours ----

test("lerp goes from a to b", () => {
  assert.deepEqual([lerp(10, 20, 0), lerp(10, 20, 0.25), lerp(10, 20, 1)], [10, 12.5, 20]);
});

test("mixColours mixes hue, saturation and lightness", () => {
  const a = { hue: 100, sat: 20, light: 40 };
  const b = { hue: 140, sat: 60, light: 80 };
  assert.deepEqual(mixColours(a, b, 0), a);
  assert.deepEqual(mixColours(a, b, 1), b);
  assert.deepEqual(mixColours(a, b, 0.5), { hue: 120, sat: 40, light: 60 });
});

test("mixColours takes the shortest way round the colour wheel", () => {
  const red = { hue: 350, sat: 50, light: 50 };
  assert.equal(mixColours(red, { ...red, hue: 10 }, 0.5).hue, 0); // through 0, not 180
  assert.equal(mixColours({ ...red, hue: 10 }, red, 0.5).hue, 0);

  // Blue to orange, with the orange just past red: through purple, not through green
  const mid = mixColours({ hue: 206, sat: 50, light: 50 }, { hue: 20, sat: 50, light: 50 }, 0.5);
  assert.equal(mid.hue, 293);
});
