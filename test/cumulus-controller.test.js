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
const create = (overrides = {}) => {
  const canvas = mockCanvas();
  return { canvas, controller: new CumulusController(canvas, { ...config, ...overrides }) };
};

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
