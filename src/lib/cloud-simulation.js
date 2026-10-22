import { clamp, distanceBetweenPoints } from "./utils.js";
import { defaultTheme } from "./theme.js";

// Moves the cells of a CloudBuilder over time.
//
// The builder owns the shape of the cloud and is deterministic for a seed. The
// simulation only mutates positions on the builder's cells. step() reports whether
// anything moved, so the caller can skip recalculating fills and redrawing when the
// cloud is at rest.

export class CloudSimulation {
  static BORDER_PADDING = 20; // Minimum gap between a moved cell and the canvas edge
  static MAX_STEP = 5; // Largest distance a cell moves in one frame
  static MAX_SHIFT = 30; // Largest distance a cell can be pushed from its base location
  static MIN_STEP = 0.1; // Below this a cell snaps to its destination

  // interaction holds the mouse settings (theme.interaction)
  constructor(builder, interaction = defaultTheme.interaction) {
    this.builder = builder;
    this.interaction = interaction;
  }

  // Advance the simulation by one frame.
  // cursor is { x, y } relative to the canvas, or null when there is no cursor.
  // Returns true if anything moved.
  step(cursor) {
    let changed = false;
    // Cells slide out of the cursor's way, if switched on (theme.interaction.repel)
    if (this.interaction.repel) changed = this.moveCellsWithMouse(cursor) || changed;
    return changed;
  }

  moveCellsWithMouse(cursor) {
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
        distanceBetweenPoints(cell.x, cell.y, cursor.x, cursor.y) < cell.sim.cursorRadius
      ) {
        // Get the cursor position relative to the cell centre
        const relX = Math.abs(cursor.x - cell.x);
        const relY = Math.abs(cursor.y - cell.y);

        // How much would the cell need to shift left or right for the cursor to be outside the cursor radius
        let shiftX = Math.ceil(Math.sqrt(cell.sim.cursorRadius ** 2 - relY ** 2) - relX);
        shiftX = cursor.x >= cell.x ? -shiftX : shiftX; // If the cursor is to the right, shift the cell left

        let desiredX = cell.x + shiftX;
        desiredX = clamp(
          desiredX,
          cell.sim.baseLocation.x - MAX_SHIFT,
          cell.sim.baseLocation.x + MAX_SHIFT,
        );

        if (cell.sim.baseLocation.x >= dome.x) {
          // The cell is on the right of the dome
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
        if (cursor.x < desiredLocation.x && desiredLocation.x < cell.sim.baseLocation.x) {
          desiredLocation = cell.sim.baseLocation;
        } else if (cursor.x > desiredLocation.x && desiredLocation.x > cell.sim.baseLocation.x) {
          desiredLocation = cell.sim.baseLocation;
        }
      }

      // Move the cell a step towards its desired location
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
}
