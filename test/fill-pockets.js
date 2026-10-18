// A way to measure whether the fills of a cloud have torn.
//
// The cloud is drawn as plain pixels: every cell, fill circle and fill polygon
// covers the pixels it contains. A "pocket" is a patch of uncovered pixels that is
// completely surrounded by cloud: sky showing through the middle of the cloud, which
// is what a tear in the fills looks like. Patches smaller than MIN_POCKET_AREA are
// ignored, as they are only the 1px seams between shapes in this simple drawing.

const MIN_POCKET_AREA = 30;

// Returns a grid (row by row) with 1 where something covers the pixel
function drawCloud(builder) {
  const { width, height } = builder;
  const covered = new Uint8Array(width * height);

  const fillCircle = (cx, cy, radius) => {
    for (let y = Math.max(0, Math.floor(cy - radius)); y <= Math.min(height - 1, Math.ceil(cy + radius)); y++) {
      const half = Math.sqrt(Math.max(0, radius * radius - (y - cy) ** 2));
      for (let x = Math.max(0, Math.floor(cx - half)); x <= Math.min(width - 1, Math.ceil(cx + half)); x++) {
        covered[y * width + x] = 1;
      }
    }
  };

  for (const cell of builder.cells) fillCircle(cell.x, cell.y, cell.radius);
  for (const circle of [...builder.fillCircles, ...builder.horizontalFillCircles]) {
    fillCircle(circle.x, circle.y, circle.radius);
  }

  // The fill polygons only have vertical and horizontal edges. On each row, the fill
  // is between the vertical edges that cross it (the middle one is dropped if there
  // are three, as the renderer does)
  for (const polygon of [builder.cloudInnerLeft, builder.cloudInnerRight]) {
    const top = Math.ceil(Math.min(...polygon.map((v) => v.y)));
    const bottom = Math.floor(Math.max(...polygon.map((v) => v.y)));
    for (let y = Math.max(0, top); y <= Math.min(height - 1, bottom); y++) {
      const crossings = [];
      for (let i = 1; i < polygon.length; i++) {
        const [a, b] = [polygon[i - 1], polygon[i]];
        if (a.x === b.x && Math.min(a.y, b.y) <= y && y <= Math.max(a.y, b.y)) crossings.push(a.x);
      }
      crossings.sort((p, q) => p - q);
      if (crossings.length === 3) crossings.splice(1, 1);
      if (crossings.length < 2) continue;
      for (let x = Math.max(0, Math.floor(crossings[0])); x <= Math.min(width - 1, crossings[1]); x++) {
        covered[y * width + x] = 1;
      }
    }
  }
  return covered;
}

// The total area of the pockets in the cloud
export function pocketArea(builder) {
  const { width, height } = builder;
  const covered = drawCloud(builder);

  // Group the uncovered pixels into patches. A patch that reaches the edge of the
  // canvas is sky; any other is a pocket
  const visited = new Uint8Array(width * height);
  const stack = new Int32Array(width * height);
  let area = 0;

  for (let start = 0; start < covered.length; start++) {
    if (covered[start] || visited[start]) continue;

    let top = 0;
    stack[top++] = start;
    visited[start] = 1;
    let size = 0;
    let touchesEdge = false;
    while (top > 0) {
      const i = stack[--top];
      size++;
      const x = i % width;
      const y = (i / width) | 0;
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) touchesEdge = true;

      // Visit the four neighbours that are uncovered and not seen yet
      if (x > 0 && !covered[i - 1] && !visited[i - 1]) (visited[i - 1] = 1), (stack[top++] = i - 1);
      if (x < width - 1 && !covered[i + 1] && !visited[i + 1]) (visited[i + 1] = 1), (stack[top++] = i + 1);
      if (y > 0 && !covered[i - width] && !visited[i - width]) (visited[i - width] = 1), (stack[top++] = i - width);
      if (y < height - 1 && !covered[i + width] && !visited[i + width]) (visited[i + width] = 1), (stack[top++] = i + width);
    }
    if (!touchesEdge && size >= MIN_POCKET_AREA) area += size;
  }
  return area;
}

// Fill edges (the vertical sides of the fill polygons) that are not backed by a
// cell: they would be seen as straight vertical lines. Returns how many pixels of
// edge there are
export function exposedFillEdgePixels(builder) {
  let exposed = 0;
  const sides = [[builder.cloudInnerLeft, -1], [builder.cloudInnerRight, 1]];
  for (const [polygon, side] of sides) {
    for (let i = 1; i < polygon.length; i++) {
      const [a, b] = [polygon[i - 1], polygon[i]];
      if (a.x !== b.x || Math.abs(a.x - builder.dome.x) < 1) continue; // the centre line is not an edge

      for (let y = Math.ceil(Math.min(a.y, b.y)); y <= Math.max(a.y, b.y); y++) {
        // The pixel just outside the fill edge should be inside a cell
        const backed = builder.cells.some((c) => (a.x + side - c.x) ** 2 + (y - c.y) ** 2 <= c.radius ** 2);
        if (!backed) exposed++;
      }
    }
  }
  return exposed;
}
