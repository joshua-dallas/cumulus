import {
  getVerticalLinesOfPolygon,
  intersection,
  mulberry32,
  subtractRange,
} from "./utils";

// TODO: Watch attribute and trigger re-render
// TODO: Use typescript and custom types for layer, line and segment
// TODO: Should I use get/set patterns to trigger re-render?
// TODO: Persist noise information between re-adding layers
// TODO: Improve noise behaviour (continious), x wave per line
// TODO: Line width gradient down background
// TODO: Implement the shadow diagonal
// TODO: Padding noise?
// TODO: Higher prob of line breaks (and longer ones) in first and last line
// TODO: Rewrite with forEach and map where possible
// TODO: #1 Add darker shading somehow - shadow diagonal, bottom shadow, lhs or middle of some cloud cells, etc.

export class EtchRenderer {
  static DRAW_STEP = 2;
  static LIGHTNESS_NOISE_RANGE = 13;
  static PROB_LINE_BREAK = 0.0009;
  static WAVE_X_NOISE_RANGE = 6;
  static LINE_Y_NOISE_RANGE = 0.4;
  static LINE_WIDTH_NOISE_RANGE = 0.3;

  constructor(canvas, lineWidth = 2, lineSpacing = 2) {
    this.canvas = canvas;

    // Global styling variables
    // TODO: Create setters
    this.defaultLineWidth = lineWidth;
    this.lineSpacing = lineSpacing;
    this.background = "white";
    this.backgroundBorderNoise = 0;
    this.defaultWaveAmplitude = 0.5;
    this.defaultWavePeriod = 60;

    // Colour variables
    this.dark2 = { hue: 0, sat: 0, light: 15 };

    // Shadow diagonal variables
    // TODO: Create setters
    this.hasShadowDiagonal = true;
    this.shadowDiagonalXOrigin =
      this.canvas.getBoundingClientRect().width * 0.7; // TODO: Is there a better way given the resize()?
    this.shadowDiagonalDirection = "left"; // Shadow to the left side
    this.shadowDiagonalAngle = (4 * Math.PI) / 5;
    this.shadowDiagonalEdgeNoise = 30;
    this.shadowDiagonalNoiseTable = []; // TODO: Should this be initialised here?

    // Random number generation
    this.seed = 10; // TODO: Use a random or provided seed
    this.random = mulberry32(this.seed);
    this.edgeNoiseTable = [];

    // Get the canvas context
    this.context = canvas.getContext("2d");
    if (!this.context) throw new Error("Failed to get 2D context from canvas");
    this.resize();

    // Initialise variables for storing the layers and rendered lines
    this.layers = [];
    this.generateLines();
  }

  resize() {
    // TODO: Should this be handled in cumulus?
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio;

    // Scale for pixel perfect rendering
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.context.scale(dpr, dpr);

    // Set the 'drawn' size of the canvas
    this.canvas.style.width = `${rect.width}px`;
    this.canvas.style.height = `${rect.height}px`;
  }

  generateLines() {
    // This function generates the objects that are used to store information about each line that is drawn
    // TODO: Using getBoundingClient feels janky
    const lineHeight = this.defaultLineWidth + this.lineSpacing;
    const numLines =
      Math.floor(this.canvas.getBoundingClientRect().height / lineHeight) - 2; // leave a line's space at the top and bottom
    this.lines = [];
    for (let i = 0; i < numLines; i++) {
      this.lines.push({
        id: i,
        y: lineHeight * (i + 1) + this.lineSpacing,
        startX: 0, // TODO: set by the background padding and mask
        //endX: this.canvas.width, // TODO: Something is going wrong here. Need to understand more
        endX: this.canvas.getBoundingClientRect().width,
        segments: [], // Information on what to draw is stored here
        // lengthNoiseTable: [], // What segments have length noise applied, and how much
      });
    }

    if (this.hasShadowDiagonal) {
      this.generateShadowDiagonalEdge();
    }
  }

  generateShadowDiagonalEdge() {
    this.shadowDiagonalNoiseTable = this.lines.map(() =>
      Math.round((this.random() - 0.5) * this.shadowDiagonalEdgeNoise),
    );
    this.shadowDiagonalLocations = this.lines.map((line) =>
      this.getShadowCrossingForLine(line),
    );
    console.log(this.shadowDiagonalXOrigin, this.shadowDiagonalLocations);
  }

  setBackgroundBorderNoise(noise) {
    // TODO: Assert positive
    // Must be called before setBackground
    this.backgroundBorderNoise = noise;
  }

  setBackground(background) {
    // TODO: Currently, this must be called first. Should the background be separate to layers?
    this.background = background;
    // For each line, we will add a segment for the background colour
    for (const line of this.lines) {
      let leftOffset = 0;
      let rightOffset = 0;
      if (this.backgroundBorderNoise) {
        leftOffset = Math.round(this.random() * this.backgroundBorderNoise);
        rightOffset = Math.round(this.random() * this.backgroundBorderNoise);
      }

      this.addSegment(
        line.id,
        line.startX + leftOffset,
        line.endX - rightOffset,
        undefined,
        true,
      );
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
      let startX = config.x - sqrtTerm;
      let endX = config.x + sqrtTerm;

      // Don't add noise to a zero length segment
      if (startX == endX) continue;

      [startX, endX] = this.addEdgeNoise(startX, endX, layerId, line.id);

      // Don't add a zero length segment
      if (startX >= endX) continue;

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
    const verticalLines = getVerticalLinesOfPolygon(config.vertices);

    // Add a segment to each of these lines
    for (const line of affectedLines) {
      // Does this line intersect any of the verticle lines
      const verticalCrossings = verticalLines.filter(
        (vert) => vert.y1 <= line.y && line.y <= vert.y2,
      );
      let range = verticalCrossings.map((vert) => vert.x);
      range.sort((a, b) => a - b);

      // If there are 3 verticle crossings, then this line is intersecting
      // a horizontal line of the polygon |_|-| <=
      if (verticalCrossings.length == 3) {
        // Take the smallest and largest x values by removing the middle value
        range.splice(1, 1);
      }

      // calculate the segment to add
      let startX = range[0];
      let endX = range[1];

      // Don't add noise to a zero length segment
      if (startX == endX) continue;

      [startX, endX] = this.addEdgeNoise(startX, endX, layerId, line.id);

      // Don't add a zero length segment
      if (startX >= endX) continue;

      this.addSegment(line.id, startX, endX, layerId, false);
    }
  }

  addEdgeNoise(startX, endX, layerId, lineId) {
    const leftEdgeNoise = this.layers[layerId].leftEdgeNoise;
    const rightEdgeNoise = this.layers[layerId].rightEdgeNoise;
    if (leftEdgeNoise) {
      // Check whether we have a previous left edge noise value on this line
      const cachedValue = this.edgeNoiseTable.filter(
        (v) => v.layerId == layerId && v.lineId == lineId && v.edge == "left",
      );
      if (cachedValue.length) {
        startX += cachedValue[0].offset;
      } else {
        const offset = Math.round((this.random() - 0.5) * leftEdgeNoise);
        startX += offset;
        this.edgeNoiseTable.push({
          layerId,
          lineId,
          edge: "left",
          offset,
        });
      }
    }

    if (rightEdgeNoise) {
      // Check whether we have a previous right edge noise value on this line
      const cachedValue = this.edgeNoiseTable.filter(
        (v) => v.layerId == layerId && v.lineId == lineId && v.edge == "right",
      );
      if (cachedValue.length) {
        endX += cachedValue[0].offset;
      } else {
        const offset = Math.round((this.random() - 0.5) * rightEdgeNoise);
        endX += offset;
        this.edgeNoiseTable.push({
          layerId,
          lineId,
          edge: "right",
          offset,
        });
      }
    }

    return [startX, endX];
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
    // Find the shadow diagonal crossing for this line, if there is one
    const shadowPaddingFactor = 0.4; // How much to attenuate padding in the shadow region TODO: move to top

    // For each final segment, draw a line to the canvas
    // TODO: Create helper functions for get colour, get offset left, right
    for (let i = 0; i < line.segments.length; i++) {
      const segment = line.segments[i];

      // TODO: Don't apply padding within the shadow region
      // Check for right-padding in the left neighbour
      // This would be implemented by shifting the left point of this segment
      let startXOffset = this.getStartXOffsetFromPadding(i, line);
      if (this.isInShadow(segment.startX, line)) {
        startXOffset *= shadowPaddingFactor;
      }

      // Check for left-padding in the right neighbour
      // This would be implemented by shifting the right point of this segment
      let endXOffset = this.getEndXOffsetFromPadding(i, line);
      if (this.isInShadow(segment.endX, line)) {
        endXOffset *= shadowPaddingFactor;
      }

      const actualStartX = segment.startX + startXOffset;
      const actualEndX = segment.endX - endXOffset;

      if (actualEndX <= actualStartX) continue;

      this.drawSegment(actualStartX, actualEndX, line, segment);
    }
  }

  drawSegment(x1, x2, line, segment) {
    // TODO: The arguments are a bit strange here, refactor

    // Get the custom line width of the layer
    const layer = this.layers[segment.layerId] || undefined;
    const lineWidth = layer?.lineWidth || this.defaultLineWidth;

    // Set up to draw the first point of the line
    let yOffset = this.getWaveYOffset(x1, layer);
    this.context.beginPath();
    this.context.moveTo(x1, line.y + yOffset);

    // We draw each segment as a waved line
    let currentX = x1;
    while (currentX < x2) {
      // Don't moveTo and lineTo the first point
      if (currentX > x1) {
        // Draw the current line section
        yOffset = this.getWaveYOffset(currentX, layer);

        // Decide whether to add a line break at the current point
        // TODO: More line breaks in the background?
        //TODO: Pull from table
        if (this.random() > EtchRenderer.PROB_LINE_BREAK) {
          const lineWidthNoise =
            (this.random() - 0.5) * EtchRenderer.LINE_WIDTH_NOISE_RANGE;

          this.context.lineTo(currentX, line.y + yOffset);
          this.context.lineWidth = lineWidth + lineWidthNoise;
          this.context.strokeStyle = this.getStrokeColour(
            currentX,
            segment,
            line,
          );
          //this.context.lineCap = "round";
          this.context.stroke();
        }

        // Setup for the next line
        this.context.beginPath();
        this.context.moveTo(currentX, line.y + yOffset);
      }

      // Quantise the x locations
      const mod = currentX % EtchRenderer.DRAW_STEP;
      if (mod == 0) {
        currentX += EtchRenderer.DRAW_STEP;
      } else {
        currentX += EtchRenderer.DRAW_STEP - mod;
      }
    }

    // Draw the final point
    yOffset = this.getWaveYOffset(x2, layer);
    this.context.lineTo(x2, line.y + yOffset);

    // Add the line to the canvas
    this.context.lineWidth = lineWidth;
    this.context.strokeStyle = this.getStrokeColour(currentX, segment, line);
    //this.context.lineCap = "round";
    this.context.stroke();
  }

  getStrokeParameters(x1, segment, line) {
    return this.getStrokeColour(x1, segment, line);
  }

  getStartXOffsetFromPadding(segmentId, line) {
    // Check for right-padding in the left neighbour
    // This would be implemented by shifting the left point of this segment
    let startXOffset = 0;
    if (segmentId > 0) {
      const leftNeighbour = line.segments[segmentId - 1];
      const leftNeighbourLayer =
        this.layers[leftNeighbour.layerId] || undefined;
      if (leftNeighbourLayer && !leftNeighbour.rightCoveredByLayer) {
        startXOffset = leftNeighbourLayer.rightPadding || 0;
      }
    }

    return startXOffset;
  }

  getEndXOffsetFromPadding(segmentId, line) {
    // Check for left-padding in the right neighbour
    // This would be implemented by shifting the right point of this segment
    let endXOffset = 0;
    if (segmentId < line.segments.length - 1) {
      const rightNeighbour = line.segments[segmentId + 1];
      const rightNeighbourLayer =
        this.layers[rightNeighbour.layerId] || undefined;
      if (rightNeighbourLayer && !rightNeighbour.leftCoveredByLayer) {
        endXOffset = rightNeighbourLayer.leftPadding || 0;
      }
    }

    return endXOffset;
  }

  getStrokeColour(x1, segment, line) {
    // Get the colour of the segment
    let colour = this.getColourOfSegment(segment);

    // Apply the shadow diagonal if needed
    if (this.isInShadow(x1, line) && !segment.isBackground) {
      colour = this.dark2;
    }

    // Apply lightness noise
    return this.addLightnessNoise(colour);
    // TODO: More lightness noise in the shadow region?
  }

  getColourOfSegment(segment) {
    let colour;
    if (segment.isBackground) {
      colour = this.background;
    } else {
      colour = this.layers[segment.layerId].fill;
    }

    return colour;
  }

  isInShadow(x, line) {
    const shadowDiagonalX = this.shadowDiagonalLocations[line.id];

    if (this.hasShadowDiagonal) {
      if (
        (this.shadowDiagonalDirection == "left" && x < shadowDiagonalX) ||
        (this.shadowDiagonalDirection == "right" && x >= shadowDiagonalX)
      ) {
        return true;
      }
    }
    return false;
  }

  getShadowCrossingForLine(line) {
    const y = line.y;
    // Remember: Positive y is down, but we have specified the angle from the bottom x-axis
    const maxY = this.canvas.getBoundingClientRect().height; // TODO: This should be global
    const yFromBottom = maxY - y;
    let shadowX =
      yFromBottom / Math.tan(this.shadowDiagonalAngle) +
      this.shadowDiagonalXOrigin;

    // Apply the shadow diagonal edge noise for this line
    shadowX += this.shadowDiagonalNoiseTable[line.id];
    shadowX = Math.round(shadowX);

    shadowX = Math.max(
      Math.min(shadowX, this.canvas.getBoundingClientRect().width),
      0,
    );

    return shadowX;
  }

  addLightnessNoise(colour) {
    const lightnessNoise = Math.round(
      (this.random() - 0.5) * EtchRenderer.LIGHTNESS_NOISE_RANGE,
    );
    const light = Math.min(Math.max(colour.light + lightnessNoise, 0), 100);
    return `hsl(${colour.hue}, ${colour.sat}%, ${light}%)`;
  }

  getAffectedLines(startY, endY) {
    return this.lines.filter((line) => line.y >= startY && line.y <= endY);
  }

  addSegment(lineId, startX, endX, layerId, isBackground) {
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
          // Create a new segment for the other section of the existing segment (the right)
          segmentsToAdd.push({
            ...existingSegment,
            startX: newRanges[1][0],
            endX: newRanges[1][1],
            leftCoveredByLayer: true,
          });
          // Update the range of the existing segment (the left)
          existingSegment.startX = newRanges[0][0];
          existingSegment.endX = newRanges[0][1];
          existingSegment.rightCoveredByLayer = true;
        }
      }
      // TODO: Early exit once we are out of the segment range
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
      segments.push(newSegment);
    }
    // Sort by location along the line
    // TODO: There will be a more efficient way to do this
    segments.sort((a, b) => a.startX - b.startX);
  }

  getWaveYOffset(x, layer) {
    // Returns the y-offset to be applied at the specified x
    // To add the wave defined by wavePeriod and waveAmplitude
    let wavePeriod = this.defaultWavePeriod;
    let waveAmplitude = this.defaultWaveAmplitude;

    if (layer) {
      // Check whether custom wave parameters exist for this layer
      wavePeriod = layer.wavePeriod || wavePeriod;
      waveAmplitude = layer.waveAmplitude || waveAmplitude;
    }

    // TODO: Should this be uniform for the whole line?
    // Add some noise that shifts the waves left or right
    // This does not change the start or end x values of the line segment
    const waveXNoise = (this.random() - 0.5) * EtchRenderer.WAVE_X_NOISE_RANGE;
    // TODO: Make this smoother - i.e. continious noise would be better. Same goes for edge noise
    const yNoise = (this.random() - 0.5) * EtchRenderer.LINE_Y_NOISE_RANGE;

    return (
      Math.sin(((x + waveXNoise) * 2 * Math.PI) / wavePeriod) * waveAmplitude +
      yNoise
    );
  }
}
