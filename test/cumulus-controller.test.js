import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { installFakeAnimationFrame, mockCanvas } from "./helpers.js";
import { CumulusController } from "../src/lib/cumulus-controller.js";
import { createTheme, defaultTheme } from "../src/lib/theme.js";

let frames;
beforeEach(() => {
  frames = installFakeAnimationFrame();
});

const config = { width: 400, height: 300, numCells: 8, seed: 323, lineWidth: 1, lineSpacing: 1.5 };

// A clock the test controls, so animations can be moved on by an exact time
let time;
const create = (overrides = {}) => {
  const canvas = mockCanvas();
  time = 0;
  const controller = new CumulusController(canvas, { ...config, now: () => time, ...overrides });
  return { canvas, controller };
};

// Runs animation frames, each 16ms after the last, for about this many ms
const runFor = (ms) => {
  for (let elapsed = 0; elapsed < ms; elapsed += 16) {
    time += 16;
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

test("when animating, the loop and mouse listeners are running", () => {
  const { canvas } = create();
  assert.equal(frames.pendingCount(), 1);
  assert.deepEqual(canvas.listeners.map((l) => l.type).sort(), ["mouseleave", "mousemove"]);
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
  const { canvas, controller } = create();
  controller.destroy();
  assert.equal(frames.pendingCount(), 0);
  assert.equal(canvas.listeners.length, 0);

  controller.setInView(true); // cannot be restarted once destroyed
  assert.equal(frames.pendingCount(), 0);
});

test("frames only recalculate fills and redraw when something moved", () => {
  const { canvas, controller } = create();
  let fillUpdates = 0;
  let draws = 0;
  const updateFills = controller.builder.updateFills.bind(controller.builder);
  controller.builder.updateFills = () => (fillUpdates++, updateFills());
  const draw = controller.renderer.draw.bind(controller.renderer);
  controller.renderer.draw = () => (draws++, draw());

  frames.runFrame(); // nothing is touching the cloud
  frames.runFrame();
  assert.deepEqual([fillUpdates, draws], [0, 0]);

  const cell = controller.builder.cells[0];
  const move = canvas.listeners.find((l) => l.type === "mousemove");
  move.handler({ clientX: cell.x - 5, clientY: cell.y });
  frames.runFrame();
  assert.deepEqual([fillUpdates, draws], [1, 1]);

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

test("fractals appear later than the cell bodies", () => {
  const { controller } = create({ growIn: true });
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
  runFor(160);
  const before = controller.scale;

  controller.setPageVisible(false);
  time += 60_000; // a minute in a background tab
  controller.setPageVisible(true);
  runFor(32);
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
  const { canvas, controller } = create({ animate: false, regenerateOnClick: true, randomSeed: () => 77 });
  const cell = controller.builder.cells[0];

  click(canvas, cell.x, cell.y);
  assert.equal(controller.seed, 77);
  assert.equal(controller.scale, 1);
  assert.equal(controller.phase, "idle");
  assert.equal(frames.pendingCount(), 0);
});

test("click handling is only attached when regenerateOnClick is on", () => {
  assert.equal(create().canvas.listeners.some((l) => l.type === "click"), false);
  const { canvas, controller } = create({ regenerateOnClick: true });
  assert.equal(canvas.listeners.some((l) => l.type === "click"), true);
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
