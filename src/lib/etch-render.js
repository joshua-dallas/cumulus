import { intersection, subtractRange } from "./utils";

export class EtchRenderer {
  constructor(canvas, lineWidth = 2, lineSpacing = 2) {
    this.canvas = canvas;
    this.lineWidth = lineWidth;
    this.lineSpacing = lineSpacing;
    this.background = "white";

    // Get the canvas context
    this.context = canvas.getContext("2d");
    if (!this.context) throw new Error("Failed to get 2D context from canvas");

    // Initialise variables for storing the layers and rendered lines
    this.layers = [];
    this.generateLines();
  }

  generateLines() {
    // This function generates the objects that are used to store information about each line that is drawn
    const lineHeight = this.lineWidth + this.lineSpacing;
    const numLines = Math.floor(this.canvas.height / lineHeight) - 2; // leave a line's space at the top and bottom
    this.lines = [];
    for (let i = 0; i < numLines; i++) {
      this.lines.push({
        id: i,
        y: lineHeight * (i + 1) + this.lineSpacing,
        startX: 0, // TODO: set by the background padding and mask
        endX: this.canvas.width, // TODO: set by the background padding and mask
        segments: [], // Information on what to draw is stored here
        // lengthNoiseTable: [], // What segments have length noise applied, and how much
      });
    }
  }

  setBackground(background) {
    // TODO: Currently, this must be called first. Should layers be treated differently in the segments?
    // TODO: Should this be handled in a set/get pattern
    // TODO: How to trigger re-render?
    this.background = background;
    // The background affects all lines
    // For each line, we will add a segment for the background colour
    // TODO: Use typescript so that we can define custom types for lines, layers, and segments
    for (const line of this.lines) {
      this.addSegment(line.id, line.startX, line.endX, undefined, true);
    }
  }

  addCircleLayer(config) {
    // TODO: Use Typescript and apply validation here
    console.log(config);
    // Save the layer config
    const layerId = this.layers.length;
    this.layers.push({ ...config, id: layerId, type: "circle" });

    // Get affected lines
    const startY = config.y - config.radius;
    const endY = config.y + config.radius;
    const affectedLines = this.getAffectedLines(startY, endY);

    // Add a segment to each of these lines
    for (const line of affectedLines) {
      // calculate the segment to add
      // Use the equation of the x axis intercepts of a circle
      const sqrtTerm = Math.round(
        Math.sqrt(config.radius ** 2 - (line.y - config.y) ** 2),
      );
      const startX = config.x - sqrtTerm;
      const endX = config.x + sqrtTerm;

      // Don't add a zero length segment
      if (startX == endX) continue;

      this.addSegment(line.id, startX, endX, layerId, false);
    }
  }

  addRightAnglePolygonLayer(config) {
    // Only handles polygons with vertical and horizontal lines
    // For any given y, the polygon can only have 2 edges
    // TODO: Use Typescript and apply validation here
    console.log(config);
    // Save the layer config
    const layerId = this.layers.length;
    this.layers.push({ ...config, id: layerId, type: "right-angle-polygon" });

    // Get affected lines
    const startY = Math.min(...config.vertices.map((v) => v.y));
    const endY = Math.max(...config.vertices.map((v) => v.y));
    const affectedLines = this.getAffectedLines(startY, endY);
    console.log(
      `min: ${startY}, max: ${endY}, number of affected lines: ${affectedLines.length}`,
    );

    // Find all the verticle lines of this polygon
    const verticalLines = this.getVerticalLinesOfPolygon(config.vertices);
    console.log(verticalLines);

    // Add a segment to each of these lines
    for (const line of affectedLines) {
      // Does this line intersect any of the verticle lines
      const verticalCrossings = verticalLines.filter(
        (vert) => vert.y1 <= line.y && line.y < vert.y2,
      );
      console.log(line.y);
      console.log(verticalCrossings);
      if (verticalCrossings.length != 2) {
        throw new Error("There must be 2 vertical crossings for this polygon");
      }
      // calculate the segment to add
      const range = verticalCrossings.map((vert) => vert.x).sort();
      console.log(range);
      const startX = range[0];
      const endX = range[1];

      // Don't add a zero length segment
      if (startX == endX) continue;

      this.addSegment(line.id, startX, endX, layerId, false);
    }
  }

  draw() {
    console.log("Drawing to canvas");
    // For testing, we are only going to draw one line at y=200
    for (const line of this.lines) {
      this.drawLine(line);
    }
  }

  drawLine(line) {
    // For each final segment, draw a line to the canvas
    for (const segment of line.segments) {
      let colour;
      if (segment.isBackground) {
        colour = this.background;
      } else {
        colour = this.layers[segment.layerId].fill;
      }

      this.context.beginPath();
      this.context.moveTo(segment.startX, line.y);
      this.context.lineTo(segment.endX, line.y);
      this.context.lineWidth = this.lineWidth;
      this.context.strokeStyle = colour;
      // TODO: All the other styling
      this.context.stroke();
    }
  }

  getAffectedLines(startY, endY) {
    return this.lines.filter((line) => line.y >= startY && line.y <= endY);
  }

  addSegment(lineId, startX, endX, layerId, isBackground) {
    // TODO: Add parametres for the noise, etc.
    let segments = this.lines[lineId].segments;

    // If there are no segments already for this line, add this one
    if (!segments.length) {
      segments.push({ startX, endX, layerId, isBackground });
      return;
    }

    // Write this segment over any overlapping segments underneath it
    // Therefore, segments are mutually exlusive, and sorted
    let segmentsToRemove = [];
    let segmentsToAdd = [];

    for (let i = 0; i < segments.length; i++) {
      const existingSegment = segments[i];
      // Check if there is any overlap
      if (
        intersection(
          [existingSegment.startX, existingSegment.endX],
          [startX, endX],
        )
      ) {
        // subtract the new segment from the existing segment
        const newRanges = subtractRange(
          [existingSegment.startX, existingSegment.endX],
          [startX, endX],
        );

        if (newRanges.length == 0) {
          // The new segment completely overlaps the existing segment
          segmentsToRemove.push(i);
        } else if (newRanges.length == 1) {
          // The new segment overlaps one end of the existing segment
          existingSegment.startX = newRanges[0][0];
          existingSegment.endX = newRanges[0][1];
        } else if (newRanges.length == 2) {
          // The new segment splits the existing segment in two
          // Update the range of the existing segment
          existingSegment.startX = newRanges[0][0];
          existingSegment.endX = newRanges[0][1];
          // Create a new segment for the other section of the existing segment
          segmentsToAdd.push({
            ...existingSegment,
            startX: newRanges[1][0],
            endX: newRanges[1][1],
          });
          // TODO: Flag in these segments that they have been split
        }
      }
      // TODO: Early exit once we are out of the specified range
      // I.e. if the endX of the existing segment is greater than the endX of the new segment, stop
    }

    // Now remove any segments to delete
    for (const i of segmentsToRemove) {
      segments.splice(i, 1);
    }

    // Now add the new segments into list
    segmentsToAdd.push({ startX, endX, layerId, isBackground });
    for (const newSegment of segmentsToAdd) {
      segments.push(newSegment);
    }
    // Sort by location along the line
    // TODO: There will be a more efficient way to do this
    segments.sort((a, b) => a.startX - b.startX);
  }

  getVerticalLinesOfPolygon(vertices) {
    let verticalLines = [];

    // Make a copy and duplicate the first point at the end to allow for
    // The last line to be formed
    let verticesCopy = [...vertices];
    verticesCopy.push(vertices[0]);

    for (let i = 1; i < verticesCopy.length; i++) {
      if (
        verticesCopy[i - 1].x == verticesCopy[i].x &&
        verticesCopy[i - 1].y != verticesCopy[i].y
      ) {
        verticalLines.push({
          x: verticesCopy[i].x,
          y1: Math.min(verticesCopy[i - 1].y, verticesCopy[i].y),
          y2: Math.max(verticesCopy[i - 1].y, verticesCopy[i].y),
        });
      }
    }

    return verticalLines;
  }

  //----------------------------------------------------//

  renderCell(cell, showNumbers = false) {
    this.context.beginPath();
    this.context.arc(cell.x, cell.y, cell.radius, 0, 2 * Math.PI);
    this.context.fillStyle = "lightblue";
    this.context.fill();
    this.context.beginPath();
    this.context.arc(cell.x, cell.y, cell.radius, 1.5 * Math.PI, 0.5 * Math.PI);
    this.context.strokeStyle = "blue";
    this.context.lineWidth = 1;
    this.context.stroke();

    if (showNumbers) {
      this.context.save();
      this.context.fillStyle = "blue";
      this.context.font = `${Math.max(10, cell.radius * 0.5)}px sans-serif`;
      this.context.textAlign = "center";
      this.context.textBaseline = "middle";
      this.context.fillText(String(cell.id), cell.x, cell.y);
      this.context.restore();
    }
  }

  renderCells(cells) {
    for (const cell of cells) {
      this.renderCell(cell);
    }
  }

  renderPolygon(polygon) {
    if (!polygon || polygon.length === 0) return;

    this.context.beginPath();
    this.context.moveTo(polygon[0].x, polygon[0].y);
    for (let i = 1; i < polygon.length; i++) {
      this.context.lineTo(polygon[i].x, polygon[i].y);
    }
    this.context.closePath();
    this.context.fillStyle = "rgba(190, 216, 230, 0.4)"; // Light blue with transparency
    this.context.fill();
    //this.context.strokeStyle = "blue";
    //this.context.lineWidth = 1;
    //this.context.stroke();
  }
}
