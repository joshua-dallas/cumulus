import { test } from "node:test";
import assert from "node:assert/strict";
import { clamp01, easeInOutCubic, easeOutCubic } from "../src/lib/easing.js";

for (const [name, ease] of [["easeOutCubic", easeOutCubic], ["easeInOutCubic", easeInOutCubic]]) {
  test(`${name} starts at 0, ends at 1 and never goes backwards`, () => {
    assert.equal(ease(0), 0);
    assert.equal(ease(1), 1);
    let previous = 0;
    for (let t = 0.01; t <= 1; t += 0.01) {
      const value = ease(t);
      assert.ok(value >= previous);
      previous = value;
    }
  });
}

test("easeOutCubic is fast at the start and settles at the end", () => {
  assert.ok(easeOutCubic(0.2) > 0.2 * 2); // already well ahead of a straight line
  assert.ok(easeOutCubic(1) - easeOutCubic(0.9) < 0.01); // barely moving at the end
});

test("easeInOutCubic is slow at both ends and passes through the middle", () => {
  assert.equal(easeInOutCubic(0.5), 0.5);
  assert.ok(easeInOutCubic(0.1) < 0.1);
  assert.ok(easeInOutCubic(0.9) > 0.9);
});

test("clamp01 keeps progress between 0 and 1", () => {
  assert.deepEqual([clamp01(-1), clamp01(0.4), clamp01(2)], [0, 0.4, 1]);
});
