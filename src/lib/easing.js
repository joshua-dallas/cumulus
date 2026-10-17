// Easing functions turn linear progress (0 to 1, from elapsed time) into
// progress that speeds up and slows down. All map 0 to 0 and 1 to 1.

export function clamp01(value) {
  return Math.min(Math.max(value, 0), 1);
}

// Fast at first, then settling: how something that is pushed out and then
// loses momentum behaves. Used for a cloud growing from nothing
export function easeOutCubic(t) {
  return 1 - (1 - t) ** 3;
}

// Gentle at both ends. Used for a cloud shrinking away and for detail
// that should only start to appear once the cloud is already growing
export function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;
}
