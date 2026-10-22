import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BLENDED_SECTIONS,
  SUNSET_SHADOW_ANGLE,
  SUNSET_SHADOW_X_ORIGIN_OFFSET,
  blendThemes,
  createSunsetKeyframes,
  createSunsetTheme,
  createTheme,
  themeAtProgress,
} from "../src/lib/theme.js";

// The paths (like "background.top.hue") of everything that differs between two themes
function differences(a, b, path = "") {
  if (a && b && typeof a === "object" && typeof b === "object") {
    return [...new Set([...Object.keys(a), ...Object.keys(b)])].flatMap((key) =>
      differences(a[key], b[key], path ? `${path}.${key}` : key),
    );
  }
  return Object.is(a, b) ? [] : [path];
}

test("the sky can be given a top colour and a bottom colour; with only a top it is all one colour", () => {
  const { background } = createTheme();
  assert.ok(background.top);
  assert.equal(background.bottom, undefined);
});

test("the shadow edge is at the chosen place in the day and in the sunset", () => {
  const { shadowDiagonal } = createTheme();
  assert.equal(Math.round((shadowDiagonal.angle * 180) / Math.PI), 151);
  assert.equal(shadowDiagonal.xOriginOffset, -0.2375);

  const sunset = createSunsetTheme().shadowDiagonal;
  assert.equal(Math.round((sunset.angle * 180) / Math.PI), 111);
  assert.equal(sunset.xOriginOffset, 0.231);
});

test("the sunset theme is a copy of the theme with only a few things changed", () => {
  const base = createTheme();
  const sunset = createSunsetTheme(base);

  assert.notEqual(sunset, base);
  const changed = differences(base, sunset);
  assert.ok(
    changed.every(
      (path) => path.startsWith("background.top") || path.startsWith("shadowDiagonal."),
    ),
    changed.join(", "),
  );
  assert.ok(changed.length > 0);

  assert.ok(sunset.background.top.hue < 40); // orange
  assert.equal(sunset.background.bottom, undefined); // all orange
  assert.equal(sunset.shadowDiagonal.angle, SUNSET_SHADOW_ANGLE);
  assert.equal(sunset.shadowDiagonal.xOriginOffset, SUNSET_SHADOW_X_ORIGIN_OFFSET);
  assert.deepEqual(base, createTheme()); // and the theme it was copied from is not changed
});

test("the stages of a sunset: day, then dusk (blue above orange, shadow half way), then sunset", () => {
  const base = createTheme();
  const [day, dusk, sunset] = createSunsetKeyframes(base);

  assert.equal(day, base); // the theme itself, so that it stays up to date
  assert.deepEqual(dusk.background.top, day.background.top); // still a blue sky at the top
  assert.deepEqual(dusk.background.bottom, sunset.background.top); // orange at the bottom
  assert.equal(
    dusk.shadowDiagonal.angle,
    (day.shadowDiagonal.angle + sunset.shadowDiagonal.angle) / 2,
  );
  assert.deepEqual(
    differences(day, dusk).filter(
      (p) => !p.startsWith("background.bottom") && !p.startsWith("shadowDiagonal."),
    ),
    [],
  );
});

test("blending themes mixes the sky and the shadow, and leaves everything else as it was", () => {
  const [day, , sunset] = createSunsetKeyframes(createTheme());
  const half = blendThemes(day, sunset, 0.5);

  assert.equal(
    half.shadowDiagonal.angle,
    (day.shadowDiagonal.angle + sunset.shadowDiagonal.angle) / 2,
  );
  assert.ok(
    half.background.top.light >= Math.min(day.background.top.light, sunset.background.top.light),
  );
  for (const key of Object.keys(day)) {
    if (!BLENDED_SECTIONS.includes(key)) assert.equal(half[key], day[key]); // the very same object
  }

  assert.deepEqual(blendThemes(day, sunset, 0).background.top, day.background.top);
  assert.deepEqual(blendThemes(day, sunset, 1).background.top, sunset.background.top);
});

test("a sky with no bottom colour blends as if its bottom were its top", () => {
  const [day, dusk] = createSunsetKeyframes(createTheme());
  const blended = blendThemes(day, dusk, 0.5);
  // the bottom starts the same as the top (blue) and is half way to orange, going through purple
  assert.deepEqual(blended.background.top, day.background.top);
  assert.equal(blended.background.bottom.hue, 293);
});

test("progress runs through the stages evenly: 0 is the day, 0.5 the dusk and 1 the sunset", () => {
  const keyframes = createSunsetKeyframes(createTheme());
  const [day, dusk, sunset] = keyframes;

  assert.deepEqual(themeAtProgress(keyframes, 0).background.top, day.background.top);
  assert.equal(themeAtProgress(keyframes, 0).shadowDiagonal.angle, day.shadowDiagonal.angle);
  assert.deepEqual(themeAtProgress(keyframes, 0.5).background, { ...dusk.background });
  assert.equal(themeAtProgress(keyframes, 0.5).shadowDiagonal.angle, dusk.shadowDiagonal.angle);
  assert.deepEqual(themeAtProgress(keyframes, 1).background.top, sunset.background.top);
  assert.equal(themeAtProgress(keyframes, 1).shadowDiagonal.angle, sunset.shadowDiagonal.angle);

  // Beyond the ends is the end
  assert.equal(themeAtProgress(keyframes, -1).shadowDiagonal.angle, day.shadowDiagonal.angle);
  assert.equal(themeAtProgress(keyframes, 5).shadowDiagonal.angle, sunset.shadowDiagonal.angle);
});

test("on the way to the sunset the shadow only rises and the sky only gets closer to orange", () => {
  const keyframes = createSunsetKeyframes(createTheme());
  const orange = keyframes[2].background.top;
  // How far a colour is from the orange, going the shortest way round the colour wheel
  const hueFromOrange = ({ hue }) =>
    Math.min(Math.abs(hue - orange.hue), 360 - Math.abs(hue - orange.hue));

  let angle = Infinity;
  let top = Infinity;
  let bottom = Infinity;
  for (let step = 0; step <= 20; step++) {
    const theme = themeAtProgress(keyframes, step / 20);
    assert.ok(theme.shadowDiagonal.angle <= angle + 1e-9, "the shadow went down");
    assert.ok(
      hueFromOrange(theme.background.top) <= top + 1e-9,
      "the top of the sky moved away from orange",
    );
    const skyBottom = theme.background.bottom ?? theme.background.top; // no bottom: the same as the top
    assert.ok(
      hueFromOrange(skyBottom) <= bottom + 1e-9,
      "the bottom of the sky moved away from orange",
    );
    angle = theme.shadowDiagonal.angle;
    top = hueFromOrange(theme.background.top);
    bottom = hueFromOrange(skyBottom);
  }
  assert.equal(angle, SUNSET_SHADOW_ANGLE);
  assert.equal(top, 0);
  assert.equal(bottom, 0);
});

test("the sunset shadow can be put somewhere else, and dusk is half way between", () => {
  const base = createTheme();
  const [day, dusk, sunset] = createSunsetKeyframes(base, {
    shadowAngle: 1,
    shadowXOriginOffset: 0.9,
  });

  assert.equal(sunset.shadowDiagonal.angle, 1);
  assert.equal(sunset.shadowDiagonal.xOriginOffset, 0.9);
  assert.equal(dusk.shadowDiagonal.angle, (day.shadowDiagonal.angle + 1) / 2);
  assert.equal(dusk.shadowDiagonal.xOriginOffset, (day.shadowDiagonal.xOriginOffset + 0.9) / 2);

  // Not given, the sunset shadow is where the sunset has it
  assert.equal(createSunsetTheme(base).shadowDiagonal.xOriginOffset, SUNSET_SHADOW_X_ORIGIN_OFFSET);
});

test("the paper is white, and the same all through the sunset; with no paper there is none", () => {
  assert.deepEqual(createTheme().background.paper, { hue: 0, sat: 0, light: 100 });

  const keyframes = createSunsetKeyframes(createTheme());
  for (const progress of [0, 0.4, 0.5, 0.8, 1]) {
    assert.deepEqual(themeAtProgress(keyframes, progress).background.paper, {
      hue: 0,
      sat: 0,
      light: 100,
    });
  }

  const base = createTheme();
  base.background.paper = undefined;
  assert.equal(themeAtProgress(createSunsetKeyframes(base), 0.4).background.paper, undefined);
});
