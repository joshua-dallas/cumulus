import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mulberry32,
  intersection,
  subtractRange,
  subtractRanges,
  intersectionOfMany,
  clamp,
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
