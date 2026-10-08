import { intersection, mulberry32, subtractRange } from "./utils";

// TODO: Watch attribute and trigger re-render
// TODO: Resize based on dpr
// TODO: Use typescript and custom types for layer, line and segment
// TODO: Should I use get/set patterns to trigger re-render?

export class EtchRenderer {
  constructor(canvas, lineWidth = 2, lineSpacing = 2) {
    this.canvas = canvas;

    // Global styling variables
    this.lineWidth = lineWidth;
    this.lineSpacing = lineSpacing;
    this.background = "white";
    this.waveAmplitude = 5; // TODO
    this.wavePeriod = 20;

    // Random number generation
    this.seed = 10; // TODO: Use a random or provided seed
    this.random = mulberry32(this.seed);

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
        endX: this.canvas.width,
        segments: [], // Information on what to draw is stored here
        // lengthNoiseTable: [], // What segments have length noise applied, and how much
      });
    }
  }

  setBackground(background) {
    // TODO: Currently, this must be called first. Should the background be separate to layers?
    this.background = background;
    // For each line, we will add a segment for the background colour
    for (const line of this.lines) {
      this.addSegment(line.id, line.startX, line.endX, undefined, true);
    }
  }

  addCircleLayer(config) {
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
    // Save the layer config
    const layerId = this.layers.length;
    this.layers.push({ ...config, id: layerId, type: "right-angle-polygon" });

    // Get affected lines
    const startY = Math.min(...config.vertices.map((v) => v.y));
    const endY = Math.max(...config.vertices.map((v) => v.y));
    const affectedLines = this.getAffectedLines(startY, endY);

    // Find all the verticle lines of this polygon
    const verticalLines = this.getVerticalLinesOfPolygon(config.vertices);

    // Add a segment to each of these lines
    for (const line of affectedLines) {
      // Does this line intersect any of the verticle lines
      const verticalCrossings = verticalLines.filter(
        (vert) => vert.y1 <= line.y && line.y < vert.y2,
      );

      if (verticalCrossings.length != 2) {
        throw new Error("There must be 2 vertical crossings for this polygon");
      }
      // calculate the segment to add
      let range = verticalCrossings.map((vert) => vert.x);
      range.sort((a, b) => a - b);
      const startX = range[0];
      const endX = range[1];

      // Don't add a zero length segment
      if (startX == endX) continue;

      this.addSegment(line.id, startX, endX, layerId, false);
    }
  }

  draw() {
    console.log("Drawing to canvas");
    console.log(this.layers);
    console.log(this.lines);
    // For testing, we are only going to draw one line at y=200
    for (const line of this.lines) {
      this.drawLine(line);
    }
  }

  drawLine(line) {
    // For each final segment, draw a line to the canvas
    for (let i = 0; i < line.segments.length; i++) {
      const segment = line.segments[i];

      let colour;
      if (segment.isBackground) {
        colour = this.background;
      } else {
        colour = this.layers[segment.layerId].fill;
      }

      // Check for right-padding in the left neighbour
      // This would be implemented by shifting the left point of this segment
      let startXOffset = 0;
      if (i > 0) {
        const leftNeighbour = line.segments[i - 1];
        const leftNeighbourLayer =
          this.layers[leftNeighbour.layerId] || undefined;
        if (leftNeighbourLayer && !leftNeighbour.rightCoveredByLayer) {
          startXOffset = leftNeighbourLayer.rightPadding || 0;
        }
      }

      // Check for left-padding in the right neighbour
      // This would be implemented by shifting the right point of this segment
      let endXOffset = 0;
      if (i < line.segments.length - 1) {
        const rightNeighbour = line.segments[i + 1];
        const rightNeighbourLayer =
          this.layers[rightNeighbour.layerId] || undefined;
        if (rightNeighbourLayer && !rightNeighbour.leftCoveredByLayer) {
          endXOffset = rightNeighbourLayer.leftPadding || 0;
        }
      }

      this.context.beginPath();
      this.context.moveTo(segment.startX + startXOffset, line.y);
      this.context.lineTo(segment.endX - endXOffset, line.y);
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
          if (existingSegment.startX == newRanges[0][0]) {
            // The start point is preserved, and the right side is cut short
            existingSegment.rightCoveredByLayer = true;
          } else {
            existingSegment.leftCoveredByLayer = true;
          }
          existingSegment.startX = newRanges[0][0];
          existingSegment.endX = newRanges[0][1];
        } else if (newRanges.length == 2) {
          // The new segment splits the existing segment in two
          // Update the range of the existing segment (the left)
          existingSegment.startX = newRanges[0][0];
          existingSegment.endX = newRanges[0][1];
          existingSegment.rightCoveredByLayer = true;
          // Create a new segment for the other section of the existing segment (the right)
          segmentsToAdd.push({
            ...existingSegment,
            startX: newRanges[1][0],
            endX: newRanges[1][1],
            leftCoveredByLayer: true,
          });
        }
      }
      // TODO: Early exit once we are out of the specified range
      // I.e. if the endX of the existing segment is greater than the endX of the new segment, stop
    }

    // Now remove any segments to delete
    segmentsToRemove.sort((a, b) => b - a); // sort decending to avoid re-indexing issues
    for (const i of segmentsToRemove) {
      segments.splice(i, 1);
    }

    // Now add the new segments into list
    segmentsToAdd.push({ startX, endX, layerId, isBackground });
    for (const newSegment of segmentsToAdd) {
      if (newSegment.startX == newSegment.endX) {
        throw new Error(
          `Do not add an empty segment ${JSON.stringify(newSegment, 0, 2)} ${lineId}`,
        );
      }
      if (newSegment.startX > newSegment.endX) {
        throw new Error(
          `Start must be before end ${JSON.stringify(newSegment, 0, 2)} ${lineId}`,
        );
      }
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
}
