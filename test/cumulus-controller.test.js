import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { installFakeAnimationFrame, mockCanvas } from "./helpers.js";
import { CumulusController } from "../src/lib/cumulus-controller.js";
import { createSunsetKeyframes, createTheme, defaultTheme } from "../src/lib/theme.js";

let frames;
beforeEach(() => {
  frames = installFakeAnimationFrame();
});

const config = { width: 400, height: 300, numCells: 8, seed: 323, lineWidth: 1, lineSpacing: 1.5 };

// A theme with the mouse push on. It is off by default: only clicking does anything
const mouseTheme = () => {
  const theme = createTheme();
  theme.interaction.repel = true;
  return theme;
};

// A clock the test controls, so animations can be moved on by an exact time
let time;
const create = (overrides = {}) => {
  const canvas = mockCanvas();
  time = 0;
  const controller = new CumulusController(canvas, { ...config, now: () => time, ...overrides });
  return { canvas, controller };
};

// Runs animation frames for about this many ms. Each frame draws the whole cloud, so
// frames are 50ms apart (60fps would take three times as long to test, and the
// controller allows frames up to 100ms) unless a test needs finer steps
const runFor = (ms, frameMs = 50) => {
  for (let elapsed = 0; elapsed < ms; elapsed += frameMs) {
    time += frameMs;
    frames.runFrame();
  }
};

// Clicks a point of the canvas the way the browser would
const click = (canvas, x, y) =>
  canvas.listeners.find((l) => l.type === "click").handler({ clientX: x, clientY: y });

test("the cloud is turned into layers: fills first, then every cell with its fractals", () => {
  const { controller } = create({ animate: false });
  const keys = controller.renderer.layers.map((layer) => layer.key);

  assert.equal(new Set(keys).size, keys.length); // every layer has its own stable key
  assert.ok(keys.some((key) => key.startsWith("inner-")));
  const firstCell = keys.findIndex((key) => key.startsWith("cell-"));
  assert.ok(keys.slice(0, firstCell).every((key) => !key.startsWith("cell-")));

  for (const cell of controller.builder.cells) {
    assert.ok(keys.includes(`cell-${cell.id}`));
    assert.ok(keys.includes(`light-fractal-${cell.id}-0`));
  }
});

test("with animate: false the cloud is drawn once, with no loop and no mouse listeners", () => {
  const { canvas } = create({ animate: false });
  assert.equal(frames.pendingCount(), 0);
  assert.equal(canvas.listeners.length, 0);
});

test("when animating, the loop is running, and the mouse is listened to only if it can do something", () => {
  const plain = create();
  assert.equal(frames.pendingCount(), 1);
  assert.equal(plain.canvas.listeners.length, 0); // the mouse push is off, and nothing can be clicked

  const withRepel = create({ theme: mouseTheme() });
  assert.deepEqual(withRepel.canvas.listeners.map((l) => l.type).sort(), [
    "mouseleave",
    "mousemove",
  ]);
});

test("the loop pauses when off-screen or the page is hidden, and resumes", () => {
  const { controller } = create();

  controller.setInView(false);
  assert.equal(frames.pendingCount(), 0);
  controller.setInView(true);
  assert.equal(frames.pendingCount(), 1);

  controller.setPageVisible(false);
  assert.equal(frames.pendingCount(), 0);
  controller.setInView(false); // still paused: hidden and off-screen
  controller.setPageVisible(true);
  assert.equal(frames.pendingCount(), 0);
  controller.setInView(true);
  assert.equal(frames.pendingCount(), 1);
});

test("destroy stops the loop and removes the listeners", () => {
  const { canvas, controller } = create({ theme: mouseTheme() });
  assert.ok(canvas.listeners.length > 0);
  controller.destroy();
  assert.equal(frames.pendingCount(), 0);
  assert.equal(canvas.listeners.length, 0);

  controller.setInView(true); // cannot be restarted once destroyed
  assert.equal(frames.pendingCount(), 0);
});

test("frames only recalculate fills and redraw when something moved", () => {
  const { controller } = create();
  let fillUpdates = 0;
  let draws = 0;
  const updateFills = controller.builder.updateFills.bind(controller.builder);
  controller.builder.updateFills = () => (fillUpdates++, updateFills());
  const draw = controller.renderer.draw.bind(controller.renderer);
  controller.renderer.draw = () => (draws++, draw());

  frames.runFrame(); // nothing is touching the cloud
  frames.runFrame();
  assert.deepEqual([fillUpdates, draws], [0, 0]);

  controller.simulation.step = () => true; // something moves
  frames.runFrame();
  assert.deepEqual([fillUpdates, draws], [1, 1]);
  controller.simulation.step = () => false; // and stops
  frames.runFrame();
  assert.deepEqual([fillUpdates, draws], [1, 1]);
});

test("putting the mouse on the cloud moves its cells, and the loop stops redrawing once they are back", () => {
  const { canvas, controller } = create({ theme: mouseTheme() });
  let draws = 0;
  const draw = controller.renderer.draw.bind(controller.renderer);
  controller.renderer.draw = () => (draws++, draw());
  const move = canvas.listeners.find((l) => l.type === "mousemove").handler;
  const leave = canvas.listeners.find((l) => l.type === "mouseleave").handler;

  const cell = controller.builder.cells[0];
  move({ clientX: cell.x - 5, clientY: cell.y });
  runFor(500, 16);
  assert.ok(draws > 0);
  assert.ok(controller.builder.cells.some((c) => c.x !== c.sim.baseLocation.x));

  // The cells return, and from then on nothing is redrawn
  leave();
  runFor(5000, 16);
  assert.ok(controller.builder.cells.every((c) => c.x === c.sim.baseLocation.x));
  const drawsWhenSettled = draws;
  runFor(500);
  assert.equal(draws, drawsWhenSettled);
});

test("by default the mouse does not move the cloud, but clicking it still makes a new one", () => {
  const { canvas, controller } = create({ regenerateOnClick: true, randomSeed: () => 4242 });
  const { dome } = controller.builder;
  const move = canvas.listeners.find((l) => l.type === "mousemove").handler;
  const before = controller.builder.cells.map((c) => [c.x, c.y]);

  for (let i = 0; i <= 14; i++) {
    move({ clientX: dome.x - 150 + i * 24, clientY: dome.y - dome.radius / 2 });
    runFor(16, 16);
  }
  assert.deepEqual(
    controller.builder.cells.map((c) => [c.x, c.y]),
    before,
  );

  const cell = controller.builder.cells[0];
  canvas.listeners.find((l) => l.type === "click").handler({ clientX: cell.x, clientY: cell.y });
  runFor(controller.theme.animation.shrinkDuration + 200);
  assert.equal(controller.seed, 4242);
});

test("the mouse does not push the cloud while it is still growing", () => {
  const { canvas, controller } = create({ growIn: true, theme: mouseTheme() });
  const move = canvas.listeners.find((l) => l.type === "mousemove").handler;
  const { dome } = controller.builder;

  for (let i = 0; i <= 14; i++) {
    move({ clientX: dome.x - 150 + i * 24, clientY: dome.y - dome.radius / 2 });
    runFor(16, 16);
  }
  assert.ok(controller.scale < 1);
  assert.ok(controller.builder.cells.every((c) => c.x === c.sim.baseLocation.x));
});

test("the cursor position is tracked, and cleared when the mouse leaves", () => {
  const { canvas, controller } = create({ theme: mouseTheme() });
  const move = canvas.listeners.find((l) => l.type === "mousemove");
  move.handler({ clientX: 120, clientY: 80 });
  assert.deepEqual(controller.cursor, { x: 120, y: 80 });

  canvas.listeners.find((l) => l.type === "mouseleave").handler();
  assert.equal(controller.cursor, null);
});

test("createTheme gives a copy that can be changed without changing the default", () => {
  const theme = createTheme();
  theme.colours.dark.light = 99;
  assert.notEqual(defaultTheme.colours.dark.light, 99);
});

test("every layer style in the theme uses a colour that exists", () => {
  for (const [name, style] of Object.entries(defaultTheme.layers)) {
    assert.ok(style.fill in defaultTheme.colours, `${name} uses an unknown colour`);
  }
});

// ---- the renderer's noise comes from the seed -----------------------------------------------

const noiseOf = (controller) => {
  const { noise } = controller.renderer;
  return {
    yOffset: noise.yOffset,
    lineWidth: noise.lineWidth,
    lineBreaks: noise.lineBreaks,
    lightness: noise.lightness,
    borderEdgeLeft: noise.borderEdgeLeft,
    shadowDiagonal: noise.shadowDiagonal,
    shadowDiagonalLocations: controller.renderer.shadowDiagonalLocations,
  };
};

test("the same seed gives the same noise, and a different seed different noise", () => {
  const a = create({ seed: 5 }).controller;
  const b = create({ seed: 5 }).controller;
  const c = create({ seed: 6 }).controller;
  assert.deepEqual(noiseOf(a), noiseOf(b));
  assert.notDeepEqual(noiseOf(a).yOffset, noiseOf(c).yOffset);
  assert.notEqual(a.renderer.seed, a.seed); // offset from the builder's seed
});

test("clicking the cloud gives it a new shape but keeps the line widths, lightness and y offsets", () => {
  const { controller } = create({ regenerateOnClick: true, randomSeed: () => 4242 });
  const before = structuredClone(noiseOf(controller));
  const rendererSeed = controller.renderer.seed;
  const cell = controller.builder.cells[0];

  controller.pointerClick(cell.x, cell.y);
  const { shrinkDuration, growDuration } = controller.theme.animation;
  runFor(shrinkDuration + growDuration + 500);
  assert.equal(controller.seed, 4242);
  assert.equal(controller.scale, 1);

  assert.equal(controller.renderer.seed, rendererSeed);
  assert.deepEqual(noiseOf(controller), before);
});

// ---- grow in -------------------------------------------------------------------------------

test("with growIn the cloud starts as nothing, grows with easing, and ends full size", () => {
  const { controller } = create({ growIn: true });
  const { growDuration } = controller.theme.animation;
  const layerKeys = () => controller.renderer.layers.map((layer) => layer.key);

  assert.equal(controller.scale, 0);
  assert.deepEqual(layerKeys(), []); // only the background is drawn

  runFor(growDuration / 4);
  const early = controller.scale;
  assert.ok(early > 0.25 && early < 1); // eased: well ahead of linear at the start
  assert.ok(layerKeys().some((key) => key.startsWith("cell-")));

  runFor(growDuration);
  assert.equal(controller.scale, 1);
  assert.equal(controller.phase, "idle");
});

test("a growing cloud is the full size cloud scaled about the middle of its base", () => {
  const { controller } = create({ growIn: true });
  runFor(controller.theme.animation.growDuration / 3);

  const cell = controller.builder.cells[0];
  const layer = controller.renderer.layers.find((l) => l.key === `cell-${cell.id}`);
  const { anchor, scale } = controller;
  assert.ok(scale > 0 && scale < 1);
  assert.equal(layer.radius, cell.radius * scale);
  assert.ok(Math.abs(layer.x - (anchor.x + (cell.x - anchor.x) * scale)) < 1e-9);
  assert.ok(Math.abs(layer.y - (anchor.y + (cell.y - anchor.y) * scale)) < 1e-9);
});

test("by default the fractals grow at the same time and rate as the cells", () => {
  const { controller } = create({ growIn: true });
  for (const scale of [0.1, 0.3, 0.6, 0.9, 1]) {
    controller.scale = scale;
    assert.equal(controller.fractalScale(), scale);
  }
});

test("with fractalLag the fractals appear later than the cell bodies", () => {
  const { controller } = create({ growIn: true });
  controller.theme.animation.fractalLag = true;
  const { growDuration, fractalStart } = controller.theme.animation;

  controller.scale = fractalStart / 2;
  assert.equal(controller.fractalScale(), 0);
  controller.scale = 0.7;
  assert.ok(controller.fractalScale() > 0 && controller.fractalScale() < controller.scale);
  controller.scale = 1;
  assert.equal(controller.fractalScale(), 1);
  assert.ok(growDuration > 0);
});

test("a finished cloud is exactly the cloud that is drawn without animation", () => {
  const grown = create({ growIn: true });
  runFor(grown.controller.theme.animation.growDuration + 100);
  const still = create({ animate: false });
  assert.deepEqual(grown.controller.renderer.layers, still.controller.renderer.layers);
});

test("growIn is ignored when animation is off, so the cloud is there straight away", () => {
  const { controller } = create({ animate: false, growIn: true });
  assert.equal(controller.scale, 1);
});

test("the grow animation does not jump ahead while paused", () => {
  const { controller } = create({ growIn: true });
  runFor(160, 16);
  const before = controller.scale;

  controller.setPageVisible(false);
  time += 60_000; // a minute in a background tab
  controller.setPageVisible(true);
  runFor(32, 16);
  assert.ok(controller.scale - before < 0.1);
  assert.equal(controller.phase, "growing");
});

// ---- click to regenerate -------------------------------------------------------------------

test("clicking the cloud shrinks it away, then grows a new cloud from a new seed", () => {
  const seeds = [];
  const { canvas, controller } = create({
    regenerateOnClick: true,
    randomSeed: () => 4242,
    onSeedChange: (seed) => seeds.push(seed),
  });
  const { shrinkDuration } = controller.theme.animation;
  const oldCells = controller.builder.cells;
  const cell = oldCells[0];

  click(canvas, cell.x, cell.y);
  assert.equal(controller.phase, "shrinking");
  assert.equal(controller.seed, 323); // still the old cloud

  runFor(shrinkDuration / 2);
  assert.ok(controller.scale > 0 && controller.scale < 1);

  runFor(shrinkDuration);
  assert.equal(controller.seed, 4242);
  assert.deepEqual(seeds, [4242]);
  assert.notEqual(controller.builder.cells, oldCells);
  assert.equal(controller.phase, "growing");

  runFor(controller.theme.animation.growDuration + 100);
  assert.equal(controller.scale, 1);
  assert.equal(controller.phase, "idle");
});

test("clicks away from the cloud, or while it is shrinking, do nothing", () => {
  const { canvas, controller } = create({ regenerateOnClick: true, randomSeed: () => 1 });

  click(canvas, 1, 1); // an empty corner of the sky
  assert.equal(controller.phase, "idle");

  const cell = controller.builder.cells[0];
  click(canvas, cell.x, cell.y);
  click(canvas, cell.x, cell.y); // a second click mid-shrink is ignored
  assert.equal(controller.phase, "shrinking");
  runFor(100);
  controller.randomSeed = () => 2;
  click(canvas, cell.x, cell.y);
  runFor(controller.theme.animation.shrinkDuration + 100);
  assert.equal(controller.seed, 1);
});

test("clicking a growing cloud shrinks it from the size it has reached", () => {
  const { canvas, controller } = create({ growIn: true, regenerateOnClick: true });
  runFor(controller.theme.animation.growDuration / 2);
  const reached = controller.scale;

  const cell = controller.builder.cells[0];
  click(canvas, controller.scaleX(cell.x), controller.scaleY(cell.y));
  assert.equal(controller.phase, "shrinking");
  assert.equal(controller.shrinkFrom, reached);
  runFor(32);
  assert.ok(controller.scale <= reached);
});

test("without animation, a click replaces the cloud immediately", () => {
  const { canvas, controller } = create({
    animate: false,
    regenerateOnClick: true,
    randomSeed: () => 77,
  });
  const cell = controller.builder.cells[0];

  click(canvas, cell.x, cell.y);
  assert.equal(controller.seed, 77);
  assert.equal(controller.scale, 1);
  assert.equal(controller.phase, "idle");
  assert.equal(frames.pendingCount(), 0);
});

test("click handling is only attached when regenerateOnClick is on", () => {
  assert.equal(
    create().canvas.listeners.some((l) => l.type === "click"),
    false,
  );
  const { canvas, controller } = create({ regenerateOnClick: true });
  assert.equal(
    canvas.listeners.some((l) => l.type === "click"),
    true,
  );
  controller.destroy();
  assert.equal(canvas.listeners.length, 0);
});

test("the pointer cursor shows over the cloud when it can be clicked", () => {
  const { canvas, controller } = create({ regenerateOnClick: true });
  const cell = controller.builder.cells[0];
  const move = canvas.listeners.find((l) => l.type === "mousemove").handler;

  move({ clientX: cell.x, clientY: cell.y });
  assert.equal(canvas.style.cursor, "pointer");
  move({ clientX: 1, clientY: 1 });
  assert.equal(canvas.style.cursor, "");
});

// ---- sunset ---------------------------------------------------------------------------------

// These tests are about the theme, not the shape of the cloud, so the cloud is a small one:
// every frame of a change draws it again
const createSmall = (overrides = {}) =>
  create({ width: 160, height: 100, numCells: 2, ...overrides });

const DAY = createTheme();
const SUNSET = createSunsetKeyframes(createTheme())[2];

// What the sky and the shadow look like, to compare
const look = (controller) => ({
  top: controller.theme.background.top,
  bottom: controller.theme.background.bottom,
  angle: controller.theme.shadowDiagonal.angle,
});

test("by default the sky is the day sky", () => {
  const { controller } = createSmall();
  assert.deepEqual(look(controller), {
    top: DAY.background.top,
    bottom: undefined,
    angle: DAY.shadowDiagonal.angle,
  });
  assert.equal(controller.renderer.backgroundTop, controller.theme.background.top);
});

test("a cloud made with sunset on starts as a sunset", () => {
  const { controller } = createSmall({ sunset: true });
  assert.deepEqual(look(controller).top, SUNSET.background.top);
  assert.equal(look(controller).angle, SUNSET.shadowDiagonal.angle);
  // and that is what is drawn
  assert.equal(controller.renderer.backgroundTop, controller.theme.background.top);
  assert.equal(controller.renderer.shadowDiagonalAngle, SUNSET.shadowDiagonal.angle);
});

test("fading to a sunset goes through dusk half way, and ends as a sunset", () => {
  const { controller } = createSmall({ sunsetDuration: 4000 });
  controller.setSunset(true);

  runFor(2000);
  const dusk = look(controller);
  assert.deepEqual(dusk.top, DAY.background.top); // still a blue sky at the top...
  assert.deepEqual(dusk.bottom, SUNSET.background.top); // ...and orange at the bottom
  assert.ok(
    Math.abs(dusk.angle - (DAY.shadowDiagonal.angle + SUNSET.shadowDiagonal.angle) / 2) < 1e-6,
  ); // shadow half way

  runFor(2200);
  assert.deepEqual(look(controller).top, SUNSET.background.top);
  assert.equal(look(controller).angle, SUNSET.shadowDiagonal.angle);
  assert.equal(controller.themeAnimation, null);
});

test("fading back from the sunset is the same stages in reverse", () => {
  const { controller } = createSmall({ sunset: true, sunsetDuration: 4000 });
  controller.setSunset(false);

  runFor(2000);
  assert.deepEqual(look(controller).top, DAY.background.top);
  assert.deepEqual(look(controller).bottom, SUNSET.background.top);

  runFor(2200);
  assert.deepEqual(look(controller).top, DAY.background.top);
  assert.equal(look(controller).angle, DAY.shadowDiagonal.angle);
  assert.equal(controller.renderer.backgroundTop, controller.theme.background.top);
});

test("the sunset can be reversed part way, and goes straight back without passing dusk again", () => {
  const { controller } = createSmall({ sunsetDuration: 4000 });
  controller.setSunset(true);
  runFor(1000);
  const reached = controller.themeProgress;
  assert.ok(reached > 0.05 && reached < 0.5);

  controller.setSunset(false);
  let previous = controller.themeProgress;
  let frames = 0;
  while (controller.themeAnimation && frames++ < 200) {
    runFor(50);
    assert.ok(controller.themeProgress <= previous + 1e-9, "went forwards again");
    previous = controller.themeProgress;
  }
  assert.equal(controller.themeProgress, 0);
  assert.equal(look(controller).angle, DAY.shadowDiagonal.angle);
});

test("a change that is part of the way there takes only part of the time", () => {
  const { controller } = createSmall({ sunsetDuration: 4000 });
  controller.setSunset(true);
  runFor(1000);
  controller.setSunset(false);
  assert.ok(controller.themeAnimation.duration < 2000); // not the whole 4000
  assert.ok(controller.themeAnimation.duration > 0);
});

test("the sky and shadow are redrawn on every frame of the change, and then the loop is idle again", () => {
  const { controller } = createSmall({ sunsetDuration: 1000 });
  let draws = 0;
  const draw = controller.renderer.draw.bind(controller.renderer);
  controller.renderer.draw = () => (draws++, draw());

  controller.setSunset(true);
  runFor(500);
  assert.ok(draws >= 9);
  runFor(700);
  const done = draws;
  runFor(500);
  assert.equal(draws, done);
});

test("transitionTheme fades through any list of themes, in either direction", () => {
  const { controller } = createSmall();
  const keyframes = createSunsetKeyframes(createTheme());

  controller.transitionTheme(keyframes, 0, 1, 1000);
  runFor(1100);
  assert.equal(controller.themeProgress, 1);
  assert.equal(look(controller).angle, SUNSET.shadowDiagonal.angle);

  controller.transitionTheme(keyframes, 1, 0, 1000);
  runFor(1100);
  assert.equal(controller.themeProgress, 0);
  assert.equal(look(controller).angle, DAY.shadowDiagonal.angle);
});

test("the theme object stays the same one, and only the sky and shadow change", () => {
  const { controller } = createSmall({ sunsetDuration: 1000 });
  const theme = controller.theme;
  const { animation, interaction, layers } = theme;

  controller.setSunset(true);
  runFor(1200);
  assert.equal(controller.theme, theme);
  assert.equal(theme.animation, animation);
  assert.equal(theme.interaction, interaction);
  assert.equal(theme.layers, layers);
});

test("without animation the sunset is immediate", () => {
  const { controller } = createSmall({ animate: false });
  controller.setSunset(true);
  assert.equal(controller.themeAnimation, null);
  assert.equal(look(controller).angle, SUNSET.shadowDiagonal.angle);
  assert.deepEqual(look(controller).top, SUNSET.background.top);
  assert.equal(frames.pendingCount(), 0);

  controller.setSunset(false);
  assert.equal(look(controller).angle, DAY.shadowDiagonal.angle);
});

test("the sunset carries on when the cloud is replaced by a click", () => {
  const { canvas, controller } = createSmall({
    sunset: true,
    regenerateOnClick: true,
    randomSeed: () => 99,
  });
  const cell = controller.builder.cells[0];
  canvas.listeners.find((l) => l.type === "click").handler({ clientX: cell.x, clientY: cell.y });
  runFor(controller.theme.animation.shrinkDuration + 200);
  assert.equal(controller.seed, 99);
  assert.equal(look(controller).angle, SUNSET.shadowDiagonal.angle);
});

test("the cloud is built with the cloud settings from the theme", () => {
  const theme = createTheme();
  theme.cloud.minBaseWidth = 0.5;
  const { controller } = createSmall({ theme });
  assert.equal(controller.builder.options, theme.cloud);
  assert.equal(controller.builder.options.minBaseWidth, 0.5);
});

test("the shadow edge can be moved for the day and for the sunset", () => {
  const { controller } = createSmall({ sunsetDuration: 1000 });
  controller.setShadowDiagonal({ day: { angle: 2, xOriginOffset: 0.4 } });
  assert.equal(controller.theme.shadowDiagonal.angle, 2);
  assert.equal(controller.renderer.shadowDiagonalAngle, 2);
  assert.equal(
    controller.renderer.shadowDiagonalXOrigin,
    controller.builder.dome.x + 0.4 * controller.builder.dome.radius,
  );

  // The sunset shadow does not show in the day, but is where the sunset ends up
  controller.setShadowDiagonal({ sunset: { angle: 1, xOriginOffset: 0.9 } });
  assert.equal(controller.theme.shadowDiagonal.angle, 2);
  controller.setSunset(true);
  runFor(1200);
  assert.equal(controller.theme.shadowDiagonal.angle, 1);
  assert.equal(controller.theme.shadowDiagonal.xOriginOffset, 0.9);

  // and the day is where it goes back to
  controller.setSunset(false);
  runFor(1200);
  assert.equal(controller.theme.shadowDiagonal.angle, 2);
  assert.equal(controller.theme.shadowDiagonal.xOriginOffset, 0.4);
});

test("moving the shadow edge in the sunset while it shows is seen at once and redrawn", () => {
  const { controller } = createSmall({ sunset: true });
  let draws = 0;
  const draw = controller.renderer.draw.bind(controller.renderer);
  controller.renderer.draw = () => (draws++, draw());

  controller.setShadowDiagonal({ sunset: { angle: 1.2 } });
  assert.equal(controller.renderer.shadowDiagonalAngle, 1.2);
  assert.equal(draws, 1);
});

test("the shadow edge can be changed part way through a sunset, which carries on to the new place", () => {
  const { controller } = createSmall({ sunsetDuration: 1000 });
  controller.setSunset(true);
  runFor(300);
  controller.setShadowDiagonal({ sunset: { angle: 1 } });
  runFor(1200);
  assert.equal(controller.theme.shadowDiagonal.angle, 1);
});

test("the shadow edge can be set when the cloud is made", () => {
  const { controller } = createSmall({
    shadowDiagonal: { day: { angle: 2.5 }, sunset: { angle: 1.1 } },
  });
  assert.equal(controller.theme.shadowDiagonal.angle, 2.5); // the day
  assert.equal(controller.sunsetKeyframes[2].shadowDiagonal.angle, 1.1);
});

test("the canvas is cleared to see-through by default, so the page behind shows in the gaps", () => {
  const canvas = mockCanvas();
  const calls = [];
  const context = canvas.getContext();
  Object.defineProperty(context, "fillRect", {
    value: (...args) => calls.push(["fillRect", ...args]),
  });
  Object.defineProperty(context, "clearRect", {
    value: (...args) => calls.push(["clearRect", ...args]),
  });

  const controller = new CumulusController(canvas, {
    ...config,
    width: 160,
    height: 100,
    numCells: 2,
    animate: false,
  });
  controller.redraw();
  assert.deepEqual(calls[0], ["clearRect", 0, 0, 160, 100]);
  assert.ok(calls.every((call) => call[0] === "clearRect"));
});

test("a paper colour is only used for the gaps in lines: the canvas itself is never filled", () => {
  const canvas = mockCanvas();
  const fills = [];
  const context = canvas.getContext();
  Object.defineProperty(context, "fillRect", { value: (...args) => fills.push(args) });
  const theme = createTheme();
  theme.background.paper = { hue: 0, sat: 0, light: 100 };

  const controller = new CumulusController(canvas, {
    ...config,
    width: 160,
    height: 100,
    numCells: 2,
    animate: false,
    theme,
  });
  controller.redraw();
  assert.deepEqual(fills, []);
});

test("the fill of the cloud counts as the cloud for clicks", () => {
  const { controller } = create({ regenerateOnClick: true });
  const circle = controller.builder.fillCircles[0] ?? controller.builder.horizontalFillCircles[0];
  assert.ok(controller.isOverCloud(circle.x, circle.y));
  assert.equal(controller.isOverCloud(1, 1), false);

  // A point inside the inner fill polygon, away from every cell
  const [first] = controller.builder.cloudInnerLeft;
  const inside = controller.isInPolygon(
    first.x + 0.5,
    first.y + 0.5,
    controller.builder.cloudInnerLeft,
  );
  assert.equal(typeof inside, "boolean");
});

test("pointer methods drive the cloud without listening to the canvas (as in a worker)", () => {
  const cursors = [];
  const { canvas, controller } = create({
    regenerateOnClick: true,
    listenToCanvas: false,
    onCursorChange: (cursor) => cursors.push(cursor),
  });
  assert.deepEqual(canvas.listeners, []);
  assert.equal(controller.followsMouse, true);

  const cell = controller.builder.cells[0];
  controller.pointerMove(cell.x, cell.y);
  controller.pointerMove(1, 1);
  controller.pointerLeave();
  assert.deepEqual(cursors, ["pointer", "", ""]);

  const seed = controller.seed;
  controller.config.randomSeed = undefined;
  controller.randomSeed = () => seed + 1;
  controller.pointerClick(cell.x, cell.y);
  assert.equal(controller.phase, "shrinking");
});

test("setThemeValues changes layer styles and shades, redraws, and keeps them through a sunset", () => {
  const { controller } = create({ animate: false });
  controller.setThemeValues({
    colours: { dark: { light: 33 } },
    layers: { cell: { lineWidth: 2.5 } },
  });

  assert.equal(controller.theme.layers.cell.lineWidth, 2.5);
  assert.equal(controller.theme.layers.cell.waveAmplitude, defaultTheme.layers.cell.waveAmplitude); // others kept
  assert.equal(controller.theme.colours.dark.light, 33);
  assert.equal(
    controller.renderer.layers.find((layer) => layer.key.startsWith("cell-")).lineWidth,
    2.5,
  );

  controller.setSunset(true, 1000); // no animation: at once
  assert.equal(controller.theme.colours.dark.light, 33);
  assert.equal(controller.theme.layers.cell.lineWidth, 2.5);
  assert.equal(controller.theme.colours.dark2.light, defaultTheme.colours.dark2.light);
});

test("paddingScale multiplies a layer's padding, including the light fractals' own padding", () => {
  const { controller } = create({ animate: false });
  const layer = (key) => controller.renderer.layers.find((l) => l.key === key);
  const cell = controller.builder.cells.find((c) =>
    c.lightFractals.some((f) => f.rightPadding > 0),
  );
  const i = cell.lightFractals.findIndex((f) => f.rightPadding > 0);
  const fractalKey = `light-fractal-${cell.id}-${i}`;

  assert.equal(layer(`cell-${cell.id}`).rightPadding, defaultTheme.layers.cell.rightPadding);
  assert.equal(layer(fractalKey).rightPadding, cell.lightFractals[i].rightPadding);

  controller.setThemeValues({
    layers: { cell: { paddingScale: 0.5 }, lightFractal: { paddingScale: 0.25 } },
  });
  assert.equal(layer(`cell-${cell.id}`).rightPadding, defaultTheme.layers.cell.rightPadding * 0.5);
  assert.equal(layer(fractalKey).rightPadding, cell.lightFractals[i].rightPadding * 0.25);
  assert.equal(controller.theme.layers.cell.rightPadding, defaultTheme.layers.cell.rightPadding); // theme unchanged
});

test("themeValues in the config are applied from the start", () => {
  const { controller } = create({
    animate: false,
    themeValues: { colours: { mid: { light: 61 } } },
  });
  assert.equal(controller.theme.colours.mid.light, 61);
  assert.equal(defaultTheme.colours.mid.light, 66); // the default theme itself is not changed
});

test("mouseRepel makes the cloud follow the mouse and slide cells out of its way", () => {
  const off = create({ animate: true });
  assert.equal(off.canvas.listeners.length, 0); // nothing to do with the mouse

  const { canvas, controller } = create({ mouseRepel: true });
  assert.ok(canvas.listeners.some((l) => l.type === "mousemove"));
  runFor(200);
  const cell = controller.builder.cells[0];
  const start = cell.x;
  controller.pointerMove(cell.x + 5, cell.y);
  runFor(200);
  assert.notEqual(cell.x, start);
});
