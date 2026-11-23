import type { TapOffset } from './Element';

/** Default hold time for {@link Element.longPress}, in ms. */
export const DEFAULT_LONG_PRESS_MS = 1000;

/**
 * Returns the long-press duration rounded to whole ms (W3C pause durations
 * must be integers), or throws when it is not a non-negative finite number.
 */
export function checkLongPressDuration(duration: number | undefined): number {
  const value = duration ?? DEFAULT_LONG_PRESS_MS;
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`longPress: duration must be a finite number of ms >= 0, got ${duration}`);
  }
  return Math.round(value);
}

/**
 * Throws unless `offset` lies inside a box of the given size:
 * `0 <= x < width` and `0 <= y < height` (the far edges are outside).
 */
export function checkTapOffset(offset: TapOffset, width: number, height: number): void {
  const inside = (v: number, max: number) => Number.isFinite(v) && v >= 0 && v < max;
  if (!offset || !inside(offset.x, width) || !inside(offset.y, height)) {
    throw new Error(
      `tapAt: offset ${JSON.stringify({ x: offset?.x ?? null, y: offset?.y ?? null })} is outside the element bounds ` +
      `(${width}x${height}); x must be in [0, ${width}) and y in [0, ${height}), measured from the top-left corner`,
    );
  }
}
