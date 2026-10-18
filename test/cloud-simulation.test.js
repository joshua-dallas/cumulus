import { test } from "node:test";
import assert from "node:assert/strict";
import { CloudBuilder } from "../src/lib/cloud-builder.js";
import { CloudSimulation } from "../src/lib/cloud-simulation.js";
import { createTheme } from "../src/lib/theme.js";

const setup = () => {
  const builder = new CloudBuilder(600, 400, 15, 323);
  const interaction = { ...createTheme().interaction, enabled: true };
  return { builder, simulation: new CloudSimulation(builder, 323, interaction) };
};

// Steps until the simulation reports that nothing moved
const settle = (simulation, cursor, maxSteps = 5000) => {
  for (let i = 0; i < maxSteps; i++) {
    if (!simulation.moveCellsWithMouse(cursor)) return i;
  }
  assert.fail("the simulation never came to rest");
};

test("the mouse does nothing unless it is switched on", () => {
  const builder = new CloudBuilder(600, 400, 15, 323);
  const simulation = new CloudSimulation(builder, 323, { ...createTheme().interaction, enabled: false });
  const before = builder.cells.map((cell) => [cell.x, cell.y]);
  const cx = builder.dome.x;
  const cy = builder.dome.y - builder.dome.radius / 2;
  for (let i = 0; i <= 20; i++) assert.equal(simulation.step({ x: cx - 150 + i * 15, y: cy }, 16), false);
  assert.deepEqual(builder.cells.map((cell) => [cell.x, cell.y]), before);
});

test("a cloud at rest with no cursor does not change", () => {
  const { simulation } = setup();
  assert.equal(simulation.step(null), false);
  assert.equal(simulation.moveCellsWithMouse(null), false);
});

// The sideways push (moveCellsWithMouse) is kept but not called by step() for now,
// so these tests call it directly

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

// ---- the mouse as a force ------------------------------------------------------------------
//
// These use a small made-up cloud, so each test is about one thing. The dome radius of
// 100 makes a "typical" cell radius 20.

function makeCloud(cellSpecs, interaction = {}) {
  const cells = cellSpecs.map(([x, y, radius], id) => ({
    id,
    x,
    y,
    radius,
    sim: { baseLocation: { x, y } },
  }));
  const builder = { dome: { x: 300, y: 300, radius: 100 }, width: 600, height: 400, cells };
  const settings = { ...createTheme().interaction, enabled: true, ...interaction };
  return { cells, simulation: new CloudSimulation(builder, 1, settings) };
}

// Moves the cursor in a straight line from one point to another at a speed in px/s,
// one 16ms frame at a time
function stroke(simulation, from, to, speed) {
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  const frames = Math.max(1, Math.round(distance / ((speed * 16) / 1000)));
  for (let i = 0; i <= frames; i++) {
    const t = i / frames;
    simulation.step({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t }, 16);
  }
}

// Steps with no cursor until every cell is back where it started. Returns the frames it took
const settleCloud = (simulation, maxFrames = 3000) => {
  for (let i = 0; i < maxFrames; i++) {
    if (simulation.isSettled()) return i;
    simulation.step(null, 16);
  }
  assert.fail("the cloud never came to rest");
};

const offset = (cell) => ({ x: cell.x - cell.sim.baseLocation.x, y: cell.y - cell.sim.baseLocation.y });

test("a cursor that is not moving does not push anything", () => {
  const { cells, simulation } = makeCloud([[400, 200, 20]]);
  for (let i = 0; i < 30; i++) assert.equal(simulation.step({ x: 400, y: 200 }, 16), false);
  assert.deepEqual(offset(cells[0]), { x: 0, y: 0 });
});

test("a stroke slower than the minimum speed does nothing", () => {
  const { cells, simulation } = makeCloud([[400, 200, 20]]);
  stroke(simulation, { x: 340, y: 200 }, { x: 460, y: 200 }, 30);
  assert.deepEqual(offset(cells[0]), { x: 0, y: 0 });
});

test("a stroke through a cell pushes it along the stroke", () => {
  const { cells, simulation } = makeCloud([[400, 200, 20]], { verticalStrength: 1 });
  stroke(simulation, { x: 330, y: 200 }, { x: 470, y: 200 }, 1200);
  assert.ok(offset(cells[0]).x > 5);

  const left = makeCloud([[400, 200, 20]]);
  stroke(left.simulation, { x: 470, y: 200 }, { x: 330, y: 200 }, 1200);
  assert.ok(offset(left.cells[0]).x < -5);
});

test("faster strokes push cells further", () => {
  const peak = (speed) => {
    const { cells, simulation } = makeCloud([[400, 200, 20]]);
    stroke(simulation, { x: 330, y: 200 }, { x: 470, y: 200 }, speed);
    let furthest = 0;
    for (let i = 0; i < 300; i++) {
      simulation.step(null, 16);
      furthest = Math.max(furthest, offset(cells[0]).x);
    }
    return furthest;
  };
  assert.ok(peak(400) < peak(900));
  assert.ok(peak(900) < peak(1500));
});

test("larger cells take more force to move than smaller ones", () => {
  const moved = (radius) => {
    const { cells, simulation } = makeCloud([[400, 200, radius]]);
    stroke(simulation, { x: 300, y: 200 }, { x: 500, y: 200 }, 1200);
    return Math.max(Math.abs(offset(cells[0]).x), 0);
  };
  assert.ok(moved(12) > moved(20));
  assert.ok(moved(20) > moved(40));
});

test("a stroke pushes less the further it passes from a cell, and not at all beyond its reach", () => {
  const pushedBy = (distanceAway) => {
    const { cells, simulation } = makeCloud([[400, 200, 20]], { parting: 0, verticalStrength: 1 });
    const y = 200 + distanceAway;
    stroke(simulation, { x: 330, y }, { x: 470, y }, 1200);
    return Math.abs(offset(cells[0]).x);
  };
  assert.ok(pushedBy(0) > pushedBy(25));
  assert.ok(pushedBy(25) > pushedBy(45));
  assert.equal(pushedBy(60), 0); // the reach is the radius, 20, plus the 30px hand, 50 in all
});

test("a stroke cannot skip over a cell, however fast the mouse jumps", () => {
  const { cells, simulation } = makeCloud([[400, 200, 20]]);
  simulation.step({ x: 300, y: 200 }, 16);
  simulation.step({ x: 400, y: 200 }, 16); // the cursor starts moving, and is now on the cell
  simulation.step({ x: 520, y: 200 }, 16); // and is on the other side of it in one frame
  assert.ok(Math.abs(offset(cells[0]).x) > 0);
});

test("cells ease back to where they started, without swinging past it, and then stop", () => {
  const { cells, simulation } = makeCloud([[400, 200, 20]]);
  stroke(simulation, { x: 330, y: 200 }, { x: 470, y: 200 }, 1200);
  assert.ok(offset(cells[0]).x > 5);

  // A cell keeps moving out for a moment after the stroke, as it has momentum. Once it
  // has turned round it only ever moves back
  let previous = offset(cells[0]).x;
  let turned = false;
  for (let frames = 0; !simulation.isSettled(); frames++) {
    assert.ok(frames < 3000, "never came to rest");
    simulation.step(null, 16);
    const x = offset(cells[0]).x;
    assert.ok(x >= 0, "went past where it started");
    if (x < previous - 1e-9) turned = true;
    if (turned) assert.ok(x <= previous + 1e-9, "moved away again");
    previous = x;
  }
  assert.ok(turned);
  assert.deepEqual(offset(cells[0]), { x: 0, y: 0 }); // exactly back
  assert.equal(simulation.step(null, 16), false); // and nothing more to draw
});

test("larger cells return more slowly than smaller ones", () => {
  // The same start: each cell is held 30px from where it started, and let go
  const framesToReturn = (radius) => {
    const { cells, simulation } = makeCloud([[400, 200, radius]]);
    cells[0].x += 30;
    let frames = 0;
    while (offset(cells[0]).x > 3 && frames < 3000) {
      simulation.step(null, 16);
      frames++;
    }
    return frames;
  };
  assert.ok(framesToReturn(40) > framesToReturn(20));
  assert.ok(framesToReturn(20) > framesToReturn(12));
});

test("a cell stays on its own side of the centre line, inside the canvas and within the maximum offset", () => {
  // A cell just right of the centre line, pushed hard to the left
  const { cells, simulation } = makeCloud([[330, 250, 20]], { maxOffsetX: 60 });
  for (let i = 0; i < 5; i++) stroke(simulation, { x: 420, y: 250 }, { x: 250, y: 250 }, 2500);
  assert.ok(cells[0].x >= 300); // the dome centre

  // A cell near the right edge pushed hard to the right
  const edge = makeCloud([[540, 250, 20]], { maxOffsetX: 60, borderPadding: 20 });
  for (let i = 0; i < 5; i++) stroke(edge.simulation, { x: 480, y: 250 }, { x: 600, y: 250 }, 2500);
  assert.ok(edge.cells[0].x <= 600 - 20 - 20);

  // A cell far from the walls cannot be pushed past the maximum offset
  const free = makeCloud([[400, 200, 8]], { maxOffsetX: 30 });
  for (let i = 0; i < 8; i++) stroke(free.simulation, { x: 340, y: 200 }, { x: 460, y: 200 }, 2500);
  assert.ok(offset(free.cells[0]).x <= 30 + 1e-9);
});

test("verticalStrength decides how much a stroke moves cells up and down", () => {
  const verticalMovement = (verticalStrength) => {
    const { cells, simulation } = makeCloud([[400, 200, 20]], { verticalStrength, parting: 0 });
    stroke(simulation, { x: 400, y: 280 }, { x: 400, y: 120 }, 1200); // straight up
    return offset(cells[0]).y;
  };
  assert.equal(verticalMovement(0), 0);
  assert.ok(verticalMovement(0.5) < -3); // up is negative
  assert.ok(verticalMovement(1) < verticalMovement(0.5));
});

test("cells that overlap are pulled along together; cells that do not are left alone", () => {
  const specs = [[400, 200, 20], [420, 200, 20], [520, 200, 20]]; // the first two overlap
  const withCohesion = makeCloud(specs, { maxRelativeOffset: Infinity });
  stroke(withCohesion.simulation, { x: 340, y: 200 }, { x: 410, y: 200 }, 1200);
  assert.ok(offset(withCohesion.cells[0]).x > 0);
  assert.ok(offset(withCohesion.cells[1]).x > 0); // dragged along (the stroke also reaches it a little)
  assert.equal(offset(withCohesion.cells[2]).x, 0); // too far away to be moved

  const without = makeCloud(specs, { neighbourStiffness: 0, maxRelativeOffset: Infinity });
  stroke(without.simulation, { x: 340, y: 200 }, { x: 410, y: 200 }, 1200);
  assert.ok(offset(withCohesion.cells[1]).x > offset(without.cells[1]).x);
});

test("overlapping cells can never be moved far out of their resting positions relative to each other", () => {
  const { cells, simulation } = makeCloud([[400, 200, 30], [420, 200, 10]], { maxRelativeOffset: 0.3 });
  const limit = 0.3 * 10; // a fraction of the smaller radius
  for (let i = 0; i < 6; i++) {
    stroke(simulation, { x: 330, y: 200 }, { x: 410, y: 200 }, 2500);
    const apart = Math.hypot(offset(cells[1]).x - offset(cells[0]).x, offset(cells[1]).y - offset(cells[0]).y);
    assert.ok(apart <= limit + 0.01, `${apart} is further apart than ${limit}`);
  }
});

test("when the cursor goes away and comes back somewhere else, the jump is not a stroke", () => {
  const { cells, simulation } = makeCloud([[400, 200, 20]]);
  simulation.step({ x: 50, y: 50 }, 16);
  simulation.step(null, 16); // the mouse leaves
  simulation.step({ x: 400, y: 200 }, 16); // and comes back on the cell
  assert.deepEqual(offset(cells[0]), { x: 0, y: 0 });

  const paused = makeCloud([[400, 200, 20]]);
  paused.simulation.step({ x: 50, y: 50 }, 16);
  paused.simulation.resetCursor(); // for example after a pause
  paused.simulation.step({ x: 400, y: 200 }, 16);
  assert.deepEqual(offset(paused.cells[0]), { x: 0, y: 0 });
});

test("a very long frame, as after a pause, does not break the physics", () => {
  const { cells, simulation } = makeCloud([[400, 200, 20], [420, 200, 20]]);
  stroke(simulation, { x: 340, y: 200 }, { x: 460, y: 200 }, 2000);
  for (const dt of [5000, 0, -10, 100]) simulation.step(null, dt);
  for (const cell of cells) {
    assert.ok(Number.isFinite(cell.x) && Number.isFinite(cell.y));
    assert.ok(Math.abs(offset(cell).x) < 100);
  }
});

test("the same strokes always move the cloud in the same way", () => {
  const run = () => {
    const { cells, simulation } = makeCloud([[400, 200, 20], [420, 230, 14], [380, 170, 26]]);
    stroke(simulation, { x: 330, y: 160 }, { x: 470, y: 240 }, 1300);
    return cells.map((cell) => [cell.x, cell.y]);
  };
  assert.deepEqual(run(), run());
});

test("on a real cloud, a stroke moves cells and they all return exactly to rest", () => {
  const { builder, simulation } = setup();
  const start = builder.cells.map((cell) => [cell.x, cell.y]);
  const cx = builder.dome.x;
  const cy = builder.dome.y - builder.dome.radius / 2;
  stroke(simulation, { x: cx - 150, y: cy }, { x: cx + 150, y: cy }, 1500);
  assert.notDeepEqual(builder.cells.map((cell) => [cell.x, cell.y]), start);

  settleCloud(simulation);
  assert.deepEqual(builder.cells.map((cell) => [cell.x, cell.y]), start);
});
