import { test } from "node:test";
import assert from "node:assert/strict";
import { CloudBuilder } from "../src/lib/cloud-builder.js";
import { CloudSimulation } from "../src/lib/cloud-simulation.js";
import { createTheme } from "../src/lib/theme.js";

const setup = () => {
  const builder = new CloudBuilder(600, 400, 15, 323);
  const interaction = { ...createTheme().interaction, repel: true };
  return { builder, simulation: new CloudSimulation(builder, interaction) };
};

// Steps until the simulation reports that nothing moved
const settle = (simulation, cursor, maxSteps = 5000) => {
  for (let i = 0; i < maxSteps; i++) {
    if (!simulation.moveCellsWithMouse(cursor)) return i;
  }
  assert.fail("the simulation never came to rest");
};

test("the mouse does nothing unless repel is switched on", () => {
  const builder = new CloudBuilder(600, 400, 15, 323);
  const simulation = new CloudSimulation(builder, { ...createTheme().interaction, repel: false });
  const before = builder.cells.map((cell) => [cell.x, cell.y]);
  const cx = builder.dome.x;
  const cy = builder.dome.y - builder.dome.radius / 2;
  for (let i = 0; i <= 20; i++) assert.equal(simulation.step({ x: cx - 150 + i * 15, y: cy }), false);
  assert.deepEqual(builder.cells.map((cell) => [cell.x, cell.y]), before);
});

test("a cloud at rest with no cursor does not change", () => {
  const { simulation } = setup();
  assert.equal(simulation.step(null), false);
  assert.equal(simulation.moveCellsWithMouse(null), false);
});

test("with repel on, step pushes cells out of the cursor's way", () => {
  const { builder, simulation } = setup();
  const cell = builder.cells[0];
  assert.equal(simulation.step({ x: cell.x - 5, y: cell.y }), true);
});

test("a cursor on a cell pushes cells sideways and reports a change", () => {
  const { builder, simulation } = setup();
  const before = builder.cells.map((cell) => cell.x);
  const cell = builder.cells[0];

  assert.equal(simulation.moveCellsWithMouse({ x: cell.x - 5, y: cell.y }), true);
  const moved = builder.cells.filter((c, i) => c.x !== before[i]);
  assert.ok(moved.length > 0);
});

test("cells only move horizontally, and never far from their base", () => {
  const { builder, simulation } = setup();
  const cell = builder.cells[0];
  const base = { ...cell.sim.baseLocation };

  for (let i = 0; i < 300; i++) simulation.moveCellsWithMouse({ x: cell.x - 5, y: cell.y });
  for (const c of builder.cells) {
    assert.equal(c.y, c.sim.baseLocation.y);
    assert.ok(Math.abs(c.x - c.sim.baseLocation.x) <= CloudSimulation.MAX_SHIFT);
  }
  assert.equal(cell.sim.baseLocation.x, base.x); // the base itself never moves
});

test("cells ease back to their base location when the cursor leaves", () => {
  const { builder, simulation } = setup();
  const cell = builder.cells[0];
  for (let i = 0; i < 300; i++) simulation.moveCellsWithMouse({ x: cell.x - 5, y: cell.y });

  settle(simulation, null);
  for (const c of builder.cells) assert.equal(c.x, c.sim.baseLocation.x);
});
