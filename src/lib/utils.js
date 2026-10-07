export function mulberry32(seed) {
  let state = seed >>> 0;

  return () => {
    let value = (state += 0x6d2b79f5);
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function union(a, b) {
  const unionStart = Math.max(a[0], b[0]);
  const unionEnd = Math.min(a[1], b[1]);
  if (unionStart < unionEnd) {
    return [unionStart, unionEnd];
  }
  return undefined;
}

export function unionOfMany(listA, listB) {
  let unions = [];
  for (const a of listA) {
    for (const b of listB) {
      const overlap = union(a, b);
      if (overlap) {
        unions.push(overlap);
      }
    }
  }
  return unions;
}

export function subtractRanges(a, listB) {
  // subtracts the ranges in listB from a
  // assumes that the ranges in listB are mutually exclusive and sorted
  let remaining = [...a];
  let newRanges = [];
  for (const b of listB) {
    // find the overlap between the remaining range of a and the current range from listB
    let overlap = union(remaining, b);

    if (overlap) {
      if (overlap[0] == remaining[0]) {
        // If the union lines up with the beggining of remaining, shorten the remaining
        remaining[0] = overlap[1];
      } else {
        // If a union splits 'a' in two, add a new range to the list
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
