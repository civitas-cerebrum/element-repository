import type { TapOffset } from '../types/Element';

/** Default hold time for {@link Element.longPress}, in ms. */
export const DEFAULT_LONG_PRESS_MS = 1000;

/** Default `maxSwipes` of {@link Element.scrollIntoView}: the swipe limit of a platform sweep. */
export const DEFAULT_MAX_SWIPES = 20;

/**
 * Returns the swipe limit of a `scrollIntoView` sweep ({@link DEFAULT_MAX_SWIPES}
 * when omitted), or throws when it is not a positive integer.
 */
export function checkMaxSwipes(maxSwipes: number | undefined): number {
  if (maxSwipes === undefined) return DEFAULT_MAX_SWIPES;
  if (!Number.isInteger(maxSwipes) || maxSwipes < 1) {
    throw new Error(`scrollIntoView: maxSwipes must be a positive integer, got ${maxSwipes}`);
  }
  return maxSwipes;
}

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
