import {
  getVerticalLinesOfPolygon,
  hashToUnit,
  mixColours,
  mulberry32,
  perlinNoise1D,
} from "./utils.js";

// Performance boosts
// - Compute noise once and save
// - Save y offsets rather than computing each time

export class HatchedRenderer {
  static DRAW_STEP = 2;
  static LIGHTNESS_NOISE_RANGE = 13;
  static PROB_LINE_BREAK = 0.0009;
  // The top and bottom lines get a random number of longer line breaks, at random places
  static EDGE_LINE_BREAKS_MIN = 3;
  static EDGE_LINE_BREAKS_MAX = 8;
  static EDGE_LINE_BREAK_MIN_WIDTH = 6; // px
  static EDGE_LINE_BREAK_MAX_WIDTH = 24; // px
  static WAVE_X_NOISE_RANGE = 8;
  static LINE_Y_NOISE_RANGE = 0.4;
  static LINE_WIDTH_NOISE_RANGE = 0.7; // The scale of the line width noise
  // Perlin nodes along a line, picked per line in this range: more means faster wandering
  static LINE_WIDTH_NOISE_NODES_MIN = 10;
  static LINE_WIDTH_NOISE_NODES_MAX = 20;

  // width and height are the logical (CSS pixel) size of the drawing area.
  // They are passed in, rather than measured from the canvas, so the renderer
  // does not depend on the canvas being laid out in the DOM.
  // pixelRatio is the device pixels per CSS pixel. A worker has no window to read it from.
  // seed decides all the noise: the same seed always gives the same picture
  constructor(
    canvas,
    width,
    height,
    lineWidth = 2,
    lineSpacing = 2,
    pixelRatio = undefined,
    seed = 10,
  ) {
    this.canvas = canvas;
    this.pixelRatio = pixelRatio ?? globalThis.window?.devicePixelRatio ?? 1;
    this.width = width;
    this.height = height;
    this.numXSteps = Math.ceil(width / HatchedRenderer.DRAW_STEP);

    // Global styling variables
    this.defaultLineWidth = lineWidth;
    this.lineSpacing = lineSpacing;
    this.backgroundBorderNoise = 0;
    // How much thicker the background lines are at the bottom compared to the top
    this.backgroundLineWidthGradientDown = 0.4;
    this.defaultWaveAmplitude = 0.5;
    this.defaultWavePeriod = 60;
    this.hasBackground = true;

    // Default colour variables
    this.colours = {
      dark2: { hue: 0, sat: 0, light: 15 },
    };
    // The sky fades from the top colour to the bottom colour, or is all the top
    // colour if there is no bottom colour. backgroundColours is the colour of each line
    this.backgroundTop = { hue: 206, sat: 57, light: 60 };
    this.backgroundBottom = undefined;
    this.backgroundColours = [];
    this.paper = { hue: 0, sat: 0, light: 100 }; // the colour of padding gaps. None: see-through

    // Shadow diagonal variables
    this.hasShadowDiagonal = true;
    // The shadow edge passes through the base of the dome, at this x. The dome is set by
    // setDome(); until then it is the whole width of the canvas, resting on the bottom
    this.dome = { x: this.width / 2, y: this.height, radius: this.width / 2 };
    this.shadowDiagonalXOrigin = this.width * 0.7;
    this.shadowDiagonalDirection = "left"; // Shadow to the left side
    this.shadowDiagonalAngle = (5 * Math.PI) / 6;
    this.shadowDiagonalEdgeNoise = 30;

    // Random number generation
    this.seed = seed;
    this.random = mulberry32(this.seed);
    this.noise = {
      // Edge noise is cached per layer key (not layer index) so that it stays
      // attached to the same shape even if layers are added or removed between frames
      layerEdge: new Map(), // key -> { left: [per line], right: [per line] }
      shadowDiagonal: [],
      waveXOffset: [],
      borderEdgeLeft: [],
      borderEdgeRight: [],
      //wavePeriod: [],
      yOffset: [],
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
    const dpr = this.pixelRatio;

    // Scale for pixel perfect rendering. Assigning canvas.width also resets
    // the context state, so the scale is applied from a clean transform
    this.canvas.width = this.width * dpr;
    this.canvas.height = this.height * dpr;
    this.context.scale(dpr, dpr);

    // Set the 'drawn' size of the canvas. An OffscreenCanvas (in a worker) has no
    // style: the element that owns the real canvas sets it
    if (this.canvas.style) {
      this.canvas.style.width = `${this.width}px`;
      this.canvas.style.height = `${this.height}px`;
    }
  }

  // The dome (see CloudBuilder) the shadow edge is measured from: { x, y, radius }, with
  // y the base of the dome. Call before applyTheme()
  setDome(dome) {
    this.dome = dome;
  }

  // Applies the renderer-related parts of a theme (see theme.js).
  // Must be called before finaliseRenderer(), as the noise depends on these values
  applyTheme(theme) {
    this.setBackgroundBorderNoise(theme.background.borderNoise);
    this.shadowDiagonalEdgeNoise = theme.shadowDiagonal.edgeNoise;
    this.updateTheme(theme);
  }

  // Applies the parts of a theme that can change after the renderer is set up,
  // such as the colours and the angle of the shadow when blending to a sunset.
  // The noise is not made again, so the border noise and the shadow edge noise
  // must be the same as when applyTheme was called. Lines drawn after this use it
  updateTheme(theme) {
    this.colours = theme.colours;
    this.backgroundTop = theme.background.top;
    this.backgroundBottom = theme.background.bottom;
    this.paper = theme.background.paper;

    const shadow = theme.shadowDiagonal;
    this.hasShadowDiagonal = shadow.enabled;
    this.shadowDiagonalXOrigin = this.dome.x + this.dome.radius * shadow.xOriginOffset;
    this.shadowDiagonalDirection = shadow.direction;
    this.shadowDiagonalAngle = shadow.angle;

    // The lines and noise are made by finaliseRenderer(). Before that there is
    // nothing to update
    if (this.noise.shadowDiagonal.length) {
      this.updateBackgroundColours();
      this.generateShadowDiagonalEdge();
    }
  }

  // The colour of each line of the sky, fading from the top colour down to the
  // bottom colour
  updateBackgroundColours() {
    const top = this.backgroundTop;
    const bottom = this.backgroundBottom;
    this.backgroundColours = this.lines.map((line, i) =>
      bottom ? mixColours(top, bottom, i / Math.max(1, this.lines.length - 1)) : top,
    );
  }

  // Clears the canvas (not the lines/layers, see clear()). It is made see-through, so
  // that the spaces between the lines show what is behind the canvas on the page
  clearCanvas() {
    this.context.clearRect(0, 0, this.width, this.height);
  }

  finaliseRenderer() {
    this.generateLines();
    this.initialiseNoise();
    this.updateBackgroundColours();
    this.generateShadowDiagonalEdge();
    this.calculateBaseYOffset();
    this.addBackground();
  }

  initialiseNoise() {
    // Let's create all the noise first
    const numXSteps = this.numXSteps;

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
      Math.round((this.random() - 0.5) * HatchedRenderer.WAVE_X_NOISE_RANGE),
    );
    // Noise per line, 1 value for each draw step
    this.noise.yOffset = this.lines.map(() =>
      [...Array(numXSteps).keys()].map(
        () => (this.random() - 0.5) * HatchedRenderer.LINE_Y_NOISE_RANGE,
      ),
    );
    // The width of the line wanders smoothly, like a pen, as Perlin noise.
    // Each line has its own number of nodes, so some lines wander faster than others.
    // It has its own random stream so that the other noise does not change if
    // the number of nodes is changed
    const widthRandom = mulberry32(this.seed + 1);
    const { LINE_WIDTH_NOISE_NODES_MIN: minNodes, LINE_WIDTH_NOISE_NODES_MAX: maxNodes } =
      HatchedRenderer;
    this.noise.lineWidth = this.lines.map(() => {
      const nodes = minNodes + Math.floor(widthRandom() * (maxNodes - minNodes + 1));
      return perlinNoise1D(widthRandom, numXSteps, nodes, HatchedRenderer.LINE_WIDTH_NOISE_RANGE);
    });
    // Uniform random variable per draw step
    this.noise.lightness = this.lines.map(() =>
      [...Array(numXSteps).keys()].map(() =>
        Math.round((this.random() - 0.5) * HatchedRenderer.LIGHTNESS_NOISE_RANGE),
      ),
    );
    // This could also be saved as the uniform variable and check the threshold in draw
    this.noise.lineBreaks = this.lines.map(() =>
      [...Array(numXSteps).keys()].map(() => this.random() < HatchedRenderer.PROB_LINE_BREAK),
    );
    this.addEdgeLineBreaks();
  }

  // Adds breaks to the top and bottom lines. They have their own random stream so
  // that the other noise does not change
  addEdgeLineBreaks() {
    const random = mulberry32(this.seed + 2);
    const {
      EDGE_LINE_BREAKS_MIN: minCount,
      EDGE_LINE_BREAKS_MAX: maxCount,
      EDGE_LINE_BREAK_MIN_WIDTH: minWidth,
      EDGE_LINE_BREAK_MAX_WIDTH: maxWidth,
      DRAW_STEP,
    } = HatchedRenderer;
    const numXSteps = this.numXSteps;

    for (const line of [this.lines[0], this.lines[this.lines.length - 1]]) {
      if (!line) continue;
      const count = minCount + Math.floor(random() * (maxCount - minCount + 1));
      for (let i = 0; i < count; i++) {
        const width = minWidth + random() * (maxWidth - minWidth);
        const start = Math.floor(random() * numXSteps);
        const end = Math.min(numXSteps, start + Math.max(1, Math.round(width / DRAW_STEP)));
        for (let step = start; step < end; step++) this.noise.lineBreaks[line.id][step] = true;
      }
    }
  }

  generateLines() {
    // This function generates the objects that are used to store information about each line that is drawn
    const lineHeight = this.defaultLineWidth + this.lineSpacing;
    const numLines = Math.floor(this.height / lineHeight) - 2; // leave a line's space at the top and bottom
    this.lines = [];
    for (let i = 0; i < numLines; i++) {
      this.lines.push({
        id: i,
        y: lineHeight * (i + 1) + this.lineSpacing,
        startX: 0,
        endX: this.width,
        segments: [], // Information on what to draw is stored here
        // lengthNoiseTable: [], // What segments have length noise applied, and how much
      });
    }
  }

  clear() {
    // Resets the lines for the next animation frame
    this.layers = [];

    for (const line of this.lines) {
      line.segments = [];
    }

    this.addBackground();
  }

  generateShadowDiagonalEdge() {
    this.shadowDiagonalLocations = this.lines.map((line) => this.getShadowCrossingForLine(line));
  }

  setBackgroundBorderNoise(noise) {
    this.backgroundBorderNoise = noise;
  }

  addBackground() {
    // For each line, we will add a segment for the background colour
    for (const line of this.lines) {
      let leftOffset = 0;
      let rightOffset = 0;
      if (this.backgroundBorderNoise) {
        leftOffset = this.noise.borderEdgeLeft[line.id];
        rightOffset = this.noise.borderEdgeRight[line.id];
      }

      this.addSegment(line.id, line.startX + leftOffset, line.endX - rightOffset, undefined, true);
    }
  }

  // Adds a layer's segment to a line, along with the padding beside it.
  //
  // Padding is treated as part of the layer, an extension of it: it is added
  // at the same point in the layer order, as empty segments (gaps) that clear
  // whatever is underneath. Layers added afterwards draw over a gap like
  // anything else, so a gap stays visible even if the layer it belongs to is
  // covered. A gap remembers what it cleared so that it can be skipped in shadow.
  addLayerSegment(line, startX, endX, layer) {
    const leftGapStart = Math.max(startX - (layer.leftPadding || 0), line.startX);
    if (leftGapStart < startX) {
      this.addSegment(line.id, leftGapStart, startX, layer.id, false, true);
    }

    const rightGapEnd = Math.min(endX + (layer.rightPadding || 0), line.endX);
    if (rightGapEnd > endX) {
      this.addSegment(line.id, endX, rightGapEnd, layer.id, false, true);
    }

    this.addSegment(line.id, startX, endX, layer.id, false);
  }

  addCircleLayer(config) {
    // Save the layer config
    const layerId = this.layers.length;
    const layer = { ...config, id: layerId, type: "circle" };
    this.layers.push(layer);

    // Get affected lines
    const startY = config.y - config.radius;
    const endY = config.y + config.radius;
    const affectedLines = this.getAffectedLines(startY, endY);

    // Add a segment to each of these lines
    for (const line of affectedLines) {
      // calculate the segment to add
      // Use the equation of the x axis intercepts of a circle
      const sqrtTerm = Math.round(Math.sqrt(config.radius ** 2 - (line.y - config.y) ** 2));
      let startX = config.x - sqrtTerm;
      let endX = config.x + sqrtTerm;

      // Don't add noise to a zero length segment
      if (startX == endX) continue;

      [startX, endX] = this.addEdgeNoise(startX, endX, layer, line.id);

      // Don't add a zero length segment
      if (startX >= endX) continue;

      this.addLayerSegment(line, startX, endX, layer);
    }
  }

  addRightAnglePolygonLayer(config) {
    // Only handles polygons with vertical and horizontal lines
    // For any given y, the polygon can only have 2 edges
    // Save the layer config
    const layerId = this.layers.length;
    const layer = { ...config, id: layerId, type: "right-angle-polygon" };
    this.layers.push(layer);

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

      // A line that only touches the polygon at a vertex crosses a single
      // vertical edge, which is not enough to make a segment
      if (range.length < 2) continue;

      // calculate the segment to add
      let startX = range[0];
      let endX = range[1];

      // Don't add noise to a zero length segment
      if (startX == endX) continue;

      [startX, endX] = this.addEdgeNoise(startX, endX, layer, line.id);

      // Don't add a zero length segment
      if (startX >= endX) continue;

      this.addLayerSegment(line, startX, endX, layer);
    }
  }

  addEdgeNoise(startX, endX, layer, lineId) {
    // Noise is cached by layer key. Layers are rebuilt every frame, so the key
    // (set by the caller, e.g. "cell-4") is what keeps a shape's edge stable
    const key = layer.key ?? `layer-${layer.id}`;
    let cached = this.noise.layerEdge.get(key);
    if (!cached) {
      cached = { left: [], right: [] };
      this.noise.layerEdge.set(key, cached);
    }

    if (layer.leftEdgeNoise) {
      startX += this.getCachedEdgeOffset(cached.left, lineId, layer.leftEdgeNoise, `${key}|left`);
    }
    if (layer.rightEdgeNoise) {
      endX += this.getCachedEdgeOffset(cached.right, lineId, layer.rightEdgeNoise, `${key}|right`);
    }

    return [startX, endX];
  }

  // The random value is cached, and scaled by range each time it is used. The
  // range can change (it shrinks with the cloud while it grows), but the noise
  // stays the same. An unset entry is undefined: 0 is a valid cached value
  // The noise value depends only on the seed, the edge ("cell-4|left") and the line, never
  // on which shapes were drawn first, so a cloud has the same edges however it got there
  getCachedEdgeOffset(offsets, lineId, range, edge) {
    let unitNoise = offsets[lineId];
    if (unitNoise === undefined) {
      unitNoise = hashToUnit(this.seed, edge, lineId) - 0.5;
      offsets[lineId] = unitNoise;
    }
    return Math.round(unitNoise * range);
  }

  draw() {
    for (const line of this.lines) {
      this.drawLine(line);
    }
  }

  drawLine(line) {
    // For each final segment, draw a line to the canvas
    const shadowRange = this.getShadowRange(line);
    for (const segment of line.segments) {
      this.drawSegmentRange(segment, segment.startX, segment.endX, line, shadowRange);
    }
  }

  // Draws the part of a segment between x1 and x2.
  // A gap (padding) is drawn in the paper colour, so that it is blank paper in the
  // line, unlike the spaces between lines, which are see-through. In shadow there
  // is no padding, and what the gap cleared is drawn instead
  drawSegmentRange(segment, x1, x2, line, shadowRange) {
    if (x2 <= x1) return;

    if (!segment.isGap) {
      this.drawSegment(x1, x2, line, segment);
      return;
    }

    // The parts of the gap outside the shadow (one of the two is empty)
    if (this.paper) {
      const outside = shadowRange
        ? [
            [x1, Math.min(x2, shadowRange.from)],
            [Math.max(x1, shadowRange.to), x2],
          ]
        : [[x1, x2]];
      for (const [start, end] of outside) {
        if (end > start) this.drawSegment(start, end, line, segment);
      }
    }

    if (!shadowRange) return;
    const shadowX1 = Math.max(x1, shadowRange.from);
    const shadowX2 = Math.min(x2, shadowRange.to);
    for (const cleared of segment.under) {
      this.drawSegmentRange(
        cleared,
        Math.max(cleared.startX, shadowX1),
        Math.min(cleared.endX, shadowX2),
        line,
        shadowRange,
      );
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
        const [colour, lineWidth, lineBreak] = this.getStrokeParameters(currentX, segment, line);
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
      const mod = currentX % HatchedRenderer.DRAW_STEP;
      if (mod == 0) {
        currentX += HatchedRenderer.DRAW_STEP;
      } else {
        currentX += HatchedRenderer.DRAW_STEP - mod;
      }
    }

    // Get the parameters for the final line section
    yOffset = this.getWaveYOffset(x2, segment, line);
    const [colour, lineWidth, lineBreak] = this.getStrokeParameters(currentX, segment, line);

    if (lineBreak) return;

    // Draw the final point
    this.context.lineTo(x2, line.y + yOffset);
    this.context.lineWidth = lineWidth;
    this.context.strokeStyle = colour;
    //this.context.lineCap = "round";
    this.context.stroke();
  }

  // Which of the per-step noise values (see initialiseNoise) belongs to x. A stroke that
  // ends exactly on the right edge of the canvas uses the last one
  drawStepIndex(x) {
    return Math.min(Math.floor(x / HatchedRenderer.DRAW_STEP), this.numXSteps - 1);
  }

  getStrokeParameters(x1, segment, line) {
    const xDrawStep = this.drawStepIndex(x1);

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
        ((line.id + 1) / this.lines.length) * (this.backgroundLineWidthGradientDown - 1) + 1;
    }

    // Decide whether to add a line break at the current point
    const lineBreak = this.noise.lineBreaks[line.id][xDrawStep];

    return [colour, lineWidth, lineBreak];
  }

  getStrokeColour(x1, segment, line) {
    const xDrawStep = this.drawStepIndex(x1);
    // A gap is plain paper, with no noise
    if (segment.isGap) {
      return `hsl(${this.paper.hue}, ${this.paper.sat}%, ${this.paper.light}%)`;
    }

    // Get the colour of the segment
    let colour = this.getColourOfSegment(segment, line);

    // Apply the shadow diagonal if needed
    if (this.isInShadow(x1, line) && !segment.isBackground) {
      colour = this.colours.dark2;
    }

    // Apply lightness noise
    const lightnessNoise = this.noise.lightness[line.id][xDrawStep];
    const light = Math.min(Math.max(colour.light + lightnessNoise, 0), 100);
    return `hsl(${colour.hue}, ${colour.sat}%, ${light}%)`;
  }

  getColourOfSegment(segment, line) {
    let colour;
    if (segment.isBackground) {
      colour = this.backgroundColours[line.id];
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

  // The x range of the line that is in shadow, or undefined if there is none
  getShadowRange(line) {
    if (!this.hasShadowDiagonal) return undefined;

    const shadowDiagonalX = this.shadowDiagonalLocations[line.id];
    return this.shadowDiagonalDirection == "left"
      ? { from: -Infinity, to: shadowDiagonalX }
      : { from: shadowDiagonalX, to: Infinity };
  }

  getShadowCrossingForLine(line) {
    const y = line.y;
    // Remember: Positive y is down, but we have specified the angle from the x-axis
    // along the base of the dome
    const yFromBase = this.dome.y - y;
    let shadowX = yFromBase / Math.tan(this.shadowDiagonalAngle) + this.shadowDiagonalXOrigin;

    // Apply the shadow diagonal edge noise for this line
    shadowX += this.noise.shadowDiagonal[line.id];
    shadowX = Math.round(shadowX);

    shadowX = Math.max(Math.min(shadowX, this.width), 0);

    return shadowX;
  }

  getAffectedLines(startY, endY) {
    return this.lines.filter((line) => line.y >= startY && line.y <= endY);
  }

  addSegment(lineId, startX, endX, layerId, isBackground, isGap = false) {
    // Segments on a line are kept sorted by startX and mutually exclusive.
    // The new segment is written over whatever is underneath it, so it is
    // spliced straight into the right place and the list never needs a re-sort.
    const segments = this.lines[lineId].segments;
    const newSegment = { startX, endX, layerId, isBackground, isGap };

    // Binary search for the first segment that ends beyond the new start
    let first = 0;
    let high = segments.length;
    while (first < high) {
      const mid = (first + high) >> 1;
      if (segments[mid].endX > startX) {
        high = mid;
      } else {
        first = mid + 1;
      }
    }

    // Every segment from `first` that starts before the new end is overlapped
    let end = first;
    while (end < segments.length && segments[end].startX < endX) {
      end++;
    }

    const replacement = [];
    if (end > first) {
      const firstOverlapped = segments[first];
      const lastOverlapped = segments[end - 1];

      // A gap keeps what it covers, clipped to the gap, for drawing in shadow
      if (isGap) {
        newSegment.under = segments.slice(first, end).map((covered) => ({
          ...covered,
          startX: Math.max(covered.startX, startX),
          endX: Math.min(covered.endX, endX),
        }));
      }

      // The right-hand remainder must be copied before the left one is trimmed,
      // as both can come from the same segment (the new one splits it in two)
      const rightRemainder =
        lastOverlapped.endX > endX ? { ...lastOverlapped, startX: endX } : undefined;

      if (firstOverlapped.startX < startX) {
        firstOverlapped.endX = startX;
        replacement.push(firstOverlapped);
      }
      replacement.push(newSegment);
      if (rightRemainder) replacement.push(rightRemainder);
    } else {
      if (isGap) newSegment.under = [];
      replacement.push(newSegment);
    }

    segments.splice(first, end - first, ...replacement);
  }

  calculateBaseYOffset() {
    // Precalculates the values of sine at each draw step point to save time
    // These values are used when there is not a custom wave period for the layer

    const numXSteps = this.numXSteps;

    for (const line of this.lines) {
      const waveXNoise = this.noise.waveXOffset[line.id];
      const yOffsets = [...Array(numXSteps).keys()].map((step) =>
        Math.sin(
          ((step * HatchedRenderer.DRAW_STEP + waveXNoise) * 2 * Math.PI) / this.defaultWavePeriod,
        ),
      );
      this.baseYOffset[line.id] = yOffsets;
    }
  }

  getWaveYOffset(x, segment, line) {
    const xDrawStep = this.drawStepIndex(x);
    // Returns the y-offset to be applied at the specified x
    // To add the wave defined by wavePeriod and waveAmplitude
    let wavePeriod = this.defaultWavePeriod;
    let waveAmplitude = this.defaultWaveAmplitude;

    const layer = this.layers[segment.layerId] || undefined;

    const yNoise = this.noise.yOffset[line.id][xDrawStep];

    if (layer) {
      // Check whether custom wave parameters exist for this layer
      wavePeriod = layer.wavePeriod || wavePeriod;
      waveAmplitude = layer.waveAmplitude || waveAmplitude;
    }

    if (wavePeriod == this.defaultWavePeriod) {
      // We can use the precalculated values
      return this.baseYOffset[line.id][xDrawStep] * waveAmplitude + yNoise;
    }

    // If there is a custom wave period, calculate using sine.
    // Add some noise that shifts the waves left or right
    // This does not change the start or end x values of the line segment
    const waveXNoise = this.noise.waveXOffset[line.id];

    return Math.sin(((x + waveXNoise) * 2 * Math.PI) / wavePeriod) * waveAmplitude + yNoise;
  }
}
