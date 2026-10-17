import {
  mulberry32,
  intersectionOfMany,
  subtractRanges,
  getHorizontalLinesOfPolygon,
  distanceBetweenPoints,
  clamp,
} from "./utils.js";

export class CloudBuilder {
  static MAX_CELLS = 100;
  static MIN_PADDING_RATIO = 0.2; // The minimum padding to ensure cells don't touch the edges of the canvas
  static MIN_CELL_RADIUS = 0.1; // Minimum cell radius as a fraction of the dome radius
  static MAX_CELL_RADIUS = 0.3; // Maximum cell radius as a fraction of the dome radius
  // TODO: Add additional padding to allow for cells to grow and rise
  // TODO: Minimum base width for matched bottom cell?
  // TODO: Find weighted centre of cells and position in the centre
  // TODO: Flag what lines have changed between animation frames

  constructor(width = 500, height = 500, numCells = 10, seed = 42) {
    this.random = mulberry32(seed);
    this.width = width;
    this.height = height;

    // Calculate the dome radius based on the smaller dimension of the canvas
    let radius;
    if (width > height) {
      radius =
        (height * (1 - CloudBuilder.MIN_PADDING_RATIO)) /
        (1 + 2 * CloudBuilder.MAX_CELL_RADIUS); // Adjust for vertical padding and maximum cell radius
    } else {
      radius =
        (width * (1 - CloudBuilder.MIN_PADDING_RATIO)) /
        (2 + 2 * CloudBuilder.MAX_CELL_RADIUS); // Adjust for horizontal padding and maximum cell radius
    }
    radius = Math.round(radius); // Round to the nearest integer

    // Calculate the dome center based on the dome radius and canvas dimensions
    let x = this.width / 2;
    let y = (this.height - radius) / 2 + radius; // Centre the dome vertically in the canvas

    this.dome = { x, y, radius };

    this.cells = [];
    this.cloudInnerLeft = [];
    this.cloudInnerRight = [];
    this.fillCircles = [];
    this.horizontalFillCircles = [];
    this.lightFractalCircles = [];
    this.darkFractalCircles = [];

    this.generateCells(Math.min(numCells, CloudBuilder.MAX_CELLS));
    this.matchBottomCell();
    this.centreCells();
    this.addSteppedChildCells();
    this.addExtensionLines();
    this.fillInnerGaps();
    this.createCloudInner();
    this.fillCentreLineGaps();
    this.addFractalsToCells();
    this.addFillCirclesToHorzontals();
    this.sortBySize();
  }

  simulateNextFrame(mouseX, mouseY) {
    this.changed = false;
    // Apply any mouse effects to cells
    this.moveCellsWithMouse(mouseX, mouseY);
    //this.fractalSim();
    //this.moveCloudCells();
    //this.growCloudCells()
    //this.fractalEffects()

    // Recalculate as needed
    this.createCloudInner();
    this.fillCentreLineGaps();

    return this.changed;
  }

  moveCellsWithMouse(cursorX, cursorY) {
    // TODO: Implement motion with force/velocity for a better easing function
    // TODO: Spread fractals when moving a cell?
    const borderPadding = 20; // TODO: Move to top
    const maxStep = 5;
    const maxShift = 30;
    const minStep = 0.1;
    // We will shift cells left and right only to avoid the cursor
    // Determine the desired location of the cell
    for (const cell of this.cells) {
      let desiredLocation = {
        x: cell.sim.baseLocation.x,
        y: cell.sim.baseLocation.y,
      };

      if (
        distanceBetweenPoints(cell.x, cell.y, cursorX, cursorY) <
        cell.sim.cursorRadius
      ) {
        // Get the cursor position relative to the cell centre
        const relX = Math.abs(cursorX - cell.x);
        const relY = Math.abs(cursorY - cell.y);

        // How much would the cell need to shift left or right for the cursor to be outside the cursor radius
        let shiftX = Math.ceil(
          Math.sqrt(cell.sim.cursorRadius ** 2 - relY ** 2) - relX,
        );
        shiftX = cursorX >= cell.x ? -shiftX : shiftX; // If the cursor is to the right, shift the cell left

        let desiredX = cell.x + shiftX;
        desiredX = clamp(
          desiredX,
          cell.sim.baseLocation.x - maxShift,
          cell.sim.baseLocation.x + maxShift,
        );

        if (cell.sim.baseLocation.x >= this.dome.x) {
          // The cell is on the right of the dome
          // TODO: Allow a slight crossing of the centre line that would not affect the visible fill
          // TODO: Move linked stepped children cells?
          desiredLocation = {
            x: clamp(
              desiredX,
              this.dome.x,
              this.width - borderPadding - cell.radius,
            ),
            y: cell.y,
          };
        } else {
          // The cell is on the left of the dome
          desiredLocation = {
            x: clamp(desiredX, borderPadding + cell.radius, this.dome.x),
            y: cell.y,
          };
        }

        // Allow the cells to return to their base location
        if (
          cursorX < desiredLocation.x &&
          desiredLocation.x < cell.sim.baseLocation.x
        ) {
          desiredLocation = cell.sim.baseLocation;
        } else if (
          cursorX > desiredLocation.x &&
          desiredLocation.x > cell.sim.baseLocation.x
        ) {
          desiredLocation = cell.sim.baseLocation;
        }
      }

      // Move the cell a step towards its desired location
      // TODO: Round all values to 10th of a pixel
      const desiredXChange = desiredLocation.x - cell.x;
      if (Math.abs(desiredXChange) < minStep) {
        cell.x = desiredLocation.x;
      } else {
        let xStep = clamp(desiredXChange * cell.sim.speed, -maxStep, maxStep);
        if (Math.abs(xStep) < minStep) {
          xStep = xStep > 0 ? minStep : -minStep;
        }
        cell.x += xStep;
      }

      // Flag if there there will be changes to draw
      if (Math.abs(desiredXChange)) {
        this.changed = true;
      }
    }
  }

  fractalSim() {
    // TODO: Simulator in a separate file
    // TODO: This didn't work very well, improve or remove
    // TODO: Is rounding best here?
    for (const fractal of this.lightFractalCircles) {
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
        2,
      );

      fractal.y = Math.round(
        fractal.sim.rotCentreY -
          Math.sin((step * 2 * Math.PI) / fractal.sim.cycleLength) *
            fractal.sim.rotRadiusY,
        2,
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

      fractal.radius = Math.round(fractal.radius, 2);
    }
  }

  moveCloudCells() {
    for (const cell of this.cells) {
      const r = this.random();
      const step = 3;

      if (r < 0.3) {
        // Move up
        cell.y -= step;
        this.lightFractalCircles
          .filter((c) => c.linkedCell == cell.id)
          .forEach((fractal) => (fractal.y -= step));
        this.darkFractalCircles
          .filter((c) => c.linkedCell == cell.id)
          .forEach((fractal) => (fractal.y -= step));
      } else if (r < 0.6) {
        // Move down
        cell.y += step;
        this.lightFractalCircles
          .filter((c) => c.linkedCell == cell.id)
          .forEach((fractal) => (fractal.y += step));
        this.darkFractalCircles
          .filter((c) => c.linkedCell == cell.id)
          .forEach((fractal) => (fractal.y += step));
      }
      // Otherwise, stay still
    }
  }

  generateCells(numCells) {
    this.cells = [];

    for (let i = 0; i < numCells; i++) {
      const angle = this.random() * Math.PI;
      const dist = this.random() * this.dome.radius;
      const radius = this.randomCellRadius();

      const x = Math.round(this.dome.x + dist * Math.cos(angle));
      const y = Math.round(this.dome.y - dist * Math.sin(angle));

      const cell = { x, y, radius, id: i };
      const sim = this.generateCellSimParams(cell);

      this.cells.push({ ...cell, sim });
    }
  }

  generateCellSimParams(cell) {
    return {
      speed: 0.01,
      baseLocation: { x: cell.x, y: cell.y },
      cursorRadius: cell.radius * 3,
    };
  }

  matchBottomCell() {
    // Find the lowest edge of cells and the corresponding cell
    let cellBottoms = this.cells.map((cell) => cell.y + cell.radius);
    let lowestCellIndex = cellBottoms.indexOf(Math.max(...cellBottoms));
    let lowestCell = this.cells[lowestCellIndex];

    // Create a new cell that matches the lowest cell's bottom edge
    let radius = this.randomCellRadius();
    let horizontalOffset = this.random() * this.dome.radius;
    let y = cellBottoms[lowestCellIndex] - radius;

    if (lowestCell.x > this.dome.x) {
      // If the lowest cell is to the right of the dome center, place the new cell to the left
      const cell = {
        x: Math.round(this.dome.x - horizontalOffset),
        y,
        radius: radius,
        id: this.cells.length,
      };
      const sim = this.generateCellSimParams(cell);
      this.cells.push({ ...cell, sim });
    } else {
      // If the lowest cell is to the left of the dome center, place the new cell to the right
      const cell = {
        x: Math.round(this.dome.x + horizontalOffset),
        y,
        radius: radius,
        id: this.cells.length,
      };
      const sim = this.generateCellSimParams(cell);
      this.cells.push({ ...cell, sim });
    }
  }

  addExtensionLines() {
    for (const cell of this.cells) {
      cell.upperExtension = 0; // TODO: Use a random number
      cell.lowerExtension = cell.radius; // TODO: Use a random number
    }
  }

  fillInnerGaps() {
    this.fillInnerGapsAux("left");
    this.fillInnerGapsAux("right");
  }

  fillInnerGapsAux(side) {
    let cells;
    if (side == "left") {
      cells = this.cells.filter((cell) => cell.x < this.dome.x);
    } else if (side == "right") {
      cells = this.cells.filter((cell) => cell.x >= this.dome.x);
    } else {
      throw new Error("Invalid side specified. Must be 'left' or 'right'.");
    }

    // Sort the cells based on their y-coordinates (top to bottom)
    cells.sort((a, b) => a.y - b.y);

    for (let i = 0; i < cells.length; i++) {
      let currentCell = cells[i];

      // Find all the cells to the outer, upper quadrant of the current cell
      // These are the cells that could create a gap between the current cell
      // and the extension rectangles.
      let upperOuterCells = cells
        .slice(0, i)
        .filter(
          (cell) =>
            (side == "left" && cell.x < currentCell.x) ||
            (side == "right" && cell.x > currentCell.x),
        );

      let lowerExtensions = upperOuterCells.map(
        (cell) => cell.y + cell.lowerExtension,
      );

      // Find all instances where the lower extension could create a gap
      let gapsFound = lowerExtensions.filter(
        (lowerExtension) =>
          lowerExtension > currentCell.y - currentCell.radius &&
          lowerExtension < currentCell.y - currentCell.upperExtension,
      );
      if (gapsFound.length > 0) {
        let largestGap = Math.min(...gapsFound);
        currentCell.upperExtension = currentCell.y - largestGap + 1;
        /*console.log(
          `Found a gap for cell ${currentCell.id} on the ${side}. Setting upper extension to ${currentCell.upperExtension}`,
        );*/
      }
    }
  }

  createCloudInner() {
    this.cloudInnerLeft = this.createCloudInnerAux("left");
    this.cloudInnerRight = this.createCloudInnerAux("right");
  }

  createCloudInnerAux(side) {
    // All the extension lines are extended to the centre line of the dome
    // And a verticle line is drawn from the top extension point of a cell to the bottom extension point
    // This forms a polygon that can be filled to create the inner cloud shape
    // We remove unnecessary points that are inside the polygon

    // First, we sort the cells based on whether they are to the left or right of the dome center
    let cells;
    if (side === "right") {
      cells = this.cells.filter((cell) => cell.x >= this.dome.x);
    } else if (side === "left") {
      cells = this.cells.filter((cell) => cell.x < this.dome.x);
    } else {
      throw new Error("Invalid side specified. Must be 'left' or 'right'.");
    }

    // First we deal with the right cells
    // We create a list of points that represent the upper and lower extension lines of the cells
    const vertices = [];
    for (let i = 0; i < cells.length; i++) {
      let cell = cells[i];
      vertices.push({
        x: cell.x,
        y: cell.y - cell.upperExtension,
        type: "upper",
        id: cell.id,
      });
      vertices.push({
        x: cell.x,
        y: cell.y + cell.lowerExtension,
        type: "lower",
        id: cell.id,
      });
    }

    // Sort the vertices based on their y-coordinates
    vertices.sort((a, b) => a.y - b.y, "asc");

    // Add vertices that are not contained within the polygon
    // I.e. we are tracing the outer edge of all of the overlapping rectangles formed by the extension lines of the cells
    let polygon = [];
    if (vertices[0].x != this.dome.x) {
      polygon.push({ x: this.dome.x, y: vertices[0].y }); // The line to the first vertex
    }
    polygon.push(vertices[0]);

    let prevVertex = vertices[0];
    vertices.shift(); // Remove the first vertex from the list

    for (const vertex of vertices) {
      if (prevVertex.type === "upper" && vertex.type === "upper") {
        if (
          (side === "right" && vertex.x > prevVertex.x) ||
          (side === "left" && vertex.x < prevVertex.x)
        ) {
          // This vertex is further out and should be added
          // First check whether the heights match
          if (vertex.y == prevVertex.y) {
            // In this case, we remove the previous vertex first
            polygon.pop();
          } else {
            // Otherwise, we add a verticle line from the previous vertex
            polygon.push({ x: prevVertex.x, y: vertex.y });
          }
          polygon.push(vertex);
          prevVertex = vertex;
        } else {
          // This vertex is further in and should not be added
          // Check if the rectangle connected to this vertex exceeds the rectangle from the previous vertex
          // Start by finding the matching lower vertices
          let vertexLower = vertices.filter(
            (v) => v.type == "lower" && v.id == vertex.id,
          )[0];
          let prevVertexLower = vertices.filter(
            (v) => v.type == "lower" && v.id == prevVertex.id,
          )[0];

          if (vertexLower.y > prevVertexLower.y) {
            // We will create a new vertex at the same height as prevVertexLower
            vertices.splice(vertices.indexOf(prevVertexLower) + 1, 0, {
              ...vertex,
              y: prevVertexLower.y,
            });
          }
        }
      } else if (prevVertex.type === "upper" && vertex.type === "lower") {
        if (vertex.x == prevVertex.x) {
          // This vertex is directly below the previous vertex and should be added
          polygon.push(vertex);
          prevVertex = vertex;
        }
      } else if (prevVertex.type === "lower" && vertex.type === "upper") {
        // Check that the heights are different
        if (vertex.y != prevVertex.y) {
          // This indicates a vertical gap, so we draw a line along the dome centre
          if (prevVertex.x != this.dome.x) {
            polygon.push({ x: this.dome.x, y: prevVertex.y });
          }
          polygon.push({ x: this.dome.x, y: vertex.y });
        }
        polygon.push(vertex);
        prevVertex = vertex;
      } else if (prevVertex.type === "lower" && vertex.type === "lower") {
        if (
          (side === "right" && vertex.x < prevVertex.x) ||
          (side === "left" && vertex.x > prevVertex.x)
        ) {
          // This vertex is further in and should be added
          polygon.push({ x: vertex.x, y: prevVertex.y }); // Add a horiyontal line from the previous vertex
          polygon.push(vertex);
          prevVertex = vertex;
        }
      }
    }

    // Add a horizontal line to the dome centre from the last vertex
    polygon.push({ x: this.dome.x, y: prevVertex.y });

    // Add a vertical line to close the polygon
    polygon.push(polygon[0]);

    return polygon;
  }

  fillCentreLineGaps() {
    // TODO: This section needs better naming
    // We will look for locations along the centreline that are only filled from one side
    // At these locations, we will draw a horizonal half dome

    // Find the gaps in the RHS
    // Look for consecutive points in the right polygon that are along the centreline

    let rhsGaps = this.findGapsOfCloudInnerAlongCentre("right");
    let lhsGaps = this.findGapsOfCloudInnerAlongCentre("left");

    // Add gaps at the top and bottom if needed
    let rhsTop = Math.min(...this.cloudInnerRight.map((v) => v.y));
    let rhsBottom = Math.max(...this.cloudInnerRight.map((v) => v.y));
    let lhsTop = Math.min(...this.cloudInnerLeft.map((v) => v.y));
    let lhsBottom = Math.max(...this.cloudInnerLeft.map((v) => v.y));

    if (rhsTop > lhsTop) {
      // The RHS starts lower than the LHS
      // Add a gap to the rhs
      rhsGaps.push([lhsTop, rhsTop]);
    } else if (lhsTop > rhsTop) {
      // Add a gap to the lhs
      lhsGaps.push([rhsTop, lhsTop]);
    }

    if (rhsBottom < lhsBottom) {
      // The RHS ends higher than the LHS
      // Add a gap to the rhs
      rhsGaps.push([rhsBottom, lhsBottom]);
    } else if (lhsBottom < rhsBottom) {
      // Add a gap to the lhs
      lhsGaps.push([lhsBottom, rhsBottom]);
    }

    // Find the union of the gaps, these locations do not need halfdomes
    let gapUnions = intersectionOfMany(lhsGaps, rhsGaps);
    // TODO: If we want to remove horizontal breaks, here is where to find them, possibly

    // RHS half domes = rhs gap - unions
    let rhsFills = [];
    for (const gap of rhsGaps) {
      rhsFills = rhsFills.concat(subtractRanges(gap, gapUnions));
    }

    // LHS half domes = rlhs gap - unions
    let lhsFills = [];
    for (const gap of lhsGaps) {
      lhsFills = lhsFills.concat(subtractRanges(gap, gapUnions));
    }

    this.fillCircles = [];
    let allFills = rhsFills.concat(lhsFills);
    for (const fill of allFills) {
      const centreY = Math.round((fill[0] + fill[1]) / 2);
      const radius = Math.round((fill[1] - fill[0]) / 2);
      this.fillCircles.push({
        x: this.dome.x,
        y: centreY,
        radius,
      });
    }
  }

  addSteppedChildCells() {
    const probOfSteppedChild = 0.5; // TODO: Move to top
    const childXOffsetRadio = 0.9; // Spacing between parent and child centres, ratio of parent radius
    const childRadiusRatio = 0.5; // TODO: Randomise?
    const numberOfChildren = 2;
    // Using a random number, decide whether each cell will have stepped children
    const originalCellCount = this.cells.length;
    for (let i = 0; i < originalCellCount; i++) {
      const cell = this.cells[i];
      if (this.random() < probOfSteppedChild) {
        // For each cell with stepped children, determine which side it is on
        const side = cell.x >= this.dome.x ? 1 : -1;

        // Add stepped children with matching baselines
        for (let i = 0; i < numberOfChildren; i++) {
          const xOffset =
            side * // Move left or right
            cell.radius *
            //childRadiusRatio ** i * // For each stepped child, move based on the radius of the past child
            childXOffsetRadio *
            (i + 1);

          const radius = Math.round(cell.radius * childRadiusRatio ** (i + 1));
          const x = Math.round(cell.x + xOffset);
          const y = cell.y + cell.radius - radius; // Align the baselines

          const childCell = {
            x,
            y,
            radius,
            id: this.cells.length,
          };
          const sim = this.generateCellSimParams(childCell);
          this.cells.push({ ...childCell, sim });
        }
      }
    }
  }

  centreCells() {
    let centreSum = 0;
    let totalWeights = 0;
    for (const cell of this.cells) {
      centreSum += cell.x * cell.radius ** 2;
      totalWeights += cell.radius ** 2;
    }
    const weightedCentre = Math.round(centreSum / totalWeights);
    console.log("weighted centre", weightedCentre);

    const xOffset = this.dome.x - weightedCentre;

    for (const cell of this.cells) {
      cell.x += xOffset;
    }
  }

  sortBySize() {
    // Sort the cells by size such that the smallest cells are last
    // Therefore, smaller cells will be drawn on top of larger cells
    this.cells.sort((a, b) => b.radius - a.radius);
  }

  addFractalsToCells() {
    this.lightFractalCircles = [];
    this.darkFractalCircles = [];
    for (const cell of this.cells) {
      this.lightFractalCircles = this.lightFractalCircles.concat(
        this.generateLightFractalsForCell(cell),
      );
      this.darkFractalCircles = this.darkFractalCircles.concat(
        this.generateDarkFractalsForCell(cell),
      );
    }
  }

  generateLightFractalsForCell(cell) {
    // TODO: Better naming
    // TODO: Move constants elsewhere
    const numberOfFractals = 20; // TODO: Should this be dependant on cell radius?

    // Generate fractal circles
    let lightFractalCircles = [];
    for (let i = 0; i < numberOfFractals; i++) {
      lightFractalCircles.push(this.generateLightFractalCircle(cell));
    }

    // Sort them largest to smallest
    // TODO: Is it better without this?
    lightFractalCircles.sort((a, b) => b.radius - a.radius);

    return lightFractalCircles;
  }

  generateDarkFractalsForCell(cell) {
    // TODO: Better naming
    // TODO: Move constants elsewhere
    const numberOfFractals = 15; // TODO: Should this be dependant on cell radius?
    const probOfDarkFractals = 0.6; // Not every cell will have dark fractals

    if (this.random() > probOfDarkFractals) return [];

    // Generate fractal circles
    let darkFractalCircles = [];
    for (let i = 0; i < numberOfFractals; i++) {
      darkFractalCircles.push(this.generateDarkFractalCircle(cell));
    }

    // Sort them largest to smallest
    // TODO: Is it better without this?
    darkFractalCircles.sort((a, b) => b.radius - a.radius);

    return darkFractalCircles;
  }

  generateLightFractalCircle(cell) {
    // TODO: Impose minimum distance and limit maxRadius
    const minRadiusRatio = 0.2; // Ratio of fractal radius to cell radius
    const maxRadiusRatio = 0.45;
    const minRightPadding = 4;
    const maxRightPadding = 6;
    const shadowAngle = -Math.PI / 4; // TODO: Use a random number for this

    const angle = ((this.random() * 3) / 2) * Math.PI - Math.PI / 2; // TODO: Tailor these angles
    const dist = this.random() * cell.radius;

    // x and y are relative to the cell position
    const x = Math.round(dist * Math.cos(angle));
    const y = Math.round(-dist * Math.sin(angle));

    const radius = Math.round(
      cell.radius *
        (this.random() * (maxRadiusRatio - minRadiusRatio) + minRadiusRatio),
    );

    // If the fractal circle is below a certain angle,
    // it is at the bottom of the cell and should be less bright
    let rightPadding = 0;
    if (angle > shadowAngle) {
      // TODO: Confirm this is working as intended with the direction of y
      rightPadding = Math.round(
        this.random() * (maxRightPadding - minRightPadding) + minRightPadding,
      );
    }

    let fractal = {
      linkedCell: cell.id,
      x,
      y,
      radius,
      rightPadding,
    };

    const sim = this.generateFractalSimParams(fractal, cell);
    fractal = { ...fractal, sim };

    return fractal;
  }

  generateDarkFractalCircle(cell) {
    const minRadiusRatio = 0.2; // Ratio of fractal radius to cell radius
    const maxRadiusRatio = 0.3;
    const minDist = 0.5; // Fraction of cell radius

    const angle = ((this.random() * 2) / 3) * Math.PI + Math.PI * (2 / 3); // TODO: Tailor these angles
    const dist = (this.random() * (1 - minDist) + minDist) * cell.radius;

    // x and y are relative to the cell position
    const x = Math.round(dist * Math.cos(angle));
    const y = Math.round(-dist * Math.sin(angle));

    const radius = Math.round(
      cell.radius *
        (this.random() * (maxRadiusRatio - minRadiusRatio) + minRadiusRatio),
    );

    return {
      linkedCell: cell.id,
      x,
      y,
      radius,
    };
  }

  generateFractalSimParams(fractal, cell) {
    // We model fractals as moving in an ellipse, relative to their linked cell
    // There is a location where they grow to their maximum size and then
    // fall and shrink to nothing. When they reach their horizontal mid-point
    // they begin to grow again. This models their growing and falling behaviour
    const fps = 60; // TODO: use timestamp, move these values to the top
    const minCycleLength = 15 * fps;
    const maxCycleLength = 30 * fps;
    const maxRadiusMultiple = 3;
    const minRotRadiusX = 0; // Ratio of cell radius
    const maxRotRadiusX = 0.5;
    const minRotRadiusY = 0.2; // Ratio of cell radius
    const maxRotRadiusY = 0.5;

    // Chose a cycle length
    const cycleLength = Math.round(
      this.random() * (maxCycleLength - minCycleLength) + minCycleLength,
    );

    // Chose a max radius
    const maxRadius = Math.round(
      (this.random() * (maxRadiusMultiple - 1) + 1) * fractal.radius,
    );

    // Chose a maximum size location
    const maxRadiusStep = Math.round(
      Math.round((this.random() * cycleLength) / 4 + cycleLength / 4),
    );

    // Which side is the fractal on
    const rightSide = fractal.x > cell.x;
    const clockwise = rightSide;

    // Decide whether the fractal is currently rising or falling
    // TODO: Should this be partially random?
    const horDistFromCellCentre = Math.abs(fractal.x - cell.x);
    const isFalling = horDistFromCellCentre > cell.radius / 2;

    // Determine the current fractal cycle step
    let currentStep;
    if (isFalling) {
      currentStep = Math.round(
        ((3 * cycleLength) / 4 - maxRadiusStep) * // The fractal shrinks to zero size at the bottom of the cycle
          (1 - fractal.radius / maxRadius) +
          maxRadiusStep,
      );
    } else {
      currentStep = Math.round(maxRadiusStep * (fractal.radius / maxRadius));
    }

    // Choose a rotation radius
    const rotRadiusX = Math.round(
      (this.random() * (maxRotRadiusX - minRotRadiusX) + minRotRadiusX) *
        cell.radius,
    );

    let rotRadiusY = Math.round(
      (this.random() * (maxRotRadiusY - minRotRadiusY) + minRotRadiusY) *
        cell.radius,
    );

    rotRadiusY = Math.max(rotRadiusX, rotRadiusY); // The y rotation radius must be larger than the x radius

    // Calculate the centre of rotation
    const mult = clockwise ? 1 : -1;
    const rotCentreX = Math.round(
      fractal.x +
        mult * Math.cos((currentStep * 2 * Math.PI) / cycleLength) * rotRadiusX,
    );

    const rotCentreY = Math.round(
      fractal.y +
        Math.sin((currentStep * 2 * Math.PI) / cycleLength) * rotRadiusY,
    );

    return {
      cycleLength,
      maxRadius,
      maxRadiusStep,
      currentStep,
      clockwise,
      rotRadiusX,
      rotRadiusY,
      rotCentreX,
      rotCentreY,
    };
  }

  addFillCirclesToHorzontals() {
    this.addFillCirclesToHorzontalsAux("left");
    this.addFillCirclesToHorzontalsAux("right");
  }

  addFillCirclesToHorzontalsAux(side) {
    const maxStraightFillLength = 0.3; // Ratio of dome radius. TODO: Move to top, better name, might be too large
    const numberOfCircles = 12; // TODO: Make random based on length

    let polygon;
    if (side == "left") {
      polygon = this.cloudInnerLeft;
    } else if (side == "right") {
      polygon = this.cloudInnerRight;
    } else {
      throw new Error("Invalid side specified. Must be 'left' or 'right'.");
    }

    // Locate all upper horizontal fill lines
    const horizontalLines = getHorizontalLinesOfPolygon(
      polygon,
      (v1, v2) =>
        (v1.type == "upper" || v2.type == "upper") &&
        v1.type != "lower" &&
        v2.type != "lower",
    );
    // Based on the length of the horizontal fill,
    // Choose a random number of circles to create.
    for (const line of horizontalLines) {
      if (line.x2 - line.x1 > this.dome.radius * maxStraightFillLength) {
        for (let i = 0; i < numberOfCircles; i++) {
          // Create the circles at random positions along the line with random radius
          // Link to the cell that formed the horizontal line
          const x = Math.round(this.random() * (line.x2 - line.x1) + line.x1);

          let linkedCellId;
          if (side == "left") {
            linkedCellId =
              line.vertices[0].x < line.vertices[1].x
                ? line.vertices[0].id
                : line.vertices[1].id;
          } else {
            linkedCellId =
              line.vertices[0].x > line.vertices[1].x
                ? line.vertices[0].id
                : line.vertices[1].id;
          }
          // TODO: Using id as index is dangerous due to sortBySize
          const linkedCell = this.cells[linkedCellId];

          const radius = Math.round(
            this.random() *
              (linkedCell.lowerExtension - linkedCell.upperExtension),
          );
          if (line.y > linkedCell.y) {
            console.log(
              "Horizontal fill circle is lower than it should be",
              line,
              linkedCell,
            );
          }
          // TODO: store separately to keep with sim

          this.horizontalFillCircles.push({
            x,
            y: line.y,
            radius,
            linkedCell: linkedCellId,
          });
        }
      }
    }
  }

  randomCellRadius() {
    return Math.round(
      this.dome.radius *
        (this.random() *
          (CloudBuilder.MAX_CELL_RADIUS - CloudBuilder.MIN_CELL_RADIUS) +
          CloudBuilder.MIN_CELL_RADIUS),
    );
  }

  findGapsOfCloudInnerAlongCentre(side) {
    let cloudInner;
    if (side === "right") {
      cloudInner = this.cloudInnerRight;
    } else if (side === "left") {
      cloudInner = this.cloudInnerLeft;
    } else {
      throw new Error("Invalid side specified. Must be 'left' or 'right'.");
    }

    let gaps = [];
    for (let i = 1; i < cloudInner.length - 1; i++) {
      if (
        cloudInner[i - 1].x == this.dome.x &&
        cloudInner[i].x == this.dome.x &&
        !(cloudInner[i - 1].type == "upper" && cloudInner[i].type == "lower")
      ) {
        gaps.push([cloudInner[i - 1].y, cloudInner[i].y]);
      }
    }

    return gaps;
  }
}
