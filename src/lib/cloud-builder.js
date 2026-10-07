import { mulberry32, intersectionOfMany, subtractRanges } from "./utils.js";

export class CloudBuilder {
  static MAX_CELLS = 100;
  static MIN_PADDING_RATIO = 0.1; // The minimum padding to ensure cells don't touch the edges of the canvas
  static MIN_CELL_RADIUS = 0.05; // Minimum cell radius as a fraction of the dome radius
  static MAX_CELL_RADIUS = 0.22; // Maximum cell radius as a fraction of the dome radius
  // TODO: Add additional padding to allow for cells to grow and rise
  // TODO: Minimum base width for matched bottom cell?

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

    this.generateCells(Math.min(numCells, CloudBuilder.MAX_CELLS));
    this.matchBottomCell();
    //this.sortBySize(); //TODO
    this.addExtensionLines();
    this.fillInnerGaps();
    this.createCloudInner();
    this.fillCentreLineGaps();
  }

  generateCells(numCells) {
    this.cells = [];

    for (let i = 0; i < numCells; i++) {
      const angle = this.random() * Math.PI;
      const dist = this.random() * this.dome.radius;
      const radius = this.randomCellRadius();

      const x = Math.round(this.dome.x + dist * Math.cos(angle));
      const y = Math.round(this.dome.y - dist * Math.sin(angle));

      this.cells.push({ x, y, radius, id: i });
    }
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
      this.cells.push({
        x: Math.round(this.dome.x - horizontalOffset),
        y,
        radius: radius,
        id: this.cells.length,
      });
    } else {
      // If the lowest cell is to the left of the dome center, place the new cell to the right
      this.cells.push({
        x: Math.round(this.dome.x + horizontalOffset),
        y,
        radius: radius,
        id: this.cells.length,
      });
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
          // Check if the rectangle connected to this vertex overlaps the rectangle from the previous vertex
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
              x: vertex.x,
              y: prevVertexLower.y,
              type: "upper",
              id: vertex.id,
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
