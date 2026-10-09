export function mulberry32(seed) {
  let state = seed >>> 0;

  return () => {
    let value = (state += 0x6d2b79f5);
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
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
      (verticesFilter
        ? verticesFilter(verticesCopy[i - 1], verticesCopy[i])
        : true)
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
