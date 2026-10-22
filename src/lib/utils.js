export function mulberry32(seed) {
  let state = seed >>> 0;

  return () => {
    let value = (state += 0x6d2b79f5);
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

// Smooth ease from 0 to 1 whose slope is 0 at both ends (Perlin's "fade").
// It makes the noise flow through each node instead of kinking at it
function fade(t) {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

// 1-D Perlin (gradient) noise: a smooth, wandering line of values, like the
// drift of a pen, rather than independent random values.
//
//   random    a function returning numbers in [0, 1), e.g. from mulberry32
//   length    how many values to return
//   numNodes  how many nodes the values are spread across (at least 2). Each
//             node gets a random slope, and the values are a smooth blend of
//             the slopes of the two nodes either side. More nodes means faster
//             wandering, fewer means long, slow drifts. The noise is 0 at a node
//   scale     multiplies the values. With a scale of 1 they are in [-0.5, 0.5],
//             the same as (random() - 0.5), so it can replace that directly
//
// Uses numNodes random numbers.
export function perlinNoise1D(random, length, numNodes, scale = 1) {
  const nodes = Math.max(2, Math.floor(numNodes));
  const slopes = Array.from({ length: nodes }, () => random() * 2 - 1);

  const values = [];
  for (let i = 0; i < length; i++) {
    // Where this value is along the nodes: 0 is the first node, nodes - 1 the last
    const position = length > 1 ? (i * (nodes - 1)) / (length - 1) : 0;
    const node = Math.min(Math.floor(position), nodes - 2);
    const t = position - node; // how far from this node to the next, 0 to 1

    // Each of the two nodes says where the line would be if it followed its slope
    // to this point, and the fade blends them
    const fromLeft = slopes[node] * t;
    const fromRight = slopes[node + 1] * (t - 1);
    const blend = fade(t);
    values.push((fromLeft + blend * (fromRight - fromLeft)) * scale);
  }
  return values;
}

export function intersection(a, b) {
  const intersectionStart = Math.max(a[0], b[0]);
  const intersectionEnd = Math.min(a[1], b[1]);
  if (intersectionStart < intersectionEnd) {
    return [intersectionStart, intersectionEnd];
  }
  return undefined;
}

// TODO: Better name
export function intersectionOfMany(listA, listB) {
  // Returns the intersection of two lists of ranges
  // I.e. (union listA) intersection with (union listB)
  let intersections = [];
  for (const a of listA) {
    for (const b of listB) {
      const overlap = intersection(a, b);
      if (overlap) {
        intersections.push(overlap);
      }
    }
  }
  return intersections;
}

export function subtractRange(a, b) {
  // Subtracts the range b from the range a
  // Returns a list of ranges

  const overlap = intersection(a, b);
  if (overlap) {
    if (overlap[0] == a[0] && overlap[1] == a[1]) {
      // The entire range a was intersected by b
      return [];
    } else if (overlap[0] == a[0]) {
      // If the union lines up with the beggining of a, shorten the remaining
      return [[overlap[1], a[1]]];
    } else if (overlap[1] == a[1]) {
      // If the union lines up with the end of a, shorten the remaining
      return [[a[0], overlap[0]]];
    } else {
      // If the intersection splits 'a' in two, return two new ranges
      return [
        [a[0], overlap[0]],
        [overlap[1], a[1]],
      ];
    }
  } else {
    // Return the original range if there was no intersection
    return [...a];
  }
}

export function subtractRanges(a, listB) {
  // subtracts the ranges in listB from a
  // assumes that the ranges in listB are mutually exclusive and sorted
  let remaining = [...a];
  let newRanges = [];
  for (const b of listB) {
    // find the overlap between the remaining range of a and the current range from listB
    let overlap = intersection(remaining, b);

    if (overlap) {
      if (overlap[0] == remaining[0]) {
        // If the overlap lines up with the beggining of remaining, shorten the remaining
        remaining[0] = overlap[1];
      } else {
        // If a overlap splits 'a' in two, add a new range to the list
        newRanges.push([remaining[0], overlap[0]]);
        remaining[0] = overlap[1];
      }
    }
  }

  if (remaining[0] != remaining[1]) {
    // a still has some length
    newRanges.push(remaining);
  }

  return newRanges;
}

export function getVerticalLinesOfPolygon(vertices) {
  let verticalLines = [];

  // Make a copy and duplicate the first point at the end to allow for
  // The last line to be formed
  let verticesCopy = [...vertices];
  verticesCopy.push(vertices[0]);

  for (let i = 1; i < verticesCopy.length; i++) {
    if (verticesCopy[i - 1].x == verticesCopy[i].x && verticesCopy[i - 1].y != verticesCopy[i].y) {
      verticalLines.push({
        x: verticesCopy[i].x,
        y1: Math.min(verticesCopy[i - 1].y, verticesCopy[i].y),
        y2: Math.max(verticesCopy[i - 1].y, verticesCopy[i].y),
      });
    }
  }

  return verticalLines;
}

export function getHorizontalLinesOfPolygon(vertices, verticesFilter) {
  let horizontalLines = [];

  // Make a copy and duplicate the first point at the end to allow for
  // The last line to be formed
  let verticesCopy = [...vertices];
  verticesCopy.push(vertices[0]);

  for (let i = 1; i < verticesCopy.length; i++) {
    if (
      verticesCopy[i - 1].y == verticesCopy[i].y &&
      verticesCopy[i - 1].x != verticesCopy[i].x &&
      (verticesFilter ? verticesFilter(verticesCopy[i - 1], verticesCopy[i]) : true)
    ) {
      horizontalLines.push({
        y: verticesCopy[i].y,
        x1: Math.min(verticesCopy[i - 1].x, verticesCopy[i].x),
        x2: Math.max(verticesCopy[i - 1].x, verticesCopy[i].x),
        vertices: [verticesCopy[i - 1], verticesCopy[i]],
      });
    }
  }

  return horizontalLines;
}

export function distanceBetweenPoints(x1, y1, x2, y2) {
  return Math.sqrt((x1 - x2) ** 2 + (y1 - y2) ** 2);
}

export function clamp(val, min, max) {
  return Math.min(Math.max(min, val), max);
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

// Mixes two { hue, sat, light } colours: t = 0 is a, t = 1 is b. The hue takes the
// shortest way round the colour wheel, so 350 to 10 goes through 0, not through 180
export function mixColours(a, b, t) {
  const hueChange = ((b.hue - a.hue + 540) % 360) - 180;
  return {
    hue: (a.hue + hueChange * t + 360) % 360,
    sat: lerp(a.sat, b.sat, t),
    light: lerp(a.light, b.light, t),
  };
}
