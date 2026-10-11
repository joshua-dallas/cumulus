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
// TODO: Padding noise?
// TODO: Higher prob of line breaks (and longer ones) in first and last line
// TODO: Compute y offsets and save before draw
// TODO: Smooth transition line width and y offset between segments (have a flag for this)
// TODO: Set a flag in finalise renderer that is checked in draw
// TODO: Will it improve performance to round long decimal values to 3sf?

// Performance boosts
// - Compute noise once and save
// - Save y offsets rather than computing each time

export class EtchRenderer {
  static DRAW_STEP = 2;
  static LIGHTNESS_NOISE_RANGE = 13;
  static PROB_LINE_BREAK = 0.0009;
  static WAVE_X_NOISE_RANGE = 8;
  static LINE_Y_NOISE_RANGE = 0.4;
  static LINE_WIDTH_NOISE_RANGE = 0.3;

  constructor(canvas, lineWidth = 2, lineSpacing = 2) {
    this.canvas = canvas;

    // Global styling variables
    // TODO: Create setters
    this.defaultLineWidth = lineWidth;
    this.lineSpacing = lineSpacing;
    this.backgroundBorderNoise = 0;
    // How much thicker the background lines are at the bottom compared to the top
    this.backgroundLineWidthGradientDown = 0.4; // TODO: Specify thicker lines at the top, perhaps another variable
    this.defaultWaveAmplitude = 0.5;
    this.defaultWavePeriod = 60;
    this.hasBackground = true;

    // Default colour variables
    this.colours = {
      background: { hue: 206, sat: 57, light: 60 },
      dark2: { hue: 0, sat: 0, light: 15 },
    };

    // Shadow diagonal variables
    // TODO: Create setters
    this.hasShadowDiagonal = true;
    this.shadowDiagonalXOrigin =
      this.canvas.getBoundingClientRect().width * 0.7; // TODO: Is there a better way given the resize()?
    this.shadowDiagonalDirection = "left"; // Shadow to the left side
    this.shadowDiagonalAngle = (4 * Math.PI) / 5;
    this.shadowDiagonalEdgeNoise = 30;

    // Random number generation
    this.seed = 10; // TODO: Use a random or provided seed
    this.random = mulberry32(this.seed);
    this.noise = {
      layerEdge: [],
      shadowDiagonal: [],
      waveXOffset: [],
      borderEdgeLeft: [],
      borderEdgeRight: [],
      //wavePeriod: [],
      yOffset: [], // TODO: When dealing with unquantised locations, use floor
      lineWidth: [],
      lineBreaks: [],
      lightness: [],
      //lightnessPerLine; [], // Slight banding effect
      //borderLineBreaks: [],
    };

    // Initialise variables for storing the layers and rendered lines
    this.layers = [];
    this.lines = [];
    this.baseYOffset = [];

    // Get the canvas context
    this.context = canvas.getContext("2d");
    if (!this.context) throw new Error("Failed to get 2D context from canvas");
    this.resize();
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

  finaliseRenderer() {
    this.generateLines();
    this.initialiseNoise(); //TODO: generate?
    this.generateShadowDiagonalEdge();
    this.calculateBaseYOffset();
    this.addBackground();
  }

  initialiseNoise() {
    // TODO: This needs to be called after all the parameters have been set
    // TODO: Do we only create noise where it is enabled, or do we only apply it if is enabled?
    // Let's create all the noise first
    const numXSteps = Math.ceil(
      this.canvas.getBoundingClientRect().width / EtchRenderer.DRAW_STEP,
    );

    // Single uniform random variable per line
    this.noise.borderEdgeLeft = this.lines.map(() =>
      Math.round(this.random() * this.backgroundBorderNoise),
    );
    this.noise.borderEdgeRight = this.lines.map(() =>
      Math.round(this.random() * this.backgroundBorderNoise),
    );
    this.noise.shadowDiagonal = this.lines.map(() =>
      Math.round((this.random() - 0.5) * this.shadowDiagonalEdgeNoise),
    );
    this.noise.waveXOffset = this.lines.map(() =>
      Math.round((this.random() - 0.5) * EtchRenderer.WAVE_X_NOISE_RANGE),
    );
    // 1D Perlin noise per line (1 value for each draw step)
    // TODO: Edge noise with perlin
    this.noise.yOffset = this.lines.map(() =>
      [...Array(numXSteps).keys()].map(
        () => (this.random() - 0.5) * EtchRenderer.LINE_Y_NOISE_RANGE,
      ),
    );
    this.noise.lineWidth = this.lines.map(() =>
      [...Array(numXSteps).keys()].map(
        () => (this.random() - 0.5) * EtchRenderer.LINE_WIDTH_NOISE_RANGE,
      ),
    );
    // Uniform random variable per draw step
    this.noise.lightness = this.lines.map(() =>
      [...Array(numXSteps).keys()].map(() =>
        Math.round((this.random() - 0.5) * EtchRenderer.LIGHTNESS_NOISE_RANGE),
      ),
    );
    // This could also be saved as the uniform variable and check the threshold in draw
    this.noise.lineBreaks = this.lines.map(() =>
      [...Array(numXSteps).keys()].map(
        () => this.random() < EtchRenderer.PROB_LINE_BREAK,
      ),
    );
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
  }

  clear() {
    // Resets the lines for the next animation frame
    this.layers = [];

    for (const line of this.lines) {
      line.segmets = [];
    }

    this.addBackground();
  }

  generateShadowDiagonalEdge() {
    this.shadowDiagonalLocations = this.lines.map((line) =>
      this.getShadowCrossingForLine(line),
    );
  }

  setBackgroundBorderNoise(noise) {
    // TODO: Assert positive
    this.backgroundBorderNoise = noise;
  }

  addBackground() {
    // TODO: Currently, this must be called first. Should the background be separate to layers?
    // For each line, we will add a segment for the background colour
    for (const line of this.lines) {
      let leftOffset = 0;
      let rightOffset = 0;
      if (this.backgroundBorderNoise) {
        leftOffset = this.noise.borderEdgeLeft[line.id];
        rightOffset = this.noise.borderEdgeRight[line.id];
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

    const cachedNoise = this.noise.layerEdge[lineId]
      ? this.noise.layerEdge[lineId][layerId]
      : undefined;

    if (leftEdgeNoise) {
      // Check whether we have a previous left edge noise value on this line
      if (cachedNoise?.left) {
        startX += cachedNoise.left;
      } else {
        const offset = Math.round((this.random() - 0.5) * leftEdgeNoise);
        startX += offset;
        // Save the value to the noise cache
        if (!this.noise.layerEdge[lineId]) {
          this.noise.layerEdge[lineId] = [];
        }
        if (!this.noise.layerEdge[lineId][layerId]) {
          this.noise.layerEdge[lineId][layerId] = {};
        }
        this.noise.layerEdge[lineId][layerId].left = offset;
      }
    }

    if (rightEdgeNoise) {
      // Check whether we have a previous right edge noise value on this line
      if (cachedNoise?.right) {
        endX += cachedNoise.right;
      } else {
        const offset = Math.round((this.random() - 0.5) * rightEdgeNoise);
        endX += offset;

        // Save the value to the noise cache
        if (!this.noise.layerEdge[lineId]) {
          this.noise.layerEdge[lineId] = [];
        }
        if (!this.noise.layerEdge[lineId][layerId]) {
          this.noise.layerEdge[lineId][layerId] = {};
        }
        this.noise.layerEdge[lineId][layerId].right = offset;
      }
    }

    return [startX, endX];
  }

  draw() {
    //console.log("Drawing to canvas");
    //console.log(this.layers);
    //console.log(this.lines);
    // For testing, we are only going to draw one line at y=200
    for (const line of this.lines) {
      this.drawLine(line);
    }
  }

  drawLine(line) {
    // Find the shadow diagonal crossing for this line, if there is one
    const shadowPaddingFactor = 0.4; // How much to attenuate padding in the shadow region TODO: move to top

    // For each final segment, draw a line to the canvas
    for (let i = 0; i < line.segments.length; i++) {
      const segment = line.segments[i];

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
    // Set up to draw the first point of the line
    let yOffset = this.getWaveYOffset(x1, segment, line);
    this.context.beginPath();
    this.context.moveTo(x1, line.y + yOffset);

    // We draw each segment as a waved line
    let currentX = x1;
    while (currentX < x2) {
      // Don't moveTo and lineTo the first point
      if (currentX > x1) {
        // Get the parameters for the next line section
        const [colour, lineWidth, lineBreak] = this.getStrokeParameters(
          currentX,
          segment,
          line,
        );
        yOffset = this.getWaveYOffset(currentX, segment, line);

        // Draw the current line section

        if (!lineBreak) {
          this.context.lineTo(currentX, line.y + yOffset);
          this.context.lineWidth = lineWidth;
          this.context.strokeStyle = colour;
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

    // Get the parameters for the final line section
    yOffset = this.getWaveYOffset(x2, segment, line);
    const [colour, lineWidth, lineBreak] = this.getStrokeParameters(
      currentX,
      segment,
      line,
    );

    if (lineBreak) return;

    // Draw the final point
    this.context.lineTo(x2, line.y + yOffset);
    this.context.lineWidth = lineWidth;
    this.context.strokeStyle = colour;
    //this.context.lineCap = "round";
    this.context.stroke();
  }

  getStrokeParameters(x1, segment, line) {
    const xDrawStep = Math.floor(x1 / EtchRenderer.DRAW_STEP);

    // Get the final colour of the section
    const colour = this.getStrokeColour(x1, segment, line);

    // Get the custom line width of the layer
    const layer = this.layers[segment.layerId] || undefined;
    let lineWidth = layer?.lineWidth || this.defaultLineWidth;
    const lineWidthNoise = this.noise.lineWidth[line.id][xDrawStep];
    lineWidth += lineWidthNoise;

    // Apply the background line width gradient
    if (segment.isBackground) {
      lineWidth *=
        ((line.id + 1) / this.lines.length) *
          (this.backgroundLineWidthGradientDown - 1) +
        1;
    }

    // Decide whether to add a line break at the current point
    // TODO: More line breaks in the background?
    const lineBreak = this.noise.lineBreaks[line.id][xDrawStep];

    return [colour, lineWidth, lineBreak];
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
    const xDrawStep = Math.floor(
      // TODO: Find a cleaner way to do this. Maybe a function, or store the value of bounding client
      // TODO: Does this work as intended?
      x1 / EtchRenderer.DRAW_STEP,
    );
    // Get the colour of the segment
    let colour = this.getColourOfSegment(segment);

    // Apply the shadow diagonal if needed
    if (this.isInShadow(x1, line) && !segment.isBackground) {
      colour = this.colours.dark2;
    }

    // Apply lightness noise
    const lightnessNoise = this.noise.lightness[line.id][xDrawStep];
    const light = Math.min(Math.max(colour.light + lightnessNoise, 0), 100);
    return `hsl(${colour.hue}, ${colour.sat}%, ${light}%)`;
    // TODO: More lightness noise in the shadow region?
  }

  getColourOfSegment(segment) {
    let colour;
    if (segment.isBackground) {
      colour = this.colours.background;
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
        (this.shadowDiagonalDirection == "right" && x > shadowDiagonalX)
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
    shadowX += this.noise.shadowDiagonal[line.id];
    shadowX = Math.round(shadowX);

    shadowX = Math.max(
      Math.min(shadowX, this.canvas.getBoundingClientRect().width),
      0,
    );

    return shadowX;
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

  calculateBaseYOffset() {
    // Precalculates the values of sine at each draw step point to save time
    // These values are used when there is not a custom wave period for the layer

    const numXSteps = Math.ceil(
      this.canvas.getBoundingClientRect().width / EtchRenderer.DRAW_STEP,
    );

    for (const line of this.lines) {
      const waveXNoise = this.noise.waveXOffset[line.id];
      const yOffsets = [...Array(numXSteps).keys()].map((step) =>
        Math.sin(
          ((step * EtchRenderer.DRAW_STEP + waveXNoise) * 2 * Math.PI) /
            this.defaultWavePeriod,
        ),
      );
      this.baseYOffset[line.id] = yOffsets;
    }
  }

  getWaveYOffset(x, segment, line) {
    const xDrawStep = Math.floor(x / EtchRenderer.DRAW_STEP);
    // Returns the y-offset to be applied at the specified x
    // To add the wave defined by wavePeriod and waveAmplitude
    let wavePeriod = this.defaultWavePeriod;
    let waveAmplitude = this.defaultWaveAmplitude;

    const layer = this.layers[segment.layerId] || undefined;

    // TODO: Make this smoother - i.e. continious noise would be better. Same goes for edge noise
    const yNoise = this.noise.yOffset[line.id][xDrawStep];

    if (layer) {
      // Check whether custom wave parameters exist for this layer
      wavePeriod = layer.wavePeriod || wavePeriod;
      waveAmplitude = layer.waveAmplitude || waveAmplitude;
    }

    if (wavePeriod == this.defaultWavePeriod) {
      // We can use the precalculated values
      return this.baseYOffset[line.id][xDrawStep] * waveAmplitude * yNoise;
    }

    // If there is a custom wave period, calculate using sine.
    // Add some noise that shifts the waves left or right
    // This does not change the start or end x values of the line segment
    const waveXNoise = this.noise.waveXOffset[line.id];

    return (
      Math.sin(((x + waveXNoise) * 2 * Math.PI) / wavePeriod) * waveAmplitude +
      yNoise
    );
  }
}
