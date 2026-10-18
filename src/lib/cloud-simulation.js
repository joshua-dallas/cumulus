import { mulberry32, clamp, distanceBetweenPoints } from "./utils.js";
import { defaultTheme } from "./theme.js";

// Moves the cells and fractals of a CloudBuilder over time.
//
// The builder owns the shape of the cloud and is deterministic for a seed. The
// simulation only mutates positions/radii on the builder's cells. Each stage
// returns whether it changed anything, and step() reports that so the caller
// can skip recalculating fills and redrawing when the cloud is at rest.

export class CloudSimulation {
  static BORDER_PADDING = 20; // Minimum gap between a moved cell and the canvas edge
  static MAX_STEP = 5; // Largest distance a cell moves in one frame
  static MAX_SHIFT = 30; // Largest distance a cell can be pushed from its base location
  static MIN_STEP = 0.1; // Below this a cell snaps to its destination

  // The force based mouse interaction (see forceStep)
  static MAX_SUBSTEP = 0.008; // s. Physics runs in steps no longer than this, for stability
  static REFERENCE_RADIUS = 0.2; // A typical cell radius, as a fraction of the dome radius
  static REST_DISTANCE = 0.15; // px. A cell this close to its start, and slow, is at rest
  static REST_SPEED = 2; // px/s
  static REPORT_DISTANCE = 0.1; // px. Smaller movements are not worth a redraw

  // The simulation has its own random stream so that animation can never
  // disturb the seeded cloud generation in CloudBuilder.
  // interaction holds the settings for the force based mouse interaction
  constructor(builder, seed = 0, interaction = defaultTheme.interaction) {
    this.builder = builder;
    this.random = mulberry32(seed);
    this.interaction = interaction;

    // The mouse: where it was last frame, and its smoothed velocity in px/s
    this.cursorPrevious = null;
    this.mouseVelocity = { x: 0, y: 0 };

    this.createBodies();
  }

  // Advance the simulation by one frame.
  // cursor is { x, y } relative to the canvas, or null when there is no cursor.
  // dt is the time since the last frame in ms.
  // Returns true if anything moved.
  step(cursor, dt = 16) {
    let changed = false;
    changed = this.forceStep(cursor, dt) || changed;
    // The old sideways mouse push is not used now that the mouse is a force.
    // moveCellsWithMouse itself is unchanged
    //changed = this.moveCellsWithMouse(cursor) || changed;
    //changed = this.fractalSim() || changed;
    //changed = this.moveCloudCells() || changed;
    //changed = this.growCloudCells() || changed;
    return changed;
  }

  //----------------------------------------------------//
  // Mouse as a force
  //
  // Each cell is a body with a mass, a velocity and an offset from its start
  // (sim.baseLocation). Four forces act on it:
  //   - the mouse: along the stroke, stronger for faster strokes and for cells
  //     the stroke passes closer to
  //   - a spring back to the start, with damping so that it settles without
  //     swinging back and forth
  //   - cohesion: springs to the cells it overlaps, so the cloud moves as one
  //     body and the fills between cells are not torn apart
  //   - the walls: the dome centre line, the canvas edge and a maximum offset
  //----------------------------------------------------//

  // Sets up the bodies and which cells are neighbours. Cells are not moved
  createBodies() {
    const { dome } = this.builder;
    const referenceRadius = CloudSimulation.REFERENCE_RADIUS * dome.radius;

    this.bodies = this.builder.cells.map((cell) => ({
      cell,
      // Larger cells are heavier, and so take more force to move
      mass: (cell.radius / referenceRadius) ** this.interaction.massExponent,
      side: cell.sim.baseLocation.x >= dome.x ? 1 : -1, // Cells cannot cross the centre line
      vx: 0,
      vy: 0,
      fx: 0, // The force on the body this substep
      fy: 0,
      mouseFx: 0, // The force from the mouse this frame
      mouseFy: 0,
      reportedX: cell.x, // Where the cell was when it was last reported as moved
      reportedY: cell.y,
    }));

    // Cells that overlap at rest are neighbours. The deeper they overlap, the
    // more strongly they are tied together
    this.neighbours = [];
    for (let i = 0; i < this.bodies.length; i++) {
      for (let j = i + 1; j < this.bodies.length; j++) {
        const a = this.bodies[i].cell;
        const b = this.bodies[j].cell;
        const distance = distanceBetweenPoints(
          a.sim.baseLocation.x,
          a.sim.baseLocation.y,
          b.sim.baseLocation.x,
          b.sim.baseLocation.y,
        );
        const overlap = a.radius + b.radius - distance;
        if (overlap > 0) {
          const weight = clamp(overlap / Math.min(a.radius, b.radius), 0, 1);
          this.neighbours.push({
            a: this.bodies[i],
            b: this.bodies[j],
            weight,
            limit: this.interaction.maxRelativeOffset * Math.min(a.radius, b.radius),
          });
        }
      }
    }
  }

  // Forget the cursor, so that when it comes back the jump is not taken as a stroke
  resetCursor() {
    this.cursorPrevious = null;
    this.mouseVelocity = { x: 0, y: 0 };
  }

  forceStep(cursor, dtMs) {
    const dt = Math.min(dtMs, 100) / 1000;
    if (!(dt > 0)) return false;

    const stroke = this.updateMouse(cursor, dt);
    this.applyMouseForce(stroke);

    // A cloud that is still, and not being pushed, has nothing to do
    if (!stroke && this.isSettled()) return false;

    // Run the physics in short steps, whatever the length of the frame
    const substeps = Math.ceil(dt / CloudSimulation.MAX_SUBSTEP);
    for (let i = 0; i < substeps; i++) {
      this.integrate(dt / substeps);
    }

    return this.settleAndReport();
  }

  // Whether every cell is exactly where it started and not moving
  isSettled() {
    return this.bodies.every(
      ({ cell, vx, vy }) =>
        vx === 0 &&
        vy === 0 &&
        cell.x === cell.sim.baseLocation.x &&
        cell.y === cell.sim.baseLocation.y,
    );
  }

  // Works out the stroke made by the mouse this frame. Returns undefined if
  // there is no stroke: no cursor, or one that is not moving fast enough
  updateMouse(cursor, dt) {
    const { maxSpeed, minSpeed, speedSmoothing } = this.interaction;
    if (!cursor) {
      this.resetCursor();
      return undefined;
    }

    const from = this.cursorPrevious ?? cursor;
    this.cursorPrevious = { x: cursor.x, y: cursor.y };

    // The velocity over the frame, limited, then averaged with recent frames so
    // that it does not flicker with the timing of the mouse events
    let vx = (cursor.x - from.x) / dt;
    let vy = (cursor.y - from.y) / dt;
    const rawSpeed = Math.hypot(vx, vy);
    if (rawSpeed > maxSpeed) {
      vx *= maxSpeed / rawSpeed;
      vy *= maxSpeed / rawSpeed;
    }
    const blend = 1 - Math.exp(-dt / speedSmoothing);
    this.mouseVelocity.x += (vx - this.mouseVelocity.x) * blend;
    this.mouseVelocity.y += (vy - this.mouseVelocity.y) * blend;

    const speed = Math.hypot(this.mouseVelocity.x, this.mouseVelocity.y);
    if (speed < minSpeed) return undefined;
    return { from, to: cursor, velocity: this.mouseVelocity, speed };
  }

  // Sets the force of the mouse on every cell for this frame
  applyMouseForce(stroke) {
    const { handRadius, strength, speedExponent, referenceSpeed, parting, verticalStrength } =
      this.interaction;

    for (const body of this.bodies) {
      body.mouseFx = 0;
      body.mouseFy = 0;
      if (!stroke) continue;

      // Use the closest point of the whole stroke this frame, not only where
      // the mouse ended up, so a fast stroke cannot jump over a cell
      const { cell } = body;
      const closest = closestPointOnSegment(cell.x, cell.y, stroke.from, stroke.to);
      const distance = distanceBetweenPoints(cell.x, cell.y, closest.x, closest.y);
      const reach = cell.radius + handRadius;
      if (distance >= reach) continue;

      // The push fades smoothly to nothing at the edge of the reach
      const closeness = 1 - distance / reach;
      const speedForce = strength * stroke.speed * (stroke.speed / referenceSpeed) ** (speedExponent - 1);
      const push = speedForce * closeness * closeness;

      // Mostly along the stroke, and a little directly away from it
      const alongX = stroke.velocity.x / stroke.speed;
      const alongY = stroke.velocity.y / stroke.speed;
      const awayX = distance > 1e-6 ? (cell.x - closest.x) / distance : 0;
      const awayY = distance > 1e-6 ? (cell.y - closest.y) / distance : 0;

      body.mouseFx = push * ((1 - parting) * alongX + parting * awayX);
      body.mouseFy = push * ((1 - parting) * alongY + parting * awayY) * verticalStrength;
    }
  }

  // Moves every cell on by h seconds (semi-implicit Euler: velocities first)
  integrate(h) {
    const { returnTime, dampingRatio, neighbourStiffness, maxOffsetX, maxOffsetY } =
      this.interaction;

    // The spring constant per unit mass. A critically damped spring returns about
    // 90% of the way in 3.9 / omega seconds, so omega = 3.9 / returnTime
    const omega = 3.9 / returnTime;
    const spring = omega * omega;

    // The mouse, and the spring back to the start
    for (const body of this.bodies) {
      const { cell } = body;
      const offsetX = cell.x - cell.sim.baseLocation.x;
      const offsetY = cell.y - cell.sim.baseLocation.y;

      // The spring stiffens as a cell nears its maximum offset, so that it
      // is slowed down gently and not stopped dead by the limit
      const reached = Math.min(1, Math.hypot(offsetX / maxOffsetX, offsetY / maxOffsetY));
      const stiffness = spring * (1 + 3 * reached * reached);
      const damping = 2 * dampingRatio * Math.sqrt(stiffness * body.mass);

      body.fx = body.mouseFx - stiffness * offsetX - damping * body.vx;
      body.fy = body.mouseFy - stiffness * offsetY - damping * body.vy;
    }

    // Cohesion: each pair of neighbours is tied together by a spring on how
    // far each has been moved from its start, and resists moving apart or
    // together quickly
    if (neighbourStiffness > 0) {
      for (const { a, b, weight } of this.neighbours) {
        const stiffness = neighbourStiffness * spring * weight;
        const damping = 2 * dampingRatio * Math.sqrt(stiffness * Math.min(a.mass, b.mass));
        const pullX =
          stiffness * (b.cell.x - b.cell.sim.baseLocation.x - (a.cell.x - a.cell.sim.baseLocation.x)) +
          damping * (b.vx - a.vx);
        const pullY =
          stiffness * (b.cell.y - b.cell.sim.baseLocation.y - (a.cell.y - a.cell.sim.baseLocation.y)) +
          damping * (b.vy - a.vy);
        a.fx += pullX;
        a.fy += pullY;
        b.fx -= pullX;
        b.fy -= pullY;
      }
    }

    for (const body of this.bodies) {
      body.vx += (body.fx / body.mass) * h;
      body.vy += (body.fy / body.mass) * h;
      body.cell.x += body.vx * h;
      body.cell.y += body.vy * h;
    }

    // Both kinds of limit can move a cell, and fixing one can break the other,
    // so go round a few times. The walls come last: they must always hold
    const rounds = Number.isFinite(this.interaction.maxRelativeOffset) ? 3 : 1;
    for (let i = 0; i < rounds; i++) {
      if (rounds > 1) this.limitRelativeOffsets();
      for (const body of this.bodies) this.keepInBounds(body);
    }
  }

  // Two cells that overlap cannot be moved more than a set distance out of their
  // resting positions relative to each other. If they are, they are pulled back
  // together (the lighter cell moves more) and stop moving apart
  limitRelativeOffsets() {
    for (const { a, b, limit } of this.neighbours) {
      const x = b.cell.x - b.cell.sim.baseLocation.x - (a.cell.x - a.cell.sim.baseLocation.x);
      const y = b.cell.y - b.cell.sim.baseLocation.y - (a.cell.y - a.cell.sim.baseLocation.y);
      const distance = Math.hypot(x, y);
      if (distance <= limit) continue;

      const directionX = x / distance;
      const directionY = y / distance;
      const inverseA = 1 / a.mass;
      const inverseB = 1 / b.mass;
      const share = inverseA + inverseB;

      const excess = distance - limit;
      a.cell.x += (directionX * excess * inverseA) / share;
      a.cell.y += (directionY * excess * inverseA) / share;
      b.cell.x -= (directionX * excess * inverseB) / share;
      b.cell.y -= (directionY * excess * inverseB) / share;

      const separating = (b.vx - a.vx) * directionX + (b.vy - a.vy) * directionY;
      if (separating > 0) {
        a.vx += (directionX * separating * inverseA) / share;
        a.vy += (directionY * separating * inverseA) / share;
        b.vx -= (directionX * separating * inverseB) / share;
        b.vy -= (directionY * separating * inverseB) / share;
      }
    }
  }

  // The walls. A cell that meets one stops moving into it
  keepInBounds(body) {
    const { cell, side } = body;
    const { dome, width, height } = this.builder;
    const { maxOffsetX, maxOffsetY, borderPadding } = this.interaction;
    const base = cell.sim.baseLocation;

    // Each cell stays on its own side of the centre line, as the fills are
    // built separately for each side
    let minX = side > 0 ? dome.x : borderPadding + cell.radius;
    let maxX = side > 0 ? width - borderPadding - cell.radius : dome.x;
    minX = Math.max(minX, base.x - maxOffsetX);
    maxX = Math.min(maxX, base.x + maxOffsetX);
    let minY = Math.max(borderPadding + cell.radius, base.y - maxOffsetY);
    let maxY = Math.min(height - borderPadding - cell.radius, base.y + maxOffsetY);

    // The start itself is always allowed, even if it is outside these
    minX = Math.min(minX, base.x);
    maxX = Math.max(maxX, base.x);
    minY = Math.min(minY, base.y);
    maxY = Math.max(maxY, base.y);

    if (cell.x < minX) {
      cell.x = minX;
      body.vx = Math.max(body.vx, 0);
    } else if (cell.x > maxX) {
      cell.x = maxX;
      body.vx = Math.min(body.vx, 0);
    }
    if (cell.y < minY) {
      cell.y = minY;
      body.vy = Math.max(body.vy, 0);
    } else if (cell.y > maxY) {
      cell.y = maxY;
      body.vy = Math.min(body.vy, 0);
    }
  }

  // Puts cells that have come to rest exactly back at their start, so that
  // the cloud really is still and nothing needs redrawing. Returns true if any
  // cell has moved far enough since it was last reported to be worth redrawing
  settleAndReport() {
    const { REST_DISTANCE, REST_SPEED, REPORT_DISTANCE } = CloudSimulation;

    // Cells are only put back when the whole cloud is still, or the cloud
    // would jump. A mouse that is pushing keeps it moving
    const atRest = this.bodies.every(
      ({ cell, vx, vy, mouseFx, mouseFy }) =>
        mouseFx === 0 &&
        mouseFy === 0 &&
        Math.hypot(vx, vy) < REST_SPEED &&
        distanceBetweenPoints(cell.x, cell.y, cell.sim.baseLocation.x, cell.sim.baseLocation.y) <
          REST_DISTANCE,
    );

    let changed = false;
    for (const body of this.bodies) {
      const { cell } = body;
      if (atRest) {
        cell.x = cell.sim.baseLocation.x;
        cell.y = cell.sim.baseLocation.y;
        body.vx = 0;
        body.vy = 0;
      }
      if (
        Math.hypot(cell.x - body.reportedX, cell.y - body.reportedY) >=
          REPORT_DISTANCE ||
        (atRest && (cell.x !== body.reportedX || cell.y !== body.reportedY))
      ) {
        body.reportedX = cell.x;
        body.reportedY = cell.y;
        changed = true;
      }
    }
    return changed;
  }

  moveCellsWithMouse(cursor) {
    // TODO: Implement motion with force/velocity for a better easing function
    // TODO: Spread fractals when moving a cell?
    const { dome, width } = this.builder;
    const { BORDER_PADDING, MAX_STEP, MAX_SHIFT, MIN_STEP } = CloudSimulation;
    let changed = false;

    // We will shift cells left and right only to avoid the cursor
    // Determine the desired location of the cell
    for (const cell of this.builder.cells) {
      let desiredLocation = {
        x: cell.sim.baseLocation.x,
        y: cell.sim.baseLocation.y,
      };

      if (
        cursor &&
        distanceBetweenPoints(cell.x, cell.y, cursor.x, cursor.y) <
          cell.sim.cursorRadius
      ) {
        // Get the cursor position relative to the cell centre
        const relX = Math.abs(cursor.x - cell.x);
        const relY = Math.abs(cursor.y - cell.y);

        // How much would the cell need to shift left or right for the cursor to be outside the cursor radius
        let shiftX = Math.ceil(
          Math.sqrt(cell.sim.cursorRadius ** 2 - relY ** 2) - relX,
        );
        shiftX = cursor.x >= cell.x ? -shiftX : shiftX; // If the cursor is to the right, shift the cell left

        let desiredX = cell.x + shiftX;
        desiredX = clamp(
          desiredX,
          cell.sim.baseLocation.x - MAX_SHIFT,
          cell.sim.baseLocation.x + MAX_SHIFT,
        );

        if (cell.sim.baseLocation.x >= dome.x) {
          // The cell is on the right of the dome
          // TODO: Allow a slight crossing of the centre line that would not affect the visible fill
          // TODO: Move linked stepped children cells?
          desiredLocation = {
            x: clamp(desiredX, dome.x, width - BORDER_PADDING - cell.radius),
            y: cell.y,
          };
        } else {
          // The cell is on the left of the dome
          desiredLocation = {
            x: clamp(desiredX, BORDER_PADDING + cell.radius, dome.x),
            y: cell.y,
          };
        }

        // Allow the cells to return to their base location
        if (
          cursor.x < desiredLocation.x &&
          desiredLocation.x < cell.sim.baseLocation.x
        ) {
          desiredLocation = cell.sim.baseLocation;
        } else if (
          cursor.x > desiredLocation.x &&
          desiredLocation.x > cell.sim.baseLocation.x
        ) {
          desiredLocation = cell.sim.baseLocation;
        }
      }

      // Move the cell a step towards its desired location
      // TODO: Round all values to 10th of a pixel
      const desiredXChange = desiredLocation.x - cell.x;
      if (Math.abs(desiredXChange) < MIN_STEP) {
        cell.x = desiredLocation.x;
      } else {
        let xStep = clamp(desiredXChange * cell.sim.speed, -MAX_STEP, MAX_STEP);
        if (Math.abs(xStep) < MIN_STEP) {
          xStep = xStep > 0 ? MIN_STEP : -MIN_STEP;
        }
        cell.x += xStep;
      }

      // Flag if there there will be changes to draw
      if (Math.abs(desiredXChange)) {
        changed = true;
      }
    }

    return changed;
  }

  fractalSim() {
    // TODO: This didn't work very well, improve or remove
    // TODO: Is rounding best here?
    let changed = false;
    for (const cell of this.builder.cells) {
      for (const fractal of cell.lightFractals) {
        // Update the radius and location of each light fractal
        let step = fractal.sim.currentStep + 1;
        if (step >= fractal.sim.cycleLength) {
          step = 0;
        }
        fractal.sim.currentStep = step;

        const mult = fractal.sim.clockwise ? 1 : -1;
        fractal.x = Math.round(
          fractal.sim.rotCentreX -
            mult *
              Math.cos((step * 2 * Math.PI) / fractal.sim.cycleLength) *
              fractal.sim.rotRadiusX,
        );

        fractal.y = Math.round(
          fractal.sim.rotCentreY -
            Math.sin((step * 2 * Math.PI) / fractal.sim.cycleLength) *
              fractal.sim.rotRadiusY,
        );

        const shrinkingProgress =
          (step - fractal.sim.maxRadiusStep) /
          ((fractal.sim.cycleLength * 3) / 4 - fractal.sim.maxRadiusStep);

        if (step <= fractal.sim.maxRadiusStep) {
          fractal.radius =
            (step / fractal.sim.maxRadiusStep) * fractal.sim.maxRadius;
        } else if (step <= (fractal.sim.cycleLength * 3) / 4) {
          fractal.radius = (1 - shrinkingProgress) * fractal.sim.maxRadius;
        } else {
          fractal.radius = 0;
        }

        fractal.radius = Math.round(fractal.radius);
        changed = true;
      }
    }
    return changed;
  }

  moveCloudCells() {
    const step = 3;
    let changed = false;
    for (const cell of this.builder.cells) {
      const r = this.random();

      let dy = 0;
      if (r < 0.3) {
        dy = -step; // Move up
      } else if (r < 0.6) {
        dy = step; // Move down
      }
      // Otherwise, stay still

      if (dy) {
        cell.y += dy;
        for (const fractal of cell.lightFractals) fractal.y += dy;
        for (const fractal of cell.darkFractals) fractal.y += dy;
        changed = true;
      }
    }
    return changed;
  }
}

// The point of the segment from a to b that is closest to (x, y)
function closestPointOnSegment(x, y, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return { x: a.x, y: a.y };

  const along = clamp(((x - a.x) * dx + (y - a.y) * dy) / lengthSquared, 0, 1);
  return { x: a.x + along * dx, y: a.y + along * dy };
}
